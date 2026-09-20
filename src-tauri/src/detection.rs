//! Detection du jeu et des changements utiles aux overlays.
use crate::constants::PANGYA_CACHE_TTL;
use crate::state::PangyaWindowCache;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::{CloseHandle, HWND, LPARAM};
use windows::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32, PROCESS_QUERY_LIMITED_INFORMATION,
};
use windows::Win32::UI::WindowsAndMessaging::{
    EnumWindows, GetWindowTextW, GetWindowThreadProcessId, IsWindow, IsWindowVisible,
};

// =====================================================================
// STRUCTURES DE DÉTECTION
// =====================================================================

// Structure pour stocker les informations d'une fenêtre
#[derive(Clone, Debug)]
pub struct WindowInfo {
    pub hwnd: HWND,
    pub pid: u32,
    pub process_name: String,
    pub window_title: String,
}

// Structure pour stocker les informations de la fenêtre Pangya détectée
#[derive(Clone)]
pub struct FindPangyaData {
    pub hwnd: HWND,
    pub pid: u32,
    pub process_name: String,
    pub window_title: String,
    pub all_windows: Vec<WindowInfo>,
    // Cache des noms de processus déjà résolus pendant l'énumération.
    // Évite de refaire OpenProcess pour un même PID possédant plusieurs fenêtres visibles.
    pub process_cache: HashMap<u32, String>,
}

// SAFETY: HWND is a Windows handle (essentially an integer identifier) that can be safely
// sent across threads. The underlying window is managed by Windows and the handle remains
// valid as long as the window exists. IsWindow() is used to verify validity before use.
unsafe impl Send for FindPangyaData {}
unsafe impl Sync for FindPangyaData {}
unsafe impl Send for WindowInfo {}
unsafe impl Sync for WindowInfo {}

// =====================================================================
// HELPERS WIN32
// =====================================================================

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

    let is_pangya =
        process_name_lower.contains("projectg") || process_name_lower.contains("pangya_client");

    if is_pangya {
        // Cas Pangya : on clone pour la liste de debug (si titre présent),
        // puis on déplace les originaux dans `data` avant de retourner.
        if !title.is_empty() {
            data.all_windows.push(WindowInfo {
                hwnd,
                pid,
                process_name: process_name.clone(),
                window_title: title.clone(),
            });
        }

        data.hwnd = hwnd;
        data.pid = pid;
        data.process_name = process_name;
        data.window_title = title;
        return windows::core::BOOL(0);
    }

    // Cas non-Pangya : on déplace directement les valeurs dans la liste de debug.
    // Aucun clone pour la grande majorité des fenêtres.
    if !title.is_empty() {
        data.all_windows.push(WindowInfo {
            hwnd,
            pid,
            process_name,
            window_title: title,
        });
    }

    windows::core::BOOL(1)
}

// =====================================================================
// FONCTIONS PUBLIQUES DE DÉTECTION
// =====================================================================

pub fn run_enum_windows() -> FindPangyaData {
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

pub fn find_pangya_hwnd() -> Option<FindPangyaData> {
    let data = run_enum_windows();
    if data.hwnd.is_invalid() || data.hwnd.0.is_null() {
        None
    } else {
        Some(data)
    }
}

pub fn find_pangya_cached(app: &AppHandle) -> Option<FindPangyaData> {
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

pub fn list_all_windows() -> Vec<WindowInfo> {
    run_enum_windows().all_windows
}
