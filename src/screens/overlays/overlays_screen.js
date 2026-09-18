// =====================================================================
// FICHIER : overlays_screen.js
// DESCRIPTION : Logique de la fenêtre Overlays dédiée
// =====================================================================
// Gère :
//   1. Affichage/masquage des overlays (input bar, ruler, wind, spin, infos)
//   2. Verrouillage (click-through) de chaque overlay
//   3. Déplacement (mouvement) de chaque overlay
//   4. Couleur du repère + repère T de la règle
//   5. Synchronisation inter-fenêtres (visibilité) + ouverture via le
//      bouton "Overlays" de la fenêtre principale
// =====================================================================

(function () {
  "use strict";

  // ================================================================
  // TOGGLE : visibility / click-through / couleur / repère T
  // ================================================================

  function setupOverlayVisibilityToggles(tauri) {
    // Input Bar
    const toggleInputBar = document.getElementById("toggle-show-input-bar");
    if (toggleInputBar) {
      toggleInputBar.onclick = function () {
        tauri.setOverlayVisibility("input_bar", this.checked);
      };
    }

    // Wind overlay
    const toggleShowWind = document.getElementById(
      "toggle-show-wind-overlay",
    );
    if (toggleShowWind) {
      toggleShowWind.onclick = function () {
        tauri.setOverlayVisibility("wind", this.checked);
      };
    }

    // Spin overlay
    const toggleShowSpin = document.getElementById("toggle-show-spin");
    if (toggleShowSpin) {
      toggleShowSpin.onclick = function () {
        tauri.setOverlayVisibility("spin", this.checked);
      };
    }

    // Ruler overlay
    const toggleShowRuler = document.getElementById("toggle-show-ruler");
    if (toggleShowRuler) {
      toggleShowRuler.onclick = function () {
        tauri.setOverlayVisibility("ruler", this.checked);
      };
    }

    // Infos Shot overlay
    const toggleShowInfosShot = document.getElementById(
      "toggle-show-infos-shot",
    );
    if (toggleShowInfosShot) {
      toggleShowInfosShot.onclick = function () {
        tauri.invoke("set_infos_shot_visibility", { show: this.checked });
      };
    }
  }

  function setupClickThroughToggles(tauri, storage) {
    // ============================================================
    // WIND CLICK-THROUGH (verrouillage du vent)
    // ============================================================
    const toggleWindMain = document.getElementById(
      "toggle-wind-click-through",
    );
    if (toggleWindMain) {
      const savedState = storage.get("wind_click_through", false);
      toggleWindMain.checked = savedState;

      if (tauri.isAvailable) {
        tauri.setOverlayClickThrough("wind_overlay", savedState);
      }

      toggleWindMain.addEventListener("change", function () {
        const locked = this.checked;
        if (tauri.isAvailable) {
          tauri.setOverlayClickThrough("wind_overlay", locked);
          storage.set("wind_click_through", locked);
          tauri.emit("sync-wind-click-through", { locked });
        }
      });
    }

    // ============================================================
    // SPIN CLICK-THROUGH (verrouillage du spin)
    // ============================================================
    const toggleClickThroughSpin = document.getElementById(
      "toggle-click-through-spin",
    );
    if (toggleClickThroughSpin) {
      toggleClickThroughSpin.onclick = function () {
        tauri.setOverlayClickThrough("spin_overlay", this.checked);
      };
    }

    // ============================================================
    // RULER CLICK-THROUGH (verrouillage de la règle)
    // ============================================================
    const toggleClickThrough = document.getElementById(
      "toggle-click-through",
    );
    if (toggleClickThrough) {
      toggleClickThrough.onclick = function () {
        tauri.setOverlayClickThrough("ruler_overlay", this.checked);
      };
    }

    // ============================================================
    // INFOS SHOT CLICK-THROUGH
    // ============================================================
    const toggleClickThroughInfosShot = document.getElementById(
      "toggle-click-through-infos-shot",
    );
    if (toggleClickThroughInfosShot) {
      toggleClickThroughInfosShot.onclick = function () {
        tauri.setOverlayClickThrough("infos_shot", this.checked);
      };
    }
  }

  function setupRulerOptions(tauri, storage) {
    // ============================================================
    // COULEUR DU REPÈRE (smart-indicator de la règle)
    // ============================================================
    const rulerSmartColor = document.getElementById("ruler-smart-color");
    if (rulerSmartColor) {
      rulerSmartColor.value = storage.get("ruler_smart_color", "#E0098E");
      rulerSmartColor.addEventListener("input", function () {
        const color = this.value;
        storage.set("ruler_smart_color", color);
        if (tauri.isAvailable) {
          tauri.emit("update-ruler-smart-color", { color });
        }
      });
    }

    // ============================================================
    // AFFICHAGE DU REPÈRE T (visible par défaut)
    // ============================================================
    const toggleShowTRepere = document.getElementById("toggle-show-t-repere");
    if (toggleShowTRepere) {
      toggleShowTRepere.checked = storage.get("ruler_show_t_repere", true);
      toggleShowTRepere.addEventListener("change", function () {
        const visible = this.checked;
        storage.set("ruler_show_t_repere", visible);
        if (tauri.isAvailable) {
          tauri.emit("update-ruler-t-repere", { visible });
        }
      });
    }
  }

  // ================================================================
  // MOUVEMENT DES OVERLAYS
  // ================================================================

  function setupMovementButtons(tauri) {
    // Règle
    const moveRuler = (dx, dy) =>
      tauri.invoke("move_ruler", { x: dx, y: dy });
    document
      .getElementById("btn-move-up")
      ?.addEventListener("click", () => moveRuler(0, -1));
    document
      .getElementById("btn-move-down")
      ?.addEventListener("click", () => moveRuler(0, 1));
    document
      .getElementById("btn-move-left")
      ?.addEventListener("click", () => moveRuler(-1, 0));
    document
      .getElementById("btn-move-right")
      ?.addEventListener("click", () => moveRuler(1, 0));

    // Spin
    const spinButtons = {
      "btn-spin-move-up": { dx: 0, dy: -1 },
      "btn-spin-move-down": { dx: 0, dy: 1 },
      "btn-spin-move-left": { dx: -1, dy: 0 },
      "btn-spin-move-right": { dx: 1, dy: 0 },
    };
    for (const [id, delta] of Object.entries(spinButtons)) {
      document.getElementById(id)?.addEventListener("click", () => {
        tauri.invoke("move_spin_overlay", delta);
      });
    }

    // Vent
    const windButtons = {
      "btn-wind-move-up": { dx: 0, dy: -1 },
      "btn-wind-move-down": { dx: 0, dy: 1 },
      "btn-wind-move-left": { dx: -1, dy: 0 },
      "btn-wind-move-right": { dx: 1, dy: 0 },
    };
    for (const [id, delta] of Object.entries(windButtons)) {
      document.getElementById(id)?.addEventListener("click", () => {
        tauri.invoke("move_wind_overlay", delta);
      });
    }

    // Infos Shot
    const infosShotButtons = {
      "btn-infos-shot-move-up": { dx: 0, dy: -1 },
      "btn-infos-shot-move-down": { dx: 0, dy: 1 },
      "btn-infos-shot-move-left": { dx: -1, dy: 0 },
      "btn-infos-shot-move-right": { dx: 1, dy: 0 },
    };
    for (const [id, delta] of Object.entries(infosShotButtons)) {
      document.getElementById(id)?.addEventListener("click", () => {
        tauri.invoke("move_infos_shot", delta);
      });
    }
  }

  // ================================================================
  // SYNCHRONISATION DE LA VISIBILITÉ DES OVERLAYS
  // Synchronise l'état des toggles avec les autres fenêtres
  // ================================================================

  function setupVisibilitySync(tauri) {
    const visibilitySyncMap = {
      "sync-ruler-visibility": "toggle-show-ruler",
      "sync-wind-visibility": "toggle-show-wind-overlay",
      "sync-spin-visibility": "toggle-show-spin",
      "sync-infos-shot-visibility": "toggle-show-infos-shot",
    };

    Object.entries(visibilitySyncMap).forEach(([eventName, checkboxId]) => {
      tauri.listen(eventName, (event) => {
        const cb = document.getElementById(checkboxId);
        if (cb && cb.checked !== event.payload) {
          cb.checked = event.payload;
        }
      });
    });
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
  // SYNC INTER-FENÊTRES : afficher/masquer cette fenêtre
  // ================================================================

  function setupOverlaysVisibilityListener(tauri) {
    if (tauri && tauri.isAvailable) {
      tauri.listen("toggle-overlays-visibility", async (event) => {
        const show = event.payload?.show;
        const win = await tauri.getCurrentWindow();
        if (!win) return;

        if (show === true) {
          await positionWindowOnShow(win, event.payload);
          await win.show();
          await win.setFocus();
        } else if (show === false) {
          await win.hide();
        }
      });
    }
  }

  // ================================================================
  // INITIALISATION
  // ================================================================

  document.addEventListener("DOMContentLoaded", async () => {
    const tauri = window.TauriService;
    const storage = window.StorageService;

    if (storage) {
      await storage.init();
    }

    if (!tauri || !tauri.isAvailable) return;

    setupOverlayVisibilityToggles(tauri);
    setupClickThroughToggles(tauri, storage);
    setupRulerOptions(tauri, storage);
    setupMovementButtons(tauri);
    setupVisibilitySync(tauri);
    setupOverlaysVisibilityListener(tauri);
  });
})();