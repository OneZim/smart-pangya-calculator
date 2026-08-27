// components/CharacterManager.js
(function () {
  "use strict";

  // Correspondance entre les ids des champs DOM (snake_case)
  // et les clés du modèle Character (camelCase).
  // Utilisée à la fois pour afficher (applyCharacter) et pour
  // sauvegarder (setupStatsListeners) — une seule source de vérité.
  const FIELD_MAP = {
    power: "power",
    auxpart_pwr: "auxPartPower",
    card_pwr: "cardPower",
    mascot_pwr: "mascotPower",
    card_ps_pwr: "cardPsPower",
    card_max_spin: "cardSpin",
    card_max_curve: "cardCurve",
  };

  window.CharacterManager = function (characterStore, options = {}) {
    const self = {
      store: characterStore,
      options: options,
      elements: {},
      initialized: false,

      // ================================================================
      // INITIALISATION
      // ================================================================

      init() {
        // Récupérer les éléments
        this.elements = {
          selector: document.getElementById("character-selector"),
          avatarImg: document.getElementById("character-image"),
          nameDisplay: document.getElementById("character-name-display"),
          totalDisplay: document.getElementById("total-power-display"),
          statsFields: Object.keys(FIELD_MAP),
        };

        // Vérifier que les éléments existent
        if (!this.elements.selector) {
          console.warn("⚠️ Sélecteur de personnage non trouvé");
          return this;
        }

        this.setupSelector();
        this.setupStatsListeners();
        this.setupStoreSubscription();
        this.loadInitialCharacter();

        this.initialized = true;
        return this;
      },

      // ================================================================
      // SÉLECTEUR
      // ================================================================

      setupSelector() {
        const selector = this.elements.selector;

        // Remplir la liste des personnages
        this.populateSelector();

        // Écouter les changements
        selector.addEventListener("change", () => {
          const char = this.store.get(selector.value);
          if (char) {
            this.store.select(char.id);
            this.applyCharacter(char);

            if (this.options.onSelect) {
              this.options.onSelect(char);
            }
          }
        });
      },

      populateSelector() {
        const selector = this.elements.selector;
        const state = this.store.getState();

        selector.innerHTML = "";
        state.characters.forEach((char) => {
          const option = document.createElement("option");
          option.value = char.id;
          option.textContent = char.name;
          if (char.id === state.selectedId) {
            option.selected = true;
          }
          selector.appendChild(option);
        });
      },

      // ================================================================
      // AFFICHAGE
      // ================================================================

      applyCharacter(char) {
        if (!char) return;

        // Empêche setupStoreSubscription de re-déclencher applyCharacter
        // pendant qu'on est nous-mêmes en train d'appliquer les valeurs.
        this._updating = true;

        // Avatar
        const avatarPath = `assets/avatars/${char.id}.webp`;
        this.elements.avatarImg.src = avatarPath;
        this.elements.avatarImg.alt = char.name;
        this.elements.avatarImg.onerror = function () {
          this.src = "assets/avatars/default.webp";
        };
        this.elements.nameDisplay.textContent = char.name;

        // Champs : on remplit chaque input avec la valeur du personnage,
        // puis on déclenche un vrai événement "input" pour que le
        // calculateur (qui écoute peut-être directement les champs,
        // et pas seulement playerStore) se recalcule automatiquement.
        for (const [domId, modelKey] of Object.entries(FIELD_MAP)) {
          const el = document.getElementById(domId);
          if (el && char[modelKey] !== undefined) {
            el.value = char[modelKey];
            el.dispatchEvent(new Event("input", { bubbles: true }));
          }
        }

        // Total
        if (this.elements.totalDisplay) {
          this.elements.totalDisplay.textContent = char.getTotalPower();
        }

        // Mettre à jour le PlayerStore (si le calculateur écoute plutôt ça)
        if (window.__app?.playerStore) {
          window.__app.playerStore.player = {
            power: char.power,
            auxPartPower: char.auxPartPower,
            cardPower: char.cardPower,
            mascotPower: char.mascotPower,
            cardPsPower: char.cardPsPower,
            cardSpin: char.cardSpin,
            cardCurve: char.cardCurve,
          };
          window.__app.playerStore.notify();
        }

        // Mettre à jour le sélecteur
        if (this.elements.selector) {
          this.elements.selector.value = char.id;
        }

        this._updating = false;
      },

      loadInitialCharacter() {
        const char = this.store.getSelected();
        if (char) {
          this.applyCharacter(char);
          if (this.elements.selector) {
            this.elements.selector.value = char.id;
          }
        }
      },

      // ================================================================
      // STATS - SAUVEGARDE AUTOMATIQUE (PAR PERSONNAGE)
      // ================================================================

      setupStatsListeners() {
        const statsFields = this.elements.statsFields;
        let saveTimeout = null;

        statsFields.forEach((domId) => {
          const el = document.getElementById(domId);
          if (!el) return;

          const modelKey = FIELD_MAP[domId];

          el.addEventListener("input", function () {
            // Ignore les événements qu'on a nous-mêmes déclenchés
            // dans applyCharacter (évite une boucle/écrasement).
            if (self._updating) return;

            clearTimeout(saveTimeout);

            // Champ vidé (l'utilisateur efface pour retaper une valeur) :
            // on ne sauvegarde rien tant qu'il n'y a pas de chiffre.
            // Sans ce garde-fou, Number("") === 0 (pas NaN !), donc ça
            // sauvegardait 0, ce qui déclenchait notify() -> applyCharacter()
            // -> réécrivait le champ à 0 en pleine frappe (effet de clignotement).
            if (this.value.trim() === "") return;

            saveTimeout = setTimeout(() => {
              const selected = self.store.getSelected();
              if (!selected) return;

              const value = Number(this.value);
              if (!isNaN(value)) {
                // Mettre à jour le store, avec la bonne clé du modèle
                const updates = { [modelKey]: value };
                self.store.updateStats(selected.id, updates);

                // Mettre à jour le total
                if (self.elements.totalDisplay) {
                  const total = self.store.getSelected()?.getTotalPower() || 0;
                  self.elements.totalDisplay.textContent = total;
                }

                // Mettre à jour PlayerStore avec la bonne clé aussi
                if (window.__app?.playerStore) {
                  window.__app.playerStore.player[modelKey] = value;
                  window.__app.playerStore.notify();
                }
              }
            }, 300);
          });

          // Si l'utilisateur quitte le champ en le laissant vide, on
          // considère ça comme "0" et on sauvegarde cette valeur —
          // plutôt que de restaurer l'ancienne valeur en mémoire, ce
          // qui serait surprenant si l'utilisateur voulait justement
          // mettre le champ à zéro.
          el.addEventListener("blur", function () {
            if (this.value.trim() === "") {
              clearTimeout(saveTimeout); // annule une sauvegarde en attente
              this.value = 0;

              const selected = self.store.getSelected();
              if (!selected) return;

              self.store.updateStats(selected.id, { [modelKey]: 0 });

              if (self.elements.totalDisplay) {
                const total = self.store.getSelected()?.getTotalPower() || 0;
                self.elements.totalDisplay.textContent = total;
              }

              if (window.__app?.playerStore) {
                window.__app.playerStore.player[modelKey] = 0;
                window.__app.playerStore.notify();
              }
            }
          });
        });
      },

      // ================================================================
      // SUBSCRIPTION AU STORE
      // ================================================================

      setupStoreSubscription() {
        this.store.subscribe((state) => {
          // Ne pas re-appliquer si c'est nous qui avons déclenché le changement
          if (!this._updating) {
            if (state.selected) {
              this.applyCharacter(state.selected);
            }
          }
        });
      },

      // ================================================================
      // UTILITAIRES
      // ================================================================

      refresh() {
        if (!this.initialized) {
          this.init();
          return this;
        }

        this.populateSelector();
        const char = this.store.getSelected();
        if (char) {
          this.applyCharacter(char);
        }
        return this;
      },

      getSelected() {
        return this.store.getSelected();
      },
    };

    return self.init();
  };
})();
