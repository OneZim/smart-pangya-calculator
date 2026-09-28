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
      alert(window.t("editor_error_load"));
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
    // Écrire le trou affiché avant de quitter le parcours.
    commitCurrentHole();

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
      ? window.t("editor_holes_max")
      : window.t("map_add_hole");

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

  // ================================================================
  // ÉCRITURE : LE FORMULAIRE EST LA SOURCE VÉRITÉ DU TROU AFFICHÉ
  // ================================================================
  //
  // Le modèle stocke des pins à clés ordinales ("1", "2", "3") triés par
  // distance. L'identité d'un pin est `pinDistance` : la clé n'est qu'un rang
  // technique, ce qui permet de réordonner ou renuméroter les pins sans
  // perdre la correspondance avec les distances réellement saisies.
  //
  // Toute action qui quitte le trou affiché (changement de parcours, de
  // trou, ajout ou suppression d'un pin, sauvegarde) doit d'abord rappeler
  // commitCurrentHole() : sans cela les modifications visibles à l'écran
  // seraient perdues sans aucun avertissement.

  /** Nombre à 2 décimales, 0 si la saisie est vide ou illisible. */
  function round2(value) {
    const n = Number(value);
    return Number.isFinite(n) ? Number(n.toFixed(2)) : 0;
  }

  /**
   * Distance servant à comparer deux pins.
   *
   * 2 décimales : c'est la précision historiquement affichée dans l'éditeur et
   * celle des clés de l'ancien modèle. Deux pins séparés de 0,005 yard sont
   * un doublon du point de vue de l'utilisateur, donc ici aussi.
   */
  function distanceKey(value) {
    return Number(round2(value)).toFixed(2);
  }

  /** Pins d'un trou, dans l'ordre d'affichage (distance croissante). */
  function readPinEntries(hole) {
    return Object.values(hole?.pins || {})
      .map((pin) => ({
        pinDistance: round2(pin.pinDistance),
        pinHeight: round2(pin.pinHeight),
        teeSlope: round2(pin.teeSlope),
        ground: Number.isFinite(Number(pin.ground)) ? Number(pin.ground) : 100,
      }))
      .sort((a, b) => a.pinDistance - b.pinDistance);
  }

  /** Construit l'objet `pins` à clés ordinales contiguës 1..N. */
  function toOrdinalPins(entries) {
    const pins = {};
    entries
      .slice()
      .sort((a, b) => a.pinDistance - b.pinDistance)
      .forEach((entry, index) => {
        pins[String(index + 1)] = {
          pinDistance: round2(entry.pinDistance),
          pinHeight: round2(entry.pinHeight),
          teeSlope: round2(entry.teeSlope),
          ground: entry.ground,
        };
      });
    return pins;
  }

  /** Pins actuellement affichés dans le formulaire, dans l'ordre des lignes. */
  function collectPinEntries() {
    return Array.from(pinsList.querySelectorAll(".pin-row")).map((row) => {
      const inputs = row.querySelectorAll("input");
      return {
        pinDistance: round2(parseFloat(inputs[0].value)),
        pinHeight: round2(parseFloat(inputs[1].value)),
        teeSlope: round2(parseFloat(inputs[2].value)),
        ground: Number.isFinite(parseFloat(inputs[3].value))
          ? parseFloat(inputs[3].value)
          : 100,
      };
    });
  }

  /**
   * Écrit le formulaire dans le modèle : par du trou et pins aux clés
   * ordinales triées par distance.
   *
   * Refuse les distances dupliquées dans un même trou. L'ancien modèle
   * indexait les pins par distance, donc deux pins à la même distance
   * s'écrasaient silencieusement : le second disparaissait du fichier sans
   * avertissement. Comme `pinDistance` porte désormais l'identité du pin, le
   * doublon doit être signalé à l'utilisateur et non absorbé.
   *
   * @returns {boolean} false si l'écriture a été refusée
   */
  function commitCurrentHole() {
    if (!pinData || !currentCourse || !currentHole) return true;

    const hole = pinData[currentCourse]?.holes?.[currentHole];
    if (!hole) return true;

    const entries = collectPinEntries();

    // Le formulaire doit toujours contenir autant de lignes que le modèle
    // contient de pins : l'ajout et la suppression passent tous deux par le
    // modèle avant de re-rendre. Un écart signale un rendu incomplet, et
    // écrire le formulaire dans ce cas effacerait des pins. On ne touche
    // alors qu'au par, le pins restant sur sa valeur en mémoire.
    const stored = Object.keys(hole.pins || {}).length;
    const rowsOutOfSync = entries.length !== stored;
    if (rowsOutOfSync) {
      console.error(
        "❌ Formulaire et modèle désynchronisés sur",
        currentCourse,
        currentHole,
        `(${entries.length} lignes pour ${stored} pins) : pins non réécrits`,
      );
    }

    const counts = new Map();
    for (const entry of entries) {
      if (!(entry.pinDistance > 0)) {
        // Un pin ajouté arrive à 0 et attend sa distance. Le validateur Rust
        // refuserait l'enregistrement ; mieux vaut le dire ici, avec le nom
        // du trou, plutôt que de renvoyer une erreur technique.
        alert(window.t("editor_error_invalid_distance", { hole: currentHole }));
        return false;
      }
      const key = distanceKey(entry.pinDistance);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const doublon = [...counts.entries()].find(([, n]) => n > 1);
    if (doublon) {
      alert(
        window.t("editor_error_duplicate_distance", {
          distance: doublon[0],
          count: doublon[1],
        }),
      );
      return false;
    }

    const par = parseInt(holeParInput.value, 10);
    hole.par = Number.isFinite(par) ? par : hole.par || 4;
    if (!rowsOutOfSync) {
      hole.pins = toOrdinalPins(entries);
    }
    return true;
  }

  function onHoleChange() {
    // Écrire le trou précédent avant de le quitter, sinon ses modifications
    // affichées sont perdues.
    commitCurrentHole();

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

    readPinEntries(hole).forEach((entry, index) => {
      pinsList.appendChild(createPinRow(entry, index));
    });
  }

  function createPinRow(pin, index) {
    const row = document.createElement("div");
    row.className = "pin-row";

    const distanceInput = document.createElement("input");
    distanceInput.type = "number";
    distanceInput.step = "0.01";
    distanceInput.value = pin.pinDistance;

    const heightInput = document.createElement("input");
    heightInput.type = "number";
    heightInput.step = "0.01";
    heightInput.value = pin.pinHeight;

    const slopeInput = document.createElement("input");
    slopeInput.type = "number";
    slopeInput.step = "0.01";
    slopeInput.value = pin.teeSlope;

    const groundInput = document.createElement("input");
    groundInput.type = "number";
    groundInput.value = pin.ground;

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-danger";
    deleteBtn.textContent = "×";
    deleteBtn.title = window.t("editor_delete_pin");
    deleteBtn.onclick = () => removePinRow(index);

    row.appendChild(distanceInput);
    row.appendChild(heightInput);
    row.appendChild(slopeInput);
    row.appendChild(groundInput);
    row.appendChild(deleteBtn);
    return row;
  }

  /**
   * Supprime le pin affiché à la position donnée.
   *
   * L'index porte sur la liste triée par distance et non sur la clé stockée :
   * les clés sont des ordinaux renumérotés à chaque écriture, elles ne
   * constituent pas une identité stable.
   */
  function removePinRow(index) {
    // Écrire les modifications encore visibles avant de supprimer : les
    // entrées sont lues dans le modèle, pas dans le formulaire. Sans ce
    // commit, les valeurs saisies dans les autres lignes seraient perdues.
    if (!commitCurrentHole()) return;

    const hole = pinData[currentCourse]?.holes?.[currentHole];
    if (!hole) return;

    const entries = readPinEntries(hole);
    if (index < 0 || index >= entries.length) return;

    entries.splice(index, 1);
    hole.pins = toOrdinalPins(entries);
    renderPins();
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
        alert(window.t("editor_error_course_exists", { name }));
        return;
      }

      // Crée le parcours. `short` n'existe plus dans le modèle : il était
      // ambigu (trois parcours partageaient « WW ») et jamais lu.
      pinData[name] = {
        name: name,
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
        alert(window.t("editor_error_hole_exists", { hole: normalized }));
        return;
      }

      // Crée le trou
      pinData[currentCourse].holes[normalized] = {
        par: parseInt(holeParInput.value, 10) || 4,
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

    // Écrire les modifications encore visibles avant d'ajouter : les
    // entrées sont lues dans le modèle, pas dans le formulaire. Sans ce
    // commit, les valeurs saisies dans les lignes existantes seraient
    // perdues au re-rendu.
    if (!commitCurrentHole()) return;

    const hole = pinData[currentCourse].holes[currentHole];
    if (!hole.pins) hole.pins = {};

    // Nouvelle ligne en fin de liste : l'utilisateur saisit la distance, qui
    // devient l'identité du pin. Un pin sans distance explicite est refusé
    // par le validateur Rust, on évite donc d'insérer une ligne à 0.
    const entries = readPinEntries(hole);
    entries.push({
      pinDistance: 0,
      pinHeight: 0,
      teeSlope: 0,
      ground: 100,
    });
    hole.pins = toOrdinalPins(entries);
    renderPins();

    const last = pinsList.querySelector(".pin-row:last-child input");
    if (last) {
      last.focus();
      last.select();
    }
  });

  btnSave.addEventListener("click", async () => {
    // Écrire le trou affiché avant tout : c'est la seule occasion de
    // récupérer les modifications encore visibles à l'écran.
    if (!commitCurrentHole()) return;

    try {
      const emptyCourses = Object.entries(pinData)
        .filter(([, course]) => Object.keys(course?.holes ?? {}).length === 0)
        .map(([name]) => name);
      if (emptyCourses.length > 0) {
        alert(window.t("editor_error_empty_course", { courses: emptyCourses.join("\" , \"") }));
        return;
      }

      await tauri.invoke("save_pin_location", { data: { course: pinData } });
      alert(window.t("editor_save_success"));
    } catch (err) {
      console.error("❌ Erreur sauvegarde:", err);
      // AppError sérialise en texte : le refus de validation Rust
      // (structure invalide) est donc directement lisible ici.
      alert(window.t("editor_save_error", { error: err || "" }));
    }
  });

  // ================================================================
  // LISTENER POUR OUVERTURE/FERMETURE (comme settings_screen)
  // ================================================================

  /**
   * Centre la fenêtre au-dessus de la fenêtre principale à chaque ouverture
   * (payload.pos fourni par app.js).
   *
   * Même traitement que settings_screen et overlays_screen : sans cela,
   * l'éditeur s'ouvre là où le système l'a placé la première fois, ce qui
   * le rend introuvable après un changement de résolution ou de disposition
   * d'écrans.
   *
   * @param {Object} win - Fenêtre Tauri courante
   * @param {Object} payload - Payload de l'événement toggle
   */
  async function positionWindowOnShow(win, payload) {
    const pos = payload?.pos;
    if (!pos || typeof pos.x !== "number" || typeof pos.y !== "number") return;

    try {
      const { PhysicalPosition } = window.__TAURI__.dpi;
      const curSize = await win.outerSize();
      await win.setPosition(
        new PhysicalPosition(
          Math.round(pos.x + (pos.width - curSize.width) / 2),
          Math.round(pos.y + (pos.height - curSize.height) / 2),
        ),
      );
    } catch (err) {
      console.error("❌ Erreur repositionnement éditeur:", err);
    }
  }

  if (tauri && tauri.isAvailable) {
    tauri.listen("toggle-editor-visibility", async (event) => {
      const show = event.payload?.show;
      const win = await tauri.getCurrentWindow();
      if (!win) return;
      if (show === true) {
        await positionWindowOnShow(win, event.payload);
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
      // onCourseChange() reconstruit la liste des trous (tri naturel) et
      // sélectionne le premier, ou réinitialise si le parcours est vide.
      // Resélectionner ici en ordre brut désynchroniserait le select et
      // currentHole.
      onCourseChange();
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
    const params = confirmCount !== null ? { count: confirmCount } : null;
    msgEl.textContent = window.t(confirmMessageKey, params);
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
