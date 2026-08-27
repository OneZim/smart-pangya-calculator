// core/utils/WindowDragHelper.js
//
// Utilitaire générique pour permettre le drag d'une fenêtre Tauri
// en cliquant n'importe où dans la page, SAUF sur les éléments
// interactifs (inputs, boutons, selects...) pour ne pas gêner
// leur usage normal.
//
// Réutilisable dans n'importe quelle fenêtre de l'appli.
(function () {
  "use strict";

  // Tags HTML considérés comme "interactifs" : un clic dessus
  // ne doit pas démarrer un drag de fenêtre.
  const DEFAULT_BLOQUANTS = [
    "INPUT",
    "SELECT",
    "OPTION",
    "BUTTON",
    "LABEL",
    "SPAN",
    "TEXTAREA",
  ];

  /**
   * Active le drag de fenêtre via mousedown, en excluant les
   * éléments interactifs.
   *
   * @param {object} tauriService - instance de TauriService (avec getCurrentWindow)
   * @param {object} [options]
   * @param {string[]} [options.bloquants] - tags à exclure du drag (par défaut: DEFAULT_BLOQUANTS)
   * @param {string[]} [options.selectors] - sélecteurs CSS additionnels à exclure (ex: ".no-drag")
   */
  window.setupWindowDrag = async function (tauriService, options = {}) {
    const bloquants = options.bloquants || DEFAULT_BLOQUANTS;
    const selectors = options.selectors || [];

    try {
      const appWindow = await tauriService?.getCurrentWindow();
      if (!appWindow) return null;

      appWindow.setIgnoreCursorEvents(false);

      const handler = (e) => {
        const isBlockedTag = bloquants.includes(e.target.tagName);
        const isBlockedSelector = selectors.some((sel) =>
          e.target.closest?.(sel),
        );
        const isInteractive =
          isBlockedTag ||
          isBlockedSelector ||
          e.target.closest?.("button") ||
          e.target.closest?.("select");

        if (!isInteractive) appWindow.startDragging();
      };

      document.addEventListener("mousedown", handler);

      // Retourne une fonction de nettoyage si besoin de désactiver plus tard
      return () => document.removeEventListener("mousedown", handler);
    } catch (error) {
      console.warn("Drag non disponible:", error);
      return null;
    }
  };
})();
