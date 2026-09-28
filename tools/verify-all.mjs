// Point d'entrée des vérifications hors application : enchaîne les audits de
// données et de traductions, et sort en erreur dès qu'un seul échoue.
//
// Usage : node tools/verify-all.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const NODE = process.execPath;

const STEPS = [
  ["Données des parcours", path.join(HERE, "verify", "audit-data.mjs"), []],
  ["Traductions", path.join(HERE, "verify", "verify-lang.mjs"), []],
];

const results = [];

for (const [label, script, args] of STEPS) {
  console.log(`\n=== ${label} ===`);
  console.log(`> node ${path.relative(process.cwd(), script)}`);
  const res = spawnSync(NODE, [script, ...args], { stdio: "inherit" });
  const code = res.status === null ? 1 : res.status;
  results.push({ label, ok: code === 0 });
  if (code !== 0) {
    console.log(`--> ${label} : ECHEC (code ${code})`);
  }
}

console.log("\n=== Resume ===");
for (const { label, ok } of results) {
  console.log(`${ok ? "OK   " : "ECHEC"} ${label}`);
}

const failed = results.filter((r) => !r.ok).length;
if (failed === 0) {
  console.log("\nTOUTES LES VERIFICATIONS SONT PASSEES");
} else {
  console.log(`\n${failed} VERIFICATION(S) EN ECHEC`);
}
process.exit(failed === 0 ? 0 : 1);
