// ================================================================
// ruler_overlay.js - Règle de visée pour Tarkov
// ================================================================
// Description : Affiche une règle de visée avec indicateurs de PB,
// de distance et de pourcentage. Gère le surplus de PB au-delà du
// seuil de 40 PB. Fenêtre indépendante avec persistance de position.
// ================================================================

(function () {
  "use strict";

  // ================================================================
  // 1. CONSTANTES
  // ================================================================

  // Configuration de la règle principale (repère rouge)
  const CONFIG = {
    // Seuil au-delà duquel le surplus est délégué au second repère
    SURPLUS_THRESHOLD: 40,
    // Position de blocage du repère principal quand le surplus est actif
    MAIN_CLAMP: 38,
    // Facteur d'échelle par défaut (px par PB)
    DEFAULT_PX_PER_PB: 36,
    // Clé de stockage pour la position de la fenêtre
    STORAGE_KEY: "ruler_overlay_position",
  };

  // Plage de la règle principale (toujours fixe)
  const MIN_PB = -CONFIG.SURPLUS_THRESHOLD;
  const MAX_PB = CONFIG.SURPLUS_THRESHOLD;

  // ================================================================
  // 2. ÉTAT DE L'APPLICATION
  // ================================================================

  // État global
  const state = {
    // Calibration
    pxPerPb: CONFIG.DEFAULT_PX_PER_PB, // Pixels par PB (résolution × zoom)
    currentZoom: "80", // "80" = Smart PB, "100" = PB Max
    currentWidth: 1920, // Résolution largeur
    currentHeight: 1080, // Résolution hauteur
    rulerCenterPx: 960, // Centre de la règle en pixels

    // Données reçues
    lastData: {},
    lastSurplus: 0,
    surplusMaxPb: 10, // Portée dynamique du surplus (paliers de 10)

    // Services
    tauriService: null,
    storage: null,
    savePosition: null,
  };

  // Références DOM
  let elements = {};

  // ================================================================
  // 3. SERVICES ET UTILITAIRES
  // ================================================================

  /**
   * Récupère la valeur pxPerPb depuis la calibration
   */
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

  /**
   * Décompose une valeur PB en partie principale + surplus
   */
  function splitPbValue(actualPb) {
    const absPb = Math.abs(actualPb);
    const sign = actualPb >= 0 ? 1 : -1;

    let surplus = 0;
    let valueForRuler = actualPb;

    if (absPb > CONFIG.SURPLUS_THRESHOLD) {
      // Le repère principal recule à MAIN_CLAMP, le surplus commence à 2+
      surplus = (absPb - CONFIG.MAIN_CLAMP) * sign;
      valueForRuler = CONFIG.MAIN_CLAMP * sign;
    }

    return { surplus, valueForRuler };
  }

  // ================================================================
  // 4. GESTION DU DOM
  // ================================================================

  /**
   * Récupère tous les éléments DOM nécessaires
   */
  function getElements() {
    return {
      container: document.getElementById("ruler-container"),
      redIndicator: document.getElementById("red-indicator"),
      smartIndicator: document.getElementById("smart-indicator"),
      ticksContainer: document.getElementById("ticks-container"),
      distanceDisplay: document.getElementById("distance-display"),
      surplusIndicator: document.getElementById("surplus-indicator"),
      surplusTrait: document.getElementById("surplus-trait"),
      surplusTicksContainer: document.getElementById("surplus-ticks-container"),
      percentDisplay: document.getElementById("percent-display"),
      pbRealDisplay: document.getElementById("pbReal-display"),
    };
  }

  /**
   * Dessine la règle principale (graduations de -40 à +40)
   */
  function drawRuler() {
    const container = elements.ticksContainer;
    if (!container) return;

    const fragment = document.createDocumentFragment();

    for (let i = MIN_PB; i <= MAX_PB; i++) {
      const leftPosition = state.rulerCenterPx + i * state.pxPerPb;

      // Trait de graduation
      const tick = document.createElement("div");
      tick.className = `tick-major ${i === 0 ? "zero" : ""}`;
      tick.style.left = `${leftPosition}px`;
      fragment.appendChild(tick);

      // Label de graduation
      const label = document.createElement("div");
      label.className = `tick-label ${i === 0 ? "zero" : ""}`;
      label.style.left = `${leftPosition}px`;
      label.innerText = Math.abs(i);
      fragment.appendChild(label);
    }

    container.innerHTML = "";
    container.appendChild(fragment);
  }

  /**
   * Met à jour la position des indicateurs de la règle
   */
  function updateRulerPosition(rulerPos, distVal, fullPbVal) {
    const { redIndicator, smartIndicator, distanceDisplay } =
      elements;

    const pos = rulerPos || 0;
    const leftPosition = state.rulerCenterPx + pos * state.pxPerPb;

    if (redIndicator) redIndicator.style.left = `${leftPosition}px`;
    if (smartIndicator) smartIndicator.style.left = `${leftPosition}px`;
    if (distanceDisplay)
      distanceDisplay.innerText = `${distVal.toFixed(2)} yds`;
  }

  /**
   * Dessine les graduations du surplus
   */
  function drawSurplusTicks(surplus) {
    const container = elements.surplusTicksContainer;
    if (!container) return;

    container.innerHTML = "";
    if (surplus === 0) {
      container.style.display = "none";
      return;
    }

    const sign = surplus > 0 ? 1 : -1;
    const fragment = document.createDocumentFragment();

    for (let i = 1; i <= state.surplusMaxPb; i++) {
      const leftPosition = state.rulerCenterPx - sign * i * state.pxPerPb;

      const tick = document.createElement("div");
      tick.className = "tick-major";
      tick.style.left = `${leftPosition}px`;
      fragment.appendChild(tick);

      const label = document.createElement("div");
      label.className = "tick-label";
      label.style.left = `${leftPosition}px`;
      label.innerText = i;
      fragment.appendChild(label);
    }

    container.appendChild(fragment);
    container.style.display = "block";
  }

  /**
   * Met à jour l'indicateur de surplus
   */
  function updateSurplus(surplus) {
    state.lastSurplus = surplus;
    const { surplusIndicator, surplusTrait } = elements;
    if (!surplusIndicator) return;

    // Calcul de la portée du surplus (paliers de 10)
    state.surplusMaxPb = Math.max(10, Math.ceil(Math.abs(surplus) / 10) * 10);
    drawSurplusTicks(surplus);

    if (surplus !== 0) {
      const value = Math.abs(surplus);
      const leftPosition = state.rulerCenterPx - surplus * state.pxPerPb;

      // Texte et position de l'indicateur
      surplusIndicator.innerText = `+${value.toFixed(2)}`;
      surplusIndicator.style.left = `${leftPosition}px`;
      surplusIndicator.classList.toggle("negative", surplus < 0);
      surplusIndicator.style.display = "flex";

      // Trait vertical du surplus
      if (surplusTrait) {
        surplusTrait.style.left = `${leftPosition}px`;
        surplusTrait.classList.toggle("negative", surplus < 0);
        surplusTrait.style.display = "block";
      }
    } else {
      surplusIndicator.style.display = "none";
      if (surplusTrait) surplusTrait.style.display = "none";
    }
  }

  /**
   * Met à jour l'interface complète
   */
  function updateUI(data) {
    state.lastData = data || {};
    const actualPb = data.pb !== undefined ? data.pb : 0;
    const actualDist = data.distance !== undefined ? data.distance : 0;
    const actualPercent = data.percent !== undefined ? data.percent : 0;

    const { surplus, valueForRuler } = splitPbValue(actualPb);

    updateSurplus(surplus);
    updateRulerPosition(valueForRuler, actualDist, actualPb);

    // Pourcentage
    if (elements.percentDisplay) {
      elements.percentDisplay.innerText = `${actualPercent.toFixed(1)}%`;
      elements.percentDisplay.classList.toggle(
        "percent-low",
        actualPercent < 80,
      );
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

  /**
   * Rafraîchit l'échelle de la règle
   */
  function refreshScale() {
    state.pxPerPb = getPxPerPb();
    drawRuler();
    updateUI(state.lastData || {});
  }

  // ================================================================
  // 5. GESTION DE LA FENÊTRE
  // ================================================================

  /**
   * Applique la taille et la position de la fenêtre
   */
  async function applyWindowSize() {
    state.rulerCenterPx = state.currentWidth / 2;

    // Variables CSS
    document.documentElement.style.setProperty(
      "--ruler-width",
      state.currentWidth + "px",
    );

    const calib =
      window.ResolutionCalibrationService?.getCalibration(
        state.currentWidth,
        state.currentHeight,
      ) || {};

    document.documentElement.style.setProperty(
      "--ruler-container-top",
      (calib.rulerContainerTop ?? 0) + "px",
    );
    document.documentElement.style.setProperty(
      "--ruler-indicators-top",
      (calib.rulerIndicatorTop ?? 20) + "px",
    );
    document.documentElement.style.setProperty(
      "--ruler-trepere-top",
      (calib.rulerTRepereTop ?? 43) + "px",
    );

    // Hauteur proportionnelle
    const scaleH = (state.currentHeight || 1080) / 1080;
    const rulerHeight = Math.round(600 * scaleH);
    document.documentElement.style.setProperty(
      "--ruler-height",
      rulerHeight + "px",
    );

    // Redimensionnement de la fenêtre Tauri
    try {
      const winApi = window.__TAURI__?.window;
      if (winApi?.getCurrentWindow) {
        const current = await winApi.getCurrentWindow();
        await current.setSize(
          new winApi.PhysicalSize(state.currentWidth, rulerHeight),
        );
      }
    } catch (err) {
      console.error("❌ Erreur redimensionnement fenêtre règle:", err);
    }

    refreshScale();
  }

  /**
   * Configure le drag de la fenêtre
   */
  function setupDrag() {
    document.addEventListener("mousedown", async (e) => {
      if (e.button === 0 && state.tauriService?.isAvailable) {
        const win = await state.tauriService.getCurrentWindow();
        if (win) win.startDragging();
      }
    });
  }

  /**
   * Configure la persistance de la position de la fenêtre
   */
  async function setupPositionPersistence() {
    if (!window.WindowPositionHelper) {
      console.warn("⚠️ WindowPositionHelper non chargé");
      return;
    }
    if (!state.storage) {
      console.warn("⚠️ Storage non disponible");
      return;
    }

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
    } else {
      console.warn("⚠️ win.onMoved indisponible");
    }

    // Sauvegarde au relâchement du clic (fallback)
    document.addEventListener("mouseup", () => state.savePosition?.());
  }

  // ================================================================
  // 6. COMMUNICATION TAURI
  // ================================================================

  /**
   * Configure les écouteurs d'événements Tauri
   */
  function setupTauriListeners() {
    if (!state.tauriService?.isAvailable) return;

    // Mise à jour des données de la règle
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
        applyWindowSize();
      }
    });

    // Visibilité de la règle
    state.tauriService.listen("ruler-visibility", async (event) => {
      const shouldShow =
        typeof event.payload === "object" ? event.payload.show : event.payload;
      const win = await state.tauriService.getCurrentWindow();
      if (win) {
        shouldShow ? await win.show() : await win.hide();
      }
    });

    // Verrouillage de la règle
    state.tauriService.listen("ruler-lock", (event) => {
      const shouldLock =
        typeof event.payload === "object" ? event.payload.lock : event.payload;
      state.tauriService
        .invoke(shouldLock ? "enable_click_through" : "disable_click_through")
        .catch(console.error);
    });

    // Déplacement relatif de la fenêtre
    state.tauriService.listen("ruler-move", async (event) => {
      const win = await state.tauriService.getCurrentWindow();
      if (!win) return;

      const currentPos = await win.outerPosition();
      await win.setPosition(
        new window.__TAURI__.window.PhysicalPosition(
          currentPos.x + (event.payload.x || 0),
          currentPos.y + (event.payload.y || 0),
        ),
      );
    });
  }

  // ================================================================
  // 7. INITIALISATION
  // ================================================================

  document.addEventListener("DOMContentLoaded", async () => {
    console.log("🔍 Initialisation de ruler_overlay.js");

    // --- Services ---
    state.tauriService = window.TauriService || null;
    if (!state.tauriService) {
      console.warn("⚠️ TauriService non chargé");
    }

    state.storage = window.StorageService || null;
    if (state.storage) {
      await state.storage.init();
    } else {
      console.warn("⚠️ StorageService non chargé");
    }

    // --- Récupération des éléments DOM ---
    elements = getElements();

    // --- Récupération du zoom ---
    if (state.storage) {
      state.currentZoom = state.storage.get("ruler_zoom", false) ? "100" : "80";
    }

    // --- Récupération de la résolution ---
    try {
      const res = await state.tauriService.invoke("get_game_resolution");
      if (res?.width) {
        state.currentWidth = res.width;
        state.currentHeight = res.height || state.currentHeight;
      }
    } catch (err) {
      console.warn("⚠️ Résolution non détectée, valeurs par défaut.", err);
    }

    // --- Application de la taille ---
    await applyWindowSize();

    // --- Configuration des interactions ---
    setupDrag();
    setupTauriListeners();
    await setupPositionPersistence();

    console.log("✅ Ruler overlay initialisé avec succès");
  });
})();
