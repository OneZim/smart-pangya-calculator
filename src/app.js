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
   * Teste la détection de la fenêtre Pangya
   * Appelle la commande Tauri get_game_resolution et affiche le résultat
   *
   * ⚠️ Plus appelée automatiquement au démarrage.
   * Pour tester manuellement : window.testPangyaDetection() dans la console F12.
   *
   * @async
   */
  async function testPangyaDetection() {
    console.log("🔍 === TEST DE DÉTECTION PANGYA ===");
    console.log("📡 Vérification de la présence de Tauri...");

    if (!window.TauriService?.isAvailable) {
      console.warn("⚠️ Tauri n'est pas disponible. Test impossible.");
      return;
    }

    console.log("✅ Tauri est disponible");

    // 1. Afficher automatiquement la liste de toutes les fenêtres dans la console F12
    try {
      console.log("🪟 === SCAN AUTOMATIQUE DE TOUTES LES FENÊTRES ===");
      const allWindowsResult = await window.TauriService.invoke(
        "list_all_visible_windows",
      );
      if (allWindowsResult && allWindowsResult.windows) {
        allWindowsResult.windows.forEach((win, index) => {
          console.log(
            `   [${index + 1}] Titre: "${win.window_title}" | Processus: "${win.process_name}" | PID: ${win.pid}`,
          );
        });
      }
    } catch (e) {
      console.warn("⚠️ Impossible de lister toutes les fenêtres :", e);
    }

    // 2. Test de la résolution du jeu Pangya
    console.log("🔄 Appel de get_game_resolution...");

    try {
      const resolution = await window.TauriService.invoke(
        "get_game_resolution",
      );
      console.log("✅ PANGYA DÉTECTÉ !");
      console.log("📐 Résolution du jeu :", resolution);
      console.log(`   Largeur : ${resolution.width}px`);
      console.log(`   Hauteur : ${resolution.height}px`);

      // Test supplémentaire : refresh_game_resolution
      console.log("🔄 Test de refresh_game_resolution...");
      const refreshed = await window.TauriService.invoke(
        "refresh_game_resolution",
      );
      console.log("✅ Refresh réussi :", refreshed);

      // Debug DPI : vérifie si le scaling Windows fausse la résolution détectée
      try {
        const dpiInfo = await window.TauriService.invoke("get_game_dpi_debug");
        console.log("🔬 === DEBUG DPI ===");
        console.log(
          "   Client brut    :",
          dpiInfo.client_width,
          "x",
          dpiInfo.client_height,
        );
        console.log(
          "   DPI jeu        :",
          dpiInfo.game_dpi,
          dpiInfo.game_is_dpi_aware
            ? "(aware)"
            : "(non-aware → Windows agrandit la fenêtre)",
        );
        console.log(
          "   DPI moniteur   :",
          dpiInfo.app_dpi,
          "→ facteur x" + dpiInfo.scale_factor.toFixed(2),
        );
        console.log(
          "   Résolution corrigée :",
          Math.round(dpiInfo.corrected_width),
          "x",
          Math.round(dpiInfo.corrected_height),
        );
      } catch (dpiErr) {
        console.warn("⚠️ Debug DPI impossible :", dpiErr);
      }

      return resolution;
    } catch (error) {
      console.error("❌ PANGYA NON DÉTECTÉ !");
      console.error("   Erreur :", error);
      console.error("   Message :", error?.message || error);
      console.error("   Vérifiez que le jeu Pangya est lancé et visible.");

      console.warn("💡 Conseils de dépannage :");
      console.warn("   1. Vérifiez que le jeu Pangya est bien lancé");
      console.warn("   2. Vérifiez que la fenêtre du jeu n'est pas minimisée");
      console.warn(
        "   3. Regardez la liste des processus affichée ci-dessus pour trouver le nom exact.",
      );

      return null;
    } finally {
      console.log("🔍 === FIN DU TEST ===");
    }
  }

  /**
   * Retourne la position et la taille de la fenêtre principale
   * Utilisée pour positionner les fenêtres settings/overlays au-dessus de main
   * @returns {Promise<{x:number, y:number, width:number, height:number}|null>}
   */
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
        // 0. INITIALISATION
        // ============================================================
        console.log("🚀 Initialisation de l'application...");

        // Détection Pangya : plus d'appel automatique au démarrage.
        // Pour tester manuellement : window.testPangyaDetection() en console.

        // ============================================================
        // 1. RÉCUPÉRATION DES SERVICES
        // ============================================================
        const tauri = window.TauriService;
        const storage = window.StorageService;

        console.log("📦 Services récupérés :", {
          tauri: !!tauri,
          storage: !!storage,
        });

        // Initialisation du stockage
        await storage.init();
        console.log("✅ Storage initialisé");

        // ============================================================
        // 2. INITIALISATION DES STORES
        // ============================================================
        const courseStore = window.CourseStore(tauri, storage);
        const playerStore = window.PlayerStore(storage);
        const characterStore = window.CharacterStore({ storage });

        console.log("🏪 Stores créés :", {
          courseStore: !!courseStore,
          playerStore: !!playerStore,
          characterStore: !!characterStore,
        });

        // Chargement des données
        await courseStore.initialize();
        playerStore.initialize();
        console.log("📊 Données des stores chargées");

        // ============================================================
        // 3. EXPOSITION DES STORES (pour les overlays)
        // ============================================================
        window.__app = { courseStore, playerStore };
        console.log("🌐 Stores exposés globalement");

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
          console.log("✅ Sélecteur de parcours configuré");
        }

        // ============================================================
        // 5. GESTIONNAIRE DE PERSONNAGES
        // ============================================================
        window.CharacterManager(characterStore, {
          onSelect: (char) => {
            // Callback lors de la sélection d'un personnage
            console.log("👤 Personnage sélectionné :", char?.name || char);
          },
        });
        window.__characterStore = characterStore;
        console.log("✅ Gestionnaire de personnages configuré");

        // ============================================================
        // 6. SÉLECTION AUTOMATIQUE DU TEXTE AU FOCUS
        // ============================================================
        document.querySelectorAll('input[type="text"]').forEach((input) => {
          input.addEventListener("focus", function () {
            this.select(); // Sélectionne tout le texte au focus
          });
        });

        // ============================================================
        // 7. CONFIGURATION DES OPTIONS OVERLAYS (onglet Calculs)
        // ============================================================
        this.setupCalculsOverlayOptions(tauri, storage);

        // ============================================================
        // 7b. CONFIGURATION DU BOUTON PARAMÈTRES
        // ============================================================
        this.setupSettingsToggle(tauri);

        // ============================================================
        // 7c. CONFIGURATION DU BOUTON OVERLAYS
        // Ouvre/ferme la fenêtre dédiée de gestion des overlays
        // ============================================================
        this.setupOverlaysToggle(tauri);

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
        // 12b. CALIBRATION VENT — TAILLE RÉELLE DE L'IMAGE
        // ============================================================
        // Déléguée à ScreenshotManager : à chaque chargement d'image, on lit
        // naturalWidth/naturalHeight et on applique la calibration adéquate.

        // ============================================================
        // 13. SÉLECTEUR D'ANGLE (vent)
        // ============================================================
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

        console.log("✅ Application initialisée avec succès !");
      } catch (error) {
        console.error("❌ Erreur d'initialisation:", error);
      }
    },

    // ================================================================
    // MÉTHODE : setupCalculsOverlayOptions()
    // DESCRIPTION : Configure les contrôles overlay propres à la fenêtre
    // principale (onglet Calculs). La gestion complète des overlays a été
    // déplacée vers la fenêtre dédiée screens/overlays/overlays_screen.
    // ================================================================

    /**
     * Configure les contrôles overlay restant dans la fenêtre principale :
     * - Zoom de la règle PB (Smart PB ~80% / PB Max 100%)
     * - Forcer le spin (▼ positif / ▲ négatif, synchronisés avec calc_overlay)
     *
     * @param {Object} tauri - Service Tauri pour les communications
     * @param {Object} storage - Service de stockage pour persister les états
     */
    setupCalculsOverlayOptions: function (tauri, storage) {
      console.log("🔄 Configuration des options overlays (onglet Calculs)...");

      // ============================================================
      // TOGGLE : ZOOM RÈGLE PB (Smart PB ~80% / PB Max 100%)
      // ============================================================
      const toggleRulerZoom = document.getElementById("toggle-ruler-zoom");
      if (toggleRulerZoom) {
        // Défaut : Smart PB (~80%) → décoché ; PB Max (100%) → coché.
        toggleRulerZoom.checked = storage.get("ruler_zoom", false);

        toggleRulerZoom.addEventListener("change", function () {
          const zoom = this.checked ? "100" : "80";
          storage.set("ruler_zoom", this.checked);
          if (window.TauriService?.isAvailable) {
            window.TauriService.emit("update-ruler-zoom", { zoom });
          }
        });
      }

      // ============================================================
      // TOGGLES : FORCER LE SPIN (▼ positif / ▲ négatif)
      // Synchronisés avec calc_overlay via "sync-spin-force"
      // (clé de stockage partagée "spin_force")
      // ============================================================
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

      tauri.listen("sync-spin-force", (event) => {
        const payload = event.payload || {};
        if (chkSpinPos && chkSpinPos.checked !== !!payload.positive) {
          chkSpinPos.checked = !!payload.positive;
        }
        if (chkSpinNeg && chkSpinNeg.checked !== !!payload.negative) {
          chkSpinNeg.checked = !!payload.negative;
        }
      });

      // Restauration depuis le stockage partagé (démarrage)
      const savedSpinForce = storage.get("spin_force", "");
      if (chkSpinPos) chkSpinPos.checked = savedSpinForce === "positive";
      if (chkSpinNeg) chkSpinNeg.checked = savedSpinForce === "negative";

      console.log("✅ Options overlays configurées");
    },

    // ================================================================
    // MÉTHODE : setupSettingsToggle()
    // DESCRIPTION : Configure le bouton pour afficher/masquer les paramètres
    // ================================================================

    /**
     * Configure le bouton "Paramètres" pour ouvrir/fermer la fenêtre settings
     * @param {Object} tauri - Service Tauri
     */
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

    // ================================================================
    // MÉTHODE : setupOverlaysToggle()
    // DESCRIPTION : Configure le bouton pour afficher/masquer les overlays
    // ================================================================

    /**
     * Configure le bouton "Overlays" pour ouvrir/fermer la fenêtre
     * de gestion des overlays (screens/overlays/overlays_screen)
     * @param {Object} tauri - Service Tauri
     */
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
      console.log("🔄 Configuration des champs de saisie...");

