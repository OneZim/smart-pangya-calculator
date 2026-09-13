// dunk_button.js

(function () {
  "use strict";

  async function clickSpinPosition(spin, curve) {
    console.log(
      "🎯 clickSpinPosition appelée à",
      performance.now(),
      "spin:",
      spin,
      "curve:",
      curve,
    );

    const tauri = window.TauriService;
    const calibrationService = window.ResolutionCalibrationService;
    if (!tauri?.isAvailable || !calibrationService) return;

    curve = curve || 0;

    try {
      let info;
      try {
        info = await tauri.invoke("get_game_info");
      } catch (err) {
        console.warn("⚠️ Jeu non détecté — valeurs de test.", err);
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

      await tauri.invoke("move_and_click_focused", { x: clickX, y: clickY });
    } catch (err) {
      console.error("❌ Clic spin impossible :", err);
    }
  }

  function resolveOptimizeErrorMessage(result) {
    if (result.message) return result.message;
    if (result.reasonKey && typeof window.t === "function") {
      return window.t(result.reasonKey, result.reasonParams);
    }
    if (result.reason) return result.reason;
    return typeof window.t === "function"
      ? window.t("dunk_optimize_no_solution")
      : "Aucun calcul possible";
  }

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
    // Convention "jeu" (sens contraire horaire) → reconversion vers la
    // convention historique attendue par l'algorithme de simulation.
    let degree = checkValidInput(document.getElementById("degree").value);
    degree = ((360 - degree) % 360 + 360) % 360;
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

  function getSpinOptions() {
    const posOnly =
      document.getElementById("chk-spin-positive")?.checked || false;
    const negOnly =
      document.getElementById("chk-spin-negative")?.checked || false;
    return { positiveOnly: posOnly, negativeOnly: negOnly };
  }

  function showOptimizeTooltip(btn, message) {
    if (!btn) return;
    const existing = document.querySelector(".optimize-tooltip");
    if (existing) existing.remove();

    const tooltip = document.createElement("div");
    tooltip.className = "optimize-tooltip";
    tooltip.textContent = message;
    document.body.appendChild(tooltip);

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

  function applyResultToFormAndOverlay(result) {
    if (result.spin === undefined || result.curva === undefined) return;

    const spinInput = document.getElementById("spin");
    if (spinInput) {
      spinInput.value = result.spin;
      spinInput.dispatchEvent(new Event("input", { bubbles: true }));
      spinInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    const curveInput = document.getElementById("curve");
    if (curveInput) {
      curveInput.value = result.curva;
      curveInput.dispatchEvent(new Event("input", { bubbles: true }));
      curveInput.dispatchEvent(new Event("change", { bubbles: true }));
    }

    if (window.TauriService?.isAvailable) {
      window.TauriService.emit("dunk-optimize-result", {
        success: result.success,
        message: result.warning || result.message || null,
      });
    }

    if (result.warning) console.warn("⚠️", result.warning);
    console.log(
      `Spin: ${result.spin}, Courbe: ${result.curva}, Capler: ${result.capler}, Écart: ${result.ecart}`,
    );

    if (typeof calc === "function") calc();
  }

  // Clic Bouton 1 : Optimiser le Spin (avec courbe fixe ou à 0)
  function onOptimizeSpinClick() {
    const btn = document.getElementById("btn-optimize-spin");
    const input_values = buildInputValuesFromForm();
    const spinOptions = getSpinOptions();

    const result = findBestDunkSpin(input_values, { spinOptions });

    if (!result.success) {
      const message = resolveOptimizeErrorMessage(result);
      console.warn("❌ Non idéal :", message);
      showOptimizeTooltip(btn, message);
      return;
    }

    applyResultToFormAndOverlay(result);
  }

  function onClickSpinOnly() {
    const spinEl = document.getElementById("spin");
    const curveEl = document.getElementById("curve");
    if (!spinEl) return;

    const spin = checkValidInput(spinEl.value);
    const curve = curveEl ? checkValidInput(curveEl.value) : 0;

    clickSpinPosition(spin, curve);
  }

  document.addEventListener("DOMContentLoaded", function () {
    const btnSpin = document.getElementById("btn-optimize-spin");
    if (btnSpin) btnSpin.addEventListener("click", onOptimizeSpinClick);

    const clickBtn = document.getElementById("btn-click-spin");
    if (clickBtn) clickBtn.addEventListener("click", onClickSpinOnly);
  });

  window.buildInputValuesFromForm = buildInputValuesFromForm;
})();
