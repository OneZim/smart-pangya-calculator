use crate::constants::EVT_COURSES_UPDATED;
use crate::error::AppError;
use crate::state::{LanguagesCache, PinLocationCache};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

// =====================================================================
// LANGUES
// =====================================================================

#[tauri::command]
pub fn get_available_languages(app: AppHandle) -> Result<Vec<String>, AppError> {
    let cache_state = app.state::<Arc<Mutex<LanguagesCache>>>();

    {
        let lock = cache_state.lock().unwrap();
        if let Some(langs) = &lock.available {
            return Ok(langs.clone());
        }
    }

    let mut lang_dir = app
        .path()
        .resource_dir()
        .map_err(|e| AppError::Message(e.to_string()))?
        .join("lang");

    if !lang_dir.is_dir() {
        lang_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("lang");
    }

    if !lang_dir.is_dir() {
        return Err(AppError::Message(format!(
            "Dossier introuvable. Chemin testé : {:?}",
            lang_dir
        )));
    }

    let entries = fs::read_dir(lang_dir)?;
    let mut langs = Vec::new();

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() && path.extension().map_or(false, |ext| ext == "json") {
                if let Some(file_stem) = path.file_stem() {
                    langs.push(file_stem.to_string_lossy().to_string());
                }
            }
        }
    }

    {
        let mut lock = cache_state.lock().unwrap();
        lock.available = Some(langs.clone());
    }

    Ok(langs)
}

#[tauri::command]
pub fn load_language_json(app: AppHandle, lang: String) -> Result<String, AppError> {
    let cache_state = app.state::<Arc<Mutex<LanguagesCache>>>();

    {
        let lock = cache_state.lock().unwrap();
        if let Some(content) = lock.contents.get(&lang) {
            return Ok(content.clone());
        }
    }

    let mut file_path = app
        .path()
        .resource_dir()
        .map_err(|e| AppError::Message(e.to_string()))?
        .join("lang")
        .join(format!("{}.json", &lang));

    if !file_path.is_file() {
        file_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("lang")
            .join(format!("{}.json", &lang));
    }

    if !file_path.is_file() {
        return Err(AppError::Message(format!(
            "Fichier {}.json introuvable.",
            lang
        )));
    }

    let content = fs::read_to_string(file_path)?;

    {
        let mut lock = cache_state.lock().unwrap();
        lock.contents.insert(lang.clone(), content.clone());
    }

    Ok(content)
}

// =====================================================================
// DONNÉES DE PARCOURS (Lecture : Working > Embarqué)
// =====================================================================

/// Chemin du fichier embarqué dans les ressources de l'app, avec repli
/// sur le dépôt pour le mode développement.
fn embedded_pin_path(app: &AppHandle) -> PathBuf {
    let mut embedded_path = app
        .path()
        .resource_dir()
        .map(|dir| dir.join("data").join("pin_location.json"))
        .unwrap_or_else(|_| PathBuf::new());

    if !embedded_path.is_file() {
        embedded_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("data")
            .join("pin_location.json");
    }

    embedded_path
}

/// Valide la structure des données de parcours.
/// Le fichier de travail est prioritaire sur le fichier embarqué : y écrire
/// une structure invalide rendrait le calculateur inutilisable, on refuse donc.
fn validate_pin_data(data: &serde_json::Value) -> Result<(), String> {
    let course = data
        .get("course")
        .ok_or_else(|| "champ \"course\" absent des données".to_string())?;

    let course = course
        .as_object()
        .ok_or_else(|| "le champ \"course\" doit être un objet".to_string())?;

    if course.is_empty() {
        return Err("aucun parcours dans les données".to_string());
    }

    for (course_name, course_data) in course {
        let course_obj = course_data
            .as_object()
            .ok_or_else(|| format!("le parcours \"{course_name}\" n'est pas un objet"))?;

        let holes = course_obj
            .get("holes")
            .or_else(|| course_obj.get("trous"))
            .ok_or_else(|| format!("le parcours \"{course_name}\" n'a aucun champ holes"))?;

        let holes_obj = holes.as_object().ok_or_else(|| {
            format!("le champ holes du parcours \"{course_name}\" n'est pas un objet")
        })?;

        if holes_obj.is_empty() {
            return Err(format!("le parcours \"{course_name}\" n'a aucun trou"));
        }

        for (hole_name, hole_data) in holes_obj {
            let hole_obj = hole_data.as_object().ok_or_else(|| {
                format!("le trou \"{hole_name}\" de \"{course_name}\" n'est pas un objet")
            })?;

            if let Some(pins) = hole_obj.get("pins") {
                if !pins.is_null() && !pins.is_object() {
                    return Err(format!(
                        "le champ pins du trou \"{hole_name}\" de \"{course_name}\" n'est pas un objet"
                    ));
                }
            }
        }
    }

    Ok(())
}

