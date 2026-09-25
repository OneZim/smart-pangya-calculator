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

          // === INFOS DE TIR (PB réel, distance, %) ===
          // Alimenté par l'événement "update-ruler" via ShotInfoService.
          await window.ShotInfoService.init({ tauriService: tauri, storage });

          const renderShotInfo = () => {
            const data = window.ShotInfoService.getCurrentData();
            const pbRealEl = document.getElementById("pbReal-display");
            const percentEl = document.getElementById("percent-display");
            const distEl = document.getElementById("distance-display");

            if (pbRealEl) {
              const pbReal = window.ShotInfoService.computeRealPb(
                data.pb != null ? data.pb : 0,
              );
              pbRealEl.textContent = `${pbReal.toFixed(2)} PB`;
            }
            if (percentEl) {
              const percent = data.percent != null ? data.percent : 0;
              percentEl.textContent = `${percent.toFixed(1)}%`;
              percentEl.classList.toggle("percent-low", percent < 80);
            }
            if (distEl) {
              const dist = data.distance != null ? data.distance : 0;
              distEl.textContent = `${dist.toFixed(2)} yds`;
            }
          };

          window.ShotInfoService.onData(renderShotInfo);
          window.ShotInfoService.onConfigChange(renderShotInfo);
          renderShotInfo();

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

          this.setupViewToggle();

          this.initBallPanel(tauri, storage);
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

    // Bascule entre la vue Vent et la vue Balle de la carte droite.
    // Une seule vue est affichée à la fois ; quitter la vue Balle réinitialise
    // les points posés sur la capture.
    setupViewToggle: function () {
      const btnWind = document.getElementById("btn-toggle-wind-view");
      const btnBall = document.getElementById("btn-toggle-ball-view");
      const viewWind = document.getElementById("view-wind");
      const viewBall = document.getElementById("view-ball");
      const title = document.getElementById("wind-view-title");
      if (!btnWind || !btnBall || !viewWind || !viewBall) return;

      const setActiveView = (isBall) => {
        viewWind.hidden = isBall;
        viewBall.hidden = !isBall;
        btnWind.classList.toggle("action-btn--success", !isBall);
        btnBall.classList.toggle("action-btn--success", isBall);

        const key = isBall ? "card_ball" : "card_wind";
        if (title) {
          title.setAttribute("data-i18n", key);
          if (typeof window.t === "function") title.textContent = window.t(key);
        }

        if (isBall && typeof window.resetBallDots === "function") {
          window.resetBallDots();
        }
      };

      btnWind.addEventListener("click", () => setActiveView(false));
      btnBall.addEventListener("click", () => setActiveView(true));
      setActiveView(false);
    },

    // Panneau "Balle" : capture + calibration dédiées (ScreenshotManager),
    // et interaction clic gauche / clic droit pour tracer la pente sur la
    // capture, avec report du résultat dans le champ slope_break.
    initBallPanel: function (tauri, storage) {
      if (!tauri || !window.ScreenshotManager) return;

      window.ScreenshotManager(tauri, storage, {
        imageId: "ball-image",
        refreshBtnId: "btn-refresh-ball",
        cropUpId: "btn-ball-crop-up",
        cropDownId: "btn-ball-crop-down",
        cropLeftId: "btn-ball-crop-left",
        cropRightId: "btn-ball-crop-right",
        offsetXKey: "ballImgOffsetX",
        offsetYKey: "ballImgOffsetY",
        anchorKey: "ballAnchor",
        zoomKey: "ballZoom",
        label: "balle",
      });

      const ballCounter = document.getElementById("ball-click-counter");
      const ballCropBox = document.querySelector(".ball-crop-box");
      const ballClickLayer = document.getElementById("ball-click-layer");
      const ballPolylineShape = document.getElementById("ball-polyline-shape");
      const ballPoints = [];

      function syncBallSlope(value) {
        const slopeInput = document.getElementById("slope_break");
        if (slopeInput && slopeInput.value !== value) {
          slopeInput.value = value;
          slopeInput.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (typeof window.triggerCalc === "function") {
          window.triggerCalc();
        }
      }

      function renderBallLine() {
        if (!ballPolylineShape) return;
        if (ballPoints.length === 0) {
          ballPolylineShape.setAttribute("points", "");
          return;
        }
        ballPolylineShape.setAttribute(
          "points",
          ballPoints.map((p) => `${p.x},${p.y}`).join(" "),
        );
      }

      function updateBallPente() {
        const n = ballPoints.length;

        if (n === 0) {
          if (ballCounter) ballCounter.textContent = "0";
          syncBallSlope("0");
          return;
        }

        if (n === 1) {
          if (ballCounter) ballCounter.textContent = "+1";
          syncBallSlope("1");
          return;
        }

        const premierPoint = ballPoints[0];
        const dernierPoint = ballPoints[n - 1];

        let diffX = dernierPoint.x - premierPoint.x;
        const diffY = premierPoint.y - dernierPoint.y;

        if (diffY < 0) {
          diffX = -diffX;
        }

        const seuil = 5;
        let affichage;

        if (diffX > seuil) {
          affichage = `-${n}`; // Affiche "-3"
        } else if (diffX < -seuil) {
          affichage = `${n}`; // Affiche "+3"
        } else {
          affichage = "0";
        }

        if (ballCounter) ballCounter.textContent = affichage;
        syncBallSlope(affichage);
      }

      function addBallDot(e) {
        if (!ballCropBox) return;
        const rect = ballCropBox.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const dot = document.createElement("div");
        dot.className = "click-dot";
        dot.style.left = x + "px";
        dot.style.top = y + "px";
        if (ballClickLayer) ballClickLayer.appendChild(dot);
        ballPoints.push({ x, y });
        renderBallLine();
        updateBallPente();
      }

      function removeLastBallDot() {
        if (ballPoints.length === 0) return;
        if (ballClickLayer && ballClickLayer.lastElementChild) {
          ballClickLayer.lastElementChild.remove();
        }
        ballPoints.pop();
        renderBallLine();
        updateBallPente();
      }

      function resetBallDots() {
        ballPoints.length = 0;
        if (ballClickLayer) ballClickLayer.innerHTML = "";
        renderBallLine();
        if (ballCounter) ballCounter.textContent = "0";
      }

      if (ballCropBox) {
        ballCropBox.addEventListener("click", addBallDot);
        ballCropBox.addEventListener("contextmenu", (e) => {
          e.preventDefault();
          removeLastBallDot();
        });
      }

      // Exposé pour que le toggle réinitialise les points à la fermeture.
      window.resetBallDots = resetBallDots;
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
        const pxPerPb = Number(calibration?.pxPerPb) || 20;
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
