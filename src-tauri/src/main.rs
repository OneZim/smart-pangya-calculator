#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, Position};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowLongW, SetWindowLongW, GWL_EXSTYLE,
    WS_EX_LAYERED, WS_EX_TRANSPARENT,
};

use base64::{prelude::BASE64_STANDARD, Engine};
use notify::{EventKind, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use tauri_plugin_dialog::DialogExt;

use windows::Win32::Foundation::RECT;
use windows::Win32::Graphics::Gdi::{ClientToScreen, MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

// === Imports pour la détection ===
use windows::Win32::Foundation::{CloseHandle, LPARAM};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow,
};

// On garde une référence globale du Watcher pour éviter qu'il ne soit détruit en mémoire
struct WatcherState {
    watcher: Option<notify::RecommendedWatcher>,
}

// Garde en mémoire le dernier état "click-through" demandé pour chaque fenêtre
struct ClickThroughState {
    locked: HashMap<String, bool>,
}

// Structure pour stocker les informations d'une fenêtre
#[derive(Clone, Debug)]
struct WindowInfo {
    hwnd: HWND,
    pid: u32,
    process_name: String,
    window_title: String,
}

// Structure pour stocker les informations de la fenêtre Pangya détectée
struct FindPangyaData {
    hwnd: HWND,
    pid: u32,
    process_name: String,
    window_title: String,
    all_windows: Vec<WindowInfo>,
}

// Active la transparence de base
fn enable_transparency(app: &AppHandle, window_label: &str) {
    if let Some(win) = app.get_webview_window(window_label) {
        if let Ok(hwnd_ptr) = win.hwnd() {
            let hwnd = HWND(hwnd_ptr.0);
            unsafe {
                let style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                let layered = WS_EX_LAYERED.0 as i32;
                let _ = SetWindowLongW(hwnd, GWL_EXSTYLE, style | layered);
            }
        }
    }
}

// Fonction qui surveille le dossier et envoie l'événement au JS
fn lancer_surveillance_dossier(app: AppHandle, path_str: String) {
    let state = app.state::<Arc<Mutex<WatcherState>>>();
    let mut state_lock = state.lock().unwrap();

    let _old = state_lock.watcher.take();
    let app_clone = app.clone();

    let mut watcher =
        notify::recommended_watcher(move |res: Result<notify::Event, notify::Error>| {
            if let Ok(event) = res {
                if matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                    let _ = app_clone.emit("nouvelle-capture-detectee", ());
                }
            }
        })
        .unwrap();

    let path = PathBuf::from(&path_str);
    if path.is_dir() {
        let _ = watcher.watch(&path, RecursiveMode::NonRecursive);
        state_lock.watcher = Some(watcher);
    }
}

// =====================================================================
// COMMANDES UNIVERSELLES DE CLICK-THROUGH
// =====================================================================

fn apply_click_through_style(app: &AppHandle, window_label: &str, locked: bool) {
    if let Some(win) = app.get_webview_window(window_label) {
        if let Ok(hwnd_ptr) = win.hwnd() {
            let hwnd = HWND(hwnd_ptr.0);
            unsafe {
                let style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                let transparent = WS_EX_TRANSPARENT.0 as i32;
                let layered = WS_EX_LAYERED.0 as i32;

                let new_style = if locked {
                    style | transparent | layered
                } else {
                    (style & !transparent) | layered
                };

                let _ = SetWindowLongW(hwnd, GWL_EXSTYLE, new_style);
            }
        }
    }
}

fn reapply_click_through(app: &AppHandle, window_label: &str) {
    let state = app.state::<Arc<Mutex<ClickThroughState>>>();
    let locked = {
        let lock = state.lock().unwrap();
        lock.locked.get(window_label).copied().unwrap_or(false)
    };
    apply_click_through_style(app, window_label, locked);
}

#[tauri::command]
fn set_overlay_click_through(
    app: AppHandle,
    window_label: String,
    locked: bool,
) -> Result<(), String> {
    apply_click_through_style(&app, &window_label, locked);

    let state = app.state::<Arc<Mutex<ClickThroughState>>>();
    state.lock().unwrap().locked.insert(window_label, locked);

    Ok(())
}

#[tauri::command]
fn enable_click_through(app: AppHandle) {
    let _ = set_overlay_click_through(app, "ruler_overlay".to_string(), true);
}

