// models/Character.js
(function () {
  "use strict";

  window.Character = class Character {
    constructor(data = {}) {
      this.id =
        data.id || data.name?.toLowerCase().replace(/\s/g, "_") || "unknown";
      this.name = data.name || "Inconnu";
      this.power = Number(data.power) || 40;
      this.auxPartPower = Number(data.auxPartPower) || 0;
      this.cardPower = Number(data.cardPower) || 0;
      this.mascotPower = Number(data.mascotPower) || 0;
      this.cardPsPower = Number(data.cardPsPower) || 0;
      this.cardSpin = Number(data.cardSpin) || 0;
      this.cardCurve = Number(data.cardCurve) || 0;
    }
    getTotalPower() {
      return (
        this.power +
        this.auxPartPower +
        this.cardPower +
        this.mascotPower +
        this.cardPsPower +
        this.cardSpin
      );
    }
    toJSON() {
      return {
        id: this.id,
        name: this.name,
        power: this.power,
        auxPartPower: this.auxPartPower,
        cardPower: this.cardPower,
        mascotPower: this.mascotPower,
        cardPsPower: this.cardPsPower,
        cardSpin: this.cardSpin,
        cardCurve: this.cardCurve,
      };
    }
    static fromJSON(data) {
      return new Character(data);
    }
    static getDefaultCharacters() {
      const characters = [
        { id: "nuri", name: "Nuri" },
        { id: "hana", name: "Hana" },
        { id: "azer", name: "Azer" },
        { id: "cecilia", name: "Cecilia" },
        { id: "max", name: "Max" },
        { id: "kooh", name: "Kooh" },
        { id: "arin", name: "Arin" },
        { id: "kaz", name: "Kaz" },
        { id: "lucia", name: "Lucia" },
        { id: "nell", name: "Nell" },
        { id: "spika", name: "Spika" },
      ];
      return characters.map(
        (data) =>
          new Character({
            ...data,
            power: 40,
            auxPartPower: 0,
            cardPower: 0,
            mascotPower: 0,
            cardPsPower: 0,
            cardSpin: 0,
            cardCurve: 0,
          }),
      );
    }
  };
})();
