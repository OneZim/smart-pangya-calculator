// core/services/StorageService.js
(function () {
  "use strict";

  window.StorageService = {
    prefix: "pangya_",

    _tauriStore: null, // instance du fichier Tauri Store
    _cache: new Map(), // copie en mémoire pour un accès synchrone
    _ready: false,
    _saveTimeout: null,

    // ================================================================
    // INITIALISATION — à appeler et await AVANT tout le reste de l'app
    // (avant CourseStore/PlayerStore/CharacterStore/setupInputFields...)
    // ================================================================
    async init() {
      try {
        const { load } = window.__TAURI__.store;
        // Un seul fichier pour toute l'app, ex: storage.json dans appDataDir()
        this._tauriStore = await load("storage.json", { autoSave: false });

        const entries = await this._tauriStore.entries();
        for (const [key, value] of entries) {
          this._cache.set(key, value);
        }

        this._ready = true;
      } catch (error) {
        console.error("❌ Erreur chargement Tauri Store:", error);
        this._ready = true; // évite de bloquer l'app même si ça échoue
      }
    },

    // ================================================================
    // LECTURE — synchrone (lit le cache mémoire), même signature qu'avant
    // ================================================================
    get(key, defaultValue = null) {
      if (!this._ready) {
        console.warn(
          `⚠️ StorageService.get("${key}") appelé avant init() — valeur possiblement absente`,
        );
      }
      const fullKey = this.prefix + key;
      return this._cache.has(fullKey) ? this._cache.get(fullKey) : defaultValue;
    },

    // ================================================================
    // ÉCRITURE — met à jour le cache immédiatement (synchrone),
    // persiste sur disque en arrière-plan avec un debounce de 300ms
    // (pour ne pas écrire à chaque frappe clavier)
    // ================================================================
    set(key, value) {
      const fullKey = this.prefix + key;

      // Contrairement à localStorage, pas besoin de JSON.stringify :
      // le plugin Store sérialise déjà nativement objets/nombres/strings.
      this._cache.set(fullKey, value);

      if (this._tauriStore) {
        this._tauriStore.set(fullKey, value);

        clearTimeout(this._saveTimeout);
        this._saveTimeout = setTimeout(() => {
          this._tauriStore
            .save()
            .catch((err) =>
              console.error("❌ Erreur sauvegarde Tauri Store:", err),
            );
        }, 300);
      }
    },

    // Force l'écriture immédiate sur disque (utile avant fermeture de l'app)
    async flush() {
      clearTimeout(this._saveTimeout);
      if (this._tauriStore) {
        await this._tauriStore.save();
      }
    },

    // ================================================================
    // MÉTHODES MÉTIER (inchangées, utilisent get/set ci-dessus)
    // ================================================================

    getLastSelection() {
      return {
        map: this.get("lastMap", ""),
        hole: this.get("lastHole", ""),
        pin: this.get("lastPin", ""),
      };
    },

    saveLastSelection(map, hole, pin) {
      this.set("lastMap", map);
      this.set("lastHole", hole);
      this.set("lastPin", pin);
    },

    getPlayerData() {
      return {
        power: Number(this.get("power", 0)),
        auxPartPower: Number(this.get("auxpart_pwr", 0)),
        cardPower: Number(this.get("card_pwr", 0)),
        mascotPower: Number(this.get("mascot_pwr", 0)),
        cardPsPower: Number(this.get("card_ps_pwr", 0)),
        spinDunk: Number(this.get("spinDunk", 9)),
        spinToma: Number(this.get("spinToma", 7)),
        spinSpike: Number(this.get("spinSpike", 7)),
        spinCobra: Number(this.get("spinCobra", 9)),
      };
    },
  };
})();
