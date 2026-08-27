// core/components/AngleSelector.js

(function () {
  "use strict";

  window.AngleSelector = function (options = {}) {
    // === STORAGE ===
    // Utilise le StorageService (Tauri Store) passé en option, avec
    // fallback sur window.StorageService si non fourni explicitement.
    const storage = options.storage || window.StorageService;

    // === PARAMÈTRES ===
    const canvasId = options.canvasId || "angle-canvas";
    const displayId = options.displayId || "angle-display";
    const degreeId = options.degreeId || "degree";
    const syncEnabled =
      options.syncEnabled !== undefined ? options.syncEnabled : true;
    // Note: le préfixe "pangya_" est désormais géré automatiquement par
    // StorageService, donc plus besoin de le mettre dans la clé ici.
    const storageKey = options.storageKey || "wind_angle";
    const onAngleChange = options.onAngleChange || null;

    // === MODE COMPACT (réduction du dessin sous 1920 px) ===
    // Le sélecteur principal ne passe aucune option → dialScale 1, lignes
    // épaisses : comportement inchangé. L'overlay vent active compact quand
    // la résolution est < 1920 pour réduire croix/flèche et affiner les traits.
    const COMPACT_SCALE = 0.62;
    let compact = !!options.compact;
    let dialScale = compact ? COMPACT_SCALE : 1;
    let thin = compact;

    // === RÉCUPÉRATION DU CANVAS ===
    const canvas = document.getElementById(canvasId);
    if (!canvas) {
      console.warn(`⚠️ Canvas #${canvasId} non trouvé`);
      return null;
    }

    const ctx = canvas.getContext("2d");
    const center = {
      x: canvas.width / 2,
      y: canvas.height / 2,
    };

    let radius = 80 * dialScale;
    let clickPos = null;
    let angle = 0;
    let isUpdatingFromSync = false;

    // ================================================================
    // DESSINER
    // ================================================================

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const s = dialScale;
      const crooshairSize = 83 * s;
      // Crosshair
      ctx.strokeStyle = "rgba(12, 12, 12, 0.3)";
      ctx.lineWidth = 1;
      // ligne verticale
      ctx.beginPath();
      ctx.moveTo(center.x, center.y - crooshairSize);
      ctx.lineTo(center.x, center.y + crooshairSize);
      ctx.stroke();

      // ligne horizontale
      ctx.beginPath();
      ctx.moveTo(center.x - crooshairSize, center.y);
      ctx.lineTo(center.x + crooshairSize, center.y);
      ctx.stroke();

      // Point central
      ctx.fillStyle = "#c9a84c";
      ctx.beginPath();
      ctx.arc(center.x, center.y, 3, 0, 2 * Math.PI);
      ctx.fill();

      if (!clickPos) return;

      // Flèche
      const opposite = {
        x: 2 * center.x - clickPos.x,
        y: 2 * center.y - clickPos.y,
      };

      ctx.strokeStyle = "#ff4444";
      ctx.lineWidth = thin ? 1 : 1.5;
      ctx.beginPath();
      ctx.moveTo(opposite.x, opposite.y);
      ctx.lineTo(clickPos.x, clickPos.y);
      ctx.stroke();

      const extend = 15 * s;
      const dx2 = clickPos.x - center.x;
      const dy2 = clickPos.y - center.y;
      const a2 = Math.atan2(dy2, dx2);
      ctx.beginPath();
      ctx.moveTo(clickPos.x, clickPos.y);
      ctx.lineTo(
        clickPos.x + Math.cos(a2) * extend,
        clickPos.y + Math.sin(a2) * extend,
      );
      ctx.stroke();

      const dx = clickPos.x - center.x;
      const dy = clickPos.y - center.y;
      const a = Math.atan2(dy, dx);
      const size = 50 * s;

      // offset variable selon l'angle courant (0-360°)
      const offset = (angle >= 110 && angle <= 250 ? 1.5 : 2.1) * s;

      const baseX = center.x + Math.cos(a) * offset;
      const baseY = center.y + Math.sin(a) * offset;

      ctx.strokeStyle = "#ff4444";
      ctx.lineWidth = thin ? 1 : 1.5;
      ctx.beginPath();
      ctx.moveTo(
        baseX + Math.cos(a + Math.PI / 2) * size,
        baseY + Math.sin(a + Math.PI / 2) * size,
      );
      ctx.lineTo(
        baseX + Math.cos(a - Math.PI / 2) * size,
        baseY + Math.sin(a - Math.PI / 2) * size,
      );
      ctx.stroke();

      const arrowSize = 50 * s;
      const flare = Math.PI / 4.3;

      ctx.strokeStyle = "#4a9eff";
      ctx.lineWidth = thin ? 1 : 2;
      ctx.beginPath();
      ctx.moveTo(clickPos.x, clickPos.y);
      ctx.lineTo(
        clickPos.x - arrowSize * Math.cos(a - flare),
        clickPos.y - arrowSize * Math.sin(a - flare),
      );
      ctx.moveTo(clickPos.x, clickPos.y);
      ctx.lineTo(
        clickPos.x - arrowSize * Math.cos(a + flare),
        clickPos.y - arrowSize * Math.sin(a + flare),
      );
      ctx.stroke();
    }

    // ================================================================
    // POSITION
    // ================================================================

    function updatePosition() {
      const rad = ((angle - 90) * Math.PI) / 180;
      clickPos = {
        x: center.x + radius * Math.cos(rad),
        y: center.y + radius * Math.sin(rad),
      };
    }

    // ================================================================
    // UI (avec protection anti-boucle)
    // ================================================================

    function updateUI() {
      // Ne pas émettre si on est en synchro
      if (isUpdatingFromSync) {
        return;
      }

      const angleInt = Math.round(angle);

      // Mettre à jour l'affichage
      const display = document.getElementById(displayId);
      if (display) display.textContent = `${angleInt}°`;

      const degreeInput = document.getElementById(degreeId);
      if (degreeInput) degreeInput.value = angleInt;

      // Sauvegarder (nombre natif, plus besoin de String())
      storage.set(storageKey, angleInt);

      // Synchroniser via Tauri (UNIQUEMENT si enabled)
      if (syncEnabled && window.TauriService?.isAvailable) {
        window.TauriService.emit("sync-wind-angle", { angle: angleInt });
      }

      if (onAngleChange) onAngleChange(angleInt);

      draw();
    }

    // ================================================================
    // ROTATION
    // ================================================================

    function rotate(delta) {
      if (!clickPos) return;
      angle = (angle + delta + 360) % 360;
      const rad = ((angle - 90) * Math.PI) / 180;
      const dx = clickPos.x - center.x;
      const dy = clickPos.y - center.y;
      const currentRadius = Math.sqrt(dx * dx + dy * dy);
      clickPos = {
        x: center.x + currentRadius * Math.cos(rad),
        y: center.y + currentRadius * Math.sin(rad),
      };
      updateUI();
    }

    // ================================================================
    // LONGUEUR
    // ================================================================

    function changeLength(delta) {
      if (!clickPos) return;
      const dx = clickPos.x - center.x;
      const dy = clickPos.y - center.y;
      const currentRadius = Math.sqrt(dx * dx + dy * dy);
      const newRadius = Math.max(15, Math.min(120, currentRadius + delta));
      const rad = ((angle - 90) * Math.PI) / 180;
      clickPos = {
        x: center.x + newRadius * Math.cos(rad),
        y: center.y + newRadius * Math.sin(rad),
      };
      draw();
    }

    // ================================================================
    // SET ANGLE (externe) - NE PAS ÉMETTRE
    // ================================================================

    function setAngle(newAngle) {
      isUpdatingFromSync = true;

      angle = newAngle;
      updatePosition();

      const angleInt = Math.round(angle);
      const display = document.getElementById(displayId);
      if (display) display.textContent = `${angleInt}°`;
      const degreeInput = document.getElementById(degreeId);
      if (degreeInput) degreeInput.value = angleInt;

      draw();

      // NE PAS ÉMETTRE ICI (c'est une synchro externe)
      // On réinitialise le flag après un court délai
      setTimeout(() => {
        isUpdatingFromSync = false;
      }, 50);
    }

    // ================================================================
    // ÉVÉNEMENTS
    // ================================================================

    function setupEvents() {
      canvas.addEventListener("click", (e) => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        const x = (e.clientX - rect.left) * scaleX;
        const y = (e.clientY - rect.top) * scaleY;
        const dx = x - center.x;
        const dy = center.y - y;

        let a = (Math.atan2(dy, dx) * 180) / Math.PI;
        if (a < 0) a += 360;

        angle = (450 - a) % 360;
        radius = Math.sqrt(dx * dx + dy * dy);
        updatePosition();
        updateUI();
      });

      const btnMinus = document.getElementById("btn-angle-minus");
      const btnPlus = document.getElementById("btn-angle-plus");
      const btnLengthMinus = document.getElementById("btn-length-minus");
      const btnLengthPlus = document.getElementById("btn-length-plus");

      if (btnMinus) btnMinus.addEventListener("click", () => rotate(-1));
      if (btnPlus) btnPlus.addEventListener("click", () => rotate(1));
      if (btnLengthMinus)
        btnLengthMinus.addEventListener("click", () => changeLength(-1));
      if (btnLengthPlus)
        btnLengthPlus.addEventListener("click", () => changeLength(1));
    }

    // ================================================================
    // INIT
    // ================================================================

    const savedAngle = storage.get(storageKey, 0);
    angle = Number(savedAngle) || 0;
    updatePosition();

    setupEvents();
    updateUI();

    // ================================================================
    // API PUBLIQUE
    // ================================================================

    // ================================================================
    // REDIMENSIONNER LE CANVAS (externe)
    // ================================================================

    function setCanvasSize(w, h) {
      canvas.width = w;
      canvas.height = h;
      center.x = w / 2;
      center.y = h / 2;
      // Garde le rayon du pointeur (en % de la moitié) proportionnel.
      if (clickPos) {
        const rad = Math.sqrt(
          Math.pow(clickPos.x - center.x, 2) +
            Math.pow(clickPos.y - center.y, 2),
        );
        radius = Math.max(15, Math.min(120, rad));
        updatePosition();
      }
      draw();
    }

    // ================================================================
    // MODE COMPACT (externe) - bascule le dessin réduit/affiné
    // ================================================================

    function setCompact(value) {
      value = !!value;
      if (value === compact) return;
      const prevScale = dialScale;
      compact = value;
      dialScale = compact ? COMPACT_SCALE : 1;
      thin = compact;

      // Rescale le rayon du pointeur courant par le rapport des échelles
      // pour qu'il reste sur l'arc (l'angle est conservé) quand le cadran
      // rétrécit ou revient à la normale.
      if (clickPos) {
        const rad = Math.sqrt(
          Math.pow(clickPos.x - center.x, 2) +
            Math.pow(clickPos.y - center.y, 2),
        );
        radius = Math.max(15, Math.min(120, rad * (dialScale / prevScale)));
        updatePosition();
      } else {
        radius = 80 * dialScale;
      }

      draw();
    }

    return {
      draw,
      updateUI,
      rotate,
      changeLength,
      setAngle,
      setCompact,
      setCanvasSize,
      getAngle: () => angle,
      getCenter: () => center,
      getRadius: () => radius,
    };
  };
})();
