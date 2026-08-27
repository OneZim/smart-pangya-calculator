// calc_overlay.js - Version avec store local

(function () {
  "use strict";

  let elements = {};
  let isSyncing = false;
  let courseStore = null;
  let courseSelector = null;
  let playerStore = null;
  let storage = null; // StorageService (Tauri Store), initialisé dans DOMContentLoaded

  // ================================================================
  // RÉCUPÉRATION DES ÉLÉMENTS
  // ================================================================

  function getElements() {
    return {
      club: document.getElementById("club"),
      shot: document.getElementById("shot"),
      power_shot: document.getElementById("power_shot"),
      distance: document.getElementById("distance"),
      height: document.getElementById("height"),
      wind: document.getElementById("wind"),
      degree: document.getElementById("degree"),
      spin: document.getElementById("spin"),
      curve: document.getElementById("curve"),
      ground: document.getElementById("ground"),
      slope_break: document.getElementById("slope_break"),
      resetParams: document.getElementById("reset-params"),
      resetHall: document.getElementById("reset-hall"),
      btnAngleMinus: document.getElementById("btn-angle-minus"),
      btnAnglePlus: document.getElementById("btn-angle-plus"),
      shortError: document.getElementById("short-error"),
    };
  }

  // ================================================================
  // UTILITAIRES
  // ================================================================

  function emitSync(id, value) {
    if (window.TauriService?.isAvailable) {
      window.TauriService.emit("sync-input-value", { id, value });
    }
  }

  function emitDropdownSync(id, value) {
    if (window.TauriService?.isAvailable) {
      window.TauriService.emit("sync-dropdown-parcours", {
        id,
        value,
        sender: "input_bar",
      });
    }
  }

  function triggerCalc() {
    if (typeof window.triggerCalc === "function") {
      window.triggerCalc();
    } else if (typeof window.calc === "function") {
      clearTimeout(window._calcTimeout);
      window._calcTimeout = setTimeout(() => {
        window.calc();
      }, 150);
    }
  }

  // ================================================================
  // SHOT AUTO
  // ================================================================

  function updateShotDependencies() {
    if (playerStore) {
      playerStore.refresh();
    }

    const shot = parseInt(elements.shot?.value || 0);

    if (elements.power_shot) {
      const value = playerStore
        ? playerStore.getPowerShotForShot(shot)
        : shot === 0
          ? "0"
          : "1";
      elements.power_shot.value = value;
      emitSync("power_shot", value);
    }

    if (elements.spin) {
      const value = playerStore ? playerStore.getSpinForShot(shot) : 9;
      elements.spin.value = value;
      emitSync("spin", String(value));
      if (window.TauriService?.isAvailable) {
        const curveVal = elements.curve?.value || 0;
        window.TauriService.emit("update-spin", {
          spin: String(value),
          curve: curveVal,
          boost: shot === 1 || shot === 2,
        });
      }
    }
    triggerCalc();
  }

  function updateOptimizeDunkBtnState() {
    const optimizeBtn = document.getElementById("btn-optimize-dunk");
    const clickBtn = document.getElementById("btn-click-spin");
    if (!elements.shot) return;
    const shotValue = parseInt(elements.shot.value);
    const enabled = [0, 1, 2].includes(shotValue); // Dunk, Tomahawk, Spike

    if (optimizeBtn) optimizeBtn.disabled = !enabled;
    if (clickBtn) clickBtn.disabled = !enabled;
  }
  // ================================================================
  // ANGLE
  // ================================================================

  function updateDegree(delta) {
    let angle = parseInt(elements.degree?.value) || 0;
    angle = (angle + delta + 360) % 360;
    if (elements.degree) {
      elements.degree.value = angle;
      emitSync("degree", String(angle));
      if (typeof window.updateWindCanvas === "function") {
        window.updateWindCanvas(angle);
      }
      triggerCalc();
    }
  }

  function showOptimizeTooltip(btn, message) {
    if (!btn) return;

    const existing = document.querySelector(".optimize-tooltip");
    if (existing) existing.remove();

    const tooltip = document.createElement("div");
    tooltip.className = "optimize-tooltip";
    tooltip.textContent = message;
    document.body.appendChild(tooltip);

    const btnRect = btn.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const left = btnRect.left + btnRect.width / 2 - tooltipRect.width / 2;
    const top = btnRect.top - tooltipRect.height - 8;

    tooltip.style.left = Math.max(4, left) + "px";
    tooltip.style.top = Math.max(4, top) + "px";

    clearTimeout(btn._tooltipTimeout);
    btn._tooltipTimeout = setTimeout(() => {
      tooltip.remove();
    }, 3000);
  }
  // ================================================================
  // ÉVÉNEMENTS
  // ================================================================

  function setupEvents() {
    // === CHAMPS ===
    const fields = [
      "club",
      "shot",
      "power_shot",
      "distance",
      "wind",
      "degree",
      "spin",
      "height",
      "curve",
      "ground",
      "slope_break",
    ];

    fields.forEach((id) => {
      const el = elements[id];
      if (!el) return;

      ["input", "change"].forEach((type) => {
        el.addEventListener(type, (e) => {
          if (isSyncing) return;
          emitSync(id, e.target.value);
          if (
            (id === "spin" || id === "curve") &&
            window.TauriService?.isAvailable
          ) {
            const spinVal = elements.spin?.value || 0;
            const curveVal = elements.curve?.value || 0;
            const shotVal = parseInt(elements.shot?.value || 0);
            const boost = shotVal === 1 || shotVal === 2; // Tomahawk, Spike
            window.TauriService.emit("update-spin", {
              spin: spinVal,
              curve: curveVal,
              boost: boost,
            });
          }
          triggerCalc();
        });
      });
    });

    // === SHOT AUTO ===
    // === SHOT AUTO ===
    elements.shot?.addEventListener("change", () => {
      updateShotDependencies();
      updateOptimizeDunkBtnState();
    });

    // === ANGLE ===
    elements.btnAngleMinus?.addEventListener("click", () => updateDegree(-1));
    elements.btnAnglePlus?.addEventListener("click", () => updateDegree(+1));

    // === RESET ===
    // input_bar.js - setupEvents()

    elements.resetParams?.addEventListener("click", () => {
      ["curve", "slope_break"].forEach((id) => {
        const el = elements[id];
        if (el) {
          el.value = "0";
          emitSync(id, "0");
        }
      });

      // Ground → 100
      if (elements.ground) {
        elements.ground.value = "100";
        emitSync("ground", "100");
      }

      triggerCalc();
    });

    elements.resetHall?.addEventListener("click", () => {
      [
        "distance",
        "height",
        "wind",
        "degree",
        "spin",
        "curve",
        "slope_break",
      ].forEach((id) => {
        const el = elements[id];
        if (el) {
          el.value = "0";
          emitSync(id, "0");
        }
      });

      // Ground → 100
      if (elements.ground) {
        elements.ground.value = "100";
        emitSync("ground", "100");
      }

      triggerCalc();
    });

    // === TOGGLE WIND CLICK-THROUGH ===
    // Même clé ("wind_click_through") que dans app.js, pour que les deux
    // fenêtres lisent/écrivent la même valeur persistée. Fallback sur
    // localStorage si StorageService n'est pas dispo dans cette fenêtre.
    const toggleWind = document.getElementById("toggle-wind-click-through");
    if (toggleWind) {
      const savedState = storage
        ? storage.get("wind_click_through", false)
        : localStorage.getItem("pangya_wind_click_through") === "true";
      toggleWind.checked = savedState;

      if (window.TauriService?.isAvailable) {
        window.TauriService.setOverlayClickThrough("wind_overlay", savedState);
      }

      toggleWind.addEventListener("change", function () {
        const locked = this.checked;
        if (window.TauriService?.isAvailable) {
          window.TauriService.setOverlayClickThrough("wind_overlay", locked);
          if (storage) {
            storage.set("wind_click_through", locked);
          } else {
            localStorage.setItem("pangya_wind_click_through", String(locked));
          }
          window.TauriService.emit("sync-wind-click-through", { locked });
        }
      });
    }
  }
  // ================================================================
  // BOUTON POUR DÉCLENCHER LE SPIN IDÉAL SUR LA PAGE PRINCIPALE
  // ================================================================

  function setupDunkButton() {
    const btn = document.getElementById("btn-optimize-dunk");
    updateOptimizeDunkBtnState(); // état initial

    if (btn) {
      btn.addEventListener("click", function () {
        if (window.TauriService?.isAvailable) {
          window.TauriService.emit("click-optimize-dunk", {});
        }
      });
    }

    const clickBtn = document.getElementById("btn-click-spin");
    if (clickBtn) {
      clickBtn.addEventListener("click", function () {
        if (window.TauriService?.isAvailable) {
          window.TauriService.emit("click-spin-only", {});
        }
      });
    }
  }

  // Initialiser
  document.addEventListener("DOMContentLoaded", setupDunkButton);
  // ================================================================
  // LISTENERS TAURI
  // ================================================================

  function setupTauriListeners() {
    if (!window.TauriService?.isAvailable) return;

    // Synchro dropdown
    window.TauriService.listen("sync-dropdown-parcours", (event) => {
      const { id, value, sender } = event.payload;
      if (sender === "input_bar") return;

      const mapId = {
        "select-parcours": "map",
        "select-trou": "hole",
        "select-pin": "pin",
      };
      const type = mapId[id];
      if (type === "map") courseStore.selectMap(value);
      else if (type === "hole") courseStore.selectHole(value);
      else if (type === "pin") courseStore.selectPin(value);
    });

    // Synchro champs
    window.TauriService.listen("sync-input-value", (event) => {
      const { id, value } = event.payload;
      const el = elements[id];
      if (el && el.value !== String(value)) {
        isSyncing = true;
        el.value = value;
        triggerCalc();
        isSyncing = false;

        if (id === "shot") {
          updateOptimizeDunkBtnState();
        }
      }
    });

    // Synchro angle
    window.TauriService.listen("sync-wind-angle", (event) => {
      const { angle } = event.payload;
      if (elements.degree) {
        elements.degree.value = angle;
        emitSync("degree", String(angle));
        triggerCalc();
      }
    });

    // input_bar.js - À la fin de setupTauriListeners()
    // NOTE : la synchro de langue entre fenêtres est désormais gérée
    // directement par i18n.js (listener "app-lang-changed" centralisé).
    // Voir updateShortErrorText() plus bas dans ce fichier pour la mise
    // à jour du message d'erreur suite à un changement de langue.

    // Synchro des spins par défaut (changés depuis la fenêtre principale)
    window.TauriService.listen("sync-spin-default", (event) => {
      const { id, value } = event.payload;
      if (storage) {
        storage.set(id, value); // garde le cache de cette fenêtre à jour
      }
      playerStore?.refresh();
    });

    // === UPDATE RULER ===
    window.TauriService.listen("update-ruler", (event) => {
      const { pb } = event.payload;
      const shortErrorLabel = document.getElementById("short-error");
      if (!shortErrorLabel) return;

      if (pb === null) {
        const text = window.t("error_shot_shot_short");
        shortErrorLabel.textContent = text;
        shortErrorLabel.style.display = "block";
      } else {
        shortErrorLabel.style.display = "none";
      }
    });

    window.TauriService.listen("dunk-optimize-result", (event) => {
      if (event.payload.success) return; // rien à afficher si succès
      const btn = document.getElementById("btn-optimize-dunk");
      showOptimizeTooltip(btn, event.payload.message);
    });
  }

  // === TOGGLES AFFICHAGE OVERLAYS ===
  const toggleShowRuler = document.getElementById("toggle-show-ruler-co");
  if (toggleShowRuler) {
    toggleShowRuler.addEventListener("change", function () {
      window.TauriService?.invoke("set_ruler_visibility", {
        show: this.checked,
      });
    });
  }

  const toggleShowWind = document.getElementById("toggle-show-wind-co");
  if (toggleShowWind) {
    toggleShowWind.addEventListener("change", function () {
      window.TauriService?.invoke("set_wind_visibility", {
        show: this.checked,
      });
    });
  }

  const toggleShowSpin = document.getElementById("toggle-show-spin-co");
  if (toggleShowSpin) {
    toggleShowSpin.addEventListener("change", function () {
      window.TauriService?.invoke("set_spin_visibility", {
        show: this.checked,
      });
    });
  }

  window.TauriService?.listen("sync-ruler-visibility", (event) => {
    const cb = document.getElementById("toggle-show-ruler-co"); // ou l'id côté main
    if (cb) cb.checked = event.payload;
  });

  window.TauriService?.listen("sync-wind-visibility", (event) => {
    const cb = document.getElementById("toggle-show-wind-co");
    if (cb) cb.checked = event.payload;
  });

  window.TauriService?.listen("sync-spin-visibility", (event) => {
    const cb = document.getElementById("toggle-show-spin-co");
    if (cb) cb.checked = event.payload;
  });
  // ================================================================
  // SELECTION TEXTE
  // ================================================================

  function setupTextSelection() {
    document.querySelectorAll('input[type="text"]').forEach((input) => {
      input.addEventListener("mousedown", function (e) {
        e.stopPropagation();
        setTimeout(() => this.select(), 0);
      });
    });
  }

  // ================================================================
  // MISE À JOUR DU MESSAGE D'ERREUR
  // ================================================================

  function updateShortErrorText() {
    const shortErrorLabel = document.getElementById("short-error");
    if (!shortErrorLabel) return;

    const text = window.t("error_shot_shot_short");
    if (shortErrorLabel.textContent !== text) {
      shortErrorLabel.textContent = text;
    }
  }

  // Mise à jour au chargement
  setTimeout(updateShortErrorText, 300);

  // Mise à jour après changement de langue
  document.addEventListener("i18n-loaded", function () {
    updateShortErrorText();
  });

  // ================================================================
  // INITIALISATION
  // ================================================================

  document.addEventListener("DOMContentLoaded", async () => {
    elements = getElements();

    if (!window.TauriService) {
      console.error("❌ TauriService non disponible");
      return;
    }

    // === STORAGE ===
    // Fenêtre séparée : StorageService doit être chargé (balise <script>
    // dans le HTML de cette fenêtre) et initialisé ici indépendamment.
    storage = window.StorageService || null;
    if (storage) {
      await storage.init();
    } else {
      console.warn(
        "⚠️ StorageService non chargé dans cette fenêtre — fallback localStorage pour le toggle wind click-through.",
      );
    }

    courseStore = window.createCourseStoreCalcOverlay
      ? window.createCourseStoreCalcOverlay(
          window.TauriService,
          emitDropdownSync,
          storage,
        )
      : null;
    await courseStore?.initialize();

    playerStore = window.createPlayerStoreCalcOverlay
      ? window.createPlayerStoreCalcOverlay(storage)
      : null;
    playerStore?.initialize();

    const container = document.getElementById("course-selector-container");
    if (container) {
      courseSelector = window.CourseSelector(
        container,
        courseStore,
        window.TauriService,
        {
          onChange: (type, value) => {
            const idMap = {
              map: "select-parcours",
              hole: "select-trou",
              pin: "select-pin",
            };
            if (window.TauriService?.isAvailable) {
              window.TauriService.emit("sync-dropdown-parcours", {
                id: idMap[type],
                value: value,
                sender: "input_bar",
              });
            }
          },
        },
      );
    }

    setupEvents();
    setupTauriListeners();
    window.setupWindowDrag?.(window.TauriService);
    setupTextSelection();
    updateOptimizeDunkBtnState();
  });
})();
