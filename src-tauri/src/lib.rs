use base64::{prelude::BASE64_STANDARD, Engine};
use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};
use notify::{EventKind, RecursiveMode, Watcher};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use windows::Win32::Foundation::RECT;
use windows::Win32::Foundation::{HWND, POINT};
use windows::Win32::Graphics::Gdi::{ClientToScreen, MonitorFromWindow, MONITOR_DEFAULTTONEAREST};
use windows::Win32::UI::HiDpi::{GetDpiForMonitor, GetDpiForWindow, MDT_EFFECTIVE_DPI};
use windows::Win32::UI::WindowsAndMessaging::GetClientRect;
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE,
    WS_EX_LAYERED, WS_EX_TRANSPARENT,
};
// === Imports pour la détection ===
use windows::Win32::Foundation::{CloseHandle, LPARAM};
use windows::Win32::System::Threading::{
    AttachThreadInput, GetCurrentThreadId, OpenProcess, QueryFullProcessImageNameW,
    PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindow, IsWindowVisible,
    SetForegroundWindow,
};

// =====================================================================
// CONSTANTES
// =====================================================================
const WIN_MAIN: &str = "main";
const WIN_SETTINGS: &str = "settings_screen";
const WIN_OVERLAYS_SCREEN: &str = "overlays_screen";
const WIN_INPUT: &str = "input_overlay";
const WIN_RULER: &str = "ruler_overlay";
const WIN_WIND: &str = "wind_overlay";
const WIN_SPIN: &str = "spin_overlay";
const WIN_INFOS: &str = "infos_shot";

const EVT_SYNC_RULER_VIS: &str = "sync-ruler-visibility";
const EVT_SYNC_WIND_VIS: &str = "sync-wind-visibility";
const EVT_SYNC_SPIN_VIS: &str = "sync-spin-visibility";
const EVT_SYNC_INFOS_VIS: &str = "sync-infos-shot-visibility";
const EVT_SYNC_WIND_ANGLE: &str = "sync-wind-angle";
const EVT_UPDATE_GAME_RESOLUTION: &str = "update-game-resolution";
const EVT_NEW_CAPTURE: &str = "nouvelle-capture-detectee";
const EVT_GLOBAL_CLICK_PB: &str = "global-trigger-click-pb";

const PANGYA_CACHE_TTL: Duration = Duration::from_secs(2);

// =====================================================================
// ÉTATS PARTAGÉS
// =====================================================================
struct WatcherState {
    watcher: Option<notify::RecommendedWatcher>,
    // Chemin actuellement surveillé. Permet de ne relancer le watcher que si le dossier change.
    watched_path: Option<String>,
}

struct ClickThroughState {
    locked: HashMap<String, bool>,
}

struct PangyaWindowCache {
    data: Option<FindPangyaData>,
    fetched_at: Option<Instant>,
}

impl PangyaWindowCache {
    fn new() -> Self {
        Self {
            data: None,
            fetched_at: None,
        }
    }
}

// Cache des données de parcours (pin_location.json). Chargé une seule fois à la première
// demande, puis servi depuis la mémoire pour éviter de relire le disque à chaque appel.
struct PinLocationCache {
    data: Option<serde_json::Value>,
}

impl PinLocationCache {
    fn new() -> Self {
        Self { data: None }
    }
}

// Cache des langues : liste des langues disponibles + contenu de chaque langue déjà demandée.
// Comme l'utilisateur ne change de langue qu'une seule fois par session, ce cache évite de
// relire les fichiers du dossier lang à chaque changement d'écran.
struct LanguagesCache {
    available: Option<Vec<String>>,
    contents: HashMap<String, String>,
}

impl LanguagesCache {
    fn new() -> Self {
        Self {
            available: None,
            contents: HashMap::new(),
        }
    }
}

// =====================================================================
// DÉTECTION GÉNÉRIQUE DE LA FENÊTRE PANGYA
// =====================================================================
#[derive(Clone, Debug)]
struct WindowInfo {
    hwnd: HWND,
    pid: u32,
    process_name: String,
    window_title: String,
}

