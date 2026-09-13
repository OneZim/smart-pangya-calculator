// dunk_optimizer.js
// Optimiseur de spin, courbe et capler pour le Smart Calculator Pangya

const DUNK_TOTAL_CRANS = 360; // Nombre de crans fixes sur la jauge (0 à 100%)
const DUNK_TOLERANCE = 0.1; // Tolérance de dunk en jeu (+/- 0.10)
const MAX_EFFECT_RADIUS = 30; // Rayon maximal du cercle d'effet (jauge de Pangya)

// Génère une liste de spins de `start` à `end` inclus, par pas de 0.5.

function generateSpinRange(start, end) {
  const list = [];
  for (let s = start; s <= end + 1e-9; s += 0.5) {
    const val = Math.round(s * 2) / 2;

    // On ignore 0.5 et -0.5 s'ils posent problème en jeu
    if (val === 0.5 || val === -0.5) {
      continue;
    }

    list.push(val);
  }
  return list;
}
/**
 * Recalcule la distance pour un spin et une courbe donnés avec mise en cache.
 */
/**
 * Recalcule la distance pour un spin et une courbe donnés (sans cache).
 */
function computeDistanceForSpinAndCurve(input_values, spin, curva) {
  const found = find_power(
    input_values.power_player,
    input_values.club_info,
    input_values.shot,
    input_values.power_shot,
    input_values.distance,
    input_values.height,
    input_values.wind,
    input_values.degree,
    input_values.ground,
    spin,
    curva,
    input_values.slope,
  );

  let f = [found];
  let index_f = 0;

  if (found.power != -1) {
    let safetyCounter = 0; // Sécurité anti-freeze
    do {
      index_f++;
      safetyCounter++;
      if (safetyCounter > 50) {
        // Stoppe net après 50 iterations pour éviter le freeze
        break;
      }
      f.push(
        find_power(
          input_values.power_player,
          input_values.club_info,
          input_values.shot,
          input_values.power_shot,
          input_values.distance,
          input_values.height,
          input_values.wind,
          input_values.degree,
          input_values.ground,
          spin,
          curva,
          input_values.slope,
          Math.atan2(f[index_f - 1].desvio * 1.5, input_values.distance),
          f[index_f - 1].power,
        ),
      );
    } while (
      f[index_f].power != -1 &&
      f[index_f - 1].power != -1 &&
      Math.abs(f[index_f - 1].desvio - f[index_f].desvio) >= 0.05
    );
  }

  if (f[index_f].power == -1) {
    return null;
  }

  const distanceYards =
    parseFloat((f[index_f].power_range * f[index_f].power).toFixed(1)) || 0.0;

  return {
    distanceYards: distanceYards,
    powerRange: f[index_f].power_range,
    power: f[index_f].power,
  };
}

/**
 * Vérifie si le couple (spin, curva) respecte le cercle d'effet et les filtres de spin.
 */
function isEffectValid(spin, curva, spinOptions) {
  const effectDistance = Math.sqrt(spin * spin + curva * curva);
  if (effectDistance > MAX_EFFECT_RADIUS) {
    return false;
  }

  if (spinOptions && spinOptions.positiveOnly && spin < 0) return false;
  if (spinOptions && spinOptions.negativeOnly && spin > 0) return false;

  return true;
}

/**
 * Évaluation d'un candidat (spin, curva).
 */
function evalCandidate(input_values, spin, curva, spinOptions) {
  if (!isEffectValid(spin, curva, spinOptions)) return null;

  const res = computeDistanceForSpinAndCurve(input_values, spin, curva);
  if (!res || res.power > 1.0) return null; // Exclu si hors de portée (> 100%)

  const step = res.powerRange / DUNK_TOTAL_CRANS;
  const nCrans = Math.round(res.distanceYards / step);
  const achievableCapler = Math.round(nCrans * step * 10) / 10;
  const ecart = Math.round((achievableCapler - res.distanceYards) * 100) / 100;

  return {
    spin: spin,
    curva: curva,
    capler: achievableCapler,
    distanceYards: res.distanceYards,
    ecart: ecart,
  };
}

/**
 * BOUTON 1 : Optimisation du Spin (avec courbe fixe entrée ou à 0).
 */
/**
 * BOUTON 1 : Optimisation du Spin (avec courbe fixe entrée ou à 0).
 */
function findBestDunkSpin(input_values, options = {}) {
  const tolerance =
    options.tolerance != null ? options.tolerance : DUNK_TOLERANCE;
  const spinOptions = options.spinOptions || {
    positiveOnly: false,
    negativeOnly: false,
  };
  const fixedCurve = input_values.curva || 0;

  const easySpins = generateSpinRange(-15, 15);
  const hardSpins = generateSpinRange(-30, -15.5).concat(
    generateSpinRange(15.5, 30),
  );

  function testSpins(spinList) {
    return spinList
      .map((s) => evalCandidate(input_values, s, fixedCurve, spinOptions))
      .filter(Boolean);
  }

  let easyResults = testSpins(easySpins);
  let pool = easyResults.filter((r) => Math.abs(r.ecart) <= tolerance);
  let usedHardSpin = false;
  let allResults = [...easyResults];

  if (pool.length === 0) {
    let hardResults = testSpins(hardSpins);
    allResults.push(...hardResults);
    let hardWithinTolerance = hardResults.filter(
      (r) => Math.abs(r.ecart) <= tolerance,
    );
    if (hardWithinTolerance.length > 0) {
      pool = hardWithinTolerance;
      usedHardSpin = true;
    }
  }

  if (pool.length === 0) pool = allResults;

  // Ici, "pool" (et donc "allResults") est vide UNIQUEMENT si, pour
  // TOUS les spins testés (easy + hard), aucun n'a de puissance <= 100%.
  // C'est le seul vrai cas "impossible".
  if (pool.length === 0) {
    return {
      success: false,
      error: "HORS DE PORTÉE",
      message:
        "La distance cible dépasse les 100% de puissance possible avec ce club et cette courbe. Tir impossible.",
    };
  }

  const best = pool.reduce((a, b) =>
    Math.abs(a.ecart) < Math.abs(b.ecart) ? a : b,
  );
  const withinTolerance = Math.abs(best.ecart) <= tolerance;

  // On a bien trouvé un capler jouable (<=100%) : success reste true,
  // même si ce n'est pas dans la tolérance stricte. La précision est
  // indiquée séparément via withinTolerance / warning.
  return {
    success: true,
    spin: best.spin,
    curva: best.curva,
    capler: best.capler,
    distanceYards: best.distanceYards,
    ecart: best.ecart,
    withinTolerance,
    usedHardSpin,
    warning: usedHardSpin
      ? "Spin hard utilisé pour respecter la tolérance et le cercle d'effet."
      : !withinTolerance
        ? `Aucune combinaison ne rentre dans la tolérance +/- ${tolerance}.`
        : null,
  };
}
