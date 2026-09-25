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
      const { courses, selected } = currentState;
      const course = courses[selected.map] || null;
      const hole = course
        ? (course.holes || course.trous || {})[selected.hole] || null
        : null;
      const pin = hole
        ? (hole.pins || hole.positions || {})[selected.pin] || null
        : null;

      currentState.mapOptions = Object.keys(currentState.courses).map((key) => ({
        value: key,
        label: currentState.courses[key]?.name || key,
      }));

      const holeKeys = course
        ? Object.keys(course.holes || course.trous || {})
        : [];
      const sortedHoleKeys = holeKeys.sort((a, b) => {
        const numA = parseInt(a.replace(/\D/g, "")) || 0;
        const numB = parseInt(b.replace(/\D/g, "")) || 0;
        return numA - numB;
      });
      currentState.holeOptions = sortedHoleKeys.map((key) => {
        const holeData = (course?.holes || course?.trous || {})[key];
        const par = holeData?.par || "";
        return {
          value: key,
          label: par ? ` ${key} (Par ${par})` : ` ${key}`,
        };
      });

      const pinKeys = hole ? Object.keys(hole.pins || hole.positions || {}) : [];
      currentState.pinOptions = pinKeys.map((key) => ({
        value: key,
        label: ` ${key.toUpperCase()}`,
      }));

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
      if (payload) {
        currentState = { ...currentState, ...payload };
        recomputeOptions();
        notify();
      }
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
