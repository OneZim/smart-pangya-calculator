// core/stores/CourseStore.js
(function () {
  "use strict";

  // -------------------------------------------------------------------
  // Helpers de construction des options de select.
  //
  // Ils sont factorisés et exposés en global car deux implémentations
  // doivent produire exactement les mêmes options : le store de la fenêtre
  // principale (CourseStore) et le proxy de l'overlay de saisie
  // (CourseStore.createProxy). Toute divergence entre les deux se
  // traduirait par des listes de pins différentes selon la fenêtre.
  //
  // Le modèle de données est figé par src-tauri/src/commands/i18n.rs :
  // la clé d'un pin est un ordinal technique ("1", "2", "3") et
  // `pinDistance` porte la seule donnée métier. Les libellés doivent donc
  // être dérivés de la distance, jamais de la clé, sinon l'overlay
  // afficherait « 1 », « 2 », « 3 » au lieu de « 415.96Y ».
  // -------------------------------------------------------------------

  /** Alias de lecture tolérés par les anciennes versions du fichier. */
  function holesOf(course) {
    return course?.holes || course?.trous || {};
  }

  function pinsOf(hole) {
    return hole?.pins || hole?.positions || {};
  }

  /** Libellé de parcours : nom lisible, sinon clé. */
  function buildMapOptions(courses) {
    return Object.keys(courses || {}).map((key) => ({
      value: key,
      label: courses[key]?.name || key,
    }));
  }

  /** Tri naturel des trous : H2 avant H10. */
  function sortHoleKeys(keys) {
    return [...keys].sort((a, b) => {
      const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
      const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
      return numA - numB;
    });
  }

  function buildHoleOptions(course) {
    const holes = holesOf(course);
    return sortHoleKeys(Object.keys(holes)).map((key) => {
      const par = holes[key]?.par || "";
      return { value: key, label: par ? ` ${key} (Par ${par})` : ` ${key}` };
    });
  }

  /**
   * Distance affichée au format historique « 415.96Y ».
   * Le repli sur la clé ne sert que pour un pin sans `pinDistance`
   * exploitable, que le validateur Rust refuse par ailleurs.
   */
  function formatPinLabel(pin, key) {
    const distance = Number(pin?.pinDistance);
    if (Number.isFinite(distance)) return ` ${distance.toFixed(2)}Y`;
    return ` ${String(key).toUpperCase()}`;
  }

  /**
   * Options du select de pins, triées par distance croissante.
   *
   * La clé reste l'ordinal technique : c'est la valeur transportée par
   * l'événement `select-pin` et persistée par le StorageService, donc
   * stable même si l'utilisateur renumérote ou réordonne les pins.
   */
  function buildPinOptions(hole) {
    const pins = pinsOf(hole);

    return Object.keys(pins)
      .map((key) => ({ key, pin: pins[key] }))
      .sort((a, b) => {
        const da = Number(a.pin?.pinDistance);
        const db = Number(b.pin?.pinDistance);
        if (Number.isFinite(da) && Number.isFinite(db) && da !== db) {
          return da - db;
        }
        // Repli ordinal si une distance est absente ou invalide.
        const ordA = parseInt(a.key, 10);
        const ordB = parseInt(b.key, 10);
        if (Number.isFinite(ordA) && Number.isFinite(ordB)) return ordA - ordB;
        return 0;
      })
      .map(({ key, pin }) => ({ value: key, label: formatPinLabel(pin, key) }));
  }

  window.CourseStore = function (tauriService, storageService) {
    const store = {
      courses: {},
      selected: { map: null, hole: null, pin: null },
      observers: [],
      initialized: false,
      // Incrémenté à chaque rechargement des parcours. Permet à l'émetteur
      // de `current-course-state` de ne pas rediffuser un état identique
      // (l'overlay demande l'état au démarrage alors qu'il vient déjà de le
      // recevoir) sans avoir à sérialiser les 821 pins pour le comparer.
      revision: 0,

      async initialize() {
        if (this.initialized) return this.courses;

        try {
          await this.loadFromSource();
        } catch (error) {
          console.error("❌ Erreur chargement:", error);
          throw error;
        }
        return this.courses;
      },

      // (Ré)charge les parcours depuis la source de vérité (fichier de travail
      // en AppData, sinon fichier embarqué) puis resélectionne le dernier
      // parcours utilisé. Utilisé au démarrage et par reload() après une
      // sauvegarde faite dans l'éditeur.
      async loadFromSource() {
        const data = await tauriService.invoke("parcours");
        this.courses = data?.course || data || {};
        this.initialized = true;
        this.revision++;

        // Repartir d'une sélection propre avant de la restaurer
        this.selected.map = null;
        this.selected.hole = null;
        this.selected.pin = null;

        // Restaurer la dernière sélection
        const saved = storageService.getLastSelection();
        if (saved.map && this.courses[saved.map]) {
          this.selected.map = saved.map;
          if (saved.hole) {
            const holes = holesOf(this.courses[saved.map]);
            if (holes[saved.hole]) {
              this.selected.hole = saved.hole;
              if (saved.pin) {
                // Tolérance : une sélection persistée peut dater d'avant la
                // migration vers les clés ordinales. Le pin est introuvable,
                // on laisse simplement la sélection vide plutôt que de
                // bloquer le parcours au démarrage.
                const pins = pinsOf(holes[saved.hole]);
                if (pins[saved.pin]) {
                  this.selected.pin = saved.pin;
                }
              }
            }
          }
        }

        this.notify();
      },

      // Recharge après une modification externe (sauvegarde de l'éditeur).
      // Un échec ne doit pas casser l'application déjà fonctionnelle.
      async reload() {
        try {
          await this.loadFromSource();
        } catch (error) {
          console.error("❌ Erreur rechargement:", error);
        }
      },

      selectMap(mapKey) {
        this.selected.map = mapKey;
        this.selected.hole = null;
        this.selected.pin = null;
        storageService.saveLastSelection(mapKey, "", "");
        this.notify();
      },

      selectHole(holeKey) {
        this.selected.hole = holeKey;
        this.selected.pin = null;
        storageService.saveLastSelection(this.selected.map, holeKey, "");
        this.notify();
      },

      selectPin(pinKey) {
        this.selected.pin = pinKey;
        storageService.saveLastSelection(
          this.selected.map,
          this.selected.hole,
          pinKey,
        );
        this.notify();
      },

      getSelectedCourse() {
        return this.courses[this.selected.map] || null;
      },

      getSelectedHole() {
        return holesOf(this.getSelectedCourse())[this.selected.hole] || null;
      },

      getSelectedPin() {
        return pinsOf(this.getSelectedHole())[this.selected.pin] || null;
      },

      // core/stores/CourseStore.js - getState() modifié

      // core/stores/CourseStore.js - getState()

      getState() {
        const course = this.getSelectedCourse();
        const hole = this.getSelectedHole();
        const pin = this.getSelectedPin();

        const mapOptions = buildMapOptions(this.courses);
        const holeOptions = buildHoleOptions(course);
        const pinOptions = buildPinOptions(hole);

        return {
          courses: this.courses,
          selected: this.selected,
          selectedCourse: course,
          selectedHole: hole,
          selectedPin: pin,
          mapOptions,
          holeOptions,
          pinOptions,
        };
      },

      subscribe(observer) {
        this.observers.push(observer);
        observer(this.getState());
      },

      notify() {
        const state = this.getState();
        for (const observer of this.observers) {
          observer(state);
        }
      },
    };

    return store;
  };

  // Proxy for Calc Overlay - forwards to Main, listens for updates
  window.CourseStore.createProxy = function (tauriService) {
    let currentState = {
      courses: {},
      selected: { map: null, hole: null, pin: null },
      mapOptions: [],
      holeOptions: [],
      pinOptions: [],
    };
    const subscribers = new Set();

    // Compute options from courses (like real CourseStore)
    function recomputeOptions() {
      // `selected` doit être lu depuis currentState : toute référence nue
      // lèverait un ReferenceError en mode strict, et notify() n'étant
      // appelé qu'après ce calcul, l'overlay resterait sur son état vide
      // (seul le libellé par défaut « Map » subsisterait).
      const { courses, selected } = currentState;
      const course = courses[selected.map] || null;
      const hole = holesOf(course)[selected.hole] || null;
      const pin = pinsOf(hole)[selected.pin] || null;

      currentState.mapOptions = buildMapOptions(currentState.courses);
      currentState.holeOptions = buildHoleOptions(course);
      currentState.pinOptions = buildPinOptions(hole);

      currentState.selectedCourse = course;
      currentState.selectedHole = hole;
      currentState.selectedPin = pin;
    }

    // Notify all subscribers
    function notify() {
      for (const cb of subscribers) {
        cb({
          courses: currentState.courses,
          selected: currentState.selected,
          selectedCourse: currentState.selectedCourse,
          selectedHole: currentState.selectedHole,
          selectedPin: currentState.selectedPin,
          mapOptions: currentState.mapOptions,
          holeOptions: currentState.holeOptions,
          pinOptions: currentState.pinOptions,
        });
      }
    }

    // Update internal state from Main's payload
    function updateFromPayload(payload) {
      const { id, value, sender } = payload;
      if (sender === "input_bar") return; // ignore own echoes

      const typeMap = {
        "select-parcours": "map",
        "select-trou": "hole",
        "select-pin": "pin",
      };
      const type = typeMap[id];
      if (type) {
        currentState.selected[type] = value;
        // reset downstream selections
        if (type === "map") {
          currentState.selected.hole = null;
          currentState.selected.pin = null;
        } else if (type === "hole") {
          currentState.selected.pin = null;
        }
        recomputeOptions();
        notify();
      }
    }

    // Listen for updates from Main
    tauriService.listen("sync-dropdown-parcours", (event) => {
      const payload = event.payload;
      if (payload) updateFromPayload(payload);
    });

    // Listen for full state from Main (initial sync)
    tauriService.listen("current-course-state", (event) => {
      const payload = event.payload;
      if (!payload) return;
      // L'événement est diffusé à toutes les fenêtres : n'accepter que
      // l'état produit par la fenêtre principale.
      if (payload.source && payload.source !== "main") return;
      currentState = { ...currentState, ...payload };
      recomputeOptions();
      notify();
    });

    // Request initial state from Main on startup
    tauriService.emit("request-current-course", { sender: "input_bar" });

    // Proxy methods that forward to Main
    const forward = (type, value) => {
      // Update local state optimistically
      currentState.selected[type] = value;
      if (type === "map") {
        currentState.selected.hole = null;
        currentState.selected.pin = null;
      } else if (type === "hole") {
        currentState.selected.pin = null;
      }
      recomputeOptions();
      notify();

      // Forward to Main
      const idMap = { map: "select-parcours", hole: "select-trou", pin: "select-pin" };
      tauriService.emit("sync-dropdown-parcours", {
        id: idMap[type],
        value,
        sender: "input_bar",
      });
    };

    return {
      selectMap: (v) => forward("map", v),
      selectHole: (v) => forward("hole", v),
      selectPin: (v) => forward("pin", v),
      subscribe: (cb) => {
        subscribers.add(cb);
        // Immediately call with current state
        cb({
          courses: currentState.courses,
          selected: currentState.selected,
          selectedCourse: currentState.selectedCourse,
          selectedHole: currentState.selectedHole,
          selectedPin: currentState.selectedPin,
          mapOptions: currentState.mapOptions,
          holeOptions: currentState.holeOptions,
          pinOptions: currentState.pinOptions,
        });
        return () => subscribers.delete(cb);
      },
      getState: () => ({
        courses: currentState.courses,
        selected: currentState.selected,
        selectedCourse: currentState.selectedCourse,
        selectedHole: currentState.selectedHole,
        selectedPin: currentState.selectedPin,
        mapOptions: currentState.mapOptions,
        holeOptions: currentState.holeOptions,
        pinOptions: currentState.pinOptions,
      }),
      getSelectedPin: () => currentState.selectedPin,
    };
  };
})();
