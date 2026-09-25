//! Constantes partagees du backend Tauri.
use std::time::Duration;

// =====================================================================
// LABELS DES FENÊTRES TAURI
// =====================================================================
// Doivent correspondre à tauri.conf.json
pub const WIN_MAIN: &str = "main";
pub const WIN_SETTINGS: &str = "settings_screen";
pub const WIN_OVERLAYS_SCREEN: &str = "overlays_screen";
pub const WIN_INPUT: &str = "input_overlay";
pub const WIN_RULER: &str = "ruler_overlay";
pub const WIN_SPIN: &str = "spin_overlay";
pub const WIN_INFOS: &str = "infos_shot";

// =====================================================================
// ÉVÉNEMENTS TAURI
// =====================================================================
// Convention : sync-*, update-*, nouvelle-*, *-visibility
pub const EVT_SYNC_RULER_VIS: &str = "sync-ruler-visibility";
pub const EVT_SYNC_SPIN_VIS: &str = "sync-spin-visibility";
pub const EVT_SYNC_INFOS_VIS: &str = "sync-infos-shot-visibility";
pub const EVT_UPDATE_GAME_RESOLUTION: &str = "update-game-resolution";
pub const EVT_NEW_CAPTURE: &str = "nouvelle-capture-detectee";
pub const EVT_GLOBAL_CLICK_PB: &str = "global-trigger-click-pb";

// =====================================================================
// CACHE DE DÉTECTION DE LA FENÊTRE PANGYA
// =====================================================================
// Pendant cette durée, on réutilise le HWND trouvé au lieu de refaire
// un EnumWindows complet.
pub const PANGYA_CACHE_TTL: Duration = Duration::from_secs(2);
