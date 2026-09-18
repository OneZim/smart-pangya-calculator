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
    const optimizeBtn = document.getElementById("btn-optimize-spin");
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

    // === DEGREE (suit le canvas du sélecteur d'angle du panneau vent) ===
    elements.degree?.addEventListener("input", () => {
      if (typeof window.angleSelector?.setAngle === "function") {
        const v = parseFloat(elements.degree.value);
        if (!isNaN(v)) window.angleSelector.setAngle(v);
      }
    });

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
    const btn = document.getElementById("btn-optimize-spin");
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

  // ================================================================
  // TOGGLES "FORCER LE SPIN" (▼ positif / ▲ négatif)
  // State synchronisé avec la page principale (clé "spin_force").
  // ================================================================

  function setupSpinForceToggles() {
    const chkPos = document.getElementById("chk-spin-positive-co");
    const chkNeg = document.getElementById("chk-spin-negative-co");
    const { TauriService } = window;
    if (!chkPos && !chkNeg) return;

    function applyState(positive, negative) {
      if (chkPos) chkPos.checked = !!positive;
      if (chkNeg) chkNeg.checked = !!negative;
    }

    function saveAndSync(positive, negative) {
      const value = positive ? "positive" : negative ? "negative" : "";
      if (storage) storage.set("spin_force", value);
      TauriService?.emit("sync-spin-force", { positive, negative });
    }

    const saved = storage ? storage.get("spin_force", "") : "";
    applyState(saved === "positive", saved === "negative");

    if (chkPos) {
      chkPos.addEventListener("change", function () {
        if (this.checked && chkNeg) chkNeg.checked = false;
        saveAndSync(this.checked, false);
      });
    }
    if (chkNeg) {
      chkNeg.addEventListener("change", function () {
        if (this.checked && chkPos) chkPos.checked = false;
        saveAndSync(false, this.checked);
      });
    }

    TauriService?.listen("sync-spin-force", (event) => {
      const payload = event.payload || {};
      applyState(payload.positive, payload.negative);
    });
  }

  // Initialiser
  document.addEventListener("DOMContentLoaded", setupDunkButton);
  // ================================================================
  // LISTENERS TAURI
  // ================================================================

  async function initResizeGrip() {
    const grip = document.getElementById("resize-grip");
    if (!grip || !window.TauriService?.isAvailable) return;

    const appWindow = await window.TauriService.getCurrentWindow();
    if (!appWindow) return;

    // Référence fenêtre (ratio verrouillé 350/420) : échelle uniforme
    const REF_W = 350;
    const REF_H = 420;
    const DIR = "SouthEast";
    let drag = null;

    grip.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      Promise.all([appWindow.outerPosition(), appWindow.outerSize()]).then(
        ([pos, size]) => {
          const scale = window.devicePixelRatio || 1;
          drag = {
            dir: DIR,
            startX: e.screenX * scale,
            startY: e.screenY * scale,
            pos: { x: pos.x, y: pos.y },
            size: { w: size.width, h: size.height },
          };
        },
      );
      grip.setPointerCapture(e.pointerId);
    });

    document.addEventListener("pointermove", (e) => {
      if (!drag) return;
      const d = drag;
      const scale = window.devicePixelRatio || 1;
      const dx = e.screenX * scale - d.startX;
      const dy = e.screenY * scale - d.startY;
      const west = d.dir.includes("West");
      const east = d.dir.includes("East");
      const north = d.dir.includes("North");
      const south = d.dir.includes("South");

      // Échelle unique : ratio dominant issu du bord/coing saisi
      const ratios = [];
      if (west) ratios.push((d.size.w - dx) / (REF_W * scale));
      else if (east) ratios.push((d.size.w + dx) / (REF_W * scale));
      if (north) ratios.push((d.size.h - dy) / (REF_H * scale));
      else if (south) ratios.push((d.size.h + dy) / (REF_H * scale));
      let s = ratios.length ? Math.max(...ratios) : 1;
      s = Math.max(1, Math.min(2.5, s));

      const w = REF_W * scale * s;
      const h = REF_H * scale * s;
      const anchors = {
        left: d.pos.x,
        right: d.pos.x + d.size.w,
        top: d.pos.y,
        bottom: d.pos.y + d.size.h,
      };
      const x = west ? anchors.right - w : anchors.left;
      const y = north ? anchors.bottom - h : anchors.top;

      const P = window.TauriService.window.PhysicalPosition;
      const S = window.TauriService.window.PhysicalSize;
      if (west || north)
        appWindow
          .setPosition(new P(Math.round(x), Math.round(y)))
          .catch(() => {});
      appWindow.setSize(new S(Math.round(w), Math.round(h))).catch(() => {});
    });

    const onPointerUp = async () => {
      if (drag && storage) {
        try {
          const size = await appWindow.outerSize();
          storage.set("calc_overlay_size", { w: size.width, h: size.height });
        } catch (err) {
          console.error("❌ Sauvegarde taille fenêtre:", err);
        }
      }
      drag = null;
    };
    document.addEventListener("pointerup", onPointerUp);
    document.addEventListener("pointercancel", onPointerUp);
  }

  function initContentZoom() {
    const bar = document.querySelector(".horizontal-calculator-bar");
    if (!bar) return;
    const apply = () => {
      const z = Math.min(window.innerWidth / 350, window.innerHeight / 420);
      bar.style.zoom = String(Math.max(1, Math.min(2.5, z)));
    };
    apply();
    window.addEventListener("resize", apply);
  }

  async function restoreCalcWindowSize() {
    if (!storage || !window.TauriService?.isAvailable) return;
    const saved = storage.get("calc_overlay_size", null);
    if (
      !saved ||
      typeof saved.w !== "number" ||
      typeof saved.h !== "number"
    ) {
      return;
    }
    try {
      const appWindow = await window.TauriService.getCurrentWindow();
      if (!appWindow) return;
      const scale = window.devicePixelRatio || 1;
      const S = window.TauriService.window.PhysicalSize;
      const w = Math.max(Math.round(350 * scale), Math.round(saved.w));
      const h = Math.max(Math.round(420 * scale), Math.round(saved.h));
      await appWindow.setSize(new S(w, h));
    } catch (err) {
      console.error("❌ Restauration taille fenêtre:", err);
    }
  }

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

        if (
          id === "degree" &&
          typeof window.angleSelector?.setAngle === "function"
        ) {
          const v = parseFloat(value);
          if (!isNaN(v)) window.angleSelector.setAngle(v);
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
      const btn = document.getElementById("btn-optimize-spin");
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

  const toggleShowInfosShot = document.getElementById(
    "toggle-show-infos-shot-co"
  );
  if (toggleShowInfosShot) {
    toggleShowInfosShot.addEventListener("change", function () {
      window.TauriService?.invoke("set_infos_shot_visibility", {
        show: this.checked,
      });
    });
  }

  window.TauriService?.listen("sync-ruler-visibility", (event) => {
    const cb = document.getElementById("toggle-show-ruler-co"); // ou l'id côté main
    if (cb) cb.checked = event.payload;
  });

  window.TauriService?.listen("sync-infos-shot-visibility", (event) => {
    const cb = document.getElementById("toggle-show-infos-shot-co");
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
    setupSpinForceToggles();
    setupTauriListeners();
    initResizeGrip();
    await restoreCalcWindowSize();
    initContentZoom();
    window.setupWindowDrag?.(window.TauriService, {
      selectors: [".wind-panel", ".resize-grip"],
    });
    setupTextSelection();
    updateOptimizeDunkBtnState();

    // === PANNEAU VENT (SLIDE-IN) ===
    const toggleWindPanel = document.getElementById("btn-toggle-wind-panel");
    const windPanel = document.getElementById("wind-panel");
    if (toggleWindPanel && windPanel) {
      toggleWindPanel.addEventListener("click", () => {
        windPanel.classList.toggle("open");
      });
    }

    // === SÉLECTEUR D'ANGLE (canvas du panneau vent) ===
    window.angleSelector = window.WindAngleSelector?.({
      storage,
      canvasId: "angle-canvas",
      displayId: "angle-display",
      degreeId: "degree",
      syncEnabled: true,
      storageKey: "wind_angle",
    });

    // === IMAGE VENT (chargement + calibration + recadrage) ===
    // Même dossier (StorageService partagé) et mêmes événements
    // `nouvelle-capture-detectee` que la page principale.
    window.ScreenshotManager?.(window.TauriService, storage);
  });
})();
