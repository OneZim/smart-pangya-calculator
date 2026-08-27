// models/Pin.js

export class Pin {
  constructor(pinKey, data) {
    this.pinKey = pinKey;
    this.distance = data.distance || data.pinDistance || null;
    this.height = data.height || data.pinHeight || null;
  }
}
