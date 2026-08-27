// dunk_button.js

(function () {
  "use strict";

  // Position et sensibilité viennent de la table de calibration par
  // résolution (ResolutionCalibrationService) — plus aucune constante
  // dupliquée ni valeur sauvegardée dépendante de la machine.
  async function clickSpinPosition(spin, curve) {
    const tauri = window.TauriService;
    const calibrationService = window.ResolutionCalibrationService;
    if (!tauri?.isAvailable || !calibrationService) return;

    curve = curve || 0;

    try {
      let info;
      try {
        info = await tauri.invoke("get_game_info");
      } catch (err) {
        console.warn(
          "⚠️ Jeu non détecté — utilisation de valeurs de test fixes.",
          err,
        );
        info = { width: 1920, height: 1080, scale_factor: 1 };
      }

      const calibration = calibrationService.getCalibration(
        info.width,
        info.height,
      );

      let origin;
      try {
        origin = await tauri.invoke("get_game_client_rect_on_screen");
      } catch (err) {
        console.warn(
          "⚠️ Fenêtre jeu introuvable — clic de test centré à l'écran.",
          err,
        );
        // Simule une "fenêtre" de la taille de l'écran, centrée dessus,
        // uniquement pour tester le mécanisme de clic (move_and_click_focused).
        const screenWidth = window.screen.width;
        const screenHeight = window.screen.height;
        origin = {
          x: (screenWidth - info.width) / 2,
          y: (screenHeight - info.height) / 2,
          width: info.width,
          height: info.height,
        };
      }

      const scale = info.scale_factor || 1;
      const ppu = calibration.pxParUniteSpin;

      const centerX = origin.x + origin.width / 2;
      const centerY = origin.y + origin.height / 2;

      const clickX = Math.round(
        centerX +
          (calibration.spinDialCenter.x - origin.width / 2 - curve * ppu) *
            scale,
      );
      const clickY = Math.round(
        centerY +
          (calibration.spinDialCenter.y - origin.height / 2 + spin * ppu) *
            scale,
      );

      console.log(
        `🎯 Clic spin — jeu ${info.width}x${info.height} · client ${origin.width}x${origin.height} · origine écran (${origin.x},${origin.y}) · centre (${calibration.spinDialCenter.x},${calibration.spinDialCenter.y}) · ppu ${ppu} · scale ${scale}${calibration._source ? " · " + calibration._source : ""} → pixel (${clickX},${clickY})`,
      );

      await tauri.invoke("move_and_click_focused", { x: clickX, y: clickY });
    } catch (err) {
      console.error("❌ Clic spin impossible :", err);
    }
  }
  function constrainSpinToCurve(spin, curve, maxSpin, maxCurve) {
    if (!maxSpin || !maxCurve) return spin;

    const curveRatio = curve / maxCurve;
    if (Math.abs(curveRatio) >= 1) return 0;

    const maxSpinAllowed = maxSpin * Math.sqrt(1 - curveRatio * curveRatio);
    const result = Math.min(spin, maxSpinAllowed);

    // Arrondit au 0.5 le plus proche pour rester cohérent avec le reste
    // du système (generateSpinRange, spin_overlay, etc.), et ne jamais
    // dépasser la limite réelle (arrondi vers le bas si nécessaire).
    return Math.floor(result * 2) / 2;
  }
  function onClickSpinOnly() {
    const spinEl = document.getElementById("spin");
    const curveEl = document.getElementById("curve");

    if (!spinEl) return;

    const spin = checkValidInput(spinEl.value);
    const curve = curveEl ? checkValidInput(curveEl.value) : 0;

    clickSpinPosition(spin, curve);
  }
  function resolveOptimizeErrorMessage(dunkResult) {
    if (dunkResult.reasonKey && typeof window.t === "function") {
      return window.t(dunkResult.reasonKey, dunkResult.reasonParams);
    }
    if (dunkResult.reason) return dunkResult.reason;

    if (dunkResult.warningKey && typeof window.t === "function") {
      return window.t(dunkResult.warningKey, dunkResult.warningParams);
    }
    if (dunkResult.warning) return dunkResult.warning;

    return typeof window.t === "function"
      ? window.t("dunk_optimize_no_solution")
      : "Aucun calcul possible";
  }
  // Reconstruit exactement les mêmes input_values que calc(), à partir
  // du DOM actuel. Dupliqué depuis calc() pour ne pas devoir le modifier.
  function buildInputValuesFromForm() {
    let power = checkValidInput(document.getElementById("power").value);
    let auxpart_pwr = checkValidInput(
      document.getElementById("auxpart_pwr").value,
    );
    let card_pwr = checkValidInput(document.getElementById("card_pwr").value);
    let mascot_pwr = checkValidInput(
      document.getElementById("mascot_pwr").value,
    );
    let card_ps_pwr = checkValidInput(
      document.getElementById("card_ps_pwr").value,
    );

    let clubEl = document.getElementById("club");
    let club =
      CLUB_INFO[CLUB_INFO_ENUM[clubEl.options[clubEl.selectedIndex].value]];

    let shotEl = document.getElementById("shot");
    let shot =
      SHOT_TYPE[SHOT_TYPE_ENUM[shotEl.options[shotEl.selectedIndex].value]];

    let powerShotEl = document.getElementById("power_shot");
    let power_shot =
      POWER_SHOT_FACTORY[
        POWER_SHOT_FACTORY_ENUM[
          powerShotEl.options[powerShotEl.selectedIndex].value
        ]
      ];

    let distance = checkValidInput(document.getElementById("distance").value);
    let height = checkValidInput(document.getElementById("height").value);
    let wind = checkValidInput(document.getElementById("wind").value);
    let degree = checkValidInput(document.getElementById("degree").value);
    let ground = checkValidInput(document.getElementById("ground").value);
    let curve = checkValidInput(document.getElementById("curve").value);
    let slope_break = checkValidInputSlope(
      document.getElementById("slope_break").value,
    );

    if (ground == 0.0) ground = 100.0;

    return {
      power_player: {
        pwr: power,
        options: {
          auxpart: auxpart_pwr,
          mascot: mascot_pwr,
          card: card_pwr,
          ps_auxpart: 0,
          ps_mascot: 0,
          ps_card: card_ps_pwr,
          total: function (option) {
            let pwr = this.auxpart + this.mascot + this.card;
            if (option == 1 || option == 2 || option == 3)
              pwr += this.ps_auxpart + this.ps_mascot + this.ps_card;
            return pwr;
          },
        },
      },
      club_info: club,
      shot: shot,
      power_shot: power_shot,
      distance: distance,
      height: height,
      wind: wind,
      degree: degree,
      ground: ground,
      curva: curve,
      slope: slope_break,
    };
  }

  function isDunkSelected() {
    const shotEl = document.getElementById("shot");
    if (!shotEl) return false;
    const value = shotEl.options[shotEl.selectedIndex].value;
    return SHOT_TYPE[SHOT_TYPE_ENUM[value]] === SHOT_TYPE.DUNK;
  }

  // Retourne le type de shot courant ("dunk", "tomahawk", "spike", ou null
  // si non applicable/Cobra), pour savoir quelle fonction d'optimisation
  // utiliser et si le bouton doit être actif.
  function getOptimizableShotType() {
    const shotEl = document.getElementById("shot");
    if (!shotEl) return null;
    const value = shotEl.options[shotEl.selectedIndex].value;
    const type = SHOT_TYPE[SHOT_TYPE_ENUM[value]];
    if (type === SHOT_TYPE.DUNK) return "dunk";
    if (type === SHOT_TYPE.TOMAHAWK) return "tomahawk";
    if (type === SHOT_TYPE.SPIKE) return "spike";
    return null; // Cobra non géré
  }

  function updateOptimizeButtonState() {
    const btn = document.getElementById("btn-optimize-dunk");
    if (!btn) return;
    btn.disabled = getOptimizableShotType() === null;
  }
  function showOptimizeTooltip(btn, message) {
    if (!btn) return;

    // Retire une éventuelle bulle précédente encore affichée
    const existing = document.querySelector(".optimize-tooltip");
    if (existing) existing.remove();

    const tooltip = document.createElement("div");
    tooltip.className = "optimize-tooltip";
    tooltip.textContent = message;
    document.body.appendChild(tooltip);

    // Positionnement calculé après ajout au DOM (pour connaître sa largeur réelle)
    const btnRect = btn.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();

    const left = btnRect.left + btnRect.width / 2 - tooltipRect.width / 2;
    const top = btnRect.top - tooltipRect.height - 8;

    tooltip.style.left = Math.max(4, left) + "px";
    tooltip.style.top = Math.max(4, top) + "px";

    clearTimeout(btn._tooltipTimeout);
    btn._tooltipTimeout = setTimeout(() => {
      tooltip.remove();
    }, 3000);
  }
  function onOptimizeClick() {
    const btn = document.getElementById("btn-optimize-dunk");
    const shotType = getOptimizableShotType();
    if (!shotType) return;

    const input_values = buildInputValuesFromForm();
    const dunkResult =
      shotType === "dunk"
        ? findBestDunkSpin(input_values)
        : findBestTomahawkSpikeSpin(input_values);

    console.log("=== SPIN OPTIMIZER (" + shotType + ", bouton) ===");
    if (!dunkResult.success) {
      const message = resolveOptimizeErrorMessage(dunkResult);
      console.warn("❌ Non idéal :", message);
      showOptimizeTooltip(btn, message);
    }

    if (window.TauriService?.isAvailable) {
      window.TauriService.emit("dunk-optimize-result", {
        success: dunkResult.success,
        message: dunkResult.success
          ? null
          : resolveOptimizeErrorMessage(dunkResult),
      });
    }

    if (dunkResult.spin === undefined) return; // rien d'exploitable

    // === Contrainte elliptique spin/curve (selon stats du perso équipé) ===
    const curveEl = document.getElementById("curve");
    const currentCurve = curveEl ? checkValidInput(curveEl.value) : 0;

    const maxSpinEl = document.getElementById("card_max_spin");
    const maxCurveEl = document.getElementById("card_max_curve");
    const maxSpin = maxSpinEl ? checkValidInput(maxSpinEl.value) : 30;
    const maxCurve = maxCurveEl ? checkValidInput(maxCurveEl.value) : 30;

    const constrainedSpin = constrainSpinToCurve(
      dunkResult.spin,
      currentCurve,
      maxSpin,
      maxCurve,
    );

    const spinInput = document.getElementById("spin");
    if (spinInput) {
      spinInput.value = constrainedSpin;
      // Déclenche les listeners existants (sync Tauri, recalcul, etc.)
      spinInput.dispatchEvent(new Event("input", { bubbles: true }));
      spinInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (dunkResult.warning) console.warn("⚠️", dunkResult.warning);
    console.log(
      "Spin:",
      dunkResult.spin,
      "Capler cible:",
      dunkResult.capler,
      "Distance réelle:",
      dunkResult.distanceYards,
      "Écart:",
      dunkResult.ecart,
    );

    // Relance le calcul principal pour rafraîchir l'affichage/la règle
    if (typeof calc === "function") calc();
  }

  document.addEventListener("DOMContentLoaded", function () {
    const shotEl = document.getElementById("shot");
    if (shotEl) {
      shotEl.addEventListener("change", updateOptimizeButtonState);
    }
    updateOptimizeButtonState(); // état initial

    const btn = document.getElementById("btn-optimize-dunk");
    if (btn) {
      btn.addEventListener("click", onOptimizeClick);
    }
    const clickBtn = document.getElementById("btn-click-spin");
    if (clickBtn) {
      clickBtn.addEventListener("click", onClickSpinOnly);
    }
  });

  // Exposé pour dunk_request_listener.js (appelé depuis calc_overlay via Tauri event)
  window.buildInputValuesFromForm = buildInputValuesFromForm;
})();
