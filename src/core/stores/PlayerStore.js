// core/stores/PlayerStore.js
(function () {
  "use strict";

  window.PlayerStore = function (storageService) {
    const store = {
      player: null,
      observers: [],

      initialize() {
        this.player = storageService.getPlayerData();
        this.notify();
        return this.player;
      },

      getSpin(type) {
        const spinKey = `spin${type.charAt(0).toUpperCase() + type.slice(1)}`;
        return this.player?.[spinKey] || 9;
      },

      // ============================================================
      // RÈGLES MÉTIER : SHOT → POWERSHOT + SPIN
      // ============================================================

      getPowerShotForShot(shotType) {
        // Dunk (0) = Off, les autres = On
        return shotType === 0 ? "0" : "1";
      },

      getSpinForShot(shotType) {
        const spinMap = {
          0: this.player?.spinDunk || 0, // Dunk
          1: this.player?.spinToma || 7, // Tomahawk
          2: this.player?.spinSpike || 7, // Spike
          3: this.player?.spinCobra || 9, // Cobra
        };
        return spinMap[shotType] ?? 9;
      },

      // ============================================================
      // UTILITAIRES
      // ============================================================

      getState() {
        return {
          player: this.player,
          spins: this.player || {},
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