#[derive(Clone)]
struct FindPangyaData {
    hwnd: HWND,
    pid: u32,
    process_name: String,
    window_title: String,
    all_windows: Vec<WindowInfo>,
    // Cache des noms de processus déjà résolus pendant l'énumération.
    // Évite de refaire OpenProcess pour un même PID possédant plusieurs fenêtres visibles.
    process_cache: HashMap<u32, String>,
}

// SAFETY: HWND is a Windows handle (essentially an integer identifier) that can be safely
// sent across threads. The underlying window is managed by Windows and the handle remains
// valid as long as the window exists. IsWindow() is used to verify validity before use.
unsafe impl Send for FindPangyaData {}
unsafe impl Sync for FindPangyaData {}
unsafe impl Send for WindowInfo {}
unsafe impl Sync for WindowInfo {}

fn get_process_name(pid: u32) -> Option<String> {
    // SAFETY: OpenProcess avec PROCESS_QUERY_LIMITED_INFORMATION est un accès en lecture seule.
    // Le handle est systématiquement fermé via CloseHandle avant tout retour. Le buffer de
    // 260 u16 couvre la taille max d'un chemin Windows, et QueryFullProcessImageNameW écrit
    // au maximum `size` caractères.
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

// SAFETY: Callback appelé par Windows lors de EnumWindows. Le paramètre `lparam` est le
// pointeur vers FindPangyaData transmis à EnumWindows ; il reste valide pendant toute la
// durée de l'énumération. `hwnd` est fourni par Windows et est valide durant le callback.
unsafe extern "system" fn enum_windows_callback(hwnd: HWND, lparam: LPARAM) -> windows::core::BOOL {
    let data = &mut *(lparam.0 as *mut FindPangyaData);

    if !IsWindowVisible(hwnd).as_bool() {
        return windows::core::BOOL(1);
    }

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, Some(&mut pid));

    // Mémoïsation : on réutilise le nom du processus si ce PID a déjà été résolu.
    // Gain notable quand un processus possède plusieurs fenêtres visibles (ex: Chrome),
    // car on évite de refaire OpenProcess/QueryFullProcessImageNameW pour le même PID.
    let cached_name = data.process_cache.get(&pid).cloned();
    let process_name = match cached_name {
        Some(name) => name,
        None => {
            let name = get_process_name(pid).unwrap_or_default();
            data.process_cache.insert(pid, name.clone());
            name
        }
    };
    let process_name_lower = process_name.to_lowercase();

    let mut title_buf = [0u16; 256];
    let len = GetWindowTextW(hwnd, &mut title_buf);
    let title = String::from_utf16_lossy(&title_buf[..len.max(0) as usize]);

    if !title.is_empty() {
        data.all_windows.push(WindowInfo {
            hwnd,
            pid,
            process_name: process_name.clone(),
            window_title: title.clone(),
        });
    }

    if process_name_lower.contains("projectg") || process_name_lower.contains("pangya_client") {
        data.hwnd = hwnd;
        data.pid = pid;
        data.process_name = process_name;
        data.window_title = title;
        return windows::core::BOOL(0);
    }

    windows::core::BOOL(1)
}

fn run_enum_windows() -> FindPangyaData {
    let mut data = FindPangyaData {
        hwnd: HWND(std::ptr::null_mut()),
        pid: 0,
        process_name: String::new(),
        window_title: String::new(),
        all_windows: Vec::new(),
        process_cache: HashMap::new(),
    };
    // SAFETY: on passe à EnumWindows un pointeur valide vers `data`, variable locale dont la
    // durée de vie couvre l'intégralité de l'appel. Le callback n'accède aux données que via
    // ce pointeur.
    unsafe {
        let _ = EnumWindows(
            Some(enum_windows_callback),
            LPARAM(&mut data as *mut FindPangyaData as isize),
        );
    }
    data
}

fn find_pangya_hwnd() -> Option<FindPangyaData> {
    let data = run_enum_windows();
    if data.hwnd.is_invalid() || data.hwnd.0.is_null() {
        None
    } else {
        Some(data)
    }
}

