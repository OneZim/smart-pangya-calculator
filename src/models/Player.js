// models/Player.js

export class Player {
  constructor(data = {}) {
    this.power = Number(data.power) || 0;
    this.auxPartPower = Number(data.auxPartPower) || 0;
    this.cardPower = Number(data.cardPower) || 0;
    this.mascotPower = Number(data.mascotPower) || 0;
    this.cardPsPower = Number(data.cardPsPower) || 0;
    this.spins = {
      dunk: Number(data.spinDunk) || 9,
      toma: Number(data.spinToma) || 7,
      spike: Number(data.spinSpike) || 7,
      cobra: Number(data.spinCobra) || 9,
    };
  }

  getTotalPower() {
    return (
      this.power +
      this.auxPartPower +
      this.cardPower +
      this.mascotPower +
      this.cardPsPower
    );
  }

  getSpin(type) {
    return this.spins[type] || 9;
  }

  setSpin(type, value) {
    if (this.spins.hasOwnProperty(type)) {
      this.spins[type] = Number(value);
    }
  }
}
