// models/Hole.js

import { Pin } from "./Pin.js";

export class Hole {
  constructor(holeKey, data) {
    this.holeKey = holeKey;
    this.distance = data.distance || data.pinDistance || null;
    this.height = data.height || data.pinHeight || null;
    this.pins = {};

    const pinsData = data.pins || data.positions || {};
    for (const [pinKey, pinData] of Object.entries(pinsData)) {
      this.pins[pinKey] = new Pin(pinKey, pinData);
    }
  }

  getPin(pinKey) {
    return this.pins[pinKey] || null;
  }
  getPins() {
    return Object.values(this.pins);
  }
  getPinKeys() {
    return Object.keys(this.pins);
  }
  hasPins() {
    return Object.keys(this.pins).length > 0;
  }
}
