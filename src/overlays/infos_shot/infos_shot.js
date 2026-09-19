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
    STORAGE_KEY: "infos_shot_position",
  };

  // ================================================================
  // 2. ÉTAT DE L'APPLICATION
  // ================================================================

  const state = {
    lastData: {},
    tauriService: null,
    storage: null,
    savePosition: null,
    unsubscribeData: null,
    unsubscribeConfig: null,
  };

  let elements = {};

  // ================================================================
  // 3. GESTION DU DOM
  // ================================================================

  function getElements() {
    return {
      pbRealDisplay: document.getElementById("pbReal-display"),
      percentDisplay: document.getElementById("percent-display"),
      distanceDisplay: document.getElementById("distance-display"),
    };
  }

  function updateUI() {
    // Utiliser le service pour obtenir les données et faire les calculs
    const data = window.ShotInfoService.getCurrentData();
    const actualPb = data.pb !== undefined ? data.pb : 0;
    const actualDist = data.distance !== undefined ? data.distance : 0;
    const actualPercent = data.percent !== undefined ? data.percent : 0;
    state.lastData = data;

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

    // PB réel (calibré) - calculé via le service
    if (elements.pbRealDisplay) {
      const pbReal = window.ShotInfoService.computeRealPb(actualPb);
      elements.pbRealDisplay.innerText = `${pbReal.toFixed(2)} PB`;
    }
  }

  // ================================================================
  // 4. GESTION DE LA FENÊTRE
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
  // 5. COMMUNICATION TAURI VIA SERVICE
  // ================================================================

  function setupShotInfoService() {
    // Initialiser le service avec les dépendances
    window.ShotInfoService.init({
      tauriService: window.TauriService,
      storage: window.StorageService,
    });

    // S'abonner aux changements de données
    state.unsubscribeData = window.ShotInfoService.onData(updateUI);

    // S'abonner aux changements de configuration (zoom/résolution)
    state.unsubscribeConfig = window.ShotInfoService.onConfigChange(updateUI);

    // Mettre à jour l'UI immédiatement avec l'état actuel du service
    updateUI();
  }

  // ================================================================
  // 6. INITIALISATION
  // ================================================================

  document.addEventListener("DOMContentLoaded", async () => {
    console.log("🔍 Initialisation de infos_shot.js");

    state.tauriService = window.TauriService || null;
    state.storage = window.StorageService || null;
    if (state.storage) await state.storage.init();

    elements = getElements();

    // Configurer le service ShotInfo (remplace les listeners Tauri directs)
    setupShotInfoService();

    // Gestion de la fenêtre (drag, position)
    setupDrag();
    await setupPositionPersistence();

    console.log("✅ Infos shot overlay initialisé avec succès");
  });
})();