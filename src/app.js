(function () {
  "use strict";

  // Vérifie si le tir sélectionné est Tomahawk ou Spike.
  function isTomahawkOrSpikeSelected() {
    const shotEl = document.getElementById("shot");
    if (!shotEl) return false;
    const value = shotEl.options[shotEl.selectedIndex].value;
    const type = SHOT_TYPE[SHOT_TYPE_ENUM[value]];
    return type === SHOT_TYPE.TOMAHAWK || type === SHOT_TYPE.SPIKE;
  }

  // Retourne la position de la fenêtre principale pour aligner les fenêtres secondaires.
  async function getMainWindowPosition() {
    try {
      if (!window.TauriService?.isAvailable) return null;
      const { getCurrentWindow } = window.__TAURI__.window;
      const currentWindow = getCurrentWindow();
      const pos = await currentWindow.outerPosition();
      const size = await currentWindow.outerSize();
      return {
        x: pos.x,
        y: pos.y,
        width: size.width,
        height: size.height,
      };
    } catch (err) {
      console.error("❌ Erreur lecture position fenêtre principale :", err);
      return null;
    }
  }

  window.App = {
    _initPromise: null,

    // Initialise les services, stores et composants de la fenêtre principale.
    init() {
      if (this._initPromise) return this._initPromise;

      this._initPromise = (async () => {
        try {
          const tauri = window.TauriService;
          const storage = window.StorageService;

          // Initialisation du stockage
          await storage.init();

          const courseStore = window.CourseStore(tauri, storage);
          const playerStore = window.PlayerStore(storage);
          const characterStore = window.CharacterStore({ storage });

          // Chargement des données
          await courseStore.initialize();
          playerStore.initialize();

          window.__app = { courseStore, playerStore };

          const container = document.getElementById(
            "course-selector-container",
          );
          if (container) {
            window.CourseSelector(container, courseStore, tauri, {
              onChange: (type, value) => {
                const idMap = {
                  map: "select-parcours",
                  hole: "select-trou",
                  pin: "select-pin",
                };
                if (tauri.isAvailable) {
                  tauri.emit("sync-dropdown-parcours", {
                    id: idMap[type],
                    value: value,
                    sender: "main",
                  });
                }
              },
            });
          }

          window.CharacterManager(characterStore);
          window.__characterStore = characterStore;

          document.querySelectorAll('input[type="text"]').forEach((input) => {
            input.addEventListener("focus", function () {
              this.select(); // Sélectionne tout le texte au focus
            });
          });

          await this.setupCalculsOverlayOptions(tauri, storage);

          this.setupSettingsToggle(tauri);

          this.setupOverlaysToggle(tauri);

          this.setupInputFields(storage, playerStore);

          this.setupShotAuto(playerStore);

          this.setupResetButtons();

          await this.setupTauriListeners(tauri, courseStore);

          window.ScreenshotManager(tauri, storage);

          const angleSelector = window.WindAngleSelector({
            storage,
            onAngleChange: () => {
              if (typeof window.triggerCalc === "function") {
                window.triggerCalc();
              }
            },
          });
          if (angleSelector) {
            window.updateWindCanvas = angleSelector.setAngle;
          }
        } catch (error) {
          this._initPromise = null;
          console.error("❌ Erreur d'initialisation:", error);
          return null;
        }
      })();

      return this._initPromise;
    },

    // Configure les options d'overlay de la fenêtre principale.
    setupCalculsOverlayOptions: async function (tauri, storage) {
      // Smart PB (80 %) ou PB Max (100 %).
      const toggleRulerZoom = document.getElementById("toggle-ruler-zoom");
      if (toggleRulerZoom) {
        // Défaut : Smart PB (~80%) → décoché ; PB Max (100%) → coché.
        toggleRulerZoom.checked = storage.get("ruler_zoom", false);
        window.__rulerZoom = toggleRulerZoom.checked ? 100 : 80;

        toggleRulerZoom.addEventListener("change", function () {
          const zoom = this.checked ? "100" : "80";
          window.__rulerZoom = Number(zoom);
          storage.set("ruler_zoom", this.checked);
          if (window.TauriService?.isAvailable) {
            window.TauriService.emit("update-ruler-zoom", { zoom });
          }
        });
      }

      // Les deux options sont exclusives et synchronisées avec l'overlay.
      const chkSpinPos = document.getElementById("chk-spin-positive");
      const chkSpinNeg = document.getElementById("chk-spin-negative");

      if (chkSpinPos) {
        chkSpinPos.addEventListener("change", function () {
          if (this.checked && chkSpinNeg) chkSpinNeg.checked = false;
          tauri.emit("sync-spin-force", {
            positive: this.checked,
            negative: false,
          });
          storage.set("spin_force", this.checked ? "positive" : "");
        });
      }
      if (chkSpinNeg) {
        chkSpinNeg.addEventListener("change", function () {
          if (this.checked && chkSpinPos) chkSpinPos.checked = false;
          tauri.emit("sync-spin-force", {
            positive: false,
            negative: this.checked,
          });
          storage.set("spin_force", this.checked ? "negative" : "");
        });
      }

      await tauri.listen("sync-spin-force", (event) => {
        const payload = event?.payload;
        if (!payload || typeof payload !== "object") return;
        if (chkSpinPos && chkSpinPos.checked !== !!payload.positive) {
          chkSpinPos.checked = !!payload.positive;
        }
        if (chkSpinNeg && chkSpinNeg.checked !== !!payload.negative) {
          chkSpinNeg.checked = !!payload.negative;
        }
      });

      const savedSpinForce = storage.get("spin_force", "");
      if (chkSpinPos) chkSpinPos.checked = savedSpinForce === "positive";
      if (chkSpinNeg) chkSpinNeg.checked = savedSpinForce === "negative";
    },

    // Ouvre ou ferme la fenêtre des paramètres.
    setupSettingsToggle: function (tauri) {
      const btnSettings = document.getElementById("btn-settings-toggle");
      if (!btnSettings) return;

      btnSettings.addEventListener("click", async () => {
        if (!tauri.isAvailable) return;

        const isVisible = await tauri.invoke("get_settings_visibility");
        const pos = await getMainWindowPosition();
        tauri.emit("toggle-settings-visibility", { show: !isVisible, pos });
      });
    },

    // Ouvre ou ferme la fenêtre de gestion des overlays.
    setupOverlaysToggle: function (tauri) {
      const btnOverlays = document.getElementById("btn-overlays-toggle");
      if (!btnOverlays) return;

      btnOverlays.addEventListener("click", async () => {
        if (!tauri.isAvailable) return;

        const isVisible = await tauri.invoke("get_overlays_screen_visibility");
        const pos = await getMainWindowPosition();
        tauri.emit("toggle-overlays-visibility", { show: !isVisible, pos });
      });
    },

    // Configure la persistance et la synchronisation des champs.
    setupInputFields: function (storage, playerStore) {
      // Les statistiques du personnage sont gérées par CharacterManager.
      const champsSync = [
        "club",
        "shot",
        "power_shot",
        "distance",
        "wind",
        "degree",
        "spin",
        "height",
        "curve",
        "ground",
        "slope_break",
      ];

      champsSync.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;

        ["input", "change"].forEach((type) => {
          el.addEventListener(type, (e) => {
            if (window.isSyncingDrop) return;

            if (
              id === "degree" &&
              typeof window.updateWindCanvas === "function"
            ) {
              const angle = parseFloat(e.target.value) || 0;
              window.updateWindCanvas(angle);
            }

            if (window.TauriService?.isAvailable) {
              window.TauriService.emit("sync-input-value", {
                id,
                value: e.target.value,
              });

              if (id === "spin" || id === "curve") {
                const spinVal = document.getElementById("spin")?.value || 0;
                const curveVal = document.getElementById("curve")?.value || 0;
                window.TauriService.emit("update-spin", {
                  spin: spinVal,
                  curve: curveVal,
                  boost: isTomahawkOrSpikeSelected(),
                });
              }
            }
          });
        });
      });

      let currentZoomSteps = 0;
      const MAX_ZOOM_STEPS = 10;

      document.addEventListener("keydown", (e) => {
        if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;

        const key = e.key.toLowerCase();
        let updated = false;

        if (key === "p") {
          if (currentZoomSteps < MAX_ZOOM_STEPS) {
            currentZoomSteps++;
            updated = true;
          }
        } else if (key === "o") {
          if (currentZoomSteps > 0) {
            currentZoomSteps--;
            updated = true;
          }
        } else if (e.key === "End") {
          if (currentZoomSteps !== 0) {
            currentZoomSteps = 0;
            updated = true;
          }
        }

        if (updated) {
          if (window.TauriService?.isAvailable) {
            window.TauriService.emit("update-zoom-step", {
              step: currentZoomSteps,
            });
          }
        }
      });
    },

    // Ajuste automatiquement le power shot et le spin selon le tir.
    setupShotAuto: function (playerStore) {
      const shotSel = document.getElementById("shot");
      const psSel = document.getElementById("power_shot");
      const spinInput = document.getElementById("spin");

      if (shotSel) {
        shotSel.addEventListener("change", function () {
          const shot = parseInt(this.value);

          if (psSel) {
            const value = playerStore
              ? playerStore.getPowerShotForShot(shot)
              : shot === 0
                ? "0"
                : "1";
            psSel.value = value;
            if (window.TauriService?.isAvailable) {
              window.TauriService.emit("sync-input-value", {
                id: "power_shot",
                value: value,
              });
            }
          }

          if (spinInput) {
            const value = 0;
            spinInput.value = value;
            if (window.TauriService?.isAvailable) {
              window.TauriService.emit("sync-input-value", {
                id: "spin",
                value: String(value),
              });
              window.TauriService.emit("update-spin", {
                spin: String(value),
                boost: isTomahawkOrSpikeSelected(),
              });
            }
          }

          if (typeof window.triggerCalc === "function") {
            window.triggerCalc();
          }
        });
      }
    },

    // Configure les boutons de réinitialisation.
    setupResetButtons: function () {
      document.getElementById("reset-params")?.addEventListener("click", () => {
        ["curve", "ground", "slope_break"].forEach((id) => {
          const el = document.getElementById(id);
          if (el) {
            el.value = "0";
            if (window.TauriService?.isAvailable) {
              window.TauriService.emit("sync-input-value", { id, value: "0" });
            }
          }
        });

        const groundEl = document.getElementById("ground");
        if (groundEl) {
          groundEl.value = "100";
          if (window.TauriService?.isAvailable) {
            window.TauriService.emit("sync-input-value", {
              id: "ground",
              value: "100",
            });
          }
        }

        if (typeof window.triggerCalc === "function") window.triggerCalc();
      });

      document.getElementById("reset-hall")?.addEventListener("click", () => {
        [
          "distance",
          "height",
          "wind",
          "spin",
          "curve",
          "ground",
          "slope_break",
        ].forEach((id) => {
          const el = document.getElementById(id);
          if (el) {
            el.value = "0";
            if (window.TauriService?.isAvailable) {
              window.TauriService.emit("sync-input-value", { id, value: "0" });
            }
          }
        });

        const windEl = document.getElementById("wind");
        if (windEl) {
          windEl.value = "1";
          if (window.TauriService?.isAvailable) {
            window.TauriService.emit("sync-input-value", {
              id: "wind",
              value: "1",
            });
          }
        }

        const groundEl = document.getElementById("ground");
        if (groundEl) {
          groundEl.value = "100";
          if (window.TauriService?.isAvailable) {
            window.TauriService.emit("sync-input-value", {
              id: "ground",
              value: "100",
            });
          }
        }

        if (typeof window.triggerCalc === "function") window.triggerCalc();
      });
    },

    // Configure les événements Tauri de la fenêtre principale.
    setupTauriListeners: async function (tauri, courseStore) {
      if (!tauri.isAvailable) {
        console.warn("⚠️ Tauri non disponible");
        return;
      }

      await tauri.listen("sync-dropdown-parcours", (event) => {
        const payload = event?.payload;
        if (!payload || typeof payload !== "object") return;

        const { id, value, sender } = payload;
        if (sender === "main") return; // Évite les boucles

        const mapId = {
          "select-parcours": "map",
          "select-trou": "hole",
          "select-pin": "pin",
        };
        const type = mapId[id];
        if (!type || value === undefined || value === null) return;
        if (type === "map") courseStore.selectMap(value);
        else if (type === "hole") courseStore.selectHole(value);
        else if (type === "pin") courseStore.selectPin(value);
      });

      await tauri.listen("sync-input-value", (event) => {
        const payload = event?.payload;
        if (!payload || typeof payload !== "object") return;

        const { id, value } = payload;
        if (typeof id !== "string" || value === undefined || value === null) {
          return;
        }

        const el = document.getElementById(id);
        if (el && el.value !== String(value)) {
          window.isSyncingDrop = true; // Bloque les listeners "input"
          try {
            el.value = value;

            if (id === "degree") {
              const angle = parseFloat(value) || 0;
              if (typeof window.updateWindCanvas === "function") {
                window.updateWindCanvas(angle);
              }
            }

            if (typeof window.triggerCalc === "function") {
              window.triggerCalc();
            }
          } finally {
            window.isSyncingDrop = false;
          }
        }
      });

      await tauri.listen("trigger-main-calculation", () => {
        document.querySelector(".calc-btn")?.click();
      });

      await tauri.listen("sync-wind-angle", (event) => {
        const payload = event?.payload;
        const angle = payload?.angle;
        if (!Number.isFinite(Number(angle))) return;

        const degreeInput = document.getElementById("degree");

        if (degreeInput && Number(degreeInput.value) === Number(angle)) {
          return;
        }

        if (degreeInput) {
          degreeInput.value = angle;
          if (typeof window.updateWindCanvas === "function") {
            window.updateWindCanvas(angle);
          }
          if (typeof window.triggerCalc === "function") {
            window.triggerCalc();
          }
        }
      });

      await tauri.listen("sync-wind-click-through", (event) => {
        const locked = event?.payload?.locked;
        if (typeof locked !== "boolean") return;
        const toggle = document.getElementById("toggle-wind-click-through");
        if (toggle && toggle.checked !== locked) {
          toggle.checked = locked;
        }
      });

      let lastPbValue = 0;
      // Fallback de test lorsque Pangya n'est pas lancé.
      let gameResolution = { width: 1920, height: 1080 };

      function updateGameResolution(payload) {
        const width = Number(payload?.width);
        const height = Number(payload?.height);
        if (width <= 0 || height <= 0) return;

        gameResolution = { width, height };
      }

      await tauri.listen("update-game-resolution", (event) => {
        updateGameResolution(event?.payload);
      });

      try {
        const detectedResolution = await tauri.invoke("get_game_resolution");
        updateGameResolution(detectedResolution);
      } catch (error) {
        console.warn(
          "⚠️ Résolution Pangya indisponible, repli sur 1920x1080 :",
          error,
        );
      }

      await window.TauriService.listen("global-trigger-click-pb", () => {
        const tauri = window.TauriService;
        if (!tauri?.isAvailable) return;

        const resolution = gameResolution;
        const calibration = window.ResolutionCalibrationService?.getCalibration(
          resolution.width,
          resolution.height,
        );
        const zoom = window.__rulerZoom || 80;
        const pxPerPb = Number(calibration?.pxPerPb?.[zoom]) || 20;
        const rulerCenterX = resolution.width / 2;
        const rulerY = resolution.height / 2;

        const clickX = Math.round(rulerCenterX - lastPbValue * pxPerPb);

        tauri.invoke("move_and_click_focused", { x: clickX, y: rulerY });
      });

      await tauri.listen("update-ruler", (event) => {
        const pb = event?.payload?.pb;
        if (Number.isFinite(Number(pb))) {
          lastPbValue = Number(pb);
        }
      });

      if (window.TauriService?.isAvailable) {
        await window.TauriService.listen("click-optimize-dunk", function () {
          const btn = document.getElementById("btn-optimize-spin");
          if (btn) {
            btn.click();
          } else {
            console.warn(
              "⚠️ Bouton btn-optimize-spin non trouvé dans la page principale",
            );
          }
        });

        await window.TauriService.listen("click-spin-only", function () {
          const btn = document.getElementById("btn-click-spin");
          if (btn) {
            btn.click();
          } else {
            console.warn(
              "⚠️ Bouton btn-click-spin non trouvé dans la page principale",
            );
          }
        });
      }
    },
  };
})();
