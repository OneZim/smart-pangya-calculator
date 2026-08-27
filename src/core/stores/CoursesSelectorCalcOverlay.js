// core/stores/CourseStoreCalcOverlay.js

(function () {
  "use strict";

  window.createCourseStoreCalcOverlay = function (
    tauriService,
    emitDropdownSync,
    storage,
  ) {
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

          // Le plugin Store gère nativement les objets (pas besoin de
          // JSON.stringify/parse manuel comme avec localStorage).
          const saved = storage
            ? storage.get("lastSelection", { map: "", hole: "", pin: "" })
            : JSON.parse(
                localStorage.getItem("pangya_lastSelection") ||
                  '{"map":"","hole":"","pin":""}',
              );

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

      _saveSelection() {
        const value = {
          map: this.selected.map || "",
          hole: this.selected.hole || "",
          pin: this.selected.pin || "",
        };
        if (storage) {
          storage.set("lastSelection", value);
        } else {
          localStorage.setItem("pangya_lastSelection", JSON.stringify(value));
        }
      },

      selectMap(mapKey) {
        this.selected.map = mapKey;
        this.selected.hole = null;
        this.selected.pin = null;
        this._saveSelection();
        this.notify();
        emitDropdownSync?.("select-parcours", mapKey);
      },

      selectHole(holeKey) {
        this.selected.hole = holeKey;
        this.selected.pin = null;
        this._saveSelection();
        this.notify();
        emitDropdownSync?.("select-trou", holeKey);
      },

      selectPin(pinKey) {
        this.selected.pin = pinKey;
        this._saveSelection();
        this.notify();
        emitDropdownSync?.("select-pin", pinKey);
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

      getState() {
        const course = this.getSelectedCourse();
        const hole = this.getSelectedHole();

        const mapOptions = Object.keys(this.courses).map((key) => ({
          value: key,
          label: this.courses[key].name || key,
        }));

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
          selectedPin: this.getSelectedPin(),
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