/**
       * NOTES IMPORTANTES :
       * Les champs suivants sont EXCLUS de cette liste car ils sont gérés
       * par le CharacterManager + CharacterStore (par personnage) :
       * - power
       * - auxpart_pwr
       * - card_pwr
       * - mascot_pwr
       * - card_ps_pwr
       * Les laisser ici les feraient écraser par une ancienne valeur globale
       * à chaque changement de personnage.
       */

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
              const angle = parseFloat(e.target.value) || 0;
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

      console.log("✅ Champs de saisie configurés");

      // ============================================================
      // GESTION DU ZOOM DE LA RÈGLE VIA LES TOUCHES O et P
      // ============================================================
      let currentZoomSteps = 0;
      const MAX_ZOOM_STEPS = 10;

      document.addEventListener("keydown", (e) => {
        // On ne fait rien si l'utilisateur tape dans un champ de saisie
        if (["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName)) return;

        const key = e.key.toLowerCase();
        let updated = false;

        if (key === "p") {
          // Dézoom (-)
          if (currentZoomSteps < MAX_ZOOM_STEPS) {
            currentZoomSteps++;
            updated = true;
          }
        } else if (key === "o") {
          // Rezoom (+)
          if (currentZoomSteps > 0) {
            currentZoomSteps--;
            updated = true;
          }
        } else if (e.key === "End") {
          // Reset zoom
          if (currentZoomSteps !== 0) {
            currentZoomSteps = 0;
            updated = true;
          }
        }

        if (updated) {
          console.log(
            `🔍 [ZOOM] Palier envoyé aux overlays : ${currentZoomSteps}`,
          );
          if (window.TauriService?.isAvailable) {
            window.TauriService.emit("update-zoom-step", {
              step: currentZoomSteps,
            });
          }
        }
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

          // Sélection automatique du Spin (fixé à 0 par défaut)
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
      console.log("🔄 Configuration des listeners Tauri...");

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
            const angle = parseFloat(value) || 0;
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

        // Ignorer l'écho de notre propre canvas : le champ #degree a déjà
        // reçu la valeur via updateUI() et le recalcul est déclenché par
        // onAngleChange(). Évite le dispatchEvent + double triggerCalc
        // (latence de 400 ms perçue au 2ᵉ clic sur la page principale).
        if (
          degreeInput &&
          Number(degreeInput.value) === Number(angle)
        ) {
          return;
        }

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

        console.log(
          `🖱️ Clic PB : X=${clickX}, Y=${RULER_Y} (PB=${lastPbValue})`,
        );
        tauri.invoke("move_and_click_focused", { x: clickX, y: RULER_Y });
      });

      // ============================================================
      // LISTENER : MISE À JOUR DE LA RÈGLE (Ruler)
      // ============================================================
      tauri.listen("update-ruler", (event) => {
        if (event.payload?.pb !== null && event.payload?.pb !== undefined) {
          lastPbValue = event.payload.pb;
          console.log(`📏 PB mis à jour : ${lastPbValue}`);
        }
      });

      // ============================================================
      // LISTENER : CLIC SUR LE BOUTON "SPIN IDÉAL" DEPUIS L'OVERLAY
      // ============================================================
      if (window.TauriService?.isAvailable) {
        window.TauriService.listen("click-optimize-dunk", function () {
          console.log("📩 Clic reçu de l'overlay");

          const btn = document.getElementById("btn-optimize-spin");
          if (btn) {
            btn.click(); // Simule un clic sur le bouton
          } else {
            console.warn(
              "⚠️ Bouton btn-optimize-spin non trouvé dans la page principale",
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

      console.log("✅ Listeners Tauri configurés");
    },
  };

  // Expose la fonction de test globalement
  window.testPangyaDetection = testPangyaDetection;
})();
