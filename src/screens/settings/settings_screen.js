// =====================================================================
// FICHIER : settings_screen.js
// DESCRIPTION : Logique de la fenêtre Paramètres dédiée
// =====================================================================
// Gère :
//   1. Détection auto de la résolution du jeu (rel-width, rel-height)
//   2. Toggles verrouillés (smart-dev-limit, auto-fit) — forcés à false
//   3. Gestion du dossier d'images (via ScreenshotManager)
//   4. Synchronisation inter-fenêtres (thème, langue) — la langue est
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
  // DÉTECTION DE LA RÉSOLUTION DU JEU
  // ================================================================

  /**
   * Remplit les champs rel-width / rel-height avec la résolution du jeu
   * détectée côté Rust (get_game_resolution). En échec (jeu non lancé),
   * on conserve les valeurs existantes.
   * @param {Object} storage - StorageService
   */
  async function fillResolutionFromDetection(storage) {
    const widthEl = document.getElementById("rel-width");
    const heightEl = document.getElementById("rel-height");
    if (!storage || !widthEl || !heightEl) return;

    try {
      const resolution = await window.TauriService.invoke(
        "get_game_resolution",
      );
      if (resolution && resolution.width > 0 && resolution.height > 0) {
        widthEl.value = resolution.width;
        heightEl.value = resolution.height;
        storage.set("rel-width", resolution.width);
        storage.set("rel-height", resolution.height);
      }
    } catch (err) {
      console.warn(
        "⚠️ Résolution du jeu non détectée — valeurs précédentes conservées.",
        err,
      );
    }
  }

  async function refreshResolution(storage) {
    try {
      await window.TauriService.invoke("refresh_game_resolution");
    } catch (err) {
      console.warn("⚠️ refresh_game_resolution a échoué :", err);
    }
    await fillResolutionFromDetection(storage);
  }

  // ================================================================
  // POSITION DE LA FENÊTRE
  // ================================================================

  /**
   * Centre la fenêtre au-dessus de la fenêtre principale à chaque
   * ouverture (payload.pos fourni par app.js).
   * @param {Object} win - Fenêtre Tauri courante
   * @param {Object} payload - Payload de l'événement toggle
   */
  async function positionWindowOnShow(win, payload) {
    const pos = payload?.pos;
    if (pos && typeof pos.x === "number" && typeof pos.y === "number") {
      const { PhysicalPosition } = window.__TAURI__.dpi;
      const curSize = await win.outerSize();
      await win.setPosition(
        new PhysicalPosition(
          Math.round(pos.x + (pos.width - curSize.width) / 2),
          Math.round(pos.y + (pos.height - curSize.height) / 2),
        ),
      );
    }
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

    // Toggles verrouillés : forcés à false tant que la fonctionnalité n'est
    // pas réactivée (champs désactivés → aucun événement "change" possible).
    ["smart-dev-limit", "auto-fit"].forEach((id) => {
      const el = document.getElementById(id);
      if (el) {
        el.checked = false;
        if (storage) storage.set(id, false);
      }
    });

    // Bouton de re-détection de la résolution du jeu
    const refreshBtn = document.getElementById("btn-refresh-resolution");
    if (refreshBtn) {
      refreshBtn.addEventListener("click", () => refreshResolution(storage));
    }

    // Bouton de réinitialisation à 1920x1080
    const resetBtn = document.getElementById("btn-reset-resolution");
    if (resetBtn) {
      resetBtn.addEventListener("click", () => {
        const widthEl = document.getElementById("rel-width");
        const heightEl = document.getElementById("rel-height");
        if (widthEl && heightEl) {
          widthEl.value = 1920;
          heightEl.value = 1080;
          storage.set("rel-width", 1920);
          storage.set("rel-height", 1080);
        }
      });
    }

    // Détection initiale de la résolution du jeu
    fillResolutionFromDetection(storage);

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
          await positionWindowOnShow(win, event.payload);
          await win.show();
          await win.setFocus();
          fillResolutionFromDetection(storage);
        } else if (show === false) {
          await win.hide();
        }
      });

      // Re-détection à chaque changement de résolution du jeu (émis par
      // refresh_game_resolution côté Rust).
      tauri.listen("update-game-resolution", (event) => {
        const width = Number(event.payload?.width) || 0;
        const height = Number(event.payload?.height) || 0;
        if (width > 0 && height > 0) {
          const widthEl = document.getElementById("rel-width");
          const heightEl = document.getElementById("rel-height");
          if (widthEl) widthEl.value = width;
          if (heightEl) heightEl.value = height;
          storage.set("rel-width", width);
          storage.set("rel-height", height);
        } else {
          fillResolutionFromDetection(storage);
        }
      });
    }
  });
})();
