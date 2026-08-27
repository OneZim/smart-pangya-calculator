// spin_overlay.js

(function () {
  "use strict";

  // ================================================================
  // CALIBRATION MANUELLE PAR RÉSOLUTION (temporaire)
  // ================================================================
  //
  // La table de calibration vit dans spin_overlay_presets.json (donnée
  // pure, pas de logique). Contrairement à un <script> classique, fetch()
  // est ASYNCHRONE : CONFIG/REPERE_BASE ne peuvent donc plus être des
  // const calculées au chargement du fichier — elles sont remplies par
  // loadActivePreset(), à appeler (et await) avant tout le reste de
  // l'init (voir DOMContentLoaded plus bas).

  const RESOLUTION_INDEX = 2; // 0 = 1920x1080 (référence) | 1 = 1200x900

  // Chemin RELATIF : le JSON vit dans overlay/spin_overlay/, au même
  // niveau que spin_overlay.html/js/css — pas besoin d'un chemin absolu
  // depuis la racine ici.
  //
  // ⚠️ À VÉRIFIER : ce fichier n'étant PAS dans public/, Vite ne le
  // "voit" pas via un import statique — il ne sera copié dans le build
  // de prod QUE si Vite/Tauri copie les fichiers non-JS/CSS/HTML des
  // sous-dossiers source tels quels. Ça fonctionnera à coup sûr en dev
  // (`tauri dev`) ; avant de livrer une version release, fais un
  // `tauri build` et vérifie que spin_overlay_presets.json est bien
  // présent à côté de spin_overlay.html dans le dossier de sortie. S'il
  // manque, la solution la plus sûre est de le déplacer dans public/
  // (voir version précédente avec un chemin absolu "/...").
  const PRESETS_URL = "./spin_overlay_presets.json";

  // Filet de sécurité si le fetch échoue (mauvais chemin, fichier absent...)
  const FALLBACK_PRESET = {
    pxParUniteSpin: 2,
    pxParUniteCurve: 2,
    ancrageZero: 40,
    ancrageZeroX: 0,
    cercleSize: 120,
    trait: { w: 11, h: 2, top: 3 },
    cercleRepere: { size: 20, top: 10 },
    traitBas: { w: 11, h: 2, top: 39 },
    traitR: { w: 2, h: 13, top: 22, offset: 44 },
    traitL: { w: 2, h: 13, top: 22, offset: 44 },
  };

  let CONFIG = null;
  let REPERE_BASE = null;

  async function loadActivePreset() {
    let presets = [];
    try {
      const res = await fetch(PRESETS_URL);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      presets = await res.json();
    } catch (err) {
      console.warn(
        `⚠️ Impossible de charger ${PRESETS_URL} (${err.message}) — utilisation du preset de secours 1920x1080.`,
      );
    }

    const active = presets[RESOLUTION_INDEX] || FALLBACK_PRESET;

    CONFIG = {
      pxParUniteSpin: active.pxParUniteSpin,
      pxParUniteCurve: active.pxParUniteCurve,

      ancrageZero: active.ancrageZero,
      ancrageZeroX: active.ancrageZeroX,
      valeurMin: 0,
      valeurMax: 30,
      curveMin: -30,
      curveMax: 30,
    };

    REPERE_BASE = {
      cercleSize: active.cercleSize,
      trait: active.trait,
      cercleRepere: active.cercleRepere,
      traitBas: active.traitBas,
      traitR: active.traitR,
      traitL: active.traitL,
    };
  }

  const POSITION_KEY = "spin_overlay_position";

  // ================================================================
  // VARIABLES
  // ================================================================

  let tauriService = null;
  let storage = null;
  let savePosition = null;
  let repere = null;

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
    if (!container) return;

    container.innerHTML = "";

    const b = REPERE_BASE;

    const trait = document.createElement("div");
    trait.id = "trait";
    trait.style.cssText = `
      width: ${b.trait.w}px;
      height: ${b.trait.h}px;
      background: red;
      position: absolute;
      top: ${b.trait.top}px;
      left: 50%;
      transform: translate(-50%, 0px);
      pointer-events: none;
    `;

    const cercle = document.createElement("div");
    cercle.id = "cercle-repere";
    cercle.style.cssText = `
      width: ${b.cercleRepere.size}px;
      height: ${b.cercleRepere.size}px;
      border: 2px solid red;
      border-radius: 50%;
      position: absolute;
      top: ${b.cercleRepere.top}px;
      left: 50%;
      transform: translateX(-50%);
      pointer-events: none;
    `;

    const traitBas = document.createElement("div");
    traitBas.id = "trait-bas";
    traitBas.style.cssText = `
      width: ${b.traitBas.w}px;
      height: ${b.traitBas.h}px;
      background: red;
      position: absolute;
      top: ${b.traitBas.top}px;
      left: 50%;
      transform: translate(-50%);
      pointer-events: none;
    `;

    // traitR / traitL : ancrés au centre, décalage signé = leur `offset`
    // calibré (voir PRESETS). Symétriques par construction (même |offset|,
    // signe opposé) — s'ils doivent un jour être asymétriques, donne-leur
    // chacun leur propre champ `offset` dans PRESETS (déjà séparés).
    const traitR = document.createElement("div");
    traitR.id = "traitR";
    traitR.style.cssText = `
      width: ${b.traitR.w}px;
      height: ${b.traitR.h}px;
      background: red;
      position: absolute;
      top: ${b.traitR.top}px;
      left: 50%;
      transform: translate(calc(-50% + ${b.traitR.offset}px), 0);
      pointer-events: none;
    `;

    const traitL = document.createElement("div");
    traitL.id = "traitL";
    traitL.style.cssText = `
      width: ${b.traitL.w}px;
      height: ${b.traitL.h}px;
      background: red;
      position: absolute;
      top: ${b.traitL.top}px;
      left: 50%;
      transform: translate(calc(-50% - ${b.traitL.offset}px), 0);
      pointer-events: none;
    `;

    container.appendChild(trait);
    container.appendChild(cercle);
    container.appendChild(traitBas);
    container.appendChild(traitR);
    container.appendChild(traitL);
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
      CONFIG.ancrageZero + valeurTapee * CONFIG.pxParUniteCurve;
    const deplacementX =
      CONFIG.ancrageZeroX - curveTapee * CONFIG.pxParUniteCurve;

    if (repere) {
      repere.style.transform =
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

    // TODO : détection auto de la résolution mise de côté pour l'instant —
    // on calibre à la main via RESOLUTION_INDEX en attendant d'avoir toutes
    // les résolutions calibrées. À réactiver une fois prêt (remplacer par
    // un appel à ResolutionCalibrationService.getCalibration(width, height)) :
    //
    // tauriService.listen("update-game-resolution", (event) => {
    //   const payload = event.payload || {};
    //   setScale(Number(payload.width) || 0, Number(payload.height) || 0);
    // });

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

    await loadActivePreset(); // remplit CONFIG/REPERE_BASE avant tout usage

    applyCercleSize();
    buildRepere();
    repere = document.getElementById("repere");

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