/// Lit un fichier de données et le valide.
/// `Ok(None)` = fichier lisible mais structure invalide (à ignorer).
fn read_valid_pin_file(path: &PathBuf) -> Result<Option<serde_json::Value>, String> {
    let contenu = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let value: serde_json::Value = serde_json::from_str(&contenu).map_err(|e| e.to_string())?;

    match validate_pin_data(&value) {
        Ok(()) => Ok(Some(value)),
        Err(e) => {
            println!("⚠️ Données invalides ignorées ({:?}) : {}", path, e);
            Ok(None)
        }
    }
}

#[tauri::command]
pub fn parcours(app: AppHandle) -> Result<serde_json::Value, AppError> {
    let cache_state = app.state::<Arc<Mutex<PinLocationCache>>>();

    // 1. Cache en mémoire
    {
        let lock = cache_state.lock().unwrap();
        if let Some(data) = &lock.data {
            return Ok(data.clone());
        }
    }

    // 2. PRIORITÉ : fichier de travail dans AppData.
    //    S'il est illisible ou structurellement invalide on l'ignore
    //    complètement (retour au fichier embarqué) plutôt que de renvoyer
    //    des données inutilisables.
    let working_path = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Message(e.to_string()))?
        .join("pin_location.json");

    if working_path.is_file() {
        match read_valid_pin_file(&working_path) {
            Ok(Some(value)) => {
                let mut lock = cache_state.lock().unwrap();
                lock.data = Some(value.clone());
                return Ok(value);
            }
            Ok(None) => {}
            Err(err) => {
                println!("⚠️ Fichier de travail illisible ({}) : {:?}", err, working_path);
            }
        }
    }

    // 3. FALLBACK : fichier embarqué
    let embedded_path = embedded_pin_path(&app);

    if !embedded_path.is_file() {
        return Err(AppError::Message(format!(
            "Fichier introuvable. Chemin testé : {:?}",
            embedded_path
        )));
    }

    let contenu = fs::read_to_string(&embedded_path)?;
    let value: serde_json::Value = serde_json::from_str(&contenu)?;

    let mut lock = cache_state.lock().unwrap();
    lock.data = Some(value.clone());

    Ok(value)
}

// =====================================================================
// SAUVEGARDE (Primary / Working)
// =====================================================================

#[tauri::command]
pub fn save_pin_location(app: AppHandle, data: serde_json::Value) -> Result<String, AppError> {
    // 1. Valider AVANT toute écriture : ce fichier est prioritaire sur les
    //    données embarquées, une structure invalide casserait le calculateur.
    if let Err(e) = validate_pin_data(&data) {
        return Err(AppError::Message(format!("Données refusées : {e}")));
    }

    // 2. Obtenir le dossier utilisateur (AppData)
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Message(e.to_string()))?;

    fs::create_dir_all(&app_data_dir).map_err(|e| AppError::Message(e.to_string()))?;

    let primary_path = app_data_dir.join("primary_pin_location.json");
    let working_path = app_data_dir.join("pin_location.json");
    let backup_path = app_data_dir.join("pin_location.bak.json");
    let tmp_path = app_data_dir.join("pin_location.json.tmp");

    // 3. Si primary n'existe PAS → on le crée avec l'original embarqué
    if !primary_path.exists() {
        let embedded_path = embedded_pin_path(&app);

        if embedded_path.is_file() {
            fs::copy(&embedded_path, &primary_path)
                .map_err(|e| AppError::Message(e.to_string()))?;
            println!("✅ primary_pin_location.json créé (backup de l'original)");
        } else {
            return Err(AppError::Message(
                "Fichier original introuvable".to_string(),
            ));
        }
    }

    // 4. Conserver l'état précédent avant écrasement
    if working_path.is_file() {
        fs::copy(&working_path, &backup_path)
            .map_err(|e| AppError::Message(e.to_string()))?;
    }

    // 5. Écriture atomique : fichier temporaire puis rename, pour ne jamais
    //    laisser un pin_location.json tronqué si l'app crash pendant l'écriture.
    let contenu_json =
        serde_json::to_string_pretty(&data).map_err(|e| AppError::Message(e.to_string()))?;
    fs::write(&tmp_path, contenu_json).map_err(|e| AppError::Message(e.to_string()))?;
    fs::rename(&tmp_path, &working_path).map_err(|e| AppError::Message(e.to_string()))?;

    // 6. Invalider le cache
    let cache_state = app.state::<Arc<Mutex<PinLocationCache>>>();
    {
        let mut lock = cache_state.lock().unwrap();
        lock.data = None;
    }

    // 7. Prévenir les fenêtres que les parcours ont changé (resync éditeur/app)
    let _ = app.emit(EVT_COURSES_UPDATED, ());

    Ok("Fichier sauvegardé avec succès.".to_string())
}
