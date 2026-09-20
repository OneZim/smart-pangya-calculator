use crate::constants::EVT_UPDATE_GAME_RESOLUTION;
use crate::detection::{find_pangya_cached, list_all_windows};
use crate::error::AppError;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HWND, POINT, RECT};
use windows::Win32::Graphics::Gdi::{ClientToScreen, MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::GetClientRect;

// =====================================================================
// STRUCTURES DE DONNÉES JEU
// =====================================================================

#[derive(serde::Serialize)]
pub struct GameResolution {
    pub width: i32,
    pub height: i32,
}

#[derive(serde::Serialize)]
pub struct GameInfo {
    pub hwnd: isize,
    pub pid: u32,
    pub process_name: String,
    pub window_title: String,
    pub width: i32,
    pub height: i32,
    pub game_dpi: u32,
    pub monitor_dpi: u32,
    pub scale_factor: f64,
}

#[derive(serde::Serialize)]
pub struct AllWindowsInfo {
    pub total: usize,
    pub windows: Vec<serde_json::Value>,
}

#[derive(serde::Serialize)]
pub struct GameClientRectOnScreen {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

#[derive(serde::Serialize)]
pub struct GameDpiDebug {
    pub hwnd: isize,
    pub pid: u32,
    pub process_name: String,
    pub client_width: i32,
    pub client_height: i32,
    pub game_dpi: u32,
    pub app_dpi: u32,
    pub scale_factor: f64,
    pub corrected_width: f64,
    pub corrected_height: f64,
    pub game_is_dpi_aware: bool,
}

// =====================================================================
// RÉSOLUTIONS OFFICIELLES PANGYA
// =====================================================================

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

// =====================================================================
// HELPERS DPI / RÉSOLUTION
// =====================================================================

fn get_monitor_dpi_for_window(hwnd: HWND) -> u32 {
    // SAFETY: `hwnd` est une fenêtre valide fournie par l'appelant. MONITOR_DEFAULTTONEAREST
    // garantit un moniteur valide en retour. dpi_x/dpi_y sont initialisés avant l'appel.
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

fn correct_resolution(
    raw_width: i32,
    raw_height: i32,
    game_hwnd: HWND,
) -> (i32, i32, u32, u32, f64) {
    // SAFETY: game_hwnd est la fenêtre du jeu détectée et validée par find_pangya_hwnd.
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

    let mut best_dist = f64::MAX;
    let mut best_resolution: Option<(i32, i32)> = None;

    for &(rw, rh) in PANGYA_RESOLUTIONS.iter() {
        let dist =
            (((w - rw as f64) / rw as f64).powi(2) + ((h - rh as f64) / rh as f64).powi(2)).sqrt();

        if dist < best_dist {
            best_dist = dist;
            best_resolution = Some((rw, rh));
        }
    }

    if let Some(res) = best_resolution {
        if best_dist <= 0.03 {
            result = res;
        }
    }

    (result.0, result.1, game_dpi, monitor_dpi, scale_factor)
}

fn read_game_resolution(app: &AppHandle) -> Result<GameResolution, AppError> {
    let game_data = find_pangya_cached(app).ok_or(AppError::WindowNotFound)?;

    let mut rect = RECT::default();

    // SAFETY: game_data.hwnd est la fenêtre du jeu validée. `rect` est correctement
    // initialisé avant l'appel à GetClientRect.
    unsafe {
        GetClientRect(game_data.hwnd, &mut rect).map_err(|e| AppError::Win32(e.to_string()))?;
    }

    let raw_w = rect.right - rect.left;
    let raw_h = rect.bottom - rect.top;

    let (width, height, _game_dpi, _monitor_dpi, _scale_factor) =
        correct_resolution(raw_w, raw_h, game_data.hwnd);

    Ok(GameResolution { width, height })
}

// =====================================================================
// COMMANDES JEU
// =====================================================================

#[tauri::command]
pub fn get_game_resolution(app: AppHandle) -> Result<GameResolution, AppError> {
    read_game_resolution(&app)
}

#[tauri::command]
pub fn refresh_game_resolution(app: AppHandle) -> Result<GameResolution, AppError> {
    let res = read_game_resolution(&app)?;
    let _ = app.emit(EVT_UPDATE_GAME_RESOLUTION, &res);
    Ok(res)
}

#[tauri::command]
pub fn get_game_info(app: AppHandle) -> Result<GameInfo, AppError> {
    let game_data = find_pangya_cached(&app).ok_or(AppError::WindowNotFound)?;

    let mut rect = RECT::default();

    // SAFETY: game_data.hwnd est la fenêtre du jeu validée.
    unsafe {
        GetClientRect(game_data.hwnd, &mut rect).map_err(|e| AppError::Win32(e.to_string()))?;
    }

    let (width, height, game_dpi, monitor_dpi, scale_factor) = correct_resolution(
        rect.right - rect.left,
        rect.bottom - rect.top,
        game_data.hwnd,
    );

    let info = GameInfo {
        hwnd: game_data.hwnd.0 as isize,
        pid: game_data.pid,
        process_name: game_data.process_name,
        window_title: game_data.window_title,
        width,
        height,
        game_dpi,
        monitor_dpi,
        scale_factor,
    };

    Ok(info)
}

#[tauri::command]
pub fn get_game_client_rect_on_screen(app: AppHandle) -> Result<GameClientRectOnScreen, AppError> {
    let game_data = find_pangya_cached(&app).ok_or(AppError::WindowNotFound)?;

    let mut rect = RECT::default();
    let mut origin = POINT::default();

    // SAFETY: game_data.hwnd est la fenêtre du jeu validée. `rect` et `origin` sont
    // initialisés avant les appels à GetClientRect et ClientToScreen.
    unsafe {
        GetClientRect(game_data.hwnd, &mut rect).map_err(|e| AppError::Win32(e.to_string()))?;

        if !ClientToScreen(game_data.hwnd, &mut origin).as_bool() {
            return Err(AppError::Message("ClientToScreen a échoué.".to_string()));
        }
    }

    Ok(GameClientRectOnScreen {
        x: origin.x,
        y: origin.y,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    })
}

#[tauri::command]
pub fn get_game_dpi_debug(app: AppHandle) -> Result<GameDpiDebug, AppError> {
    let game_data = find_pangya_cached(&app).ok_or(AppError::WindowNotFound)?;

    let mut rect = RECT::default();

    // SAFETY: game_data.hwnd est la fenêtre du jeu validée. `rect` est initialisé.
    unsafe {
        GetClientRect(game_data.hwnd, &mut rect).map_err(|e| AppError::Win32(e.to_string()))?;
    }

    let raw_w = rect.right - rect.left;
    let raw_h = rect.bottom - rect.top;

    // SAFETY: game_data.hwnd est la fenêtre du jeu validée.
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
pub fn list_all_visible_windows() -> Result<AllWindowsInfo, AppError> {
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
