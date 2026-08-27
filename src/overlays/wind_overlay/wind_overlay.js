// wind_overlay.js - Version corrigée

(function () {
  "use strict";

  let angleSelector = null;
  let isDragging = false;
  let lastMouseX = 0;
  let lastMouseY = 0;
  let dragAccumX = 0;
  let dragAccumY = 0;
  let isSyncing = false; // ← Flag pour éviter les boucles

  const dragHandle = document.getElementById("wind-drag-handle");

  // ================================================================
  // UTILITAIRES TAURI
  // ================================================================

  function getTauriCore() {
    return window.__TAURI__?.core || null;
  }

  function getTauriEvent() {
    return window.__TAURI__?.event || null;
  }

  // ================================================================
  // ÉMISSION DE L'ANGLE
  // ================================================================

  function emitWindAngle(angle) {
    if (isSyncing) return; // ← Ne pas émettre si on est en synchro

    const angleInt = Math.round(angle);

    if (window.TauriService?.isAvailable) {
      window.TauriService.emit("sync-wind-angle", { angle: angleInt });
    }
  }

  // ================================================================
  // POSITION DE LA FENÊTRE (sauvegarde/restauration)
  // ================================================================

  const POSITION_KEY = "wind_overlay_position";
  let savePosition = null; // assignée dans DOMContentLoaded, une fois storage prêt

  // ================================================================
  // DRAG
  // ================================================================

  function setupDrag() {
    if (!dragHandle) return;

    dragHandle.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      isDragging = true;
      lastMouseX = e.screenX;
      lastMouseY = e.screenY;
      dragAccumX = 0;
      dragAccumY = 0;
      e.preventDefault();
    });

    window.addEventListener("mousemove", (e) => {
      if (!isDragging) return;

      dragAccumX += e.screenX - lastMouseX;
      dragAccumY += e.screenY - lastMouseY;
      lastMouseX = e.screenX;
      lastMouseY = e.screenY;

      const core = getTauriCore();
      if (!core) return;

      const stepsX = Math.trunc(dragAccumX);
      const stepsY = Math.trunc(dragAccumY);

      if (stepsX !== 0 || stepsY !== 0) {
        core
          .invoke("move_wind_overlay", { dx: stepsX, dy: stepsY })
          .catch((err) => console.error("Drag error:", err));
        dragAccumX -= stepsX;
        dragAccumY -= stepsY;
        savePosition?.(); // debounced, ne sauvegarde vraiment qu'à l'arrêt du mouvement
      }
    });

    window.addEventListener("mouseup", () => {
      isDragging = false;
    });

    window.addEventListener("mouseleave", () => {
      isDragging = false;
    });
  }

  // ================================================================
  // TOUCHES CLAVIER
  // ================================================================

  function setupKeyboardMove() {
    window.addEventListener("keydown", (e) => {
      const deltas = {
        ArrowUp: { dx: 0, dy: -1 },
        ArrowDown: { dx: 0, dy: 1 },
        ArrowLeft: { dx: -1, dy: 0 },
        ArrowRight: { dx: 1, dy: 0 },
      };
      const delta = deltas[e.key];
      if (!delta) return;
      e.preventDefault();

      const core = getTauriCore();
      if (core) {
        core
          .invoke("move_wind_overlay", delta)
          .catch((err) => console.error("Erreur déplacement touche:", err));
        savePosition?.();
      }
    });
  }

  // ================================================================
  // LISTENERS TAURI
  // ================================================================

  // wind_overlay.js - setupTauriListeners()

  function setupTauriListeners() {
    const tauriEvent = getTauriEvent();
    if (!tauriEvent) return;

    // Réception depuis la page principale
    tauriEvent.listen("sync-wind-angle", (event) => {
      const { angle: newAngle } = event.payload;
      if (angleSelector) {
        angleSelector.setAngle(newAngle); // ← setAngle n'émet pas
      }
    });

    tauriEvent.listen("sync-input-value", (event) => {
      const { id, value } = event.payload;
      if (id === "degree" && angleSelector) {
        angleSelector.setAngle(parseInt(value) || 0);
      }
    });

    // Rebasculer le mode compact quand la résolution du jeu change (émis par
    // refresh_game_resolution côté Rust). Même mécanisme que spin_overlay.
    tauriEvent.listen("update-game-resolution", (event) => {
      const width = Number(event.payload?.width) || 0;
      if (width > 0) {
        const compactNow = width < 1920;
        angleSelector?.setCompact(compactNow);
        applyWindowMode(compactNow, true);
      }
    });
  }

  // ================================================================
  // INITIALISATION
  // ================================================================

  document.addEventListener("DOMContentLoaded", async () => {

    // === STORAGE ===
    // Cette fenêtre (overlay) est un contexte JS séparé de la fenêtre
    // principale : StorageService doit être chargé (balise <script> dans
    // le HTML de cet overlay) ET initialisé ici indépendamment, avant de
    // créer l'AngleSelector qui en dépend dès sa création.
    const storage = window.StorageService;
    if (storage) {
      await storage.init();
    } else {
      console.warn(
        "⚠️ StorageService non chargé dans cette fenêtre — l'angle ne persistera pas ici (fallback mémoire dans AngleSelector).",
      );
    }

    // === POSITION DE LA FENÊTRE ===
    if (storage && window.WindowPositionHelper) {
      savePosition = window.WindowPositionHelper.createDebouncedPositionSaver(
        storage,
        POSITION_KEY,
      );
      await window.WindowPositionHelper.restoreWindowPosition(
        storage,
        POSITION_KEY,
      );
    }

    // === DÉTECTION DE LA RÉSOLUTION (mode compact sous 1920 px) ===
    // Même logique que spin_overlay : on lit la résolution du jeu au
    // démarrage. compact = true réduit le dessin (croix/flèche, traits fins).
    let compact = false;
    try {
      const core = getTauriCore();
      if (core) {
        const res = await core.invoke("get_game_resolution");
        if (res && res.width && res.width < 1920) compact = true;
      }
    } catch (err) {
      console.warn("⚠️ Résolution non détectée — cadran non compact.", err);
    }

    // Redimensionne la fenêtre ET le canvas selon le mode : petite en
    // compact (<1920), grande à 1920+ (dessin plein format). Le canvas doit
    // suivre la fenêtre pour que la poignée de drag reste visible.
    async function applyWindowMode(compactMode, resizeCanvas) {
      try {
        const winApi = window.__TAURI__?.window;
        if (!winApi?.getCurrentWindow) return;
        const current = await winApi.getCurrentWindow();
        await current.setSize(
          new winApi.PhysicalSize(
            compactMode ? 150 : 300,
            compactMode ? 170 : 250,
          ),
        );

        if (resizeCanvas) {
          const size = compactMode ? 130 : 206;
          const canvas = document.getElementById("angle-canvas");
          if (canvas) canvas.width = canvas.height = size;
          const container = document.querySelector(".crosshair-container");
          if (container) {
            container.style.width = size + "px";
            container.style.height = size + "px";
          }
          angleSelector?.setCanvasSize(size, size);
        }
      } catch (err) {
        console.error("❌ Erreur redimensionnement fenêtre vent:", err);
      }
    }

    await applyWindowMode(compact, true);

    // === CRÉER L'ANGLE SELECTOR ===
    // wind_overlay.js - Création de l'AngleSelector

    angleSelector = window.AngleSelector({
      storage, // ← même storage que la fenêtre principale
      canvasId: "angle-canvas",
      displayId: null,
      degreeId: null,
      syncEnabled: false, // ← L'overlay N'ÉMET PAS
      // Même clé que la fenêtre principale (sans le préfixe "pangya_",
      // désormais géré automatiquement par StorageService) pour que les
      // deux fenêtres lisent/écrivent la même valeur sur disque.
      storageKey: "wind_angle",
      compact,
      onAngleChange: (angle) => {
        // Émettre MANUELLEMENT vers la page principale
        const angleInt = Math.round(angle);
        if (window.TauriService?.isAvailable) {
          window.TauriService.emit("sync-wind-angle", { angle: angleInt });
        }
      },
    });

    if (!angleSelector) {
      console.error("❌ AngleSelector non initialisé");
      return;
    }

    // === CONFIGURATION ===
    setupDrag();
    setupKeyboardMove();
    setupTauriListeners();
  });
})();
