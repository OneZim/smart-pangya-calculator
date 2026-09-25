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
    let mut enigo = Enigo::new(&Settings::default()).map_err(|e| AppError::Enigo(e.to_string()))?;

    // 1. Déplace la souris sur la cible AVANT d'activer le jeu : ainsi, quand le
    //    jeu passe au premier plan, le clic physique déjà capté (cli sur le bouton
    //    « Appliquer » alors que le curseur était dans la zone du jeu) est rejoué
    //    par le jeu sur la cible elle-même, et non sur la position du curseur.
    enigo
        .move_mouse(x.round() as i32, y.round() as i32, Coordinate::Abs)
        .map_err(|e| AppError::Enigo(e.to_string()))?;

    std::thread::sleep(std::time::Duration::from_millis(15));

    // 2. Focus ensuite, confirmé avant le clic.
    if let Some(game_data) = find_pangya_cached(&app) {
        let focus_ok = force_foreground(game_data.hwnd);
        if !focus_ok {
            eprintln!("Impossible de donner le focus à la fenêtre du jeu.");
        }

        let focused = wait_for_focus(game_data.hwnd, 500);
        if !focused {
            return Err(AppError::Enigo(
                "Focus du jeu non confirmé, clic annulé.".into(),
            ));
        }

        // Stabilisation après focus (le jeu doit être prêt à recevoir les inputs).
        std::thread::sleep(std::time::Duration::from_millis(50));
    } else {
        return Err(AppError::Enigo("Fenêtre Pangya introuvable.".into()));
    }

    // 3. Clic quasi immédiat, pour réduire la fenêtre où un mouvement physique
    //    de la souris pourrait écraser la position.
    enigo
        .button(Button::Left, Direction::Press)
        .map_err(|e| AppError::Enigo(e.to_string()))?;

    std::thread::sleep(std::time::Duration::from_millis(80));

    enigo
        .button(Button::Left, Direction::Release)
        .map_err(|e| AppError::Enigo(e.to_string()))?;

    Ok(())
}
