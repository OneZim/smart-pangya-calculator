use crate::error::AppError;
use crate::state::{LanguagesCache, PinLocationCache};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};

// =====================================================================
// LANGUES & DONNÉES DE PARCOURS
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

#[tauri::command]
pub fn parcours(app: AppHandle) -> Result<serde_json::Value, AppError> {
    let cache_state = app.state::<Arc<Mutex<PinLocationCache>>>();

    {
        let lock = cache_state.lock().unwrap();
        if let Some(data) = &lock.data {
            return Ok(data.clone());
        }
    }

    let mut file_path = app
        .path()
        .resource_dir()
        .map_err(|e| AppError::Message(e.to_string()))?
        .join("data")
        .join("pin_location.json");

    if !file_path.is_file() {
        file_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("data")
            .join("pin_location.json");
    }

    if !file_path.is_file() {
        return Err(AppError::Message(format!(
            "Fichier introuvable. Chemin testé : {:?}",
            file_path
        )));
    }

    let contenu_json = fs::read_to_string(file_path)?;
    let value: serde_json::Value = serde_json::from_str(&contenu_json)?;

    {
        let mut lock = cache_state.lock().unwrap();
        lock.data = Some(value.clone());
    }

    Ok(value)
}
