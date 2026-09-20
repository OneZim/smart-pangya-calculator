// =====================================================================
// TYPE D'ERREUR CENTRALISÉ
// =====================================================================
// Toutes les commandes Tauri retournent désormais Result<T, AppError>.
// AppError se sérialise comme une simple chaîne de caractères afin que
// le frontend reçoive exactement le même format qu'avant (une string),
// sans aucun changement de comportement côté JavaScript.
#[derive(Debug, thiserror::Error)]
pub enum AppError {
    #[error("Fenêtre Pangya introuvable.")]
    WindowNotFound,

    #[error("{0}")]
    Message(String),

    #[error("Erreur Win32 : {0}")]
    Win32(String),

    #[error("Erreur fenêtre : {0}")]
    Window(String),

    #[error("Erreur événement : {0}")]
    Emit(String),

    #[error("Erreur souris : {0}")]
    Enigo(String),

    #[error("Erreur IO : {0}")]
    Io(#[from] std::io::Error),

    #[error("Erreur JSON : {0}")]
    Json(#[from] serde_json::Error),
}

// Sérialisation comme une simple string pour préserver le format reçu par le frontend.
impl serde::Serialize for AppError {
    fn serialize<S>(&self, serializer: S) -> Result<S::Ok, S::Error>
    where
        S: serde::Serializer,
    {
        serializer.serialize_str(&self.to_string())
    }
}
