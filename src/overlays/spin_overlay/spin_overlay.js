// spin_overlay.js

(function () {
  "use strict";

  let CONFIG = null;
  let REPERE_BASE = null;
  let activeResolutionKey = null;

  function applyCalibration(calib) {
    CONFIG = {
      pxParUniteSpin: calib.pxParUniteSpin,
      ancrageZero: calib.ancrageZero,
      ancrageZeroX: calib.ancrageZeroX,
      valeurMin: -30, // Corrigé à -30 pour accepter les spins négatifs du Dunk
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
        "⚠️ Jeu non détecté au démarrage — référence appliquée.",
        err,
      );
    }

    applyCalibration(
      window.ResolutionCalibrationService.getCalibration(width, height),
    );
    activeResolutionKey = `${width}x${height}`;
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
  }

  const POSITION_KEY = "spin_overlay_position";

  let tauriService = null;
  let storage = null;
  let savePosition = null;
  let marqueur = null;

  let lastSpin = 0;
  let lastCurve = 0;

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

  function applyCercleSize() {
    document.documentElement.style.setProperty(
      "--cercle-size",
      `${REPERE_BASE.cercleSize}px`,
    );
  }

  function buildRepere() {
    const container = document.getElementById("repere");
    if (!container || !REPERE_BASE) return;

    container.innerHTML = "";
    const b = REPERE_BASE;
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

  function setupDrag() {
    document.addEventListener("mousedown", async (e) => {
      if (e.button === 0 && tauriService?.isAvailable) {
        const win = await tauriService.getCurrentWindow();
        if (win) win.startDragging();
      }
    });
  }

  async function setupPositionPersistence() {
    if (!window.WindowPositionHelper || !storage) return;

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
    }

    document.addEventListener("mouseup", () => {
      savePosition?.();
    });
  }

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

    tauriService.listen("update-game-resolution", (event) => {
      const payload = event.payload || {};
      const width = Number(payload.width) || 0;
      const height = Number(payload.height) || 0;
      if (width > 0 && height > 0) reloadCalibration(width, height);
    });

    tauriService.listen("spin-visibility", async (event) => {
      const win = await tauriService.getCurrentWindow();
      if (win) event.payload ? await win.show() : await win.hide();
    });
  }

  document.addEventListener("DOMContentLoaded", async () => {
    tauriService = createTauriService();
    await loadCalibrationForCurrentGame();

    applyCercleSize();
    buildRepere();

    storage = window.StorageService || null;
    if (storage) await storage.init();

    setValue(0, 0);

    setupDrag();
    setupTauriListeners();
    await setupPositionPersistence();
  });
})();
