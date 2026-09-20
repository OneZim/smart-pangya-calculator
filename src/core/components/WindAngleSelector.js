// core/components/WindAngleSelector.js
//
// Sélecteur d'angle dédié à la carte "Calcul du vent" de la fenêtre
// principale (canvas 360×360 superposé à la capture zoomée du jeu).
//
// Différences avec core/components/AngleSelector.js (partagé par
// wind_overlay, canvas 206, mode compact) :
//   - Aucune croix dessinée sur le canvas : le repère central est fourni
//     par l'élément CSS `.wind-crosshair` posé au-dessus de l'image.
//   - Toutes les tailles (rayon, longueur, épaisseurs) sont proportionnelles
//     à la taille réelle du canvas (référence historique : 300px), pour
//     garder les mêmes proportions visuelles quelle que soit la taille de
//     la boîte (actuellement 360px).

(function () {
  "use strict";

  window.WindAngleSelector = function (options = {}) {
    // === STORAGE ===
    const storage = options.storage || window.StorageService;

    // === PARAMÈTRES ===
    const canvasId = options.canvasId || "angle-canvas";
    const displayId = options.displayId || "angle-display";
    const degreeId = options.degreeId || "degree";
    const syncEnabled =
      options.syncEnabled !== undefined ? options.syncEnabled : true;
    const storageKey = options.storageKey || "wind_angle";
    const onAngleChange = options.onAngleChange || null;

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

    // === ÉCHELLE PROPORTIONNELLE ===
    // Référence historique : 300px (toutes les tailles ci-dessous ont été
    // calibrées à l'œil sur un canvas 300×300). On les multiplie par le
    // rapport taille_réelle / 300 pour garder les mêmes proportions.
    const BASE_SIZE = 300;
    let scale = canvas.width / BASE_SIZE;

    const DEFAULT_RADIUS = 115;

    let radius = DEFAULT_RADIUS * scale;
    let clickPos = null;
    let angle = 0;
    let isUpdatingFromSync = false;

    // === VISÉE À 2 CLICS (sur la base/queue de la flèche du jeu) ===
    // L'utilisateur clique 2 points sur la base de la flèche (jamais la
    // pointe). La direction = perpendiculaire à cette base, orientée vers
    // l'extérieur du centre (résout l'ordre indifférent des 2 clics).
    let markers = [];

    // Rayon max (px, fixe) autorisé pour un clic de repère — au-delà,
    // le clic est ignoré (évite de prendre en compte un clic en bord
    // de fenêtre, hors de la zone utile de l'image).
    const MAX_CLICK_RADIUS = 150;

    // ================================================================
    // DESSINER (uniquement la flèche — la croix est gérée en CSS)
    // ================================================================

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const s = scale;

      // Repère principal : trait du centre vers la pointe calculée
      // (perpendiculaire à la base, à 90°). Dessiné en premier pour
      // rester sous les marqueurs de la base.
      if (clickPos) {
        ctx.strokeStyle = "#ff4444";
        ctx.lineWidth = 1 * s;
        ctx.beginPath();
        ctx.moveTo(center.x, center.y);
        ctx.lineTo(clickPos.x, clickPos.y);
        ctx.stroke();
      }

      // Marqueurs des clics de base (dessinés en dernier pour rester
      // visibles au-dessus du repère principal ; effacés à la
      // prochaine paire de clics)
      if (markers.length) {
        if (markers.length === 2) {
          ctx.strokeStyle = "#ffdd55";
          ctx.lineWidth = 1 * s;
          ctx.beginPath();
          ctx.moveTo(markers[0].x, markers[0].y);
          ctx.lineTo(markers[1].x, markers[1].y);
          ctx.stroke();
        }

        ctx.fillStyle = "#ffdd55";
        ctx.strokeStyle = "#000";
        ctx.lineWidth = 1;
        markers.forEach((m) => {
          ctx.beginPath();
          ctx.arc(m.x, m.y, 2.5 * s, 0, 2 * Math.PI);
          ctx.fill();
          ctx.stroke();
        });
      }
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
    // VISÉE À 2 CLICS : calcule l'angle depuis 2 points de la base
    // ================================================================

    function finalizePair(p1, p2) {
      const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };

      // Vecteur de la base + 2 perpendiculaires possibles
      const vx = p2.x - p1.x;
      const vy = p2.y - p1.y;
      let perpX = -vy;
      let perpY = vx;

      // On choisit la perpendiculaire qui pointe vers l'extérieur
      // (loin du centre) par rapport au milieu de la base.
      const outX = mid.x - center.x;
      const outY = mid.y - center.y;
      if (perpX * outX + perpY * outY < 0) {
        perpX = -perpX;
        perpY = -perpY;
      }

      // Conversion en angle (même convention que le clic simple :
      // Y inversé, puis repère 0-360° maison).
      let a = (Math.atan2(-perpY, perpX) * 180) / Math.PI;
      if (a < 0) a += 360;
      angle = (450 - a) % 360;

      // Longueur fixe (indépendante de l'écart entre les 2 clics) —
      // ajustable ensuite via les boutons +/- longueur.
      radius = DEFAULT_RADIUS * scale;

      updatePosition();
      updateUI();
    }

    // ================================================================
    // UI (avec protection anti-boucle)
    // ================================================================

    function updateUI() {
      if (isUpdatingFromSync) {
        return;
      }

      // `angle` (interne) pilote uniquement le dessin (clickPos/trait
      // rouge) et ne change pas. La valeur AFFICHÉE/synchronisée
      // (utilisée aussi par le champ #degree et le moteur de calcul) est
      // le miroir de l'interne, pour corriger la convention 0-360°.
      const displayAngle = (360 - angle) % 360;
      const angleRounded = Math.round(displayAngle * 10) / 10;

      const display = document.getElementById(displayId);
      if (display) display.textContent = `${angleRounded.toFixed(1)}°`;

      const degreeInput = document.getElementById(degreeId);
      if (degreeInput) degreeInput.value = angleRounded;

      if (syncEnabled && window.TauriService?.isAvailable) {
        window.TauriService.emit("sync-wind-angle", { angle: angleRounded });
      }

      if (onAngleChange) onAngleChange(angleRounded);

      draw();
    }

    // ================================================================
    // ROTATION
    // ================================================================

    // Fait pivoter un point autour du centre du canvas de deltaDeg
    // degrés (même convention/sens que la rotation de clickPos).
    function rotatePointAroundCenter(p, deltaDeg) {
      const rad = (deltaDeg * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      return {
        x: center.x + dx * cos - dy * sin,
        y: center.y + dx * sin + dy * cos,
      };
    }

    function rotate(delta) {
      if (!clickPos) return;
      // `delta` = variation souhaitée de l'angle AFFICHÉ (celui des
      // boutons +/-). Comme l'angle interne est le miroir de l'affiché
      // (voir updateUI), on soustrait delta en interne pour que
      // l'affiché augmente bien de +delta.
      angle = (angle - delta + 360) % 360;
      const rad = ((angle - 90) * Math.PI) / 180;
      const dx = clickPos.x - center.x;
      const dy = clickPos.y - center.y;
      const currentRadius = Math.sqrt(dx * dx + dy * dy);
      clickPos = {
        x: center.x + currentRadius * Math.cos(rad),
        y: center.y + currentRadius * Math.sin(rad),
      };

      // Le repère jaune (base à 2 clics) suit la même rotation visuelle
      // que le trait rouge (donc le même signe interne, -delta).
      if (markers.length === 2) {
        markers = markers.map((m) => rotatePointAroundCenter(m, -delta));
      }

      updateUI();
    }

    // ================================================================
    // SET ANGLE (externe) - NE PAS ÉMETTRE
    // ================================================================

    function setAngle(newAngle) {
      // newAngle arrive en convention AFFICHÉE (externe/sync). On la
      // compare à l'équivalent affiché de l'angle interne courant pour
      // détecter un écho de notre propre émission (même valeur à 0.1°
      // près) — évite d'effacer les marqueurs qui viennent d'être posés.
      const currentDisplay = (360 - angle) % 360;
      if (Math.round(newAngle * 10) === Math.round(currentDisplay * 10)) {
        return;
      }

      isUpdatingFromSync = true;

      // Fin-ajustage (décalage dans les ±0.5° voire 1°) : on fait pivoter
      // les marqueurs de base avec la flèche au lieu de les effacer, pour
      // préserver la visée lors des allers-retours inter-fenêtres.
      const delta = (((newAngle - currentDisplay) % 360) + 360) % 360;
      const normalizedDelta = delta > 180 ? delta - 360 : delta;

      if (markers.length === 2 && Math.abs(normalizedDelta) <= 1) {
        markers = markers.map((m) =>
          rotatePointAroundCenter(m, -normalizedDelta),
        );
      } else {
        markers = [];
      }
      // Conversion affiché → interne (miroir), pour piloter le dessin.
      angle = (360 - newAngle + 360) % 360;
      updatePosition();

      const angleRounded = Math.round(newAngle * 10) / 10;
      const display = document.getElementById(displayId);
      if (display) display.textContent = `${angleRounded.toFixed(1)}°`;
      const degreeInput = document.getElementById(degreeId);
      if (degreeInput) degreeInput.value = angleRounded;

      draw();

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

        // Clic hors de la zone utile (trop proche du bord) : ignoré
        const dxc = x - center.x;
        const dyc = y - center.y;
        if (Math.sqrt(dxc * dxc + dyc * dyc) > MAX_CLICK_RADIUS) {
          return;
        }

        // Une nouvelle paire de clics écrase la précédente
        if (markers.length >= 2) markers = [];

        markers.push({ x, y });

        if (markers.length === 2) {
          finalizePair(markers[0], markers[1]);
        } else {
          draw();
        }
      });

      canvas.addEventListener("contextmenu", () => {
        markers = [];
        draw();
      });

      const btnMinus = document.getElementById("btn-angle-minus");
      const btnPlus = document.getElementById("btn-angle-plus");

      if (btnMinus) btnMinus.addEventListener("click", () => rotate(-0.5));
      if (btnPlus) btnPlus.addEventListener("click", () => rotate(0.5));
    }

    // ================================================================
    // INIT
    // ================================================================

    // L'angle du vent change à chaque coup : pas de persistance disque,
    // on part toujours de 0 au démarrage.
    angle = 0;
    updatePosition();

    setupEvents();
    updateUI();

    // ================================================================
    // REDIMENSIONNER LE CANVAS (externe)
    // ================================================================

    function setCanvasSize(w, h) {
      canvas.width = w;
      canvas.height = h;
      center.x = w / 2;
      center.y = h / 2;
      scale = canvas.width / BASE_SIZE;
      // Longueur toujours fixe désormais (plus d'ajustement manuel).
      radius = DEFAULT_RADIUS * scale;
      if (clickPos) updatePosition();
      draw();
    }

    // ================================================================
    // API PUBLIQUE
    // ================================================================

    return {
      draw,
      updateUI,
      rotate,
      setAngle,
      setCanvasSize,
      getAngle: () => angle,
      getCenter: () => center,
      getRadius: () => radius,
    };
  };
})();
