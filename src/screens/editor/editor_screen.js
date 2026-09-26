(function () {
  "use strict";

  let pinData = null;
  let currentCourse = null;
  let currentHole = null;
  // Clés i18n de la modal de confirmation en cours (permet le rafraîchissement
  // du libellé si l'utilisateur change de langue pendant son affichage)
  let confirmMessageKey = null;
  let confirmCount = null;
  let confirmOkKey = null;

  const tauri = window.TauriService;

  const courseSelect = document.getElementById("course-select");
  const holeSelect = document.getElementById("hole-select");
  const holeParInput = document.getElementById("hole-par");
  const pinsList = document.getElementById("pins-list");
  const btnAddCourse = document.getElementById("btn-add-course");
  const btnAddHole = document.getElementById("btn-add-hole");
  const btnAddPin = document.getElementById("btn-add-pin");
  const btnSave = document.getElementById("btn-save");
  const btnDeleteCourse = document.getElementById("btn-delete-course");
  const btnDeleteHole = document.getElementById("btn-delete-hole");
  // ================================================================
  // CHARGEMENT
  // ================================================================
  async function loadData() {
    try {
      const data = await tauri.invoke("parcours");
      pinData = data.course || data;
      populateCourses();
    } catch (err) {
      console.error("❌ Erreur chargement:", err);
      alert("Erreur lors du chargement des données");
    }
  }

  function populateCourses() {
    courseSelect.innerHTML = "";
    Object.keys(pinData).forEach((courseName) => {
      const option = document.createElement("option");
      option.value = courseName;
      option.textContent = courseName;
      courseSelect.appendChild(option);
    });

    if (Object.keys(pinData).length > 0) {
      courseSelect.value = Object.keys(pinData)[0];
      btnDeleteCourse.disabled = Object.keys(pinData).length === 0;
      onCourseChange();
    }
  }

  function onCourseChange() {
    currentCourse = courseSelect.value;
    if (!currentCourse || !pinData[currentCourse]) return;

    const holes = pinData[currentCourse].holes || {};
    holeSelect.innerHTML = "";

    // TRI NUMÉRIQUE DES TROUS (H1, H2, H3... H18)
    const holeKeys = Object.keys(holes).sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, "")) || 0;
      const numB = parseInt(b.replace(/\D/g, "")) || 0;
      return numA - numB;
    });

    holeKeys.forEach((holeName) => {
      const option = document.createElement("option");
      option.value = holeName;
      option.textContent = holeName;
      holeSelect.appendChild(option);
    });

    // ✅ DÉSACTIVER "Add Hole" si 18 trous ou plus
    const hasMaxHoles = holeKeys.length >= 18;
    btnAddHole.disabled = hasMaxHoles;
    btnAddHole.title = hasMaxHoles
      ? "Maximum 18 trous atteint"
      : "Ajouter un trou";

    if (holeKeys.length > 0) {
      holeSelect.value = holeKeys[0];
      onHoleChange();
    } else {
      resetHoleSelection();
    }
  }

  // Réinitialise le trou courant quand le cours n'a aucun trou.
  // Sans cela currentHole garde l'ancien trou et pointe sur une clé inexistante.
  function resetHoleSelection() {
    currentHole = "";
    holeSelect.value = "";
    holeParInput.value = "";
    pinsList.innerHTML = "";
    btnDeleteHole.disabled = true;
    btnAddPin.disabled = true;
  }

  function onHoleChange() {
    currentHole = holeSelect.value;
    if (!currentCourse || !currentHole) return;

    const hole = pinData[currentCourse].holes[currentHole];
    if (hole) holeParInput.value = hole.par || 4;
    renderPins();
    btnDeleteHole.disabled = !currentHole;
    btnAddPin.disabled = !currentHole;
  }

  function renderPins() {
    pinsList.innerHTML = "";
    if (!currentCourse || !currentHole) return;

    const hole = pinData[currentCourse].holes[currentHole];
    if (!hole) return;

    const pins = hole.pins || {};
    Object.keys(pins).forEach((pinKey) => {
      pinsList.appendChild(createPinRow(pinKey, pins[pinKey]));
    });
  }

  function createPinRow(pinKey, pin) {
    const row = document.createElement("div");
    row.className = "pin-row";

    const distanceInput = document.createElement("input");
    distanceInput.type = "number";
    distanceInput.step = "0.01";
    distanceInput.value = pin.pinDistance || 0;

    const heightInput = document.createElement("input");
    heightInput.type = "number";
    heightInput.step = "0.01";
    heightInput.value = pin.pinHeight || 0;

    const slopeInput = document.createElement("input");
    slopeInput.type = "number";
    slopeInput.step = "0.01";
    slopeInput.value = pin.teeSlope || 0;

    const groundInput = document.createElement("input");
    groundInput.type = "number";
    groundInput.value = pin.ground || 100;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-danger";
    deleteBtn.textContent = "×";
    deleteBtn.onclick = () => {
      delete pinData[currentCourse].holes[currentHole].pins[pinKey];
      renderPins();
    };

    row.appendChild(distanceInput);
    row.appendChild(heightInput);
    row.appendChild(slopeInput);
    row.appendChild(groundInput);
    row.appendChild(deleteBtn);
    return row;
  }

  function collectPinData() {
    const pins = {};
    pinsList.querySelectorAll(".pin-row").forEach((row) => {
      const inputs = row.querySelectorAll("input");
      const distance = parseFloat(inputs[0].value) || 0;
      const key = `${distance.toFixed(2)}y`;
      pins[key] = {
        pinDistance: distance,
        pinHeight: parseFloat(inputs[1].value) || 0,
        teeSlope: parseFloat(inputs[2].value) || 0,
        ground: parseFloat(inputs[3].value) || 100,
      };
    });
    return pins;
  }

  // ================================================================
  // ÉVÉNEMENTS
  // ================================================================
  courseSelect.addEventListener("change", onCourseChange);
  holeSelect.addEventListener("change", onHoleChange);

  btnAddCourse.addEventListener("click", () => {
    // === MODAL CUSTOM au lieu de prompt() ===
    showCourseModal((name) => {
      if (!name) return; // Annulé

      // Vérifie si le parcours existe déjà
      if (pinData[name]) {
        alert(`⚠️ Le parcours "${name}" existe déjà !`);
        return;
      }

      // Crée le parcours
      pinData[name] = {
        name: name,
        short: name.substring(0, 2).toUpperCase(),
        holes: {},
      };

      // Rafraîchit l'UI
      populateCourses();
      courseSelect.value = name;
      onCourseChange();
    });
  });

  btnAddHole.addEventListener("click", () => {
    if (!currentCourse) return;

    // === MODAL CUSTOM au lieu de prompt() ===
    showHoleModal((name) => {
      if (!name) return; // Annulé

      // Normalise : ajoute "H" si manquant
      const normalized = name.toUpperCase().startsWith("H")
        ? name.toUpperCase()
        : "H" + name.toUpperCase();

      // Vérifie si le trou existe déjà
      if (pinData[currentCourse].holes[normalized]) {
        alert(`⚠️ Le trou ${normalized} existe déjà !`);
        return;
      }

      // Crée le trou
      pinData[currentCourse].holes[normalized] = {
        par: parseInt(holeParInput.value) || 4,
        name: normalized,
        pins: {},
      };

      // Rafraîchit l'UI
      onCourseChange();
      holeSelect.value = normalized;
      onHoleChange();
    });
  });

  btnAddPin.addEventListener("click", () => {
    if (!currentCourse || !currentHole) return;
    const hole = pinData[currentCourse].holes[currentHole];
    if (!hole.pins) hole.pins = {};
    hole.pins["0.00y"] = {
      pinDistance: 0,
      pinHeight: 0,
      teeSlope: 0,
      ground: 100,
    };
    renderPins();
  });

  btnSave.addEventListener("click", async () => {
    try {
      const emptyCourses = Object.entries(pinData)
        .filter(([, course]) => Object.keys(course?.holes ?? {}).length === 0)
        .map(([name]) => name);
      if (emptyCourses.length > 0) {
        alert(
          "⚠️ Sauvegarde impossible : le parcours \"" +
            emptyCourses.join("\" , \"") +
            "\" n'a aucun trou.\nAjoute au moins un trou ou supprime le parcours.",
        );
        return;
      }

      if (currentCourse && currentHole) {
        const hole = pinData[currentCourse]?.holes?.[currentHole];
        if (hole) {
          hole.par = parseInt(holeParInput.value) || 4;
          hole.pins = collectPinData();
        }
      }

      await tauri.invoke("save_pin_location", { data: { course: pinData } });
      alert("✅ Données sauvegardées !");
    } catch (err) {
      console.error("❌ Erreur sauvegarde:", err);
      // AppError sérialise en texte : le refus de validation Rust
      // (structure invalide) est donc directement lisible ici.
      alert("❌ " + (err || "Erreur lors de la sauvegarde"));
    }
  });

  // ================================================================
  // LISTENER POUR OUVERTURE/FERMETURE (comme settings_screen)
  // ================================================================
  if (tauri && tauri.isAvailable) {
    tauri.listen("toggle-editor-visibility", async (event) => {
      const show = event.payload?.show;
      const win = await tauri.getCurrentWindow();
      if (!win) return;
      if (show === true) {
        await win.show();
        await win.setFocus();
        // Recharger les données à chaque ouverture
        await loadData();
      } else if (show === false) {
        await win.hide();
      }
    });
  }
  // ================================================================
  // MODAL CUSTOM POUR AJOUTER UN PARCOURS
  // ================================================================
  function showCourseModal(callback) {
    const modal = document.getElementById("course-modal");
    const input = document.getElementById("course-modal-input");
    const btnOk = document.getElementById("course-modal-ok");
    const btnCancel = document.getElementById("course-modal-cancel");

    input.value = "";
    modal.hidden = false;
    input.focus();

    function close(value) {
      modal.hidden = true;
      btnOk.onclick = null;
      btnCancel.onclick = null;
      input.onkeydown = null;
      callback(value ? value.trim() : null);
    }

    btnOk.onclick = () => close(input.value);
    btnCancel.onclick = () => close(null);
    input.onkeydown = (e) => {
      if (e.key === "Enter") close(input.value);
      if (e.key === "Escape") close(null);
    };
  }

  // ================================================================
  // MODAL CUSTOM POUR AJOUTER UN TROU (remplace le prompt() natif)
  // ================================================================
  function showHoleModal(callback) {
    const modal = document.getElementById("hole-modal");
    const input = document.getElementById("hole-modal-input");
    const btnOk = document.getElementById("hole-modal-ok");
    const btnCancel = document.getElementById("hole-modal-cancel");

    input.value = "";
    modal.hidden = false;
    input.focus();

    function close(value) {
      modal.hidden = true;
      btnOk.onclick = null;
      btnCancel.onclick = null;
      input.onkeydown = null;
      callback(value ? value.trim() : null);
    }

    btnOk.onclick = () => close(input.value);
    btnCancel.onclick = () => close(null);
    input.onkeydown = (e) => {
      if (e.key === "Enter") close(input.value);
      if (e.key === "Escape") close(null);
    };
  }

  // ================================================================
  // SUPPRESSION PARCOURS
  // ================================================================
  btnDeleteCourse.addEventListener("click", () => {
    if (!currentCourse) return;

    showConfirm("editor_confirm_delete_course", null, "btn_delete_course", () => {
      delete pinData[currentCourse];
      populateCourses();
      if (Object.keys(pinData).length > 0) {
        courseSelect.value = Object.keys(pinData)[0];
        onCourseChange();
      } else {
        pinsList.innerHTML = "";
      }
    });
  });

  // ================================================================
  // SUPPRESSION TROU
  // ================================================================
  btnDeleteHole.addEventListener("click", () => {
    if (!currentCourse || !currentHole) return;

    const holeData = pinData[currentCourse].holes[currentHole];
    const pinCount = Object.keys(holeData.pins || {}).length;

    showConfirm("editor_confirm_delete_hole", pinCount, "btn_delete_hole", () => {
      delete pinData[currentCourse].holes[currentHole];
      onCourseChange();
      if (Object.keys(pinData[currentCourse].holes).length > 0) {
        holeSelect.value = Object.keys(pinData[currentCourse].holes)[0];
        onHoleChange();
      } else {
        resetHoleSelection();
      }
    });
  });
  document.addEventListener("DOMContentLoaded", loadData);
  // ================================================================
  // MODAL CUSTOM DE CONFIRMATION (Remplace confirm() natif)
  // ================================================================
  // messageKey : clé i18n du message
  // count      : valeur remplaçant {count} dans le message (ou null)
  // okKey      : clé i18n du libellé du bouton de confirmation
  function translateConfirm() {
    const msgEl = document.getElementById("confirm-modal-message");
    const btnOk = document.getElementById("confirm-modal-ok");
    let message = window.t(confirmMessageKey);
    if (confirmCount !== null) message = message.replace("{count}", confirmCount);
    msgEl.textContent = message;
    btnOk.textContent = window.t(confirmOkKey);
  }

  function showConfirm(messageKey, count, okKey, onConfirm) {
    const modal = document.getElementById("confirm-modal");
    const btnOk = document.getElementById("confirm-modal-ok");
    const btnCancel = document.getElementById("confirm-modal-cancel");

    confirmMessageKey = messageKey;
    confirmCount = count;
    confirmOkKey = okKey;

    translateConfirm();
    modal.hidden = false;

    function close(confirmed) {
      modal.hidden = true;
      btnOk.onclick = null;
      btnCancel.onclick = null;
      if (confirmed) onConfirm();
    }

    btnOk.onclick = () => close(true);
    btnCancel.onclick = () => close(false);
  }

  // Changement de langue pendant l'affichage de la modal : retraduire
  document.addEventListener("i18n-loaded", () => {
    const modal = document.getElementById("confirm-modal");
    if (modal && !modal.hidden && confirmMessageKey) translateConfirm();
  });
})();