#[tauri::command]
fn disable_click_through(app: AppHandle) {
    let _ = set_overlay_click_through(app, "ruler_overlay".to_string(), false);
}

// =====================================================================
// DÉTECTION GÉNÉRIQUE DE LA FENÊTRE PANGYA
// =====================================================================

fn get_process_name(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid).ok()?;

        let mut buffer = [0u16; 260];
        let mut size = buffer.len() as u32;

        let result = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            windows::core::PWSTR(buffer.as_mut_ptr()),
            &mut size,
        );

        let _ = CloseHandle(handle);

        if result.is_ok() {
            let full_path = String::from_utf16_lossy(&buffer[..size as usize]);
            let file_name = full_path
                .rsplit('\\')
                .next()
                .unwrap_or(&full_path)
                .trim_end_matches(".exe")
                .to_string();
            Some(file_name)
        } else {
            None
        }
    }
}

unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    let data = &mut *(lparam.0 as *mut FindPangyaData);

    if !IsWindowVisible(hwnd).as_bool() {
        return windows::core::BOOL(1);
    }

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    let process_name = get_process_name(pid).unwrap_or_default();
    let process_name_lower = process_name.to_lowercase();

    let mut title_buf = [0u16; 256];
    let len = GetWindowTextW(hwnd, &mut title_buf);
    let title = String::from_utf16_lossy(&title_buf[..len.max(0) as usize]);

    // Remplissage de la liste de debug
    if !title.is_empty() {
        data.all_windows.push(WindowInfo {
            hwnd,
            pid,
            process_name: process_name.clone(),
            window_title: title.clone(),
        });
    }

    // C'est LE SEUL filtre nécessaire tant qu'on cible l'exécutable ProjectG
    if process_name_lower.contains("projectg") || process_name_lower.contains("pangya_client") {
        data.hwnd = hwnd;
        data.pid = pid;
        data.process_name = process_name;
        data.window_title = title;
        return windows::core::BOOL(0); // Trouvé !
    }

    windows::core::BOOL(1)
}
fn find_pangya_hwnd() -> Option<FindPangyaData> {
    let mut data = FindPangyaData {
        hwnd: HWND(std::ptr::null_mut()),
        pid: 0,
        process_name: String::new(),
        window_title: String::new(),
        all_windows: Vec::new(),
    };

    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM(&mut data as *mut FindPangyaData as isize),
        );
    }

    if data.hwnd.is_invalid() || data.hwnd.0.is_null() {
        None
    } else {
        Some(data)
    }
}

fn list_all_windows() -> Vec<WindowInfo> {
    let mut data = FindPangyaData {
        hwnd: HWND(std::ptr::null_mut()),
        pid: 0,
        process_name: String::new(),
        window_title: String::new(),
        all_windows: Vec::new(),
    };

    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM(&mut data as *mut FindPangyaData as isize),
        );
    }

    data.all_windows
}

// =====================================================================
// RÉSOLUTION DU JEU
// =====================================================================

#[derive(serde::Serialize)]
struct GameResolution {
    width: i32,
    height: i32,
}

#[derive(serde::Serialize)]
struct GameInfo {
    hwnd: isize,
    pid: u32,
    process_name: String,
    window_title: String,
    width: i32,
    height: i32,
    game_dpi: u32,
    monitor_dpi: u32,
    scale_factor: f64,
}

#[derive(serde::Serialize)]
struct AllWindowsInfo {
    total: usize,
    windows: Vec<serde_json::Value>,
}

// Debug : mesures brutes pour vérifier si le scaling DPI fausse la résolution détectée
#[derive(serde::Serialize)]
struct GameDpiDebug {
    hwnd: isize,
    pid: u32,
    process_name: String,
    client_width: i32,
    client_height: i32,
    game_dpi: u32,
    app_dpi: u32,
    scale_factor: f64,
    corrected_width: f64,
    corrected_height: f64,
    game_is_dpi_aware: bool,
}

// Résolutions officielles du jeu en fenêtré — sert à aligner la valeur mesurée
const PANGYA_RESOLUTIONS: [(i32, i32); 16] = [
    (800, 600),
    (1024, 768),
    (1152, 864),
    (1280, 720),
    (1280, 768),
    (1280, 800),
    (1280, 960),
    (1280, 1024),
    (1360, 768),
    (1366, 768),
    (1400, 900),
    (1400, 1050),
    (1440, 900),
    (1600, 900),
    (1680, 1050),
    (1920, 1080),
];

