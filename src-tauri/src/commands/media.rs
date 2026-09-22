use crate::constants::EVT_NEW_CAPTURE;
use crate::error::AppError;
use crate::state::WatcherState;
use base64::{prelude::BASE64_STANDARD, Engine};
use notify::{EventKind, RecursiveMode, Watcher};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;

// =====================================================================
// SURVEILLANCE DE DOSSIER & CAPTURES
// =====================================================================

fn lancer_surveillance_dossier(app: AppHandle, path_str: String) {
    let state = app.state::<Arc<Mutex<WatcherState>>>();
    let mut state_lock = state.lock().unwrap();
    let _old = state_lock.watcher.take();

    let app_clone = app.clone();

    let watcher_result =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                    let _ = app_clone.emit(EVT_NEW_CAPTURE, ());
                }
            }
        });

    let mut watcher = match watcher_result {
        Ok(w) => w,
        Err(_e) => {
            state_lock.watched_path = None;
            return;
        }
    };

    let path = PathBuf::from(&path_str);

    if path.is_dir() {
        let _ = watcher.watch(&path, RecursiveMode::NonRecursive);
        state_lock.watcher = Some(watcher);
        state_lock.watched_path = Some(path_str);
    } else {
        state_lock.watched_path = None;
    }
}

#[tauri::command]
pub fn select_folder(app: AppHandle) -> Option<String> {
    let folder = app
        .dialog()
        .file()
        .set_title("Sélectionner le dossier des captures Pangya")
        .blocking_pick_folder();
    if let Some(ref f) = folder {
        lancer_surveillance_dossier(app.clone(), f.to_string());

        // Notifier le frontend qu'il doit rafraîchir l'image immédiatement,
        // sans attendre une nouvelle capture. Cela force l'appel à get_latest_image.
        let _ = app.emit(EVT_NEW_CAPTURE, ());
    }

    folder.map(|f| f.to_string())
}

#[tauri::command]
pub fn get_latest_image(app: AppHandle, folder_path: String) -> Result<String, AppError> {
    let dir = PathBuf::from(&folder_path);

    if !dir.is_dir() {
        return Err(AppError::Message(
            "Le chemin spécifié n'est pas un dossier valide.".to_string(),
        ));
    }

    let state = app.state::<Arc<Mutex<WatcherState>>>();
    let needs_watch = {
        let lock = state.lock().unwrap();
        lock.watcher.is_none() || lock.watched_path.as_deref() != Some(folder_path.as_str())
    };

    if needs_watch {
        lancer_surveillance_dossier(app.clone(), folder_path.clone());
    }

    let entries = fs::read_dir(dir)?;
    let mut latest: Option<(PathBuf, std::time::SystemTime)> = None;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();

            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();

                    if ext_str == "png" || ext_str == "jpg" || ext_str == "jpeg" {
                        if let Ok(metadata) = entry.metadata() {
                            if let Ok(modified) = metadata.modified() {
                                let is_newer = match &latest {
                                    None => true,
                                    Some((_, latest_time)) => modified > *latest_time,
                                };

                                if is_newer {
                                    latest = Some((path, modified));
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some((latest_path, _)) = latest {
        let image_bytes = fs::read(&latest_path)?;
        let encoded = BASE64_STANDARD.encode(&image_bytes);

        let ext = latest_path
            .extension()
            .unwrap_or_default()
            .to_string_lossy()
            .to_lowercase();

        let mime_type = if ext == "png" {
            "image/png"
        } else {
            "image/jpeg"
        };

        Ok(format!("data:{};base64,{}", mime_type, encoded))
    } else {
        Err(AppError::Message(
            "Aucune image trouvée dans ce dossier.".to_string(),
        ))
    }
}

#[tauri::command]
pub fn clear_screenshot_folder(folder_path: String) -> Result<String, AppError> {
    let dir = PathBuf::from(&folder_path);

    if !dir.is_dir() {
        return Err(AppError::Message("Dossier invalide.".to_string()));
    }

    let entries = fs::read_dir(dir)?;
    let mut deleted: u32 = 0;
    let mut failed: u32 = 0;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();

            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();

                    if ext_str == "png" || ext_str == "jpg" || ext_str == "jpeg" {
                        match fs::remove_file(&path) {
                            Ok(_) => deleted += 1,
                            Err(_) => failed += 1,
                        }
                    }
                }
            }
        }
    }

    Ok(format!(
        "{} fichier(s) supprimé(s), {} échec(s)",
        deleted, failed
    ))
}
