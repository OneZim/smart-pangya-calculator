//! Etat partage de l'application.
use crate::detection::FindPangyaData;
use notify::RecommendedWatcher;
use std::collections::HashMap;
use std::time::Instant;

// =====================================================================
// ÉTATS PARTAGÉS
// =====================================================================

// On garde une référence globale du Watcher pour éviter qu'il ne soit détruit en mémoire.
pub struct WatcherState {
    pub watcher: Option<RecommendedWatcher>,
    // Chemin actuellement surveillé. Permet de ne relancer le watcher que si le dossier change.
    pub watched_path: Option<String>,
}

// Garde en mémoire le dernier état "click-through" demandé pour chaque fenêtre.
pub struct ClickThroughState {
    pub locked: HashMap<String, bool>,
}

// Cache du résultat de find_pangya_hwnd pour éviter de refaire un EnumWindows complet
// à chaque commande qui a besoin du jeu.
pub struct PangyaWindowCache {
    pub data: Option<FindPangyaData>,
    pub fetched_at: Option<Instant>,
}

impl PangyaWindowCache {
    pub fn new() -> Self {
        Self {
            data: None,
            fetched_at: None,
        }
    }
}

// Cache des données de parcours (pin_location.json). Chargé une seule fois à la première
// demande, puis servi depuis la mémoire pour éviter de relire le disque à chaque appel.
pub struct PinLocationCache {
    pub data: Option<serde_json::Value>,
}

impl PinLocationCache {
    pub fn new() -> Self {
        Self { data: None }
    }
}

// Cache des langues : liste des langues disponibles + contenu de chaque langue déjà demandée.
// Comme l'utilisateur ne change de langue qu'une seule fois par session, ce cache évite de
// relire les fichiers du dossier lang à chaque changement d'écran.
pub struct LanguagesCache {
    pub available: Option<Vec<String>>,
    pub contents: HashMap<String, String>,
}

impl LanguagesCache {
    pub fn new() -> Self {
        Self {
            available: None,
            contents: HashMap::new(),
        }
    }
}
