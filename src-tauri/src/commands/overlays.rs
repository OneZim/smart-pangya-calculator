use crate::constants::*;
use crate::error::AppError;
use crate::state::ClickThroughState;
use crate::window_style::{apply_click_through_style, reapply_click_through};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

// =====================================================================
// FONCTIONS INTERNES FACTORISÉES
// =====================================================================

fn set_overlay_visibility_internal(
    app: &AppHandle,
    label: &str,
    sync_event: Option<&str>,
    show: bool,
) {
    if let Some(win) = app.get_webview_window(label) {
        if show {
            let _ = win.show();
            reapply_click_through(app, label);
        } else {
            let _ = win.hide();
        }
    }

    if let Some(evt) = sync_event {
        let _ = app.emit(evt, show);
    }
}

fn move_overlay_by(app: &AppHandle, label: &str, dx: i32, dy: i32) -> Result<(), AppError> {
    if let Some(window) = app.get_webview_window(label) {
        let mut pos = window
            .outer_position()
            .map_err(|e| AppError::Window(e.to_string()))?;
        pos.x += dx;
        pos.y += dy;
        window
            .set_position(pos)
            .map_err(|e| AppError::Window(e.to_string()))?;
    }

    Ok(())
}

// =====================================================================
// COMMANDES CLICK-THROUGH
// =====================================================================

#[tauri::command]
pub fn set_overlay_click_through(
    app: AppHandle,
    window_label: String,
    locked: bool,
) -> Result<(), AppError> {
    apply_click_through_style(&app, &window_label, locked);

    let state = app.state::<Arc<Mutex<ClickThroughState>>>();
    state.lock().unwrap().locked.insert(window_label, locked);

    Ok(())
}

#[tauri::command]
pub fn enable_click_through(app: AppHandle) {
    let _ = set_overlay_click_through(app, WIN_RULER.to_string(), true);
}

#[tauri::command]
pub fn disable_click_through(app: AppHandle) {
    let _ = set_overlay_click_through(app, WIN_RULER.to_string(), false);
}

// =====================================================================
// COMMANDES DE VISIBILITÉ DES OVERLAYS
// =====================================================================

#[tauri::command]
pub fn set_ruler_visibility(app: AppHandle, show: bool) {
    set_overlay_visibility_internal(&app, WIN_RULER, Some(EVT_SYNC_RULER_VIS), show);
}

#[tauri::command]
pub fn set_spin_visibility(app: AppHandle, show: bool) {
    set_overlay_visibility_internal(&app, WIN_SPIN, Some(EVT_SYNC_SPIN_VIS), show);
}

#[tauri::command]
pub fn set_infos_shot_visibility(app: AppHandle, show: bool) {
    set_overlay_visibility_internal(&app, WIN_INFOS, Some(EVT_SYNC_INFOS_VIS), show);
}

#[tauri::command]
pub fn set_input_bar_visibility(app: AppHandle, show: bool) {
    set_overlay_visibility_internal(&app, WIN_INPUT, Some(EVT_SYNC_INPUT_VIS), show);
}

// =====================================================================
// COMMANDES DE DÉPLACEMENT DES OVERLAYS
// =====================================================================

#[tauri::command]
pub fn move_ruler(app: AppHandle, x: i32, y: i32) {
    let _ = move_overlay_by(&app, WIN_RULER, x, y);
}

#[tauri::command]
pub fn move_spin_overlay(app_handle: AppHandle, dx: i32, dy: i32) -> Result<(), AppError> {
    move_overlay_by(&app_handle, WIN_SPIN, dx, dy)
}

#[tauri::command]
pub fn move_infos_shot(app_handle: AppHandle, dx: i32, dy: i32) -> Result<(), AppError> {
    move_overlay_by(&app_handle, WIN_INFOS, dx, dy)
}

// =====================================================================
// AUTRES COMMANDES DE VISIBILITÉ / SYNCHRO
// =====================================================================

#[tauri::command]
pub fn get_settings_visibility(app: AppHandle) -> bool {
    app.get_webview_window(WIN_SETTINGS)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

#[tauri::command]
pub fn get_overlays_screen_visibility(app: AppHandle) -> bool {
    app.get_webview_window(WIN_OVERLAYS_SCREEN)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

#[tauri::command]
pub fn get_editor_visibility(app: AppHandle) -> bool {
    app.get_webview_window("editor_screen")
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}
