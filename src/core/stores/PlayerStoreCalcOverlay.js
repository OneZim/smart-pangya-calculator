// core/stores/PlayerStoreCalcOverlay.js
(function () {
  "use strict";

  window.createPlayerStoreCalcOverlay = function (storage) {
    return {
      player: null,

      initialize() {
        this.player = {};
        return this.player;
      },

      refresh() {
        this.player = {};
        return this.player;
      },

      getPowerShotForShot(shotType) {
        return shotType === 0 ? "0" : "1";
      },
    };
  };
})();