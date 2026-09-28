// Vérifie que tous les fichiers de langue partagent exactement le même jeu de
// clés, que les clés attendues par le code sont présentes partout, et que les
// placeholders déclarés survivent à la traduction.
//
// Usage :
//   node tools/verify/verify-lang.mjs            (audit de src-tauri/lang)
//   node tools/verify/verify-lang.mjs <dossier>  (audit d'un autre dossier)
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..");
const DEFAULT_DIR = path.join(REPO_ROOT, "src-tauri", "lang");

const langDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DIR;
const files = readdirSync(langDir)
  .filter((f) => f.endsWith(".json"))
  .sort();

if (files.length === 0) {
  console.log(`ECHEC : aucun fichier .json dans ${langDir}`);
  process.exit(1);
}

// Clés référencées par le code qui doivent exister dans toutes les langues.
const EXPECTED = [
  "editor_delete_pin",
  "editor_holes_max",
  "editor_error_load",
  "editor_error_course_exists",
  "editor_error_hole_exists",
  "editor_error_duplicate_distance",
  "editor_error_empty_course",
  "editor_save_success",
  "editor_save_error",
  "editor_error_invalid_distance",
  "pin_data_warning_title",
  "pin_data_warning_close",
];

// Placeholders que chaque langue doit conserver.
const PLACEHOLDERS = {
  editor_error_course_exists: ["{name}"],
  editor_error_hole_exists: ["{hole}"],
  editor_error_duplicate_distance: ["{count}", "{distance}"],
  editor_error_empty_course: ["{courses}"],
  editor_save_error: ["{error}"],
  editor_error_invalid_distance: ["{hole}"],
};

let failed = false;
const sets = {};
const parsed = {};

for (const f of files) {
  const raw = readFileSync(path.join(langDir, f), "utf8");
  try {
    const json = JSON.parse(raw);
    parsed[f] = json;
    sets[f] = new Set(Object.keys(json));
  } catch (err) {
    console.log(`ECHEC ${f} : JSON invalide -> ${err.message}`);
    failed = true;
  }
}

const names = Object.keys(sets);
console.log(`dossier : ${langDir}`);
console.log(`fichiers: ${names.length}`);
console.log("---");

// 1. Parité des jeux de clés entre toutes les langues
const ref = names[0];
for (const f of names.slice(1)) {
  const cur = sets[f];
  const missing = [...sets[ref]].filter((k) => !cur.has(k));
  const extra = [...cur].filter((k) => !sets[ref].has(k));
  if (missing.length || extra.length) {
    console.log(
      `ECHEC ${f} : ${missing.length} manquante(s), ${extra.length} en trop`,
    );
    for (const k of missing) console.log(`   - absente : ${k}`);
    for (const k of extra) console.log(`   - en trop : ${k}`);
    failed = true;
  } else {
    console.log(`OK   ${f} : ${cur.size} cles identiques a ${ref}`);
  }
}

// 2. Présence des clés attendues par le code
for (const key of EXPECTED) {
  const absent = names.filter((f) => !sets[f].has(key));
  if (absent.length) {
    console.log(`ECHEC clé attendue absente : ${key} -> ${absent.join(", ")}`);
    failed = true;
  }
}

// 3. Conservation des placeholders
for (const f of names) {
  const json = parsed[f];
  for (const [key, vars] of Object.entries(PLACEHOLDERS)) {
    const value = String(json[key] ?? "");
    for (const v of vars) {
      if (!value.includes(v)) {
        console.log(`ECHEC ${f} : ${key} ne contient pas ${v}`);
        failed = true;
      }
    }
  }
}

console.log("---");
console.log(failed ? "ECHEC TRADUCTIONS" : "TRADUCTIONS OK");
process.exitCode = failed ? 1 : 0;
