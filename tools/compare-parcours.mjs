/**
 * Compare deux fichiers de parcours (ancien ou nouveau format) et rapporte
 * toute divergence de contenu, trou par trou et pin par pin.
 *
 * Usage : node tools/compare-parcours.mjs <reference.json> <compare.json>
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const [, , refPath, cmpPath] = process.argv;

if (!refPath || !cmpPath) {
  console.error("Usage : node tools/compare-parcours.mjs <reference> <compare>");
  process.exit(1);
}

const load = (p) => {
  const raw = JSON.parse(readFileSync(resolve(p), "utf8"));
  return raw.course ?? raw;
};

const holesOf = (c) => c.holes ?? c.trous ?? {};
const pinsOf = (h) => h.pins ?? h.positions ?? {};

/** Indexe les pins par distance : la clé change de forme entre les formats. */
const pinsByDistance = (hole) => {
  const out = new Map();
  for (const [key, pin] of Object.entries(pinsOf(hole))) {
    out.set(Number(pin.pinDistance), { key, pin });
  }
  return out;
};

const FIELDS = ["pinDistance", "pinHeight", "teeSlope", "ground"];

const a = load(refPath);
const b = load(cmpPath);

const diffs = [];
const namesA = Object.keys(a);
const namesB = Object.keys(b);

for (const n of namesA) if (!namesB.includes(n)) diffs.push(`parcours absent : ${n}`);
for (const n of namesB) if (!namesA.includes(n)) diffs.push(`parcours en trop : ${n}`);

let pinsCompared = 0;

for (const name of namesA.filter((n) => namesB.includes(n))) {
  const holesA = holesOf(a[name]);
  const holesB = holesOf(b[name]);

  for (const h of Object.keys(holesA)) if (!holesB[h]) diffs.push(`trou absent : ${name}/${h}`);
  for (const h of Object.keys(holesB)) if (!holesA[h]) diffs.push(`trou en trop : ${name}/${h}`);

  for (const h of Object.keys(holesA).filter((h) => holesB[h])) {
    if (holesA[h].par !== holesB[h].par) {
      diffs.push(`par : ${name}/${h}  ${holesA[h].par} != ${holesB[h].par}`);
    }
    if ((holesA[h].name ?? h) !== (holesB[h].name ?? h)) {
      diffs.push(`name : ${name}/${h}  ${holesA[h].name} != ${holesB[h].name}`);
    }

    const pa = pinsByDistance(holesA[h]);
    const pb = pinsByDistance(holesB[h]);

    for (const d of pa.keys()) if (!pb.has(d)) diffs.push(`pin absent : ${name}/${h}  ${d}Y`);
    for (const d of pb.keys()) if (!pa.has(d)) diffs.push(`pin en trop : ${name}/${h}  ${d}Y`);

    for (const d of pa.keys()) {
      if (!pb.has(d)) continue;
      pinsCompared++;
      for (const f of FIELDS) {
        if (pa.get(d).pin[f] !== pb.get(d).pin[f]) {
          diffs.push(
            `${f} : ${name}/${h} ${d}Y  ${pa.get(d).pin[f]} != ${pb.get(d).pin[f]}`,
          );
        }
      }
    }
  }
}

console.log(`pins compares : ${pinsCompared}`);
if (diffs.length === 0) {
  console.log("contenu identique");
} else {
  console.log(`divergences : ${diffs.length}`);
  for (const d of diffs.slice(0, 60)) console.log(`   - ${d}`);
  if (diffs.length > 60) console.log(`   ... +${diffs.length - 60}`);
}
