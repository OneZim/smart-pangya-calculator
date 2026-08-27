// core/components/CourseSelector.js
(function () {
  "use strict";

  window.CourseSelector = function (
    container,
    store,
    tauriService,
    options = {},
  ) {
    // === RÉCUPÉRER LES SÉLECTEURS EXISTANTS ===
    const map = container.querySelector("#select-parcours");
    const hole = container.querySelector("#select-trou");
    const pin = container.querySelector("#select-pin");

    // ================================================================
    // METTRE À JOUR LES OPTIONS D'UN SELECT
    // ================================================================

    function updateSelectOptions(select, options, selectedValue) {
      if (!select) return;

      const placeholders = {
        "select-parcours": "🗺️ Map",
        "select-trou": "⛳ Hole",
        "select-pin": "📍 Pin",
      };

      const placeholder = placeholders[select.id] || "-- Option --";

      const currentOptions = Array.from(select.options)
        .slice(1)
        .map((o) => o.value);
      const newOptions = options.map((o) => o.value);

      if (
        JSON.stringify(currentOptions) !== JSON.stringify(newOptions) ||
        selectedValue !== select.value
      ) {
        select.innerHTML = `<option value="">${placeholder}</option>`;
        options.forEach((opt) => {
          const option = document.createElement("option");
          option.value = opt.value;
          option.textContent = opt.label;
          if (opt.value === selectedValue) option.selected = true;
          select.appendChild(option);
        });
      }

      if (selectedValue) {
        select.value = selectedValue;
      }
    }

    // ================================================================
    // APPLIQUER LES DONNÉES DU PIN AUX CHAMPS
    // ================================================================

    function applyPinData() {
      const pinData = store.getSelectedPin();
      if (!pinData) return;

      const distanceInput = document.getElementById("distance");
      const heightInput = document.getElementById("height");
      const groundInput = document.getElementById("ground");
      const slopeBreakInput = document.getElementById("slope_break");
      const curveInput = document.getElementById("curve");

      if (distanceInput) {
        distanceInput.value = pinData.distance || pinData.pinDistance || "";
        distanceInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (heightInput) {
        heightInput.value = pinData.height || pinData.pinHeight || "";
        heightInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (groundInput) {
        const ground = pinData.ground !== undefined ? pinData.ground : 100;
        groundInput.value = ground;
        groundInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      // === SLOPE_BREAK reçoit teeSlope ===
      if (slopeBreakInput) {
        const slope = pinData.teeSlope !== undefined ? pinData.teeSlope : 0;
        slopeBreakInput.value = slope;
        slopeBreakInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (curveInput) {
        const curve = pinData.curve !== undefined ? pinData.curve : 0;
        curveInput.value = curve;
        curveInput.dispatchEvent(new Event("input", { bubbles: true }));
      }
      if (typeof window.triggerCalc === "function") {
        window.triggerCalc();
      }
    }

    // ================================================================
    // METTRE À JOUR L'UI
    // ================================================================

    function updateUI(state) {
      const {
        map: selectedMap,
        hole: selectedHole,
        pin: selectedPin,
      } = state.selected;

      if (map) {
        map.disabled = false;
        updateSelectOptions(map, state.mapOptions, selectedMap);
      }

      if (hole) {
        hole.disabled = !state.selectedCourse;
        updateSelectOptions(hole, state.holeOptions, selectedHole);
      }

      if (pin) {
        pin.disabled = !state.selectedHole;
        updateSelectOptions(pin, state.pinOptions, selectedPin);
      }

      if (selectedPin && state.selectedPin) {
        applyPinData();
      }
    }

    // ================================================================
    // ÉVÉNEMENTS
    // ================================================================

    map?.addEventListener("change", (e) => {
      if (map.disabled) return;
      const value = e.target.value;
      store.selectMap(value);
      if (options.onChange) options.onChange("map", value);
    });

    hole?.addEventListener("change", (e) => {
      if (hole.disabled) return;
      const value = e.target.value;
      store.selectHole(value);
      if (options.onChange) options.onChange("hole", value);
    });

    pin?.addEventListener("change", (e) => {
      if (pin.disabled) return;
      const value = e.target.value;
      store.selectPin(value);
      if (options.onChange) options.onChange("pin", value);
      applyPinData();
    });

    // ================================================================
    // SUBSCRIPTION AU STORE
    // ================================================================

    store.subscribe((state) => {
      updateUI(state);
    });

    // ================================================================
    // PREMIER UPDATE
    // ================================================================

    updateUI(store.getState());

    // ================================================================
    // RETOURNER L'INSTANCE
    // ================================================================

    return {
      updateUI,
      applyPinData,
      elements: { map, hole, pin },
    };
  };
})();