// DPI effectif du moniteur où se trouve la fenêtre donnée
fn get_monitor_dpi_for_window(hwnd: HWND) -> u32 {
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut dpi_x: u32 = 0;
        let mut dpi_y: u32 = 0;
        if GetDpiForMonitor(monitor, MDT_EFFECTIVE_DPI, &mut dpi_x, &mut dpi_y).is_ok() && dpi_x > 0
        {
            dpi_x
        } else {
            96
        }
    }
}

// Applique la correction DPI puis aligne sur la résolution officielle la plus proche.
// Pangya est non DPI-aware (GetDpiForWindow == 96) : quand l'échelle Windows est > 100 %,
// Windows agrandit sa fenêtre et GetClientRect renvoie la taille agrandie. On divise
// par le facteur pour retrouver la résolution réellement choisie dans les options du jeu.
// Retourne (width, height, game_dpi, monitor_dpi, scale_factor).
fn correct_resolution(
    raw_width: i32,
    raw_height: i32,
    game_hwnd: HWND,
) -> (i32, i32, u32, u32, f64) {
    let game_dpi = unsafe { GetDpiForWindow(game_hwnd) };
    let monitor_dpi = get_monitor_dpi_for_window(game_hwnd);

    let scale_factor = if game_dpi == 96 && monitor_dpi != 96 {
        monitor_dpi as f64 / 96.0
    } else {
        1.0
    };

    let w = raw_width as f64 / scale_factor;
    let h = raw_height as f64 / scale_factor;

    let mut result = (w.round() as i32, h.round() as i32);

    // Snap vers une résolution officielle si on en est à moins de 3 %
    let mut best_dist = f64::MAX;
    for &(rw, rh) in PANGYA_RESOLUTIONS.iter() {
        let dist =
            (((w - rw as f64) / rw as f64).powi(2) + ((h - rh as f64) / rh as f64).powi(2)).sqrt();
        if dist < best_dist {
            best_dist = dist;
            if dist <= 0.03 {
                result = (rw, rh);
            }
        }
    }

    (result.0, result.1, game_dpi, monitor_dpi, scale_factor)
}

fn read_game_resolution() -> Result<GameResolution, String> {
    let game_data = find_pangya_hwnd().ok_or_else(|| "Fenêtre Pangya introuvable.".to_string())?;

    let mut rect = RECT::default();
    unsafe {
        GetClientRect(game_data.hwnd, &mut rect).map_err(|e| e.to_string())?;
    }

    let raw_w = rect.right - rect.left;
    let raw_h = rect.bottom - rect.top;
    let (width, height, _game_dpi, _monitor_dpi, _scale_factor) =
        correct_resolution(raw_w, raw_h, game_data.hwnd);

    Ok(GameResolution { width, height })
}

#[tauri::command]
fn get_game_resolution() -> Result<GameResolution, String> {
    read_game_resolution()
}

#[tauri::command]
fn refresh_game_resolution(app: AppHandle) -> Result<GameResolution, String> {
    let res = read_game_resolution()?;
    let _ = app.emit("update-game-resolution", &res);
    Ok(res)
}

#[tauri::command]
fn get_game_info() -> Result<GameInfo, String> {
    let game_data = find_pangya_hwnd().ok_or_else(|| "Fenêtre Pangya introuvable.".to_string())?;

    let mut rect = RECT::default();
    unsafe {
        GetClientRect(game_data.hwnd, &mut rect).map_err(|e| e.to_string())?;
    }

    let (width, height, game_dpi, monitor_dpi, scale_factor) = correct_resolution(
        rect.right - rect.left,
        rect.bottom - rect.top,
        game_data.hwnd,
    );

    let info = GameInfo {
        hwnd: game_data.hwnd.0 as isize,
        pid: game_data.pid,
        process_name: game_data.process_name.clone(),
        window_title: game_data.window_title.clone(),
        width,
        height,
        game_dpi,
        monitor_dpi,
        scale_factor,
    };

    Ok(info)
}