fn find_pangya_cached(app: &AppHandle) -> Option<FindPangyaData> {
    let cache_state = app.state::<Arc<Mutex<PangyaWindowCache>>>();

    {
        let lock = cache_state.lock().unwrap();
        if let (Some(data), Some(fetched_at)) = (&lock.data, lock.fetched_at) {
            if fetched_at.elapsed() < PANGYA_CACHE_TTL {
                // SAFETY: IsWindow vérifie simplement l'existence d'une fenêtre. data.hwnd est
                // un HWND précédemment retourné par EnumWindows, donc valide à passer ici.
                if unsafe { IsWindow(Some(data.hwnd)) }.as_bool() {
                    return Some(data.clone());
                }
            }
        }
    }

    let fresh = find_pangya_hwnd();

    {
        let mut lock = cache_state.lock().unwrap();
        lock.data = fresh.clone();
        lock.fetched_at = Some(Instant::now());
    }

    fresh
}

fn list_all_windows() -> Vec<WindowInfo> {
    run_enum_windows().all_windows
}

// =====================================================================
// TRANSPARENCE & CLICK-THROUGH
// =====================================================================
fn enable_transparency(app: &AppHandle, window_label: &str) {
    if let Some(win) = app.get_webview_window(window_label) {
        if let Ok(hwnd_ptr) = win.hwnd() {
            let hwnd = HWND(hwnd_ptr.0);
            // SAFETY: `hwnd` provient d'une fenêtre Tauri existante (win.hwnd()).
            // GWL_EXSTYLE est un index valide pour GetWindowLongPtrW/SetWindowLongPtrW.
            // Ces variantes "Ptr" gèrent correctement les applications 64 bits.
            unsafe {
                let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let layered = WS_EX_LAYERED.0 as isize;
                let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, style | layered);
            }
        }
    }
}

