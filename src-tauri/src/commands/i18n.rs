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

/// Fichier embarqué, et nom du fichier de travail dans l'AppData.
/// Les clés de pin y sont des ordinaux ("1", "2"...) et non plus des
/// distances : voir `normalize_pin_data`.
const PARCOURS_FILE: &str = "parcours.json";
/// Copie de sauvegarde de l'original, créée au premier enregistrement.
const PARCOURS_PRIMARY_FILE: &str = "primary_parcours.json";
/// État précédant le dernier enregistrement.
const PARCOURS_BACKUP_FILE: &str = "parcours.bak.json";
/// Ancien nom du fichier de travail (clés de pin = "<distance>y").
/// Conservé uniquement comme source de lecture pour migrer les données
/// d'une installation antérieure.
const PARCOURS_LEGACY_FILE: &str = "pin_location.json";

/// Chemin du fichier embarqué dans les ressources de l'app, avec repli
/// sur le dépôt pour le mode développement.
fn embedded_pin_path(app: &AppHandle) -> PathBuf {
    let mut embedded_path = app
        .path()
        .resource_dir()
        .map(|dir| dir.join("data").join(PARCOURS_FILE))
        .unwrap_or_else(|_| PathBuf::new());

    if !embedded_path.is_file() {
        embedded_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("data")
            .join(PARCOURS_FILE);
    }

    embedded_path
}

/// Convertit les clés de pin "<distance>y" de l'ancien format en ordinaux
/// "1", "2"... triés par distance.
///
/// Idempotent : un jeu de clés déjà ordinaux n'est pas touché. La
/// normalisation ne supprime ni ne fusionne de pin — la détection des
/// distances dupliquées est le rôle de `validate_pin_data`.
///
/// Note : `serde_json::Map` est ici une BTreeMap (ordre lexicographique).
/// Les trous Pangya comportent 1 à 3 pins, donc l'ordre d'écriture reste
/// identique à l'ordre numérique. Au-delà de 9 pins, seul l'ordre
/// cosmétique du fichier serait affected : côté JS les clés entières sont
/// toujours énumérées dans l'ordre croissant.
fn normalize_pin_data(data: &mut serde_json::Value) {
    let course = match data.get_mut("course").and_then(|c| c.as_object_mut()) {
        Some(course) => course,
        None => return,
    };

    for course_data in course.values_mut() {
        let holes = match course_data.get_mut("holes").and_then(|h| h.as_object_mut()) {
            Some(holes) => holes,
            None => continue,
        };

        for hole_data in holes.values_mut() {
            let pins = match hole_data.get_mut("pins").and_then(|p| p.as_object_mut()) {
                Some(pins) => pins,
                None => continue,
            };

            let deja_ordinal = pins.keys().all(|cle| cle.parse::<u32>().is_ok());

            if deja_ordinal {
                continue;
            }

            let existing = std::mem::take(pins);
            let mut entries: Vec<(String, serde_json::Value)> = existing.into_iter().collect();

            entries.sort_by(|a, b| {
                let da =
                    a.1.get("pinDistance")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);
                let db =
                    b.1.get("pinDistance")
                        .and_then(|v| v.as_f64())
                        .unwrap_or(0.0);

                da.partial_cmp(&db).unwrap_or(std::cmp::Ordering::Equal)
            });

            for (index, (_, pin)) in entries.into_iter().enumerate() {
                pins.insert((index + 1).to_string(), pin);
            }
        }
    }
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

            let Some(pins) = hole_obj.get("pins") else {
                continue;
            };

            if pins.is_null() {
                continue;
            }

            validate_pins(pins, course_name, hole_name)?;
        }
    }

    Ok(())
}

/// Valide les pins d'un trou : clés ordinales et distance unique.
/// L'unicité est un invariant métier du jeu — sur les 302 trous Pangya
/// aucun ne contient deux pins à la même distance, la distance est donc
/// l'identité naturelle du pin. Les clés étant désormais des ordinaux,
/// plus rien ne l'impose implicitement : on le vérifie.
fn validate_pins(
    pins: &serde_json::Value,
    course_name: &str,
    hole_name: &str,
) -> Result<(), String> {
    let pins_obj = pins.as_object().ok_or_else(|| {
        format!("le champ pins du trou \"{hole_name}\" de \"{course_name}\" n'est pas un objet")
    })?;

    // distance arrondie à 2 décimales -> libellé du pin
    let mut distances: Vec<(String, String)> = Vec::new();

    for (pin_key, pin_value) in pins_obj {
        let est_ordinal = pin_key.parse::<u32>().map(|n| n >= 1).unwrap_or(false);

        if !est_ordinal {
            return Err(format!(
                "la clé de pin \"{pin_key}\" du trou \"{hole_name}\" de \"{course_name}\" \
                 n'est pas un ordinal (attendu \"1\", \"2\"...)"
            ));
        }

        let pin_obj = pin_value.as_object().ok_or_else(|| {
            format!("le pin \"{pin_key}\" du trou \"{hole_name}\" de \"{course_name}\" n'est pas un objet")
        })?;

        let distance = pin_obj
            .get("pinDistance")
            .and_then(|v| v.as_f64())
            .ok_or_else(|| {
                format!(
                    "le pin \"{pin_key}\" du trou \"{hole_name}\" de \"{course_name}\" \
                         n'a pas de pinDistance numérique"
                )
            })?;

        distances.push((
            format!("{distance:.2}"),
            format!("le pin \"{pin_key}\" du trou \"{hole_name}\" de \"{course_name}\""),
        ));
    }

    distances.sort();

    for paire in distances.windows(2) {
        if paire[0].0 == paire[1].0 {
            return Err(format!(
                "{} et {} partagent la distance {}",
                paire[0].1, paire[1].1, paire[0].0
            ));
        }
    }

    Ok(())
}

