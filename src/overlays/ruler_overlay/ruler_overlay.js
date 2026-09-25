// ================================================================
// ruler_overlay.js - Règle de visée pour Tarkov
// ================================================================
// Description : Affiche une règle de visée avec indicateurs de PB.
// Gère le surplus de PB au-delà du seuil de 47 PB. Fenêtre indépendante
// avec persistance de position.
// ================================================================

(function () {
  "use strict";

  // ================================================================
  // 1. CONSTANTES
  // ================================================================

  // Configuration de la règle principale (repère rouge)
  const CONFIG = {
    // Seuil au-delà duquel le surplus est délégué au second repère
    SURPLUS_THRESHOLD: 47,
    // Position de blocage du repère principal quand le surplus est actif
    MAIN_CLAMP: 45,
    // Facteur d'échelle par défaut (px par PB)
    DEFAULT_PX_PER_PB: 81,
    // Hauteur fixe de la fenêtre de la règle
    WINDOW_HEIGHT: 150,
    // Clé de stockage pour la position de la fenêtre
    STORAGE_KEY: "ruler_overlay_position",
  };

  // ================================================================
  // 2. ÉTAT DE L'APPLICATION
  // ================================================================

  // État global
  const state = {
    // Calibration
    pxPerPb: CONFIG.DEFAULT_PX_PER_PB, // Pixels par PB (résolution × zoom 80%)
    currentWidth: 1920, // Résolution largeur
    currentHeight: 1080, // Résolution hauteur
    rulerCenterPx: 960, // Centre de la règle en pixels

    // Données reçues
    lastData: {},
    lastSurplus: 0,

    // Style de la règle
    smartColor: "#E0098E", // Couleur du repère smart-indicator
    showTRepere: true, // Visibilité du repère T (visible par défaut)

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
    return calib?.pxPerPb != null
      ? calib.pxPerPb
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
      smartIndicator: document.getElementById("smart-indicator"),
      surplusIndicator: document.getElementById("surplus-indicator"),
      surplusTrait: document.getElementById("surplus-trait"),
      tRepere: document.getElementById("t-repere"),
    };
  }

  /**
   * Applique le style de la règle : couleur du smart-indicator et
   * visibilité du repère T.
   */
  function applyRulerStyle() {
    if (elements.smartIndicator) {
      elements.smartIndicator.style.backgroundColor = state.smartColor;
    }
    if (elements.tRepere) {
      elements.tRepere.style.display = state.showTRepere ? "block" : "none";
    }
  }

  /**
   * Met à jour la position des indicateurs de la règle
   */
  function updateRulerPosition(rulerPos) {
    const { smartIndicator } = elements;

    const pos = rulerPos || 0;
    const leftPosition = state.rulerCenterPx + pos * state.pxPerPb;

    if (smartIndicator) smartIndicator.style.left = `${leftPosition}px`;
  }

  /**
   * Met à jour l'indicateur de surplus
   */
  function updateSurplus(surplus) {
    state.lastSurplus = surplus;
    const { surplusIndicator, surplusTrait } = elements;
    if (!surplusIndicator) return;

    if (surplus !== 0) {
      // Conversion vers les graduations réelles de la barre de tir
      // (même principe que pbRealDisplay dans infos_shot.js)
      const calib = window.ResolutionCalibrationService?.getCalibration(
        state.currentWidth,
        state.currentHeight,
      );
      const realPxPerPb = calib?.realPxPerPb || 81;
      const pixelOffset = Math.abs(surplus) * state.pxPerPb;
      const value = pixelOffset / realPxPerPb;

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

    const { surplus, valueForRuler } = splitPbValue(actualPb);

    updateSurplus(surplus);
    updateRulerPosition(valueForRuler);
  }

  /**
   * Rafraîchit l'échelle de la règle
   */
  function refreshScale() {
    state.pxPerPb = getPxPerPb();
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
      "--ruler-container-bottom",
      (calib.rulerContainerBottom ?? 0) + "px",
    );
    document.documentElement.style.setProperty(
      "--ruler-indicators-top",
      (calib.rulerIndicatorTop ?? 20) + "px",
    );

    // Hauteur fixe de la fenêtre
    const rulerHeight = CONFIG.WINDOW_HEIGHT;
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

    // Couleur du repère (smart-indicator)
    state.tauriService.listen("update-ruler-smart-color", (event) => {
      const color = event.payload?.color;
      if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) {
        state.smartColor = color;
        if (state.storage) state.storage.set("ruler_smart_color", color);
        applyRulerStyle();
      }
    });

    // Visibilité du repère T
    state.tauriService.listen("update-ruler-t-repere", (event) => {
      const visible = Boolean(event.payload?.visible);
      state.showTRepere = visible;
      if (state.storage) state.storage.set("ruler_show_t_repere", visible);
      applyRulerStyle();
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

    // --- Style de la règle (couleur repère + visibilité repère T) ---
    if (state.storage) {
      state.smartColor = state.storage.get("ruler_smart_color", "#E0098E");
      state.showTRepere = state.storage.get("ruler_show_t_repere", true);
    }
    applyRulerStyle();

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
