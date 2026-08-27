// models/Course.js

import { Hole } from "./Hole.js";

export class Course {
  constructor(mapKey, data) {
    this.mapKey = mapKey;
    this.name = data.name || mapKey;
    this.holes = {};

    const holesData = data.holes || data.trous || {};
    for (const [holeKey, holeData] of Object.entries(holesData)) {
      this.holes[holeKey] = new Hole(holeKey, holeData);
    }
  }

  getHole(holeKey) {
    return this.holes[holeKey] || null;
  }
  getHoles() {
    return Object.values(this.holes);
  }
  getHoleKeys() {
    return Object.keys(this.holes);
  }
  hasHoles() {
    return Object.keys(this.holes).length > 0;
  }
}
