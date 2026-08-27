// stores/CharacterStore.js
(function () {
  "use strict";

  window.CharacterStore = function (options = {}) {
    // Storage (Tauri Store) — passé en option, avec fallback sur
    // window.StorageService, puis sur localStorage en dernier recours.
    const storage = options.storage || window.StorageService || null;

    // Note: le préfixe "pangya_" est désormais géré automatiquement par
    // StorageService, donc les clés par défaut n'ont plus besoin de
    // l'inclure explicitement (storage.get("characters", ...) résout en
    // interne vers "pangya_characters", exactement comme avant).
    const storageKey = options.storageKey || "characters";
    const selectedKey = options.selectedKey || "characters_selected";

    const store = {
      characters: [],
      selectedId: null,
      observers: [],
      storageKey: storageKey,
      selectedKey: selectedKey,
      initialized: false,

      // ================================================================
      // CHARGEMENT
      // ================================================================

      load() {
        try {
          const saved = storage
            ? storage.get(this.storageKey, null)
            : JSON.parse(localStorage.getItem("pangya_characters") || "null");

          if (saved) {
            this.characters = saved.map((charData) =>
              window.Character.fromJSON(charData),
            );
          } else {
            // Première utilisation : créer les personnages par défaut
            this.characters = window.Character.getDefaultCharacters();
            this.save();
          }

          // Restaurer la sélection
          const savedId = storage
            ? storage.get(this.selectedKey, null)
            : localStorage.getItem("pangya_characters_selected");

          if (savedId && this.characters.some((c) => c.id === savedId)) {
            this.selectedId = savedId;
          } else if (this.characters.length > 0) {
            this.selectedId = this.characters[0].id;
          }

          this.initialized = true;
          this.notify();
          return this.characters;
        } catch (error) {
          console.error("❌ Erreur chargement personnages:", error);
          this.characters = window.Character.getDefaultCharacters();
          this.selectedId = this.characters[0]?.id || null;
          this.save();
          this.initialized = true;
          return this.characters;
        }
      },

      // ================================================================
      // SAUVEGARDE
      // ================================================================

      save() {
        try {
          // Le plugin Store sérialise nativement les tableaux/objets,
          // pas besoin de JSON.stringify manuel comme avec localStorage.
          const data = this.characters.map((c) => c.toJSON());

          if (storage) {
            storage.set(this.storageKey, data);
            if (this.selectedId) {
              storage.set(this.selectedKey, this.selectedId);
            }
          } else {
            localStorage.setItem("pangya_characters", JSON.stringify(data));
            if (this.selectedId) {
              localStorage.setItem(
                "pangya_characters_selected",
                this.selectedId,
              );
            }
          }
        } catch (error) {
          console.error("❌ Erreur sauvegarde personnages:", error);
        }
      },

      // ================================================================
      // LECTURE
      // ================================================================

      get(id) {
        return this.characters.find((c) => c.id === id) || null;
      },

      getSelected() {
        return this.get(this.selectedId) || this.characters[0] || null;
      },

      // ================================================================
      // SÉLECTION
      // ================================================================

      select(id) {
        if (this.get(id)) {
          this.selectedId = id;
          if (storage) {
            storage.set(this.selectedKey, id);
          } else {
            localStorage.setItem("pangya_characters_selected", id);
          }
          this.notify();
          return true;
        }
        return false;
      },

      // ================================================================
      // MISE À JOUR DES STATS
      // Attend des clés camelCase du modèle Character:
      // power, auxPartPower, cardPower, mascotPower, cardPsPower
      // ================================================================

      updateStats(id, stats) {
        const char = this.get(id);
        if (!char) return null;

        if (stats.power !== undefined) char.power = Number(stats.power);
        if (stats.auxPartPower !== undefined)
          char.auxPartPower = Number(stats.auxPartPower);
        if (stats.cardPower !== undefined)
          char.cardPower = Number(stats.cardPower);
        if (stats.mascotPower !== undefined)
          char.mascotPower = Number(stats.mascotPower);
        if (stats.cardPsPower !== undefined)
          char.cardPsPower = Number(stats.cardPsPower);
        if (stats.cardSpin !== undefined)
          char.cardSpin = Number(stats.cardSpin);
        if (stats.cardCurve !== undefined)
          char.cardCurve = Number(stats.cardCurve);
        this.save();
        this.notify();
        return char;
      },

      // ================================================================
      // SYNCHRONISATION AVEC LES CHAMPS
      // ================================================================

      syncFromFields() {
        const selected = this.getSelected();
        if (!selected) return;

        const fields = {
          power: document.getElementById("power"),
          auxPartPower: document.getElementById("auxpart_pwr"),
          cardPower: document.getElementById("card_pwr"),
          mascotPower: document.getElementById("mascot_pwr"),
          cardPsPower: document.getElementById("card_ps_pwr"),
          cardSpin: document.getElementById("card_max_spin"),
          cardCurve: document.getElementById("card_max_curve"),
        };

        for (const [key, el] of Object.entries(fields)) {
          if (el && selected[key] !== undefined) {
            el.value = selected[key];
          }
        }
      },

      syncToFields() {
        const selected = this.getSelected();
        if (!selected) return;

        const fields = {
          power: document.getElementById("power"),
          auxPartPower: document.getElementById("auxpart_pwr"),
          cardPower: document.getElementById("card_pwr"),
          mascotPower: document.getElementById("mascot_pwr"),
          cardPsPower: document.getElementById("card_ps_pwr"),
          cardSpin: document.getElementById("card_max_spin"),
          cardCurve: document.getElementById("card_max_curve"),
        };

        let updated = false;
        for (const [key, el] of Object.entries(fields)) {
          if (el && el.value !== undefined) {
            const val = Number(el.value);
            if (!isNaN(val) && selected[key] !== val) {
              selected[key] = val;
              updated = true;
            }
          }
        }

        if (updated) {
          this.save();
          this.notify();
        }
      },

      // ================================================================
      // OBSERVER
      // ================================================================

      subscribe(observer) {
        this.observers.push(observer);
        observer(this.getState());
      },

      unsubscribe(observer) {
        this.observers = this.observers.filter((obs) => obs !== observer);
      },

      notify() {
        const state = this.getState();
        for (const observer of this.observers) {
          observer(state);
        }
      },

      getState() {
        return {
          characters: this.characters,
          selectedId: this.selectedId,
          selected: this.getSelected(),
          count: this.characters.length,
        };
      },
    };

    store.load();
    return store;
  };
})();
