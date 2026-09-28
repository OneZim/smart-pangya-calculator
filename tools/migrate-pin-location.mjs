/**
 * Migration du modèle de données des parcours.
 *
 * Source  : src-tauri/data/pin_location.json  (clés de pin = "<distance>y")
 * Cible   : src-tauri/data/parcours.json       (clés de pin ordinales "1", "2"...)
 *
 * Le fichier cible est construit en mémoire, vérifié, et n'est écrit qu'en
 * cas de succès : aucune donnée ne peut être perdue par une exécution
 * partielle ou un fichier source illisible.
 *
 * Usage : node tools/migrate-pin-location.mjs [chemin/vers/source.json]
 *
 * La source reste paramétrable car le fichier livré a été supprimé du dépôt
 * après migration : la trace de la conversion reste rejouable sur n'importe
 * quelle copie de l'ancien format.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2]
  ? resolve(process.argv[2])
  : join(ROOT, "src-tauri", "data", "pin_location.json");
const OUT = join(ROOT, "src-tauri", "data", "parcours.json");

if (!existsSync(SRC)) {
  console.error(`❌ Source introuvable : ${SRC}`);
  console.error(
    "   Usage : node tools/migrate-pin-location.mjs [chemin/vers/source.json]",
  );
  process.exit(1);
}

/**
 * Correctifs manuels appliqués à la génération.
 * Le source déclare `name: "H4"` pour le trou H14 de Silvia Cannon
 * (copier-coller à l'origine) : la clé fait foi.
 */
const NAME_FIXES = {
  "Silvia Cannon/H14": "H14",
};

/** Extrait le numéro d'un trou ("H10" -> 10) pour un tri naturel. */
const holeNumber = (key) => parseInt(String(key).replace(/\D/g, ""), 10) || 0;

/** Normalise un nombre à 2 décimales sans artefact de virgule flottante. */
const round2 = (value) => Number(Number(value).toFixed(2));

/** Lit les trous en tolérant l'ancien alias `trous`. */
const holesOf = (course) => course.holes ?? course.trous ?? {};

/** Lit les pins en tolérant l'ancien alias `positions`. */
const pinsOf = (hole) => hole.pins ?? hole.positions ?? {};

// =====================================================================
// 1. CONSTRUCTION
// =====================================================================

const raw = JSON.parse(readFileSync(SRC, "utf8"));
const sourceCourses = raw.course ?? raw;

const courses = {};

for (const [courseName, courseData] of Object.entries(sourceCourses)) {
  const sourceHoles = holesOf(courseData);
  const holeKeys = Object.keys(sourceHoles).sort(
    (a, b) => holeNumber(a) - holeNumber(b),
  );

  const holes = {};

  for (const holeKey of holeKeys) {
    const holeData = sourceHoles[holeKey];

    // Les pins sont triés par distance avant l'attribution des ordinaux :
    // l'ordre du fichier source n'est pas garanti croissant (47 trous sur
    // 302 dans le fichier livré), et l'invariant "distance unique par
    // trou" doit rester vrai une fois les clés détachées de la distance.
    const orderedPins = Object.values(pinsOf(holeData)).sort(
      (a, b) => a.pinDistance - b.pinDistance,
    );

    const pins = {};
    orderedPins.forEach((pin, index) => {
      pins[String(index + 1)] = {
        pinDistance: round2(pin.pinDistance),
        pinHeight: round2(pin.pinHeight),
        teeSlope: round2(pin.teeSlope),
        ground: pin.ground,
      };
    });

    holes[holeKey] = {
      par: holeData.par,
      name: NAME_FIXES[`${courseName}/${holeKey}`] ?? holeData.name ?? holeKey,
      pins,
    };
  }

  // `short` est retiré : écrit par l'éditeur, jamais lu par le code, et
  // ambigu (trois cours partagent "WW").
  courses[courseName] = {
    name: courseData.name ?? courseName,
    holes,
  };
}

const output = { course: courses };

// =====================================================================
// 2. VÉRIFICATION
// =====================================================================

const errors = [];

/** Empreinte "distance -> [hauteur, pente, ground]" d'un trou. */
const fingerprint = (pins) =>
  Object.values(pins)
    .map((p) => `${p.pinDistance}:${p.pinHeight}:${p.teeSlope}:${p.ground}`)
    .sort()
    .join("|");

const sourceStats = { courses: 0, holes: 0, pins: 0 };
const targetStats = { courses: 0, holes: 0, pins: 0 };

for (const [courseName, courseData] of Object.entries(sourceCourses)) {
  sourceStats.courses += 1;

  for (const [holeKey, holeData] of Object.entries(holesOf(courseData))) {
    sourceStats.holes += 1;
    sourceStats.pins += Object.keys(pinsOf(holeData)).length;

    const targetHole = output.course[courseName]?.holes?.[holeKey];

    if (!targetHole) {
      errors.push(`trou manquant : ${courseName}/${holeKey}`);
      continue;
    }

    targetStats.holes += 1;

    const targetPins = targetHole.pins;
    const expectedOrdinals = Array.from(
      { length: Object.keys(pinsOf(holeData)).length },
      (_, i) => String(i + 1),
    );

    if (
      JSON.stringify(Object.keys(targetPins)) !==
      JSON.stringify(expectedOrdinals)
    ) {
      errors.push(
        `clés non ordinales : ${courseName}/${holeKey} -> ${Object.keys(targetPins).join(",")}`,
      );
    }

    const distances = Object.values(targetPins).map((p) => p.pinDistance);
    const ascending = distances.every((d, i) => i === 0 || d > distances[i - 1]);

    if (!ascending) {
      errors.push(
        `distances non croissantes : ${courseName}/${holeKey} -> ${distances.join(",")}`,
      );
    }

    if (new Set(distances).size !== distances.length) {
      errors.push(`distance dupliquée : ${courseName}/${holeKey}`);
    }

    if (fingerprint(pinsOf(holeData)) !== fingerprint(targetPins)) {
      errors.push(`valeurs modifiées : ${courseName}/${holeKey}`);
    }

    targetStats.pins += Object.keys(targetPins).length;
  }
}

targetStats.courses = Object.keys(output.course).length;

for (const key of ["courses", "holes", "pins"]) {
  if (sourceStats[key] !== targetStats[key]) {
    errors.push(
      `total ${key} différent : source ${sourceStats[key]} vs cible ${targetStats[key]}`,
    );
  }
}

// =====================================================================
// 3. ÉCRITURE
// =====================================================================

if (errors.length > 0) {
  console.error("❌ Vérification échouée, aucun fichier écrit :");
  for (const error of errors) console.error(`   - ${error}`);
  process.exit(1);
}

writeFileSync(OUT, `${JSON.stringify(output, null, 2)}\n`, "utf8");

console.log("✅ parcours.json généré et vérifié");
console.log(`   parcours : ${targetStats.courses}`);
console.log(`   trous    : ${targetStats.holes}`);
console.log(`   pins     : ${targetStats.pins}`);
console.log("   aucune valeur perdue, clés ordinales, distances croissantes");
