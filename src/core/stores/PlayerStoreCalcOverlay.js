// core/stores/PlayerStoreCalcOverlay.js
(function () {
  "use strict";

  window.createPlayerStoreCalcOverlay = function (storage) {
    function readSpins() {
      if (storage) {
        return {
          spinDunk: Number(storage.get("spinDunk", 0)),
          spinToma: Number(storage.get("spinToma", 7)),
          spinSpike: Number(storage.get("spinSpike", 7)),
          spinCobra: Number(storage.get("spinCobra", 9)),
        };
      }
      return {
        spinDunk: Number(localStorage.getItem("pangya_spinDunk") || 0),
        spinToma: Number(localStorage.getItem("pangya_spinToma") || 7),
        spinSpike: Number(localStorage.getItem("pangya_spinSpike") || 7),
        spinCobra: Number(localStorage.getItem("pangya_spinCobra") || 9),
      };
    }

    return {
      player: null,

      initialize() {
        this.player = readSpins();
        return this.player;
      },

      refresh() {
        this.player = readSpins();
        return this.player;
      },

      getPowerShotForShot(shotType) {
        return shotType === 0 ? "0" : "1";
      },

      getSpinForShot(shotType) {
        const spinMap = {
          0: this.player?.spinDunk || 0,
          1: this.player?.spinToma || 7,
          2: this.player?.spinSpike || 7,
          3: this.player?.spinCobra || 9,
        };
        return spinMap[shotType] ?? 9;
      },
    };
  };
})();
