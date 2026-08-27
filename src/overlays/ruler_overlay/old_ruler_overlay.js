// ruler_overlay.js - Version refactorisée (avec affichage % corrigé)

(function () {
  "use strict";

  // ================================================================
  // CONSTANTES
  // ================================================================

  const PX_PER_PB = 20.3;

  const MIN_PB = -20;
  const MAX_PB = 20;
  const POSITION_KEY = "ruler_overlay_position";

  // Moitié de la largeur de #ruler-container (1920px dans ruler_overlay.css).
  // PB = 0 est toujours dessiné à cette position en pixels, quelle que soit
  // la plage MIN_PB/MAX_PB ou la valeur de PX_PER_PB : ça découple le
  // centrage visuel de la calibration, donc recalibrer ne recasse plus
  // jamais l'alignement au centre de l'écran.
  const RULER_CENTER_PX = 960;

  // Au-delà de ce seuil, le red-indicator sortirait de l'écran : le surplus
  // prend le relais (multiple de 10 le plus proche affiché à part), et la
  // règle ne montre que le reste. À ajuster si tu changes encore la plage
  // MIN_PB/MAX_PB ou le calibrage PX_PER_PB.
  const SURPLUS_THRESHOLD = 47;

  // ================================================================
  // VARIABLES
  // ================================================================

  let elements = {};
  let tauriService = null;
  let storage = null;
  let savePosition = null;

  // ================================================================
  // RÉCUPÉRATION DES ÉLÉMENTS
  // ================================================================

  function getElements() {
    return {
      container: document.getElementById("ruler-container"),
      redIndicator: document.getElementById("red-indicator"),
      ticksContainer: document.getElementById("ticks-container"),
      pbDisplay: document.getElementById("pb-display"),
      distanceDisplay: document.getElementById("distance-display"),
      surplusIndicator: document.getElementById("surplus-indicator"),
      percentDisplay: document.getElementById("percent-display"),
    };
  }

  // ================================================================
  // DESSINER LA RÈGLE
  // ================================================================

  function drawRuler() {
    const container = elements.ticksContainer;
    if (!container) return;

    // === CONSTRUCTION HORS-DOM ===
    // On assemble tous les ticks/labels dans un DocumentFragment avant de
    // les insérer d'un coup dans le container : une seule mutation du DOM
    // au lieu d'une par élément (~63 appendChild avant).
    const fragment = document.createDocumentFragment();

    for (let i = MIN_PB; i <= MAX_PB; i++) {
      const leftPosition = RULER_CENTER_PX + i * PX_PER_PB;

      const tick = document.createElement("div");
      tick.className = `tick-major ${i === 0 ? "zero" : ""}`;
      tick.style.left = `${leftPosition}px`;
      fragment.appendChild(tick);

      const label = document.createElement("div");
      label.className = `tick-label ${i === 0 ? "zero" : ""}`;
      label.style.left = `${leftPosition}px`;
      label.innerText = Math.abs(i);
      fragment.appendChild(label);
    }

    // === UN SEUL WRITE DOM ===
    container.innerHTML = "";
    container.appendChild(fragment);
  }

  // ================================================================
  // METTRE À JOUR LA POSITION
  // ================================================================

  function updateRulerPosition(rulerPos, distVal, fullPbVal) {
    const redIndicator = elements.redIndicator;
    const pbDisplay = elements.pbDisplay;
    const distanceDisplay = elements.distanceDisplay;

    const pos = rulerPos || 0;
    const dist = distVal || 0;
    const pb = fullPbVal || 0;

    // === ANCRÉ SUR LE CENTRE DE L'ÉCRAN (voir RULER_CENTER_PX) ===
    if (redIndicator) {
      const leftPosition = RULER_CENTER_PX + pos * PX_PER_PB;
      redIndicator.style.left = `${leftPosition}px`;
    }

    if (pbDisplay) {
      pbDisplay.innerText = `${pb.toFixed(2)} PB`;
    }

    if (distanceDisplay) {
      distanceDisplay.innerText = `${dist.toFixed(2)} yds`;
    }
  }

  // ================================================================
  // DÉCOMPOSER UNE VALEUR PB (partie "règle" + partie "surplus")
  // ================================================================
  //
  // Au-delà de SURPLUS_THRESHOLD, la règle ne peut afficher que la partie
  // restante ; le surplus (multiple de 10 le plus proche) part sur
  // l'indicateur "+10/+20/...". Calcul centralisé ici pour éviter que
  // updateSurplus() et updateUI() ne divergent avec le temps.

  function splitPbValue(actualPb) {
    const sign = actualPb >= 0 ? 1 : -1;
    const absPb = Math.abs(actualPb);

    let surplus = 0;
    let valueForRuler = actualPb;

    if (absPb > SURPLUS_THRESHOLD) {
      const excess = absPb - SURPLUS_THRESHOLD;
      const magnitude = Math.ceil(excess / 10) * 10;
      surplus = magnitude * sign;
      valueForRuler = (absPb - magnitude) * sign;
    }

    return { surplus, valueForRuler };
  }

  // ================================================================
  // GÉRER LE SURPLUS
  // ================================================================

  function updateSurplus(surplus) {
    const surplusIndicator = elements.surplusIndicator;
    if (!surplusIndicator) return;

    if (surplus !== 0) {
      // === TOUJOURS AFFICHER +10 (ou +20, +30, etc.) ===
      const numberText = Math.abs(surplus);
      surplusIndicator.innerText = `+${numberText}`;
      surplusIndicator.style.display = "flex";

      // La classe negative n'est plus nécessaire
      surplusIndicator.classList.remove("negative");
    } else {
      surplusIndicator.style.display = "none";
    }
  }

  // ================================================================
  // METTRE À JOUR L'UI
  // ================================================================

  function updateUI(data) {
    const actualPb = data.pb !== undefined ? data.pb : 0;
    const actualDist = data.distance !== undefined ? data.distance : 0;
    const actualPercent = data.percent !== undefined ? data.percent : 0;

    const { surplus, valueForRuler } = splitPbValue(actualPb);

    updateSurplus(surplus);
    updateRulerPosition(valueForRuler, actualDist, actualPb);

    if (elements.percentDisplay) {
      elements.percentDisplay.innerText = `${actualPercent.toFixed(1)}%`;
      elements.percentDisplay.classList.toggle(
        "percent-low",
        actualPercent < 80,
      );
    }
  }

  // ================================================================
  // DRAG
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
  //
  // Contrairement à wind_overlay.js (drag "manuel" avec accumulation de
  // delta), cette fenêtre utilise win.startDragging() : le déplacement
  // est géré nativement par l'OS/Tauri, donc on ne peut pas intercepter
  // chaque pixel côté JS. On utilise à la place win.onMoved(), qui se
  // déclenche automatiquement après CHAQUE déplacement, peu importe la
  // source (drag natif, événement "ruler-move" reçu d'une autre fenêtre,
  // etc.) — plus simple et plus robuste ici.

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

    // Filet de sécurité : sur certaines plateformes, un drag natif
    // (startDragging) ne déclenche pas onMoved de façon fiable pendant
    // le mouvement. On force une sauvegarde au relâchement du clic aussi.
    document.addEventListener("mouseup", () => {
      savePosition?.();
    });
  }

  // ================================================================
  // LISTENERS TAURI
  // ================================================================

  function setupTauriListeners() {
    if (!tauriService?.isAvailable) return;

    tauriService.listen("update-ruler", (event) => {
      updateUI(event.payload);
    });

    // ruler_overlay.js - setupTauriListeners()

    tauriService.listen("ruler-visibility", async (event) => {
      const shouldShow =
        typeof event.payload === "object" ? event.payload.show : event.payload;
      const win = await tauriService.getCurrentWindow();
      if (win) {
        shouldShow ? await win.show() : await win.hide();
      }
    });

    tauriService.listen("ruler-lock", (event) => {
      const shouldLock =
        typeof event.payload === "object" ? event.payload.lock : event.payload;
      tauriService
        .invoke(shouldLock ? "enable_click_through" : "disable_click_through")
        .catch(console.error);
    });

    tauriService.listen("ruler-move", async (event) => {
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
    // === TAURI SERVICE ===
    // Fourni par core/services/TauriService.js (chargé via <script> dans
    // le HTML de cette fenêtre). On ne recrée plus de wrapper local ici.
    if (!window.TauriService) {
      console.warn(
        "⚠️ TauriService non chargé dans cette fenêtre — vérifie la balise <script> dans le HTML.",
      );
    }
    tauriService = window.TauriService || null;

    elements = getElements();

    // === STORAGE ===
    // Fenêtre séparée : StorageService doit être chargé (balise <script>
    // dans le HTML de cette fenêtre) et initialisé ici indépendamment.
    storage = window.StorageService || null;
    if (storage) {
      await storage.init();
    } else {
      console.warn(
        "⚠️ StorageService non chargé dans cette fenêtre — la position ne persistera pas.",
      );
    }

    drawRuler();
    updateRulerPosition(0, 0, 0);

    setupDrag();
    setupTauriListeners();
    await setupPositionPersistence();
  });
})();
