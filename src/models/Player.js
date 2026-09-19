// models/Player.js

export class Player {
  constructor(data = {}) {
    this.power = Number(data.power) || 0;
    this.auxPartPower = Number(data.auxPartPower) || 0;
    this.cardPower = Number(data.cardPower) || 0;
    this.mascotPower = Number(data.mascotPower) || 0;
    this.cardPsPower = Number(data.cardPsPower) || 0;
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
}