// Rectangle client du jeu converti en coordonnées ÉCRAN (pixels physiques).
// Sert au clic : la table de calibration donne des positions dans l'espace de
// la résolution du jeu ; le frontend les multiplie par scale_factor puis
// ajoute cette origine pour obtenir la position écran finale.
#[derive(serde::Serialize)]
struct GameClientRectOnScreen {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[tauri::command]
fn get_game_client_rect_on_screen() -> Result<GameClientRectOnScreen, String> {
    let game_data = find_pangya_hwnd().ok_or_else(|| "Fenêtre Pangya introuvable.".to_string())?;

    let mut rect = RECT::default();
    let mut origin = POINT::default();
    unsafe {
        GetClientRect(game_data.hwnd, &mut rect).map_err(|e| e.to_string())?;
        if !ClientToScreen(game_data.hwnd, &mut origin).as_bool() {
            return Err("ClientToScreen a échoué.".to_string());
        }
    }

    Ok(GameClientRectOnScreen {
        x: origin.x,
        y: origin.y,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    })
}

// Debug : mesure le DPI de la fenêtre du jeu vs le DPI réel du moniteur.
// game_dpi == 96 => le jeu n'est pas DPI-aware, Windows agrandit sa fenêtre
// et GetClientRect renvoie la taille agrandie (à corriger par scale_factor).
#[tauri::command]
fn get_game_dpi_debug(_app: AppHandle) -> Result<GameDpiDebug, String> {
    let game_data = find_pangya_hwnd().ok_or_else(|| "Fenêtre Pangya introuvable.".to_string())?;

    let mut rect = RECT::default();
    unsafe {
        GetClientRect(game_data.hwnd, &mut rect).map_err(|e| e.to_string())?;
    }

    let raw_w = rect.right - rect.left;
    let raw_h = rect.bottom - rect.top;

    // 96 pour un processus non DPI-aware, sinon son DPI effectif
    let game_dpi = unsafe { GetDpiForWindow(game_data.hwnd) };
    let app_dpi = get_monitor_dpi_for_window(game_data.hwnd);

    let scale_factor = app_dpi as f64 / 96.0;

    Ok(GameDpiDebug {
        hwnd: game_data.hwnd.0 as isize,
        pid: game_data.pid,
        process_name: game_data.process_name,
        client_width: raw_w,
        client_height: raw_h,
        game_dpi,
        app_dpi,
        scale_factor,
        corrected_width: raw_w as f64 / scale_factor,
        corrected_height: raw_h as f64 / scale_factor,
        game_is_dpi_aware: game_dpi != 96,
    })
}

#[tauri::command]
fn list_all_visible_windows() -> Result<AllWindowsInfo, String> {
    let windows = list_all_windows();
    let mut windows_json = Vec::new();

    for (index, win) in windows.iter().enumerate() {
        windows_json.push(serde_json::json!({
            "index": index + 1,
            "hwnd": win.hwnd.0 as isize,
            "pid": win.pid,
            "process_name": win.process_name,
            "window_title": win.window_title,
        }));
    }

    Ok(AllWindowsInfo {
        total: windows.len(),
        windows: windows_json,
    })
}

#[tauri::command]
fn move_and_click(x: f64, y: f64) -> Result<(), String> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    enigo
        .move_mouse(x.round() as i32, y.round() as i32, Coordinate::Abs)
        .map_err(|e| e.to_string())?;

    std::thread::sleep(std::time::Duration::from_millis(30));

