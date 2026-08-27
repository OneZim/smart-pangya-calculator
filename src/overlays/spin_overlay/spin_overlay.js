// spin_overlay.js

(function () {
  "use strict";

  // ================================================================
  // CALIBRATION PAR RÉSOLUTION (via ResolutionCalibrationService)
  // ================================================================
  //
  // La table vit dans core/services/ResolutionCalibrationService.js et la
  // sélection se fait sur la résolution RÉELLE du jeu détectée côté Rust
  // (corrigée DPI + alignée sur les résolutions officielles). Si le jeu n'est
  // pas détectable au démarrage, on retombe sur la référence (1920x1080).
  // Le listener "update-game-resolution" recharge la calibration à la volée.

  let CONFIG = null;
  let REPERE_BASE = null;
  let activeResolutionKey = null;

  function applyCalibration(calib) {
    CONFIG = {
      pxParUniteSpin: calib.pxParUniteSpin,
      ancrageZero: calib.ancrageZero,
      ancrageZeroX: calib.ancrageZeroX,
      valeurMin: 0,
      valeurMax: 30,
      curveMin: -30,
      curveMax: 30,
    };

    REPERE_BASE = {
      cercleSize: calib.cercleSize,
      trait: calib.trait,
      cercleRepere: calib.cercleRepere,
      traitBas: calib.traitBas,
      traitR: calib.traitR,
      traitL: calib.traitL,
    };
  }

  async function loadCalibrationForCurrentGame() {
    let width = 1920;
    let height = 1080;
    let source = "référence (jeu non détecté)";

    try {
      const res = await tauriService.invoke("get_game_resolution");
      if (res && res.width && res.height) {
        width = res.width;
        height = res.height;
        source = window.ResolutionCalibrationService.hasCalibration(
          width,
          height,
        )
          ? "calibrée"
          : "estimée";
      }
    } catch (err) {
      console.warn(
        "⚠️ Jeu non détecté au démarrage — calibration de référence appliquée.",
        err,
      );
    }

    applyCalibration(window.ResolutionCalibrationService.getCalibration(width, height));
    activeResolutionKey = `${width}x${height}`;
    console.log(`🎛️ Calibration ${activeResolutionKey} (${source}) :`, {
      spinDialCenter: window.ResolutionCalibrationService.getCalibration(width, height)
        .spinDialCenter,
      pxParUniteSpin: CONFIG.pxParUniteSpin,
      ancrageZero: CONFIG.ancrageZero,
    });
  }

  function reloadCalibration(width, height) {
    const key = `${width}x${height}`;
    if (key === activeResolutionKey || !CONFIG) return;

    const service = window.ResolutionCalibrationService;
    applyCalibration(service.getCalibration(width, height));
    activeResolutionKey = key;

    applyCercleSize();
    buildRepere();
    setValue(lastSpin, lastCurve);

    console.log(
      `🎛️ Résolution changée → ${key} (calibration ${
        service.hasCalibration(width, height) ? "calibrée" : "estimée"
      })`,
    );
  }

  const POSITION_KEY = "spin_overlay_position";

  // ================================================================
  // VARIABLES
  // ================================================================

  let tauriService = null;
  let storage = null;
  let savePosition = null;
  let marqueur = null;

  // Dernières valeurs spin/curve reçues, pour pouvoir redessiner le
  // repère après un buildRepere() sans attendre le prochain "update-spin".
  let lastSpin = 0;
  let lastCurve = 0;

  // ================================================================
  // CRÉER TAURI SERVICE
  // ================================================================

  function createTauriService() {
    return {
      core: window.__TAURI__?.core || null,
      event: window.__TAURI__?.event || null,
      window: window.__TAURI__?.window || null,
      isAvailable: !!(window.__TAURI__?.core && window.__TAURI__?.event),

      async invoke(command, args = {}) {
        if (!this.isAvailable) return null;
        return await this.core.invoke(command, args);
      },

      async listen(eventName, callback) {
        if (!this.isAvailable) return;
        await this.event.listen(eventName, callback);
      },

      async emit(eventName, payload) {
        if (!this.isAvailable) return;
        await this.event.emit(eventName, payload);
      },

      async getCurrentWindow() {
        if (!this.isAvailable) return null;
        return this.window.getCurrentWindow();
      },
    };
  }

  // ================================================================
  // APPLIQUER LA CALIBRATION ACTIVE (RESOLUTION_INDEX)
  // ================================================================

  function applyCercleSize() {
    document.documentElement.style.setProperty(
      "--cercle-size",
      `${REPERE_BASE.cercleSize}px`,
    );
  }

  // ================================================================
  // CRÉATION / RECONSTRUCTION DU REPÈRE
  // ================================================================
  //
  // Reconstruit intégralement les 5 éléments du repère à partir du preset
  // actif chargé depuis spin_overlay_presets.json (voir loadActivePreset).

  function buildRepere() {
    const container = document.getElementById("repere");
    if (!container || !REPERE_BASE) return;

    container.innerHTML = "";

    const b = REPERE_BASE;

    // Origine du marqueur = CENTRE du petit cercle rouge (centre de la balle
    // sur la jauge). Les tops des presets étant mesurés depuis le haut du
    // repère d'origine, on les re-exprime par rapport à ce centre ici —
    // les presets restent donc inchangés.
    const centerY = b.cercleRepere.top + b.cercleRepere.size / 2;
    const relativeTop = (element) => element.top + element.h / 2 - centerY;

    const el = document.createElement("div");
    el.id = "marqueur";

    const cercle = document.createElement("div");
    cercle.id = "cercle-repere";
    cercle.style.cssText = `
      width: ${b.cercleRepere.size}px;
      height: ${b.cercleRepere.size}px;
      border: 2px solid red;
      border-radius: 50%;
      box-sizing: border-box;
      position: absolute;
      left: ${-b.cercleRepere.size / 2}px;
      top: ${-b.cercleRepere.size / 2}px;
      pointer-events: none;
    `;

    const trait = document.createElement("div");
    trait.id = "trait";
    trait.style.cssText = `
      width: ${b.trait.w}px;
      height: ${b.trait.h}px;
      background: red;
      position: absolute;
      left: ${-b.trait.w / 2}px;
      top: ${relativeTop(b.trait)}px;
      pointer-events: none;
    `;

    const traitBas = document.createElement("div");
    traitBas.id = "trait-bas";
    traitBas.style.cssText = `
      width: ${b.traitBas.w}px;
      height: ${b.traitBas.h}px;
      background: red;
      position: absolute;
      left: ${-b.traitBas.w / 2}px;
      top: ${relativeTop(b.traitBas)}px;
      pointer-events: none;
    `;

    // traitR / traitL : ancrés à l'origine, décalage signé = leur `offset`
    // calibré. Symétriques par construction (même |offset|, signe opposé).
    const traitR = document.createElement("div");
    traitR.id = "traitR";
    traitR.style.cssText = `
      width: ${b.traitR.w}px;
      height: ${b.traitR.h}px;
      background: red;
      position: absolute;
      left: ${b.traitR.offset - b.traitR.w / 2}px;
      top: ${relativeTop(b.traitR)}px;
      pointer-events: none;
    `;

    const traitL = document.createElement("div");
    traitL.id = "traitL";
    traitL.style.cssText = `
      width: ${b.traitL.w}px;
      height: ${b.traitL.h}px;
      background: red;
      position: absolute;
      left: ${-(b.traitL.offset + b.traitL.w / 2)}px;
      top: ${relativeTop(b.traitL)}px;
      pointer-events: none;
    `;

    el.appendChild(trait);
    el.appendChild(cercle);
    el.appendChild(traitBas);
    el.appendChild(traitR);
    el.appendChild(traitL);

    container.appendChild(el);
    marqueur = el;
  }

  // ================================================================
  // METTRE À JOUR LA POSITION DU REPÈRE
  // ================================================================

  function setValue(valeurTapee, curveTapee) {
    valeurTapee = Math.round(Number(valeurTapee) * 2) / 2;
    valeurTapee = Math.min(
      Math.max(valeurTapee, CONFIG.valeurMin),
      CONFIG.valeurMax,
    );

    curveTapee = Math.round(Number(curveTapee) * 2) / 2 || 0;
    curveTapee = Math.min(
      Math.max(curveTapee, CONFIG.curveMin),
      CONFIG.curveMax,
    );

    // On mémorise pour pouvoir rejouer le positionnement après un
    // buildRepere() (ex: changement de RESOLUTION_INDEX) sans attendre
    // un nouvel event "update-spin".
    lastSpin = valeurTapee;
    lastCurve = curveTapee;

    const deplacementY =
      CONFIG.ancrageZero + valeurTapee * CONFIG.pxParUniteSpin;
    const deplacementX =
      CONFIG.ancrageZeroX - curveTapee * CONFIG.pxParUniteSpin;

    if (marqueur) {
      marqueur.style.transform =
        "translate(" + deplacementX + "px, " + deplacementY + "px)";
    }
  }

  // ================================================================
  // DRAG (drag natif via startDragging, comme ruler_overlay)
  // ================================================================

  function setupDrag() {
    document.addEventListener("mousedown", async (e) => {
      if (e.button === 0 && tauriService?.isAvailable) {
        const win = await tauriService.getCurrentWindow();
        if (win) {
          win.startDragging();
        }
      }
    });
  }

  // ================================================================
  // POSITION DE LA FENÊTRE (sauvegarde/restauration)
  // ================================================================

  async function setupPositionPersistence() {
    if (!window.WindowPositionHelper) {
      console.warn(
        "⚠️ WindowPositionHelper non chargé — vérifie la balise <script> dans le HTML de cette fenêtre.",
      );
      return;
    }
    if (!storage) {
      console.warn(
        "⚠️ Pas de storage disponible — la position ne sera pas sauvegardée.",
      );
      return;
    }

    savePosition = window.WindowPositionHelper.createDebouncedPositionSaver(
      storage,
      POSITION_KEY,
    );

    await window.WindowPositionHelper.restoreWindowPosition(
      storage,
      POSITION_KEY,
    );

    const win = await tauriService.getCurrentWindow();
    if (win?.onMoved) {
      await win.onMoved(() => {
        savePosition();
      });
    } else {
      console.warn("⚠️ win.onMoved indisponible sur cette version/plateforme");
    }

    document.addEventListener("mouseup", () => {
      savePosition?.();
    });
  }

  // ================================================================
  // LISTENERS TAURI
  // ================================================================

  function setupTauriListeners() {
    if (!tauriService?.isAvailable) return;

    tauriService.listen("update-spin", (event) => {
      const payload = event.payload;
      const spin =
        typeof payload === "object"
          ? Number(payload.spin) || 0
          : Number(payload) || 0;
      const curve =
        typeof payload === "object" ? Number(payload.curve) || 0 : 0;

      setValue(spin, curve);
    });

    // Rechargement automatique de la calibration quand la résolution du jeu
    // change (l'événement est émis par refresh_game_resolution côté Rust,
    // avec la résolution corrigée DPI).
    tauriService.listen("update-game-resolution", (event) => {
      const payload = event.payload || {};
      const width = Number(payload.width) || 0;
      const height = Number(payload.height) || 0;
      if (width > 0 && height > 0) {
        reloadCalibration(width, height);
      }
    });

    tauriService.listen("spin-visibility", async (event) => {
      const win = await tauriService.getCurrentWindow();
      if (win) {
        event.payload ? await win.show() : await win.hide();
      }
    });

    tauriService.listen("spin-move", async (event) => {
      const win = await tauriService.getCurrentWindow();
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
  // INITIALISATION
  // ================================================================

  document.addEventListener("DOMContentLoaded", async () => {
    tauriService = createTauriService();

    await loadCalibrationForCurrentGame(); // remplit CONFIG/REPERE_BASE avant tout usage

    applyCercleSize();
    buildRepere();

    // === STORAGE ===
    storage = window.StorageService || null;
    if (storage) {
      await storage.init();
    } else {
      console.warn(
        "⚠️ StorageService non chargé dans cette fenêtre — la position ne persistera pas.",
      );
    }

    setValue(0, 0); // valeur par défaut au démarrage

    setupDrag();
    setupTauriListeners();
    await setupPositionPersistence();
  });
})();
