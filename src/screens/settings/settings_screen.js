// =====================================================================
// FICHIER : settings_screen.js
// DESCRIPTION : Logique de la fenêtre Paramètres dédiée
// =====================================================================
// Gère :
//   1. Champs de configuration écran (rel-width, rel-height, smart-dev-limit, auto-fit)
//   2. Gestion du dossier d'images (via ScreenshotManager)
//   3. Synchronisation inter-fenêtres (thème, langue) — la langue est
//      gérée automatiquement par shared/js/i18n.js
// =====================================================================

(function () {
  "use strict";

  // ================================================================
  // CHAMPS DE CONFIGURATION ÉCRAN
  // ================================================================

  function setupScreenConfigFields(storage) {
    const fields = ["rel-width", "rel-height", "smart-dev-limit", "auto-fit"];

    fields.forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;

      const isCheckbox = el.type === "checkbox";

      const saved = storage.get(id);
      if (saved !== null) {
        if (isCheckbox) {
          el.checked = saved === true || saved === "true";
        } else {
          el.value = saved;
        }
      }

      el.addEventListener(isCheckbox ? "change" : "input", () => {
        const value = isCheckbox ? el.checked : el.value;
        storage.set(id, value);
      });
    });
  }

  // ================================================================
  // DOSSIER D'IMAGES
  // ================================================================

  function setupScreenshotManager(tauri, storage) {
    window.ScreenshotManager(tauri, storage);
  }

  // ================================================================
  // INITIALISATION
  // ================================================================

  document.addEventListener("DOMContentLoaded", async () => {
    const tauri = window.TauriService;
    const storage = window.StorageService;

    // Storage : idempotent, safe même si i18n.js l'a déjà initialisé
    if (storage) {
      await storage.init();
    }

    setupScreenConfigFields(storage);

    // ScreenshotManager peut injecter du HTML avec data-i18n,
    // donc on attend que les traductions soient prêtes.
    const startScreenshot = () => {
      if (tauri && storage) setupScreenshotManager(tauri, storage);
    };

    if (window.i18nReady) {
      startScreenshot();
    } else {
      document.addEventListener("i18n-loaded", startScreenshot, { once: true });
    }

    // Sync inter-fenêtres : afficher/masquer cette fenêtre
    // (utilise TauriService.getCurrentWindow() qui est lazy et safe)
    if (tauri && tauri.isAvailable) {
      tauri.listen("toggle-settings-visibility", async (event) => {
        const show = event.payload?.show;
        const win = await tauri.getCurrentWindow();
        if (!win) return;

        if (show === true) {
          await win.show();
          await win.setFocus();
        } else if (show === false) {
          await win.hide();
        }
      });
    }
  });
})();
