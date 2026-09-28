// Audit du fichier de parcours livré : conformité aux invariants que le
// validateur Rust et l'éditeur appliquent désormais.
//
// Usage :
//   node tools/verify/audit-data.mjs            (audit du fichier canonique)
//   node tools/verify/audit-data.mjs <fichier>  (audit d'un fichier arbitraire)
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_FILE = path.join(REPO_ROOT, "src-tauri", "data", "parcours.json");

const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;
let data;
try {
  data = JSON.parse(readFileSync(file, "utf8"));
} catch (err) {
  console.log(`ECHEC lecture ${file} : ${err.message}`);
  process.exit(1);
}

const errors = [];
const infos = [];

const courses = data.course;
if (!courses || typeof courses !== "object") {
  errors.push('racine "course" absente');
}

let trous = 0;
let pins = 0;
let short = 0;
let sansNom = 0;
let pinsSansDistance = 0;
let clesNonOrdinales = 0;
let distancesNonCroissantes = 0;
let doublons = 0;
let nomsHoleIncoherents = 0;

for (const cname of Object.keys(courses || {})) {
  const course = courses[cname];
  if (course.short !== undefined) short++;
  if (!course.name) sansNom++;
  if (!course.holes || typeof course.holes !== "object") {
    errors.push(`${cname}: champ holes absent`);
    continue;
  }

  // Ordre naturel des trous
  const holeKeys = Object.keys(course.holes);
  const nums = holeKeys.map((k) => parseInt(k.replace(/\D/g, ""), 10));
  if (nums.some((n, i) => i > 0 && n <= nums[i - 1])) {
    errors.push(`${cname}: trous non triés`);
  }

  for (const hname of holeKeys) {
    trous++;
    const hole = course.holes[hname];
    if (hole.name !== hname && !/^H\d+$/i.test(hname)) nomsHoleIncoherents++;
    if (!hole.pins) {
      errors.push(`${cname}/${hname}: champ pins absent`);
      continue;
    }

    // Clés de pins strictement ordinales "1", "2", "3"... contiguës
    const keys = Object.keys(hole.pins);
    const expected = Array.from({ length: keys.length }, (_, i) => String(i + 1));
    if (keys.join(",") !== expected.join(",")) clesNonOrdinales++;

    // pinDistance : strictement positive, croissante, unique dans le trou
    const dists = keys.map((k) => hole.pins[k].pinDistance);
    for (const d of dists) {
      if (typeof d !== "number" || !(d > 0)) pinsSansDistance++;
    }
    if (dists.some((d, i) => i > 0 && !(d > dists[i - 1]))) {
      distancesNonCroissantes++;
    }

    const rounded = dists.map((d) => Number(Number(d).toFixed(2)));
    if (new Set(rounded).size !== rounded.length) doublons++;

    pins += keys.length;
  }
}

// Contrôles bloquants : chacun doit être à 0.
const checks = [
  ["cles non ordinales", clesNonOrdinales],
  ["pins sans distance positive", pinsSansDistance],
  ["pins non croissants", distancesNonCroissantes],
  ["distances dupliquees", doublons],
  ["champ short present", short],
  ["parcours sans name", sansNom],
];

console.log(`fichier  : ${file}`);
console.log(`parcours : ${Object.keys(courses || {}).length}`);
console.log(`trous    : ${trous}`);
console.log(`pins     : ${pins}`);
console.log("---");
for (const [label, n] of checks) {
  console.log(`${n === 0 ? "OK  " : "ECHEC"} ${label} : ${n}`);
  if (n !== 0) errors.push(label);
}

// Cas particulier corrigé lors de la migration
const sc = courses && courses["Silvia Cannon"];
if (sc && sc.holes && sc.holes.H14) {
  const ok = sc.holes.H14.name === "H14";
  console.log(`${ok ? "OK  " : "ECHEC"} Silvia Cannon/H14.name = ${sc.holes.H14.name}`);
  if (!ok) errors.push("Silvia Cannon/H14.name");
}

// Informatif : non bloquant, car la comparaison exclut les clés de type H<n>.
if (nomsHoleIncoherents > 0) {
  infos.push(`${nomsHoleIncoherents} trou(s) dont hole.name != cle (hors cles H<n>)`);
}
for (const line of infos) {
  console.log(`INFO ${line}`);
}

console.log("---");
console.log(errors.length === 0 ? "AUDIT CONFORME" : `PROBLEMES : ${errors.length}`);
process.exitCode = errors.length ? 1 : 0;
