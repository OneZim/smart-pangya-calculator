/**
 * =====================================================================
 * FICHIER : app.js
 * DESCRIPTION : Logique principale de l'application Smart Pangya Calculator
 * AUTEUR : Onezim
 * =====================================================================
 * Ce fichier gère :
 *   1. Initialisation des services et stores (Tauri, Storage, Course, Player, Character)
 *   2. Configuration des overlays (affichage, positionnement, clic)
 *   3. Synchronisation des champs de saisie entre les fenêtres
 *   4. Gestion des boutons de réinitialisation
 *   5. Écoute des événements Tauri pour la communication inter-fenêtres
 *   6. Configuration du sélecteur de parcours et des personnages
 *   7. Capture de la position du curseur pour le calibrage du spin
 * =====================================================================
 */

/**
 * IIFE (Immediately Invoked Function Expression)
 * Isole le code dans son propre scope pour éviter les conflits globaux
 */
(function () {
  "use strict"; // Mode strict pour une meilleure sécurité

  // ================================================================
  // UTILITAIRES - SHOT TYPE
  // ================================================================

  /**
   * Vérifie si le type de tir sélectionné est Tomahawk ou Spike
   * @returns {boolean} true si le tir est Tomahawk ou Spike
   */
  function isTomahawkOrSpikeSelected() {
    const shotEl = document.getElementById("shot");
    if (!shotEl) return false;
    const value = shotEl.options[shotEl.selectedIndex].value;
    const type = SHOT_TYPE[SHOT_TYPE_ENUM[value]];
    return type === SHOT_TYPE.TOMAHAWK || type === SHOT_TYPE.SPIKE;
  }

  /**
   * Objet principal de l'application - exposé globalement
   * Contient toutes les méthodes d'initialisation et de configuration
   */
  window.App = {
    /**
     * Point d'entrée principal de l'application
     * Initialise tous les services, stores et composants
     * @async
     */
    async init() {
      try {
        // ============================================================
        // 1. RÉCUPÉRATION DES SERVICES
        // ============================================================
        const tauri = window.TauriService;
        const storage = window.StorageService;
        const dunkCalc = window.DunkCalculator;

        // Initialisation du stockage
        await storage.init();

        // ============================================================
        // 2. INITIALISATION DES STORES
        // ============================================================
        const courseStore = window.CourseStore(tauri, storage);
        const playerStore = window.PlayerStore(storage);
        const characterStore = window.CharacterStore({ storage });

        // Chargement des données
        await courseStore.initialize();
        playerStore.initialize();

        // ============================================================
        // 3. EXPOSITION DES STORES (pour les overlays)
        // ============================================================
        window.__app = { courseStore, playerStore };

        // ============================================================
        // 4. SÉLECTEUR DE PARCOURS
        // ============================================================
        const container = document.getElementById("course-selector-container");
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

        // ============================================================
        // 5. GESTIONNAIRE DE PERSONNAGES
        // ============================================================
        window.CharacterManager(characterStore, {
          onSelect: (char) => {
            // Callback lors de la sélection d'un personnage
          },
        });
        window.__characterStore = characterStore;

        // ============================================================
        // 6. SÉLECTION AUTOMATIQUE DU TEXTE AU FOCUS
        // ============================================================
        document.querySelectorAll('input[type="text"]').forEach((input) => {
          input.addEventListener("focus", function () {
            this.select(); // Sélectionne tout le texte au focus
          });
        });

        // ============================================================
        // 7. CONFIGURATION DES TOGGLES OVERLAYS
        // ============================================================
        this.setupOverlayToggles(tauri, storage);

        // ============================================================
        // 8. CONFIGURATION DES CHAMPS DE SAISIE
        // ============================================================
        this.setupInputFields(storage, playerStore);

        // ============================================================
        // 9. CONFIGURATION DU SHOT AUTO
        // ============================================================
        this.setupShotAuto(playerStore);

        // ============================================================
        // 10. CONFIGURATION DES BOUTONS RESET
        // ============================================================
        this.setupResetButtons();

        // ============================================================
        // 11. ÉCOUTE DES ÉVÉNEMENTS TAURI
        // ============================================================
        this.setupTauriListeners(tauri, courseStore);

        // ============================================================
        // 12. GESTIONNAIRE DE CAPTURE D'ÉCRAN
        // ============================================================
        window.ScreenshotManager(tauri, storage);

        // ============================================================
        // 13. SÉLECTEUR D'ANGLE (vent)
        // ============================================================
        const angleSelector = window.AngleSelector({ storage });
        if (angleSelector) {
          window.updateWindCanvas = angleSelector.setAngle;
        }
      } catch (error) {
        console.error("❌ Erreur d'initialisation:", error);
      }
    },

    // ================================================================
    // MÉTHODE : setupOverlayToggles()
    // DESCRIPTION : Configure tous les toggles de superposition (overlays)
    // ================================================================

    /**
     * Configure les contrôles d'affichage et de positionnement des overlays
     * - Input Bar (fenêtre de calcul)
     * - Wind overlay (vent)
     * - Spin overlay (repère de spin)
     * - Ruler overlay (règle de décalage)
     * Gère également les mouvements (déplacements) de chaque overlay
     *
     * @param {Object} tauri - Service Tauri pour les communications
     * @param {Object} storage - Service de stockage pour persister les états
     */
    setupOverlayToggles: function (tauri, storage) {
      // ============================================================
      // TOGGLE : INPUT BAR (fenêtre de calcul)
      // ============================================================
      const toggleInputBar = document.getElementById("toggle-show-input-bar");
      if (toggleInputBar) {
        toggleInputBar.onclick = function () {
          tauri.setOverlayVisibility("input_bar", this.checked);
        };
      }

      // ============================================================
      // TOGGLE : WIND OVERLAY (vent)
      // ============================================================
      const toggleShowWind = document.getElementById(
        "toggle-show-wind-overlay",
      );
      if (toggleShowWind) {
        toggleShowWind.onclick = function () {
          tauri.setOverlayVisibility("wind", this.checked);
        };
      }

      // ============================================================
      // TOGGLE : WIND CLICK-THROUGH (verrouillage du vent)
      // ============================================================
      const toggleWindMain = document.getElementById(
        "toggle-wind-click-through",
      );
      if (toggleWindMain) {
        // Récupère l'état sauvegardé
        const savedState = storage.get("wind_click_through", false);
        toggleWindMain.checked = savedState;

        // Applique l'état au démarrage
        if (tauri.isAvailable) {
          tauri.setOverlayClickThrough("wind_overlay", savedState);
        }

        // Écoute les changements
        toggleWindMain.addEventListener("change", function () {
          const locked = this.checked;
          if (tauri.isAvailable) {
            tauri.setOverlayClickThrough("wind_overlay", locked);
            storage.set("wind_click_through", locked);
            // Synchronise avec l'InputBar
            tauri.emit("sync-wind-click-through", { locked });
          }
        });
      }

      // ============================================================
      // SYNCHRONISATION DE LA VISIBILITÉ DES OVERLAYS
      // Synchronise l'état des toggles entre les fenêtres
      // ============================================================
      const visibilitySyncMap = {
        "sync-ruler-visibility": "toggle-show-ruler",
        "sync-wind-visibility": "toggle-show-wind-overlay",
        "sync-spin-visibility": "toggle-show-spin",
      };

      Object.entries(visibilitySyncMap).forEach(([eventName, checkboxId]) => {
        tauri.listen(eventName, (event) => {
          const cb = document.getElementById(checkboxId);
          if (cb && cb.checked !== event.payload) {
            cb.checked = event.payload;
          }
        });
      });

      // ============================================================
      // TOGGLE : SPIN OVERLAY (repère de spin)
      // ============================================================
      const toggleShowSpin = document.getElementById("toggle-show-spin");
      if (toggleShowSpin) {
        toggleShowSpin.onclick = function () {
          tauri.setOverlayVisibility("spin", this.checked);
        };
      }

      // ============================================================
      // TOGGLE : SPIN CLICK-THROUGH (verrouillage du spin)
      // ============================================================
      const toggleClickThroughSpin = document.getElementById(
        "toggle-click-through-spin",
      );
      if (toggleClickThroughSpin) {
        toggleClickThroughSpin.onclick = function () {
          tauri.setOverlayClickThrough("spin_overlay", this.checked);
        };
      }

      // ============================================================
      // MOUVEMENT DU REPÈRE DE SPIN
      // ============================================================
      const spinButtons = {
        "btn-spin-move-up": { x: 0, y: -1 },
        "btn-spin-move-down": { x: 0, y: 1 },
        "btn-spin-move-left": { x: -1, y: 0 },
        "btn-spin-move-right": { x: 1, y: 0 },
      };
      for (const [id, delta] of Object.entries(spinButtons)) {
        document.getElementById(id)?.addEventListener("click", () => {
          tauri.emit("spin-move", delta);
        });
      }

      // ============================================================
      // TOGGLE : RULER OVERLAY (règle de décalage)
      // ============================================================
      const toggleShowRuler = document.getElementById("toggle-show-ruler");
      if (toggleShowRuler) {
        toggleShowRuler.onclick = function () {
          tauri.setOverlayVisibility("ruler", this.checked);
        };
      }

      // ============================================================
      // TOGGLE : RULER CLICK-THROUGH (verrouillage de la règle)
      // ============================================================
      const toggleClickThrough = document.getElementById(
        "toggle-click-through",
      );
      if (toggleClickThrough) {
        toggleClickThrough.onclick = function () {
          tauri.setOverlayClickThrough("ruler_overlay", this.checked);
        };
      }

      // ============================================================
      // MOUVEMENT DE LA RÈGLE
      // ============================================================
      const moveRuler = (dx, dy) =>
        tauri.invoke("move_ruler", { x: dx, y: dy });
      document
        .getElementById("btn-move-up")
        ?.addEventListener("click", () => moveRuler(0, -1));
      document
        .getElementById("btn-move-down")
        ?.addEventListener("click", () => moveRuler(0, 1));
      document
        .getElementById("btn-move-left")
        ?.addEventListener("click", () => moveRuler(-1, 0));
      document
        .getElementById("btn-move-right")
        ?.addEventListener("click", () => moveRuler(1, 0));

      // ============================================================
      // MOUVEMENT DE L'OVERLAY VENT
      // ============================================================
      const windButtons = {
        "btn-wind-move-up": { dx: 0, dy: -1 },
        "btn-wind-move-down": { dx: 0, dy: 1 },
        "btn-wind-move-left": { dx: -1, dy: 0 },
        "btn-wind-move-right": { dx: 1, dy: 0 },
      };
      for (const [id, delta] of Object.entries(windButtons)) {
        document.getElementById(id)?.addEventListener("click", () => {
          tauri.invoke("move_wind_overlay", delta);
        });
      }
    },

    // ================================================================
    // MÉTHODE : setupInputFields()
    // DESCRIPTION : Configure les champs de saisie avec persistance
    // ================================================================

    /**
     * Initialise les champs de saisie avec chargement/sauvegarde automatique
     * Certains champs sont exclus car gérés par le CharacterManager
     * Synchronise également les changements avec les autres fenêtres via Tauri
     *
     * @param {Object} storage - Service de stockage
     * @param {Object} playerStore - Store des données du joueur
     */
    setupInputFields: function (storage, playerStore) {
      /**
       * NOTES IMPORTANTES :
       * Les champs suivants sont EXCLUS de cette liste car ils sont gérés
       * par le CharacterManager + CharacterStore (par personnage) :
       * - power
       * - auxpart_pwr
       * - card_pwr
       * - mascot_pwr
       * - card_ps_pwr
       * Les laisser ici les ferait écraser par une ancienne valeur globale
       * à chaque changement de personnage.
       */
      const fields = [
        "spinDunk",
        "spinToma",
        "spinSpike",
        "spinCobra",
        "rel-width",
        "rel-height",
        "smart-dev-limit",
      ];

      // Chargement et sauvegarde des champs
      fields.forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;

        // Chargement de la valeur sauvegardée
        const saved = storage.get(id);
        if (saved !== null) el.value = saved;

        // Sauvegarde à chaque changement
        el.addEventListener("input", () => {
          storage.set(id, el.value);

          // Synchronisation des spins avec le PlayerStore et les autres fenêtres
          if (id.startsWith("spin")) {
            playerStore?.initialize();
            if (window.TauriService?.isAvailable) {
              window.TauriService.emit("sync-spin-default", {
                id,
                value: el.value,
              });
            }
          }
        });
      });

      // ============================================================
      // CENTRE DU CADRAN SPIN (calibrage)
      // ============================================================
      const spinCenterX = document.getElementById("spin-dial-center-x");
      const spinCenterY = document.getElementById("spin-dial-center-y");

      if (spinCenterX && spinCenterY) {
        // Chargement des valeurs sauvegardées
        const { x, y } = storage.getSpinDialCenter();
        spinCenterX.value = x;
        spinCenterY.value = y;

        // Sauvegarde des modifications
        const saveCenter = () => {
          storage.saveSpinDialCenter(
            parseFloat(spinCenterX.value) || 0,
            parseFloat(spinCenterY.value) || 0,
          );
        };

        spinCenterX.addEventListener("input", saveCenter);
        spinCenterY.addEventListener("input", saveCenter);
      }

      // ============================================================
      // CAPTURE DE LA POSITION DU CURSEUR (touche ESPACE)
      // Permet de calibrer le centre du cadran de spin
      // ============================================================
      document.addEventListener("keydown", async (e) => {
        if (e.code !== "Space") return;
        // Ne pas capturer si l'utilisateur tape dans un champ
        if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;

        if (!window.TauriService?.isAvailable) return;
        e.preventDefault();
        try {
          const [x, y] = await window.TauriService.invoke("get_mouse_position");
          if (spinCenterX) spinCenterX.value = x;
          if (spinCenterY) spinCenterY.value = y;
          storage.saveSpinDialCenter(x, y);
          console.log(`📍 Position capturée : X=${x}, Y=${y}`);
        } catch (err) {
          console.error("❌ Erreur capture position curseur:", err);
        }
      });

      // ============================================================
      // SYNCHRONISATION DES CHAMPS AVEC L'OVERLAY
      // ============================================================
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

            // Mise à jour du canvas d'angle si c'est le champ degree
            if (
              id === "degree" &&
              typeof window.updateWindCanvas === "function"
            ) {
              const angle = parseInt(e.target.value) || 0;
              window.updateWindCanvas(angle);
            }

            // Émission du changement vers les autres fenêtres
            if (window.TauriService?.isAvailable) {
              window.TauriService.emit("sync-input-value", {
                id,
                value: e.target.value,
              });

              // Mise à jour du spin/curve pour les overlays
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
    },

    // ================================================================
    // MÉTHODE : setupShotAuto()
    // DESCRIPTION : Configure le changement automatique des paramètres de tir
    // ================================================================

    /**
     * Initialise la sélection automatique du Power Shot et du Spin
     * en fonction du type de tir sélectionné (Dunk, Tomahawk, Spike, Cobra)
     *
     * @param {Object} playerStore - Store des données du joueur
     */
    setupShotAuto: function (playerStore) {
      const shotSel = document.getElementById("shot");
      const psSel = document.getElementById("power_shot");
      const spinInput = document.getElementById("spin");

      if (shotSel) {
        shotSel.addEventListener("change", function () {
          const shot = parseInt(this.value);

          // Sélection automatique du Power Shot
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

          // Sélection automatique du Spin
          if (spinInput) {
            const value = playerStore ? playerStore.getSpinForShot(shot) : 9;
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

          // Recalcul automatique
          if (typeof calc === "function") calc();
        });
      }
    },

    // ================================================================
    // MÉTHODE : setupResetButtons()
    // DESCRIPTION : Configure les boutons de réinitialisation
    // ================================================================

    /**
     * Initialise les boutons "Reset : Cr. / Gr. / Slop" et "Reset Hall"
     * Réinitialise les champs concernés à leurs valeurs par défaut
     * et synchronise les changements avec les autres fenêtres
     */
    setupResetButtons: function () {
      // ============================================================
      // BOUTON : RESET PARAMÈTRES (Curve, Ground, Slope)
      // ============================================================
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

        // Ground à 100 (valeur par défaut)
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

        // Déclenche un recalcul
        if (typeof window.triggerCalc === "function") window.triggerCalc();
      });

      // ============================================================
      // BOUTON : RESET HALL (réinitialise tous les paramètres)
      // ============================================================
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

        // Wind à 1 (valeur par défaut)
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

        // Ground à 100 (valeur par défaut)
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

        // Déclenche un recalcul
        if (typeof window.triggerCalc === "function") window.triggerCalc();
      });
    },

    // ================================================================
    // MÉTHODE : setupTauriListeners()
    // DESCRIPTION : Configure les écouteurs d'événements Tauri
    // ================================================================

    /**
     * Configure tous les listeners pour la communication inter-fenêtres
     * - Synchronisation du sélecteur de parcours
     * - Synchronisation des champs de saisie
     * - Déclenchement du calcul
     * - Synchronisation de l'angle du vent
     * - Synchronisation du clic sur le bouton "Spin idéal"
     * - Mise à jour de la règle (ruler)
     *
     * @param {Object} tauri - Service Tauri
     * @param {Object} courseStore - Store des parcours
     */
    setupTauriListeners: function (tauri, courseStore) {
      if (!tauri.isAvailable) {
        console.warn("⚠️ Tauri non disponible");
        return;
      }

      // ============================================================
      // LISTENER : SYNCHRONISATION DU SÉLECTEUR DE PARCOURS
      // ============================================================
      tauri.listen("sync-dropdown-parcours", (event) => {
        const { id, value, sender } = event.payload;
        if (sender === "main") return; // Évite les boucles

        const mapId = {
          "select-parcours": "map",
          "select-trou": "hole",
          "select-pin": "pin",
        };
        const type = mapId[id];
        if (type === "map") courseStore.selectMap(value);
        else if (type === "hole") courseStore.selectHole(value);
        else if (type === "pin") courseStore.selectPin(value);
      });

      // ============================================================
      // LISTENER : SYNCHRONISATION DES CHAMPS DE SAISIE
      // ============================================================
      tauri.listen("sync-input-value", (event) => {
        const { id, value } = event.payload;
        const el = document.getElementById(id);
        if (el && el.value !== String(value)) {
          window.isSyncingDrop = true; // Bloque les listeners "input"
          el.value = value;
          window.isSyncingDrop = false;

          // Mise à jour du canvas d'angle si c'est le champ degree
          if (id === "degree") {
            const angle = parseInt(value) || 0;
            if (typeof window.updateWindCanvas === "function") {
              window.updateWindCanvas(angle);
            }
          }

          // Déclenche un recalcul
          if (typeof window.triggerCalc === "function") {
            window.triggerCalc();
          }
        }
      });

      // ============================================================
      // LISTENER : DÉCLENCHEMENT DU CALCUL
      // ============================================================
      tauri.listen("trigger-main-calculation", () => {
        document.querySelector(".calc-btn")?.click();
      });

      // ============================================================
      // LISTENER : SYNCHRONISATION DE L'ANGLE DU VENT
      // ============================================================
      tauri.listen("sync-wind-angle", (event) => {
        const { angle } = event.payload;

        const degreeInput = document.getElementById("degree");
        if (degreeInput) {
          degreeInput.value = angle;
          degreeInput.dispatchEvent(new Event("input", { bubbles: true }));
          if (typeof window.updateWindCanvas === "function") {
            window.updateWindCanvas(angle);
          }
          if (typeof window.triggerCalc === "function") {
            window.triggerCalc();
          }
        }
      });

      // ============================================================
      // LISTENER : SYNCHRONISATION DU VERROUILLAGE DU VENT
      // ============================================================
      tauri.listen("sync-wind-click-through", (event) => {
        const { locked } = event.payload;
        const toggle = document.getElementById("toggle-wind-click-through");
        if (toggle && toggle.checked !== locked) {
          toggle.checked = locked;
        }
      });

      // ============================================================
      // LISTENER : CLIC SUR LE PBA (Power Bar Adjustment)
      // ============================================================
      let lastPbValue = 0;

      window.TauriService.listen("global-trigger-click-pb", () => {
        const tauri = window.TauriService;
        if (!tauri?.isAvailable) return;

        const RULER_CENTER_X = 960;
        const RULER_Y = 540;
        const PX_PAR_PB = 20;

        const clickX = Math.round(RULER_CENTER_X - lastPbValue * PX_PAR_PB);

        tauri.invoke("move_and_click_focused", { x: clickX, y: RULER_Y });
      });

      // ============================================================
      // LISTENER : MISE À JOUR DE LA RÈGLE (Ruler)
      // ============================================================
      tauri.listen("update-ruler", (event) => {
        if (event.payload?.pb !== null && event.payload?.pb !== undefined) {
          lastPbValue = event.payload.pb;
        }
      });

      // ============================================================
      // LISTENER : CLIC SUR LE BOUTON "SPIN IDÉAL" DEPUIS L'OVERLAY
      // ============================================================
      if (window.TauriService?.isAvailable) {
        window.TauriService.listen("click-optimize-dunk", function () {
          console.log("📩 Clic reçu de l'overlay");

          const btn = document.getElementById("btn-optimize-dunk");
          if (btn) {
            btn.click(); // Simule un clic sur le bouton
          } else {
            console.warn(
              "⚠️ Bouton btn-optimize-dunk non trouvé dans la page principale",
            );
          }
        });

        window.TauriService.listen("click-spin-only", function () {
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