fn apply_click_through_style(app: &AppHandle, window_label: &str, locked: bool) {
    if let Some(win) = app.get_webview_window(window_label) {
        if let Ok(hwnd_ptr) = win.hwnd() {
            let hwnd = HWND(hwnd_ptr.0);
            // SAFETY: `hwnd` provient d'une fenêtre Tauri existante. GWL_EXSTYLE est valide.
            // Ces variantes "Ptr" gèrent correctement les applications 64 bits.
            unsafe {
                let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
                let transparent = WS_EX_TRANSPARENT.0 as isize;
                let layered = WS_EX_LAYERED.0 as isize;
                let new_style = if locked {
                    style | transparent | layered
                } else {
                    (style & !transparent) | layered
                };
                let _ = SetWindowLongPtrW(hwnd, GWL_EXSTYLE, new_style);
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
    let _ = set_overlay_click_through(app, WIN_RULER.to_string(), true);
}

#[tauri::command]
fn disable_click_through(app: AppHandle) {
    let _ = set_overlay_click_through(app, WIN_RULER.to_string(), false);
}

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

fn move_overlay_by(app: &AppHandle, label: &str, dx: i32, dy: i32) -> Result<(), String> {
    if let Some(window) = app.get_webview_window(label) {
        let mut pos = window.outer_position().map_err(|e| e.to_string())?;
        pos.x += dx;
        pos.y += dy;
        window.set_position(pos).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// =====================================================================
// COMMANDES DE VISIBILITÉ DES OVERLAYS
// =====================================================================
#[tauri::command]
fn set_ruler_visibility(app: AppHandle, show: bool) {
    set_overlay_visibility_internal(&app, WIN_RULER, Some(EVT_SYNC_RULER_VIS), show);
}

#[tauri::command]
fn set_wind_visibility(app: AppHandle, show: bool) {
    set_overlay_visibility_internal(&app, WIN_WIND, Some(EVT_SYNC_WIND_VIS), show);
}

#[tauri::command]
fn set_spin_visibility(app: AppHandle, show: bool) {
    set_overlay_visibility_internal(&app, WIN_SPIN, Some(EVT_SYNC_SPIN_VIS), show);
}

#[tauri::command]
fn set_infos_shot_visibility(app: AppHandle, show: bool) {
    set_overlay_visibility_internal(&app, WIN_INFOS, Some(EVT_SYNC_INFOS_VIS), show);
}

#[tauri::command]
fn set_input_bar_visibility(app: AppHandle, show: bool) {
    set_overlay_visibility_internal(&app, WIN_INPUT, None, show);
}

// =====================================================================
// COMMANDES DE DÉPLACEMENT DES OVERLAYS
// =====================================================================
#[tauri::command]
fn move_ruler(app: AppHandle, x: i32, y: i32) {
    let _ = move_overlay_by(&app, WIN_RULER, x, y);
}

#[tauri::command]
fn move_wind_overlay(app_handle: tauri::AppHandle, dx: i32, dy: i32) -> Result<(), String> {
    move_overlay_by(&app_handle, WIN_WIND, dx, dy)
}

#[tauri::command]
fn move_spin_overlay(app_handle: tauri::AppHandle, dx: i32, dy: i32) -> Result<(), String> {
    move_overlay_by(&app_handle, WIN_SPIN, dx, dy)
}

#[tauri::command]
fn move_infos_shot(app_handle: tauri::AppHandle, dx: i32, dy: i32) -> Result<(), String> {
    move_overlay_by(&app_handle, WIN_INFOS, dx, dy)
}

// =====================================================================
// AUTRES COMMANDES DE VISIBILITÉ / SYNCHRO
// =====================================================================
#[tauri::command]
fn get_settings_visibility(app: AppHandle) -> bool {
    app.get_webview_window(WIN_SETTINGS)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

#[tauri::command]
fn get_overlays_screen_visibility(app: AppHandle) -> bool {
    app.get_webview_window(WIN_OVERLAYS_SCREEN)
        .map(|w| w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

#[tauri::command]
fn emit_wind_angle(app_handle: tauri::AppHandle, angle: i32) -> Result<(), String> {
    app_handle
        .emit(EVT_SYNC_WIND_ANGLE, serde_json::json!({ "angle": angle }))
        .map_err(|e| e.to_string())?;
    Ok(())
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

    // Par défaut, on conserve la résolution mesurée (arrondie).
    let mut result = (w.round() as i32, h.round() as i32);

    // On cherche la résolution officielle la plus proche de la valeur mesurée.
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

    // On n'aligne sur une résolution officielle que si on en est à moins de 3 %.
    // Sinon on garde la valeur mesurée (cas des résolutions non standard).
    if let Some(res) = best_resolution {
        if best_dist <= 0.03 {
            result = res;
        }
    }

    (result.0, result.1, game_dpi, monitor_dpi, scale_factor)
}

fn read_game_resolution(app: &AppHandle) -> Result<GameResolution, String> {
    let game_data =
        find_pangya_cached(app).ok_or_else(|| "Fenêtre Pangya introuvable.".to_string())?;
    let mut rect = RECT::default();
    // SAFETY: game_data.hwnd est la fenêtre du jeu validée. `rect` est correctement
    // initialisé avant l'appel à GetClientRect.
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
fn get_game_resolution(app: AppHandle) -> Result<GameResolution, String> {
    read_game_resolution(&app)
}

#[tauri::command]
fn refresh_game_resolution(app: AppHandle) -> Result<GameResolution, String> {
    let res = read_game_resolution(&app)?;
    let _ = app.emit(EVT_UPDATE_GAME_RESOLUTION, &res);
    Ok(res)
}

#[tauri::command]
fn get_game_info(app: AppHandle) -> Result<GameInfo, String> {
    let game_data =
        find_pangya_cached(&app).ok_or_else(|| "Fenêtre Pangya introuvable.".to_string())?;
    let mut rect = RECT::default();
    // SAFETY: game_data.hwnd est la fenêtre du jeu validée.
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

#[derive(serde::Serialize)]
struct GameClientRectOnScreen {
    x: i32,
    y: i32,
    width: i32,
    height: i32,
}

#[tauri::command]
fn get_game_client_rect_on_screen(app: AppHandle) -> Result<GameClientRectOnScreen, String> {
    let game_data =
        find_pangya_cached(&app).ok_or_else(|| "Fenêtre Pangya introuvable.".to_string())?;
    let mut rect = RECT::default();
    let mut origin = POINT::default();
    // SAFETY: game_data.hwnd est la fenêtre du jeu validée. `rect` et `origin` sont
    // initialisés avant les appels à GetClientRect et ClientToScreen.
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

#[tauri::command]
fn get_game_dpi_debug(app: AppHandle) -> Result<GameDpiDebug, String> {
    let game_data =
        find_pangya_cached(&app).ok_or_else(|| "Fenêtre Pangya introuvable.".to_string())?;
    let mut rect = RECT::default();
    // SAFETY: game_data.hwnd est la fenêtre du jeu validée. `rect` est initialisé.
    unsafe {
        GetClientRect(game_data.hwnd, &mut rect).map_err(|e| e.to_string())?;
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

// =====================================================================
// SOURIS & CLICS
// =====================================================================
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

fn force_foreground(hwnd_target: HWND) -> bool {
    // SAFETY: les handles/thread IDs proviennent de fenêtres valides (GetForegroundWindow et
    // hwnd_target détecté). AttachThreadInput est systématiquement défait avant le retour.
    unsafe {
        let foreground_hwnd = GetForegroundWindow();
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
fn move_and_click_focused(app: AppHandle, x: f64, y: f64) -> Result<(), String> {
    std::thread::sleep(std::time::Duration::from_millis(100));

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| e.to_string())?;

    enigo
        .move_mouse(x.round() as i32, y.round() as i32, Coordinate::Abs)
        .map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(50));

    if let Some(game_data) = find_pangya_cached(&app) {
        let focus_ok = force_foreground(game_data.hwnd);
        if !focus_ok {
            eprintln!("Impossible de donner le focus à la fenêtre du jeu.");
        }
        std::thread::sleep(std::time::Duration::from_millis(100));
    } else {
        eprintln!("Fenêtre Pangya introuvable.");
    }

    enigo
        .button(Button::Left, Direction::Press)
        .map_err(|e| e.to_string())?;
    std::thread::sleep(std::time::Duration::from_millis(80));
    enigo
        .button(Button::Left, Direction::Release)
        .map_err(|e| e.to_string())?;

    Ok(())
}

// =====================================================================
// SURVEILLANCE DE DOSSIER & CAPTURES
// =====================================================================
fn lancer_surveillance_dossier(app: AppHandle, path_str: String) {
    let state = app.state::<Arc<Mutex<WatcherState>>>();
    let mut state_lock = state.lock().unwrap();
    let _old = state_lock.watcher.take();

    let app_clone = app.clone();
    // On gère l'erreur au lieu de paniquer : si le watcher ne peut pas être créé,
    // on log l'erreur et on retourne sans faire planter l'application.
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
        Err(e) => {
            eprintln!("Impossible de créer le watcher de dossier : {}", e);
            state_lock.watched_path = None;
            return;
        }
    };

    let path = PathBuf::from(&path_str);
    if path.is_dir() {
        let _ = watcher.watch(&path, RecursiveMode::NonRecursive);
        state_lock.watcher = Some(watcher);
        // Mémoriser le chemin surveillé pour éviter de relancer le watcher inutilement.
        state_lock.watched_path = Some(path_str);
    } else {
        state_lock.watched_path = None;
    }
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

    // On relance le watcher s'il n'existe pas OU s'il surveille un autre dossier
    // que celui demandé. Le lock est relâché avant l'appel pour éviter tout deadlock.
    let state = app.state::<Arc<Mutex<WatcherState>>>();
    let needs_watch = {
        let lock = state.lock().unwrap();
        lock.watcher.is_none() || lock.watched_path.as_deref() != Some(folder_path.as_str())
    };
    if needs_watch {
        lancer_surveillance_dossier(app.clone(), folder_path.clone());
    }

    // Optimisation : on garde uniquement l'image la plus récente pendant le parcours,
    // au lieu de collecter tous les fichiers dans un Vec puis de trier le tout.
    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
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
        let image_bytes = fs::read(&latest_path).map_err(|e| e.to_string())?;
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
fn clear_screenshot_folder(folder_path: String) -> Result<String, String> {
    let dir = PathBuf::from(&folder_path);
    if !dir.is_dir() {
        return Err("Dossier invalide.".to_string());
    }

    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;
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

// =====================================================================
// LANGUES & DONNÉES DE PARCOURS
// =====================================================================
#[tauri::command]
fn get_available_languages(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let cache_state = app.state::<Arc<Mutex<LanguagesCache>>>();

    // Servir depuis le cache si la liste a déjà été scannée
    {
        let lock = cache_state.lock().unwrap();
        if let Some(langs) = &lock.available {
            return Ok(langs.clone());
        }
    }

    // Pas encore en cache → scanner le dossier lang
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

    // Mémoriser la liste pour les prochaines demandes
    {
        let mut lock = cache_state.lock().unwrap();
        lock.available = Some(langs.clone());
    }

    Ok(langs)
}

#[tauri::command]
fn load_language_json(app: tauri::AppHandle, lang: String) -> Result<String, String> {
    let cache_state = app.state::<Arc<Mutex<LanguagesCache>>>();

    // Servir depuis le cache si cette langue a déjà été lue
    {
        let lock = cache_state.lock().unwrap();
        if let Some(content) = lock.contents.get(&lang) {
            return Ok(content.clone());
        }
    }

    // Pas encore en cache → lire le fichier
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

    let content = fs::read_to_string(file_path).map_err(|e| e.to_string())?;

    // Mémoriser le contenu pour les prochaines demandes de cette langue
    {
        let mut lock = cache_state.lock().unwrap();
        lock.contents.insert(lang.clone(), content.clone());
    }

    Ok(content)
}

#[tauri::command]
fn parcours(app: tauri::AppHandle) -> Result<serde_json::Value, String> {
    let cache_state = app.state::<Arc<Mutex<PinLocationCache>>>();

    // Servir depuis le cache si les données de parcours ont déjà été chargées
    {
        let lock = cache_state.lock().unwrap();
        if let Some(data) = &lock.data {
            return Ok(data.clone());
        }
    }

    // Pas encore en cache → localiser et lire le fichier pin_location.json
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
    let value: serde_json::Value =
        serde_json::from_str(&contenu_json).map_err(|e| e.to_string())?;

    // Mémoriser les données pour les prochaines demandes
    {
        let mut lock = cache_state.lock().unwrap();
        lock.data = Some(value.clone());
    }

    Ok(value)
}

// =====================================================================
// POINT D'ENTRÉE
// =====================================================================
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
            enable_click_through,
            disable_click_through,
            set_overlay_click_through,
            set_ruler_visibility,
            set_spin_visibility,
            set_input_bar_visibility,
            set_wind_visibility,
            emit_wind_angle,
            move_wind_overlay,
            move_spin_overlay,
            set_infos_shot_visibility,
            get_settings_visibility,
            get_overlays_screen_visibility,
            move_infos_shot,
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

            for label in [WIN_RULER, WIN_WIND, WIN_INPUT, WIN_SPIN, WIN_INFOS] {
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

            // On gère l'absence éventuelle de la fenêtre principale au lieu de paniquer.
            if let Some(window) = app.get_webview_window(WIN_MAIN) {
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    let _ = window.show();
                });
            } else {
                eprintln!(
                    "Fenêtre principale '{}' introuvable au démarrage.",
                    WIN_MAIN
                );
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == WIN_MAIN {
                    std::process::exit(0);
                } else if window.label() == WIN_SETTINGS {
                    api.prevent_close();
                    let _ = window.hide();
                } else if window.label() == WIN_OVERLAYS_SCREEN {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