    enigo
        .button(Button::Left, Direction::Click)
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
fn get_mouse_position() -> Result<(i32, i32), String> {
    let enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;
    enigo.location().map_err(|e| e.to_string())
}

/// Force le focus sur hwnd_target en contournant la restriction Windows
/// qui empêche normalement un process en arrière-plan de voler le focus.
fn force_foreground(hwnd_target: HWND) -> bool {
    unsafe {
        let foreground_hwnd = GetForegroundWindow();

        // Si le jeu a déjà le focus, rien à faire
        if foreground_hwnd == hwnd_target {
            return true;
        }

        let current_thread_id = GetCurrentThreadId();
        let foreground_thread_id = GetWindowThreadProcessId(foreground_hwnd, None);
        let target_thread_id = GetWindowThreadProcessId(hwnd_target, None);

        let attached_fg = if foreground_thread_id != current_thread_id {
            AttachThreadInput(current_thread_id, foreground_thread_id, true).as_bool()
        } else {
            false
        };

        let attached_target = if target_thread_id != current_thread_id {
            AttachThreadInput(current_thread_id, target_thread_id, true).as_bool()
        } else {
            false
        };
        let _ = BringWindowToTop(hwnd_target);
        let result = SetForegroundWindow(hwnd_target);

        if attached_fg {
            let _ = AttachThreadInput(current_thread_id, foreground_thread_id, false);
        }
        if attached_target {
            let _ = AttachThreadInput(current_thread_id, target_thread_id, false);
        }

        result.as_bool()
    }
}
#[tauri::command]
fn move_and_click_focused(x: f64, y: f64) -> Result<(), String> {
    if let Some(game_data) = find_pangya_hwnd() {
        let focus_ok = force_foreground(game_data.hwnd);
        if !focus_ok {
            eprintln!("Impossible de donner le focus à la fenêtre du jeu (hwnd invalide, UAC, ou fenêtre minimisée).");
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    } else {
        eprintln!("Fenêtre Pangya introuvable — clic envoyé sans focus garanti.");
    }

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    enigo
        .move_mouse(x.round() as i32, y.round() as i32, Coordinate::Abs)
        .map_err(|e| e.to_string())?;

    std::thread::sleep(std::time::Duration::from_millis(150));

    enigo
        .button(Button::Left, Direction::Press)
        .map_err(|e| e.to_string())?;

    std::thread::sleep(std::time::Duration::from_millis(80));

    enigo
        .button(Button::Left, Direction::Release)
        .map_err(|e| e.to_string())?;

    Ok(())
}
#[tauri::command]
fn set_ruler_visibility(app: AppHandle, show: bool) {
    if let Some(win) = app.get_webview_window("ruler_overlay") {
        if show {
            let _ = win.show();
            reapply_click_through(&app, "ruler_overlay");
        } else {
            let _ = win.hide();
        }
    }
    let _ = app.emit("sync-ruler-visibility", show);
}

#[tauri::command]
fn set_wind_visibility(app: AppHandle, show: bool) {
    if let Some(win) = app.get_webview_window("wind_overlay") {
        if show {
            let _ = win.show();
            reapply_click_through(&app, "wind_overlay");
        } else {
            let _ = win.hide();
        }
    }
    let _ = app.emit("sync-wind-visibility", show);
}

#[tauri::command]
fn set_spin_visibility(app: AppHandle, show: bool) {
    if let Some(win) = app.get_webview_window("spin_overlay") {
        if show {
            let _ = win.show();
            reapply_click_through(&app, "spin_overlay");
        } else {
            let _ = win.hide();
        }
    }
    let _ = app.emit("sync-spin-visibility", show);
}

#[tauri::command]
fn move_ruler(app: AppHandle, x: i32, y: i32) {
    if let Some(win) = app.get_webview_window("ruler_overlay") {
        if let Ok(pos) = win.outer_position() {
            let _ = win.set_position(Position::Physical(PhysicalPosition {
                x: pos.x + x,
                y: pos.y + y,
            }));
        }
    }
}

#[tauri::command]
fn set_input_bar_visibility(app: AppHandle, show: bool) {
    if let Some(win) = app.get_webview_window("input_overlay") {
        if show {
            let _ = win.show();
            reapply_click_through(&app, "input_overlay");
        } else {
            let _ = win.hide();
        }
    }
}

#[tauri::command]
fn move_wind_overlay(app_handle: tauri::AppHandle, dx: i32, dy: i32) -> Result<(), String> {
    if let Some(window) = app_handle.get_webview_window("wind_overlay") {
        let mut pos = window.outer_position().map_err(|e| e.to_string())?;
        pos.x += dx;
        pos.y += dy;
        window.set_position(pos).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn emit_wind_angle(app_handle: tauri::AppHandle, angle: i32) -> Result<(), String> {
    app_handle
        .emit("sync-wind-angle", serde_json::json!({ "angle": angle }))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn select_folder(app: AppHandle) -> Option<String> {
    let folder = app
        .dialog()
        .file()
        .set_title("Sélectionner le dossier des captures Pangya")
        .blocking_pick_folder();

    if let Some(ref f) = folder {
        lancer_surveillance_dossier(app.clone(), f.to_string());
    }

    folder.map(|f| f.to_string())
}

#[tauri::command]
fn get_latest_image(app: AppHandle, folder_path: String) -> Result<String, String> {
    let dir = PathBuf::from(&folder_path);
    if !dir.is_dir() {
        return Err("Le chemin spécifié n'est pas un dossier valide.".to_string());
    }

    let state = app.state::<Arc<Mutex<WatcherState>>>();
    {
        let lock = state.lock().unwrap();
        if lock.watcher.is_none() {
            drop(lock);
            lancer_surveillance_dossier(app.clone(), folder_path.clone());
        }
    }

    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
    let mut files: Vec<(PathBuf, std::time::SystemTime)> = Vec::new();

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if ext_str == "png" || ext_str == "jpg" || ext_str == "jpeg" {
                        if let Ok(metadata) = entry.metadata() {
                            if let Ok(modified) = metadata.modified() {
                                files.push((path, modified));
                            }
                        }
                    }
                }
            }
        }
    }

    files.sort_by(|a, b| b.1.cmp(&a.1));

    if let Some((latest_path, _)) = files.first() {
        let image_bytes = fs::read(latest_path).map_err(|e| e.to_string())?;
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
        Err("Aucune image trouvée dans ce dossier.".to_string())
    }
}

#[tauri::command]
fn clear_screenshot_folder(folder_path: String) -> Result<(), String> {
    let dir = PathBuf::from(&folder_path);
    if !dir.is_dir() {
        return Err("Dossier invalide.".to_string());
    }

    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries {
        if let Ok(entry) = entry {
            let path = entry.path();
            if path.is_file() {
                if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if ext_str == "png" || ext_str == "jpg" || ext_str == "jpeg" {
                        let _ = fs::remove_file(path);
                    }
                }
            }
        }
    }