/// Lit un fichier de données, le valide et le normalise au format courant.
/// `Ok(None)` = fichier lisible mais structure invalide (à ignorer).
fn read_valid_pin_file(path: &PathBuf) -> Result<Option<serde_json::Value>, String> {
    let contenu = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut value: serde_json::Value = serde_json::from_str(&contenu).map_err(|e| e.to_string())?;

    match validate_pin_data(&value) {
        Ok(()) => {
            normalize_pin_data(&mut value);
            Ok(Some(value))
        }
        Err(e) => {
            println!("⚠️ Données invalides ignorées ({:?}) : {}", path, e);
            Ok(None)
        }
    }
}

/// Nom lisible d'une source de données écartée, pour le message utilisateur.
fn nom_source(path: &std::path::Path) -> String {
    path.file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| path.to_string_lossy().to_string())
}

/// Prévient la fenêtre principale qu'un fichier de parcours a été ignoré.
///
/// La liste peut être vide : l'événement n'est émis que lorsqu'il y a
/// réellement quelque chose à signaler, pour ne pas déclencher un bandeau
/// au démarrage normal.
fn emit_pin_data_warning(app: &AppHandle, rejets: Vec<String>) {
    if rejets.is_empty() {
        return;
    }
    let _ = app.emit("pin-data-warning", rejets);
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
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Message(e.to_string()))?;

    let working_path = app_data_dir.join(PARCOURS_FILE);

    // Ancien nom de fichier : une installation antérieure peut n'avoir
    // que celui-ci. Il est lu puis normalisé, la sauvegarde suivante dans
    // l'éditeur le remplacera par le format courant.
    let legacy_path = app_data_dir.join(PARCOURS_LEGACY_FILE);

    let candidates = [working_path, legacy_path];

    // Fichiers écartés lors de cette lecture, avec le motif. La liste est
    // renvoyée au frontend pour qu'il puisse en informer l'utilisateur : un
    // repli silencieux sur les données embarquées ferait croire que les
    // modifications de l'éditeur ont été perdues alors qu'elles ont été
    // ignorées parce qu'invalides.
    let mut rejets: Vec<String> = Vec::new();

    for candidate in &candidates {
        if !candidate.is_file() {
            continue;
        }

        match read_valid_pin_file(candidate) {
            Ok(Some(value)) => {
                if candidate == &candidates[1] {
                    println!(
                        "ℹ️ Ancien fichier de parcours lu et converti ({:?})",
                        candidate
                    );
                }

                let mut lock = cache_state.lock().unwrap();
                lock.data = Some(value.clone());
                emit_pin_data_warning(&app, rejets);
                return Ok(value);
            }
            Ok(None) => {
                rejets.push(format!("{} : structure invalide", nom_source(candidate)));
            }
            Err(err) => {
                println!(
                    "⚠️ Fichier de travail illisible ({}) : {:?}",
                    err, candidate
                );
                rejets.push(format!("{} : {}", nom_source(candidate), err));
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
    let mut value: serde_json::Value = serde_json::from_str(&contenu)?;
    normalize_pin_data(&mut value);

    if let Err(err) = validate_pin_data(&value) {
        return Err(AppError::Message(format!(
            "Le fichier de parcours embarqué est invalide : {err}"
        )));
    }

    let mut lock = cache_state.lock().unwrap();
    lock.data = Some(value.clone());

    emit_pin_data_warning(&app, rejets);
    Ok(value)
}

// =====================================================================
// SAUVEGARDE (Primary / Working)
// =====================================================================

#[tauri::command]
pub fn save_pin_location(app: AppHandle, data: serde_json::Value) -> Result<String, AppError> {
    // 1. Normaliser AVANT validation : l'éditeur travaille en distances, la
    //    conversion en ordinaux est de notre ressort, pas du frontend.
    let mut data = data;
    normalize_pin_data(&mut data);

    // 2. Valider : ce fichier est prioritaire sur les données embarquées,
    //    une structure invalide ou une distance dupliquée casserait le
    //    calculateur.
    if let Err(e) = validate_pin_data(&data) {
        return Err(AppError::Message(format!("Données refusées : {e}")));
    }

    // 3. Obtenir le dossier utilisateur (AppData)
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| AppError::Message(e.to_string()))?;

    fs::create_dir_all(&app_data_dir).map_err(|e| AppError::Message(e.to_string()))?;

    let primary_path = app_data_dir.join(PARCOURS_PRIMARY_FILE);
    let working_path = app_data_dir.join(PARCOURS_FILE);
    let backup_path = app_data_dir.join(PARCOURS_BACKUP_FILE);
    let tmp_path = app_data_dir.join(format!("{PARCOURS_FILE}.tmp"));

    // 4. Si primary n'existe PAS → on le crée avec l'original embarqué
    if !primary_path.exists() {
        let embedded_path = embedded_pin_path(&app);

        if embedded_path.is_file() {
            fs::copy(&embedded_path, &primary_path)
                .map_err(|e| AppError::Message(e.to_string()))?;
            println!("✅ primary_parcours.json créé (backup de l'original)");
        } else {
            return Err(AppError::Message(
                "Fichier original introuvable".to_string(),
            ));
        }
    }

    // 5. Conserver l'état précédent avant écrasement
    if working_path.is_file() {
        fs::copy(&working_path, &backup_path).map_err(|e| AppError::Message(e.to_string()))?;
    }

    // 6. Écriture atomique : fichier temporaire puis rename, pour ne jamais
    //    laisser un parcours.json tronqué si l'app crash pendant l'écriture.
    let contenu_json =
        serde_json::to_string_pretty(&data).map_err(|e| AppError::Message(e.to_string()))?;
    fs::write(&tmp_path, contenu_json).map_err(|e| AppError::Message(e.to_string()))?;
    fs::rename(&tmp_path, &working_path).map_err(|e| AppError::Message(e.to_string()))?;

    // 7. Invalider le cache
    let cache_state = app.state::<Arc<Mutex<PinLocationCache>>>();
    {
        let mut lock = cache_state.lock().unwrap();
        lock.data = None;
    }

    // 8. Prévenir les fenêtres que les parcours ont changé (resync éditeur/app)
    let _ = app.emit(EVT_COURSES_UPDATED, ());

    Ok("Fichier sauvegardé avec succès.".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(course: &str) -> serde_json::Value {
        serde_json::from_str(course).unwrap()
    }

    #[test]
    fn normalise_cles_legacy_en_ordinaux_tries() {
        let mut data = src(r#"{"course":{"Test":{"holes":{"H1":{"par":4,"pins":{
            "417.11y":{"pinDistance":417.11,"pinHeight":-0.56,"teeSlope":-0.22,"ground":100},
            "425.16y":{"pinDistance":425.16,"pinHeight":-0.98,"teeSlope":-0.23,"ground":100},
            "415.96y":{"pinDistance":415.96,"pinHeight":-0.70,"teeSlope":-0.23,"ground":100}
        }}}}}}"#);

        normalize_pin_data(&mut data);

        let pins = &data["course"]["Test"]["holes"]["H1"]["pins"];
        let cles: Vec<&String> = pins.as_object().unwrap().keys().collect();
        assert_eq!(cles, vec!["1", "2", "3"]);
        assert_eq!(pins["1"]["pinDistance"], 415.96);
        assert_eq!(pins["2"]["pinDistance"], 417.11);
        assert_eq!(pins["3"]["pinDistance"], 425.16);
        assert!(validate_pin_data(&data).is_ok());
    }

    #[test]
    fn normaliseur_est_idempotent() {
        let mut premier = src(r#"{"course":{"T":{"holes":{"H1":{"par":4,"pins":{
            "250.00y":{"pinDistance":250.0,"pinHeight":0,"teeSlope":0,"ground":100}
        }}}}}}"#);
        normalize_pin_data(&mut premier);
        let mut second = premier.clone();
        normalize_pin_data(&mut second);
        assert_eq!(premier, second);
    }

    #[test]
    fn refuse_distance_dupliquee() {
        let data = src(r#"{"course":{"T":{"holes":{"H1":{"par":4,"pins":{
            "1":{"pinDistance":250.0,"pinHeight":0,"teeSlope":0,"ground":100},
            "2":{"pinDistance":250.0,"pinHeight":5,"teeSlope":0,"ground":100}
        }}}}}}"#);

        let err = validate_pin_data(&data).unwrap_err();
        assert!(
            err.contains("partagent la distance"),
            "message inattendu : {err}"
        );
    }

    #[test]
    fn refuse_cle_non_ordinale() {
        let data = src(r#"{"course":{"T":{"holes":{"H1":{"par":4,"pins":{
            "250.00y":{"pinDistance":250.0,"pinHeight":0,"teeSlope":0,"ground":100}
        }}}}}}"#);

        let err = validate_pin_data(&data).unwrap_err();
        assert!(
            err.contains("n'est pas un ordinal"),
            "message inattendu : {err}"
        );
    }

    #[test]
    fn accepte_trous_avec_trous_sans_pins() {
        let data = src(r#"{"course":{"T":{"holes":{
            "H1":{"par":4,"pins":{"1":{"pinDistance":250.0,"pinHeight":0,"teeSlope":0,"ground":100}}},
            "H2":{"par":3,"pins":{}}
        }}}}"#);

        assert!(validate_pin_data(&data).is_ok());
    }
}
