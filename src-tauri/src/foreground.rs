//! Gestion de la fenetre ou du processus au premier plan.
use windows::Win32::Foundation::HWND;
use windows::Win32::System::Threading::{AttachThreadInput, GetCurrentThreadId};
use windows::Win32::UI::WindowsAndMessaging::{
    BringWindowToTop, GetForegroundWindow, GetWindowThreadProcessId, SetForegroundWindow,
};

// =====================================================================
// MISE AU PREMIER PLAN DE LA FENÊTRE DU JEU
// =====================================================================

pub fn force_foreground(hwnd_target: HWND) -> bool {
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

// =====================================================================
// ATTENTE ACTIVE DU FOCUS
// =====================================================================

// Attend que la fenêtre cible ait réellement le focus, en vérifiant régulièrement
// (polling) au lieu de dormir un délai fixe. Retourne true dès que le focus est
// confirmé, ou false si le timeout est atteint.
pub fn wait_for_focus(hwnd_target: HWND, timeout_ms: u64) -> bool {
    let start = std::time::Instant::now();
    let timeout = std::time::Duration::from_millis(timeout_ms);
    let poll_interval = std::time::Duration::from_millis(10);

    loop {
        // SAFETY: GetForegroundWindow retourne simplement le HWND de la fenêtre
        // actuellement au premier plan. Aucun paramètre sensible.
        let foreground = unsafe { GetForegroundWindow() };

        if foreground == hwnd_target {
            return true;
        }

        if start.elapsed() >= timeout {
            return false;
        }

        std::thread::sleep(poll_interval);
    }
}