    Ok(())
}

#[tauri::command]
fn get_available_languages(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let mut lang_dir = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("lang");

    if !lang_dir.is_dir() {
        lang_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("lang");
    }

    if !lang_dir.is_dir() {
        return Err(format!(
            "Dossier introuvable. Chemin testé : {:?}",
            lang_dir
        ));
    }

    let entries = fs::read_dir(lang_dir).map_err(|e| e.to_string())?;
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

    Ok(langs)
}

#[tauri::command]
fn load_language_json(app: tauri::AppHandle, lang: String) -> Result<String, String> {
    let mut file_path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("lang")
        .join(format!("{}.json", &lang));

    if !file_path.is_file() {
        file_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("lang")
            .join(format!("{}.json", &lang));
    }

    if !file_path.is_file() {
        return Err(format!("Fichier {}.json introuvable.", lang));
    }

    fs::read_to_string(file_path).map_err(|e| e.to_string())
}

#[tauri::command]
fn parcours(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let mut file_path = app
        .path()
        .resource_dir()
        .map_err(|e| e.to_string())?
        .join("data")
        .join("pin_location.json");

    if !file_path.is_file() {
        file_path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("data")
            .join("pin_location.json");
    }

    if !file_path.is_file() {
        return Err(format!(
            "Fichier introuvable. Chemin testé : {:?}",
            file_path
        ));
    }

    let contenu_json = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    serde_json::from_str(&contenu_json).map_err(|e| e.to_string())
}

fn main() {
    let watcher_state = Arc::new(Mutex::new(WatcherState { watcher: None }));
    let click_through_state = Arc::new(Mutex::new(ClickThroughState {
        locked: HashMap::new(),
    }));

    tauri::Builder::default()
        .manage(watcher_state)
        .manage(click_through_state)
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            enable_click_through,
            disable_click_through,
            set_overlay_click_through,
            set_ruler_visibility,
            set_spin_visibility,
            set_input_bar_visibility,
            set_wind_visibility,
            emit_wind_angle,
            move_wind_overlay,
            move_ruler,
            select_folder,
            get_latest_image,
            clear_screenshot_folder,
            get_available_languages,
            load_language_json,
            parcours,
            move_and_click,
            get_mouse_position,
            move_and_click_focused,
            get_game_resolution,
            refresh_game_resolution,
            get_game_info,
            get_game_client_rect_on_screen,
            get_game_dpi_debug,
            list_all_visible_windows,
        ])
        .setup(|app| {
            let handle = app.app_handle();

            enable_transparency(handle, "ruler_overlay");
            enable_transparency(handle, "wind_overlay");

            // === RACCOURCI GLOBAL (Tauri 2) ===
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
                                let _ = app_handle_clone.emit("global-trigger-click-pb", ());
                            }
                        })
                        .build(),
                )?;
                app.global_shortcut().register(click_shortcut)?;
            }

            let window = app.get_webview_window("main").unwrap();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_millis(300));
                let _ = window.show();
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    std::process::exit(0);
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
