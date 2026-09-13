// ================================================================
// infos_shot.js - Fenêtre d'informations de tir (PB, distance, %)
// ================================================================
// Description : Affiche les informations de tir : PB réel calibré,
// pourcentage de puissance et distance. Fenêtre indépendante avec
// persistance de position et drag.
// ================================================================

(function () {
  "use strict";

  // ================================================================
  // 1. CONSTANTES
  // ================================================================

  const CONFIG = {
    DEFAULT_PX_PER_PB: 81,
    STORAGE_KEY: "infos_shot_position",
  };

  // ================================================================
  // 2. ÉTAT DE L'APPLICATION
  // ================================================================

  const state = {
    pxPerPb: CONFIG.DEFAULT_PX_PER_PB,
    currentZoom: "80", // "80" = Smart PB, "100" = PB Max
    currentWidth: 1920,
    currentHeight: 1080,
    lastData: {},
    tauriService: null,
    storage: null,
    savePosition: null,
  };

  let elements = {};

  // ================================================================
  // 3. SERVICES ET UTILITAIRES
  // ================================================================

  function getPxPerPb() {
    const calib = window.ResolutionCalibrationService?.getCalibration(
      state.currentWidth,
      state.currentHeight,
    );
    const ppb = calib?.pxPerPb || {};
    return ppb[state.currentZoom] != null
      ? ppb[state.currentZoom]
      : ppb["100"] != null
        ? ppb["100"]
        : CONFIG.DEFAULT_PX_PER_PB;
  }

  // ================================================================
  // 4. GESTION DU DOM
  // ================================================================

  function getElements() {
    return {
      pbRealDisplay: document.getElementById("pbReal-display"),
      percentDisplay: document.getElementById("percent-display"),
      distanceDisplay: document.getElementById("distance-display"),
    };
  }

  function updateUI(data) {
    state.lastData = data || {};
    const actualPb = data.pb !== undefined ? data.pb : 0;
    const actualDist = data.distance !== undefined ? data.distance : 0;
    const actualPercent = data.percent !== undefined ? data.percent : 0;

    // Pourcentage
    if (elements.percentDisplay) {
      elements.percentDisplay.innerText = `${actualPercent.toFixed(1)}%`;
      elements.percentDisplay.classList.toggle(
        "percent-low",
        actualPercent < 80,
      );
    }

    // Distance
    if (elements.distanceDisplay) {
      elements.distanceDisplay.innerText = `${actualDist.toFixed(2)} yds`;
    }

    // PB réel (calibré)
    if (elements.pbRealDisplay) {
      const calib = window.ResolutionCalibrationService?.getCalibration(
        state.currentWidth,
        state.currentHeight,
      );
      const realPxPerPb = calib?.realPxPerPb || 81;
      const pixelOffset = actualPb * state.pxPerPb;
      const pbReal = pixelOffset / realPxPerPb;
      elements.pbRealDisplay.innerText = `${pbReal.toFixed(2)} PB`;
    }
  }

  function refreshScale() {
    state.pxPerPb = getPxPerPb();
    updateUI(state.lastData || {});
  }

  // ================================================================
  // 5. GESTION DE LA FENÊTRE
  // ================================================================

  function setupDrag() {
    document.addEventListener("mousedown", async (e) => {
      if (e.button === 0 && state.tauriService?.isAvailable) {
        const win = await state.tauriService.getCurrentWindow();
        if (win) win.startDragging();
      }
    });
  }

  async function setupPositionPersistence() {
    if (!window.WindowPositionHelper || !state.storage) return;

    state.savePosition =
      window.WindowPositionHelper.createDebouncedPositionSaver(
        state.storage,
        CONFIG.STORAGE_KEY,
      );
    await window.WindowPositionHelper.restoreWindowPosition(
      state.storage,
      CONFIG.STORAGE_KEY,
    );

    const win = await state.tauriService.getCurrentWindow();
    if (win?.onMoved) {
      await win.onMoved(() => state.savePosition());
    }

    document.addEventListener("mouseup", () => state.savePosition?.());
  }

  // ================================================================
  // 6. COMMUNICATION TAURI
  // ================================================================

  function setupTauriListeners() {
    if (!state.tauriService?.isAvailable) return;

    // Mise à jour des données de tir (émis par smart_calculator.js)
    state.tauriService.listen("update-ruler", (event) => {
      updateUI(event.payload);
    });

    // Changement de zoom (Smart PB / PB Max)
    state.tauriService.listen("update-ruler-zoom", (event) => {
      state.currentZoom = event.payload?.zoom === "100" ? "100" : "80";
      refreshScale();
    });

    // Changement de résolution
    state.tauriService.listen("update-game-resolution", (event) => {
      const width = Number(event.payload?.width) || 0;
      const height = Number(event.payload?.height) || 0;
      if (width > 0 && height > 0) {
        state.currentWidth = width;
        state.currentHeight = height;
        refreshScale();
      }
    });
  }

  // ================================================================
  // 7. INITIALISATION
  // ================================================================

  document.addEventListener("DOMContentLoaded", async () => {
    console.log("🔍 Initialisation de infos_shot.js");

    state.tauriService = window.TauriService || null;
    state.storage = window.StorageService || null;
    if (state.storage) await state.storage.init();

    elements = getElements();

    if (state.storage) {
      state.currentZoom = state.storage.get("ruler_zoom", false)
        ? "100"
        : "80";
    }

    try {
      const res = await state.tauriService.invoke("get_game_resolution");
      if (res?.width) {
        state.currentWidth = res.width;
        state.currentHeight = res.height || state.currentHeight;
      }
    } catch (err) {
      console.warn("⚠️ Résolution non détectée, valeurs par défaut.", err);
    }

    refreshScale();

    setupDrag();
    setupTauriListeners();
    await setupPositionPersistence();

    console.log("✅ Infos shot overlay initialisé avec succès");
  });
})();