use crate::detection::find_pangya_cached;
use crate::error::AppError;
use crate::foreground::{force_foreground, wait_for_focus};
use enigo::{Button, Coordinate, Direction, Enigo, Mouse, Settings};
use tauri::AppHandle;

// =====================================================================
// SOURIS & CLICS
// =====================================================================

#[tauri::command]
pub fn move_and_click(x: f64, y: f64) -> Result<(), AppError> {
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| AppError::Enigo(e.to_string()))?;

    enigo
        .move_mouse(x.round() as i32, y.round() as i32, Coordinate::Abs)
        .map_err(|e| AppError::Enigo(e.to_string()))?;

    std::thread::sleep(std::time::Duration::from_millis(30));

    enigo
        .button(Button::Left, Direction::Click)
        .map_err(|e| AppError::Enigo(e.to_string()))?;

    Ok(())
}

#[tauri::command]
pub fn get_mouse_position() -> Result<(i32, i32), AppError> {
    let enigo = Enigo::new(&Settings::default()).map_err(|e| AppError::Enigo(e.to_string()))?;
    enigo.location().map_err(|e| AppError::Enigo(e.to_string()))
}

#[tauri::command]
pub fn move_and_click_focused(app: AppHandle, x: f64, y: f64) -> Result<(), AppError> {
    std::thread::sleep(std::time::Duration::from_millis(100));

    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| AppError::Enigo(e.to_string()))?;

    enigo
        .move_mouse(x.round() as i32, y.round() as i32, Coordinate::Abs)
        .map_err(|e| AppError::Enigo(e.to_string()))?;

    std::thread::sleep(std::time::Duration::from_millis(50));

    if let Some(game_data) = find_pangya_cached(&app) {
        let focus_ok = force_foreground(game_data.hwnd);
        if !focus_ok {
            eprintln!("Impossible de donner le focus à la fenêtre du jeu.");
        }
        // On attend que le jeu ait réellement le focus (polling au lieu d'un sleep fixe).
        // Timeout de 500 ms : largement suffisant pour un changement de focus.
        let focused = wait_for_focus(game_data.hwnd, 500);
        if !focused {
            eprintln!("Le focus du jeu n'a pas pu être confirmé dans le délai imparti.");
        }
        // Petit délai de stabilisation après confirmation du focus, pour laisser au jeu
        // le temps de préparer la réception des entrées avant le clic.
        std::thread::sleep(std::time::Duration::from_millis(50));
    } else {
        eprintln!("Fenêtre Pangya introuvable.");
    }

    enigo
        .button(Button::Left, Direction::Press)
        .map_err(|e| AppError::Enigo(e.to_string()))?;

    std::thread::sleep(std::time::Duration::from_millis(80));

    enigo
        .button(Button::Left, Direction::Release)
        .map_err(|e| AppError::Enigo(e.to_string()))?;

    Ok(())
}
