mod commands;
mod constants;
mod detection;
mod error;
mod foreground;
mod state;
mod window_style;

use crate::constants::*;
use crate::state::{
    ClickThroughState, LanguagesCache, PangyaWindowCache, PinLocationCache, WatcherState,
};
use crate::window_style::enable_transparency;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let watcher_state = Arc::new(Mutex::new(WatcherState {
        watcher: None,
        watched_path: None,
    }));

    let click_through_state = Arc::new(Mutex::new(ClickThroughState {
        locked: HashMap::new(),
    }));

    let pangya_cache = Arc::new(Mutex::new(PangyaWindowCache::new()));
    let pin_location_cache = Arc::new(Mutex::new(PinLocationCache::new()));
    let languages_cache = Arc::new(Mutex::new(LanguagesCache::new()));

    tauri::Builder::default()
        .manage(watcher_state)
        .manage(click_through_state)
        .manage(pangya_cache)
        .manage(pin_location_cache)
        .manage(languages_cache)
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::overlays::enable_click_through,
            commands::overlays::disable_click_through,
            commands::overlays::set_overlay_click_through,
            commands::overlays::set_ruler_visibility,
            commands::overlays::set_spin_visibility,
            commands::overlays::set_input_bar_visibility,
            commands::overlays::move_spin_overlay,
            commands::overlays::set_infos_shot_visibility,
            commands::overlays::get_settings_visibility,
            commands::overlays::get_overlays_screen_visibility,
            commands::overlays::move_infos_shot,
            commands::overlays::move_ruler,
            commands::media::select_folder,
            commands::media::get_latest_image,
            commands::media::clear_screenshot_folder,
            commands::i18n::get_available_languages,
            commands::i18n::load_language_json,
            commands::i18n::parcours,
            commands::input::move_and_click,
            commands::input::get_mouse_position,
            commands::input::move_and_click_focused,
            commands::game::get_game_resolution,
            commands::game::refresh_game_resolution,
            commands::game::get_game_info,
            commands::game::get_game_client_rect_on_screen,
            commands::game::get_game_dpi_debug,
            commands::game::list_all_visible_windows,
        ])
        // Affiche la fenêtre principale seulement quand sa page a fini de charger.
        // Remplace l'ancien thread + sleep(300ms) : on attend le chargement réel (anti-FOUC).
        .on_page_load(|window, _payload| {
            if window.label() == WIN_MAIN {
                let _ = window.show();
            }
        })
        .setup(|app| {
            let handle = app.app_handle();

            // Transparence de base pour tous les overlays (ordre historique conservé)
            for label in [WIN_RULER, WIN_INPUT, WIN_SPIN, WIN_INFOS] {
                enable_transparency(handle, label);
            }

            #[cfg(desktop)]
            {
                let click_shortcut =
                    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::KeyX);

                let app_handle_clone = handle.clone();

                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |_app, shortcut, event| {
                            if event.state() == ShortcutState::Pressed
                                && shortcut == &click_shortcut
                            {
                                let _ = app_handle_clone.emit(EVT_GLOBAL_CLICK_PB, ());
                            }
                        })
                        .build(),
                )?;

                app.global_shortcut().register(click_shortcut)?;
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == WIN_MAIN {
                    std::process::exit(0);
                } else if window.label() == WIN_SETTINGS {
                    api.prevent_close(); // Annule la destruction de la fenêtre
                    let _ = window.hide(); // La garde vivante mais masquée
                } else if window.label() == WIN_OVERLAYS_SCREEN {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
