//! Styles et comportements specifiques aux fenetres Windows.
use crate::state::ClickThroughState;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager};
use windows::Win32::Foundation::HWND;
use windows::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_LAYERED, WS_EX_TRANSPARENT,
};

// =====================================================================
// TRANSPARENCE & CLICK-THROUGH
// =====================================================================

pub fn enable_transparency(app: &AppHandle, window_label: &str) {
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

pub fn apply_click_through_style(app: &AppHandle, window_label: &str, locked: bool) {
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

pub fn reapply_click_through(app: &AppHandle, window_label: &str) {
    let state = app.state::<Arc<Mutex<ClickThroughState>>>();
    let locked = {
        let lock = state.lock().unwrap();
        lock.locked.get(window_label).copied().unwrap_or(false)
    };

    apply_click_through_style(app, window_label, locked);
}
