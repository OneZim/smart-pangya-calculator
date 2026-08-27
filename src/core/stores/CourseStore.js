// core/stores/CourseStore.js
(function () {
  "use strict";

  window.CourseStore = function (tauriService, storageService) {
    const store = {
      courses: {},
      selected: { map: null, hole: null, pin: null },
      observers: [],
      initialized: false,

      async initialize() {
        if (this.initialized) return this.courses;

        try {
          const data = await tauriService.invoke("parcours");
          this.courses = data?.course || data || {};
          this.initialized = true;

          // Restaurer la dernière sélection
          const saved = storageService.getLastSelection();
          if (saved.map && this.courses[saved.map]) {
            this.selected.map = saved.map;
            if (saved.hole) {
              const holes =
                this.courses[saved.map].holes ||
                this.courses[saved.map].trous ||
                {};
              if (holes[saved.hole]) {
                this.selected.hole = saved.hole;
                if (saved.pin) {
                  const pins =
                    holes[saved.hole].pins || holes[saved.hole].positions || {};
                  if (pins[saved.pin]) {
                    this.selected.pin = saved.pin;
                  }
                }
              }
            }
          }

          this.notify();
          return this.courses;
        } catch (error) {
          console.error("❌ Erreur chargement:", error);
          throw error;
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
        const course = this.getSelectedCourse();
        if (!course) return null;
        const holes = course.holes || course.trous || {};
        return holes[this.selected.hole] || null;
      },

      getSelectedPin() {
        const hole = this.getSelectedHole();
        if (!hole) return null;
        const pins = hole.pins || hole.positions || {};
        return pins[this.selected.pin] || null;
      },

      // core/stores/CourseStore.js - getState() modifié

      // core/stores/CourseStore.js - getState()

      getState() {
        const course = this.getSelectedCourse();
        const hole = this.getSelectedHole();
        const pin = this.getSelectedPin();

        const mapOptions = Object.keys(this.courses).map((key) => ({
          value: key,
          label: this.courses[key].name || key,
        }));

        // === TRI NUMÉRIQUE DES TROUS ===
        const holeKeys = course
          ? Object.keys(course.holes || course.trous || {})
          : [];
        const sortedHoleKeys = holeKeys.sort((a, b) => {
          const numA = parseInt(a.replace(/\D/g, "")) || 0;
          const numB = parseInt(b.replace(/\D/g, "")) || 0;
          return numA - numB;
        });

        const holeOptions = sortedHoleKeys.map((key) => {
          const holeData = (course?.holes || course?.trous || {})[key];
          const par = holeData?.par || "";
          return {
            value: key,
            label: par ? ` ${key} (Par ${par})` : ` ${key}`,
          };
        });

        const pinOptions = hole
          ? Object.keys(hole.pins || hole.positions || {}).map((key) => ({
              value: key,
              label: ` ${key.toUpperCase()}`,
            }))
          : [];

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
})();
