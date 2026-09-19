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

      // ============================================================
      // RÈGLES MÉTIER : SHOT → POWERSHOT
      // ============================================================

      getPowerShotForShot(shotType) {
        // Dunk (0) = Off, les autres = On
        return shotType === 0 ? "0" : "1";
      },

      // ============================================================
      // UTILITAIRES
      // ============================================================

      getState() {
        return {
          player: this.player,
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
