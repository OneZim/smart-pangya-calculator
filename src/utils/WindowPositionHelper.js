// shared/WindowPositionHelper.js
(function () {
  "use strict";

  // ================================================================
  // RESTAURER LA POSITION SAUVEGARDÉE (à appeler au démarrage,
  // après storage.init())
  // ================================================================

  async function restoreWindowPosition(storage, key) {
    if (!storage || !window.__TAURI__?.window) return;

    const saved = storage.get(key, null);
    if (!saved || typeof saved.x !== "number" || typeof saved.y !== "number") {
      return;
    }

    try {
      const { getCurrentWindow } = window.__TAURI__.window;
      const { PhysicalPosition } = window.__TAURI__.dpi;
      const win = getCurrentWindow();
      await win.setPosition(new PhysicalPosition(saved.x, saved.y));
    } catch (err) {
      console.error(`❌ Erreur restauration position (${key}):`, err);
    }
  }

  // ================================================================
  // SAUVEGARDER LA POSITION ACTUELLE (à appeler à la fin d'un drag,
  // ou après un déplacement clavier/bouton — avec un debounce conseillé)
  // ================================================================

  async function saveWindowPosition(storage, key) {
    if (!storage || !window.__TAURI__?.window) return;

    try {
      const { getCurrentWindow } = window.__TAURI__.window;
      const win = getCurrentWindow();
      const pos = await win.outerPosition();
      storage.set(key, { x: pos.x, y: pos.y });
    } catch (err) {
      console.error(`❌ Erreur sauvegarde position (${key}):`, err);
    }
  }

  // ================================================================
  // VERSION "DEBOUNCED" — pratique pendant un drag continu, pour ne
  // pas écrire sur disque à chaque pixel déplacé
  // ================================================================

  function createDebouncedPositionSaver(storage, key, delay = 300) {
    let timeout = null;
    return function () {
      clearTimeout(timeout);
      timeout = setTimeout(() => {
        saveWindowPosition(storage, key);
      }, delay);
    };
  }

  window.WindowPositionHelper = {
    restoreWindowPosition,
    saveWindowPosition,
    createDebouncedPositionSaver,
  };
})();
