// dunk_optimizer.js
//
// Cherche le meilleur couple (spin, curva) pour réussir un Dunk ou un
// Tomahawk/Spike, en recalculant la vraie distance via le moteur physique
// du jeu (find_power) pour chaque candidat, plutôt que d'approximer avec
// une table de référence. Réutilise find_power(), déjà défini dans
// smart_calculator.js — ce fichier doit donc être chargé APRÈS
// smart_calculator.js (scope global classique, sans type="module").
//
// Nécessite en entrée le même "input_values" que calc() construit déjà
// (power_player, club_info, shot, power_shot, distance, height, wind,
// degree, ground, slope) — spin et curva varient d'un appel à l'autre.
//
// ⚠️ Dispatch : c'est à l'appelant (dunk_button.js) de choisir entre
//    findBestDunkSpin() et findBestTomahawkSpikeSpin() selon le type de
//    tir sélectionné (input_values.shot). Les deux fonctions ne sont PAS
//    interchangeables : le Dunk arrondit au plus proche (tolérance
//    symétrique), le Tomahawk/Spike arrondit toujours vers le haut
//    (ceil) et ne doit JAMAIS tomber devant le trou.

const DUNK_TOTAL_CRANS = 360; // nombre de crans fixes sur toute la jauge (0 à 100%)
const DUNK_TOLERANCE = 0.1; // tolérance en jeu (+/- 0.10), partagée par Dunk et Tomahawk/Spike
const MAX_EFFECT_RADIUS = 30; // rayon maximal du cercle d'effet (jauge de Pangya)
const EPS_CEIL = 1e-6; // marge anti-flottant pour Math.ceil

// --- Rétro Tomahawk/Spike -----------------------------------------------
// Fenêtre rétro : la balle tombe derrière le trou (ecart > 0) mais revient
// dedans grâce au backspin. Tolérance dépend du spin (interpolation
// linéaire entre deux points connus en jeu) :
//   spin 1 → 0.10y derrière max
//   spin 7 → 1.00y derrière max
// Au-delà de spin 7 : plop (la balle saute le trou) → interdit.
const RETRO_SPIN_MIN = 1;
const RETRO_SPIN_MAX = 7;
const RETRO_ECART_MIN = 0.1; // borne basse : au-delà du direct
const RETRO_ECART_AT_SPIN_1 = 0.1;
const RETRO_ECART_AT_SPIN_7 = 1.0;

// Génère une liste de spins de `start` à `end` inclus, par pas de 0.5.
// Exclut 0.5 et -0.5 : trop proches du centre, le clic ne prend pas en jeu
// avec le système d'application du spin par clic. 0 reste utilisable.
function generateSpinRange(start, end) {
  const list = [];
  for (let s = start; s <= end + 1e-9; s += 0.5) {
    const val = Math.round(s * 2) / 2;
    if (val === 0.5 || val === -0.5) continue;
    list.push(val);
  }
  return list;
}

// --- Paliers de spin -----------------------------------------------------

// Dunk : facile (-15/+15), puis le reste de la plage utilisable jusqu'à ±30.
const DUNK_EASY_SPINS = generateSpinRange(-15, 15);
const DUNK_HARD_SPINS = generateSpinRange(15.5, 30).concat(
  generateSpinRange(-30, -15.5),
);

// Tomahawk/Spike : jamais de spin négatif.
// Facile 0/+8, repli +8.5/+30.
const TOMAHAWK_EASY_SPINS = generateSpinRange(0, 8);
const TOMAHAWK_EXTENDED_SPINS = generateSpinRange(8.5, 30);

// Tomahawk/Spike rétro : spin 1 → 7 (pas de 0.5). 0.5 étant exclu par
// generateSpinRange, on démarre naturellement à 1.
const TOMAHAWK_RETRO_SPINS = generateSpinRange(RETRO_SPIN_MIN, RETRO_SPIN_MAX);

// --- Debug ---------------------------------------------------------------
// Active/désactive le logging de debug pour computeDistanceForSpinAndCurve
// et evalCandidate. Mets window.DUNK_DEBUG = true dans la console avant de
// lancer l'optimiseur pour tracer chaque candidat testé.
if (typeof window !== "undefined" && typeof window.DUNK_DEBUG === "undefined") {
  window.DUNK_DEBUG = false;
}

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
        // La convergence n'a pas abouti en 50 itérations : le résultat
        // n'est pas fiable (desvio pas stabilisé). On rejette ce candidat.
        if (typeof window !== "undefined" && window.DUNK_DEBUG) {
          console.warn(
            `[dunk_optimizer] spin=${spin} curva=${curva} : non convergé après ${safetyCounter} itérations, candidat rejeté`,
          );
        }
        return null;
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
 * Vérifie si le couple (spin, curva) respecte le cercle d'effet et les
 * filtres de spin forcé (positiveOnly / negativeOnly).
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
 * Évaluation d'un candidat (spin, curva) : calcule le capler réellement
 * atteignable (cran de powerRange/360) et l'écart par rapport à la
 * distance nécessaire pour ce couple.
 */
function evalCandidate(input_values, spin, curva, spinOptions, roundMode) {
  if (!isEffectValid(spin, curva, spinOptions)) return null;

  const res = computeDistanceForSpinAndCurve(input_values, spin, curva);
  if (!res || res.power > 1.0) {
    if (typeof window !== "undefined" && window.DUNK_DEBUG) {
      console.log(
        `[dunk_optimizer] spin=${spin} curva=${curva} : ${
          !res
            ? "rejeté (null)"
            : `rejeté (power ${res.power.toFixed(3)} > 1.0)`
        }`,
      );
    }
    return null; // Exclu si hors de portée (> 100%)
  }

  const step = res.powerRange / DUNK_TOTAL_CRANS;
  const rawCrans = res.distanceYards / step;
  // roundMode "ceil" : on arrondit toujours VERS LE HAUT pour garantir
  // que le cran atteignable ne tombe jamais en dessous de la distance
  // cible (obligatoire pour Tomahawk/Spike, qui ne doit jamais tomber
  // "devant"). EPS_CEIL = 1e-6 absorbe les erreurs flottantes sans
  // décaler d'un cran. roundMode par défaut (Dunk) : arrondi au plus
  // proche, symétrique.
  const nCrans =
    roundMode === "ceil"
      ? Math.ceil(rawCrans - EPS_CEIL)
      : Math.round(rawCrans);
  const achievableCapler = Math.round(nCrans * step * 10) / 10;
  const ecart = Math.round((achievableCapler - res.distanceYards) * 100) / 100;

  if (typeof window !== "undefined" && window.DUNK_DEBUG) {
    console.log(
      `[dunk_optimizer] spin=${spin} curva=${curva} : distance=${res.distanceYards} capler=${achievableCapler} ecart=${ecart} power=${res.power.toFixed(3)}`,
    );
  }

  return {
    spin: spin,
    curva: curva,
    capler: achievableCapler,
    distanceYards: res.distanceYards,
    ecart: ecart,
  };
}

/**
 * Fonction générique : cherche, parmi une liste de spins candidats (à
 * courbe fixe), celui dont l'écart entre capler atteignable et distance
 * nécessaire respecte une plage [minDelta, maxDelta]. Si rien ne rentre
 * dans la plage principale, tente les spins étendus, puis retombe sur un
 * fallbackSpin.
 *
 * - Dunk       : plage symétrique [-0.10, +0.10]
 * - Tomahawk/Spike : jamais "devant" (trop court) ; plage [0, +0.10]
 */
function findBestShotSpin(input_values, options) {
  options = options || {};
  const spins = options.spins || [];
  const extendedSpins = options.extendedSpins || [];
  const curva = options.curva != null ? options.curva : input_values.curva || 0;
  const spinOptions = options.spinOptions || {};
  const minDelta =
    options.minDelta != null ? options.minDelta : -DUNK_TOLERANCE;
  const maxDelta = options.maxDelta != null ? options.maxDelta : DUNK_TOLERANCE;
  const fallbackSpin = options.fallbackSpin;
  const roundMode = options.roundMode;

  function evalSpin(spin) {
    return evalCandidate(input_values, spin, curva, spinOptions, roundMode);
  }

  let results = spins.map(evalSpin).filter(Boolean);
  let withinRange = results.filter(
    (r) => r.ecart >= minDelta && r.ecart <= maxDelta,
  );
  let usedExtendedSpin = false;

  // Rien dans la plage principale : on étend la recherche.
  if (withinRange.length === 0 && extendedSpins.length > 0) {
    const extResults = extendedSpins.map(evalSpin).filter(Boolean);
    results = results.concat(extResults);
    withinRange = results.filter(
      (r) => r.ecart >= minDelta && r.ecart <= maxDelta,
    );
    if (withinRange.length > 0) usedExtendedSpin = true;
  }

  let best;
  let usedFallback = false;

  if (withinRange.length > 0) {
    best = withinRange.reduce((a, b) =>
      Math.abs(a.ecart) < Math.abs(b.ecart) ? a : b,
    );
  } else {
    const fallbackResult = fallbackSpin != null ? evalSpin(fallbackSpin) : null;

    if (fallbackResult) {
      best = fallbackResult;
      usedFallback = true;
    } else if (results.length > 0) {
      best = results.reduce((a, b) =>
        Math.abs(a.ecart) < Math.abs(b.ecart) ? a : b,
      );
      usedFallback = true;
    } else {
      return {
        success: false,
        reasonKey: "shot_out_of_range",
        reasonParams: {},
      };
    }
  }

  const withinConstraint = best.ecart >= minDelta && best.ecart <= maxDelta;

  return {
    success: withinConstraint,
    spin: best.spin,
    curva: best.curva,
    capler: best.capler,
    distanceYards: best.distanceYards,
    ecart: best.ecart,
    usedFallback: usedFallback,
    usedExtendedSpin: usedExtendedSpin,
    warningKey: usedExtendedSpin
      ? "shot_extended_spin_used"
      : usedFallback
        ? "shot_fallback_spin_used"
        : !withinConstraint
          ? "shot_out_of_tolerance"
          : null,
    warningParams: usedExtendedSpin
      ? {}
      : usedFallback
        ? { minDelta: minDelta, maxDelta: maxDelta, fallbackSpin: fallbackSpin }
        : !withinConstraint
          ? { minDelta: minDelta, maxDelta: maxDelta }
          : {},
  };
}

/**
 * Tolérance max d'écart (yards derrière le trou) pour un spin rétro donné.
 * Interpolation linéaire entre (spin=1, 0.10y) et (spin=7, 1.00y).
 */
function retroEcartMax(spin) {
  if (spin < RETRO_SPIN_MIN || spin > RETRO_SPIN_MAX) return 0;
  const t = (spin - RETRO_SPIN_MIN) / (RETRO_SPIN_MAX - RETRO_SPIN_MIN);
  return (
    RETRO_ECART_AT_SPIN_1 + t * (RETRO_ECART_AT_SPIN_7 - RETRO_ECART_AT_SPIN_1)
  );
}

/**
 * Cherche un spin rétro : la balle tombe derrière le trou (ecart > 0)
 * mais dans la fenêtre où le backspin la ramène dedans.
 *
 * Règles :
 *   - spin ∈ [1, 7] (au-delà : plop)
 *   - ecart ∈ ]0.10, retroEcartMax(spin)]  (0.10 = borne du direct)
 *   - priorité : plus petit ecart (le plus proche du trou)
 *
 * Retourne null si aucun candidat rétro valide.
 */
function findBestRetroSpin(input_values, options = {}) {
  const curva = options.curva != null ? options.curva : input_values.curva || 0;
  const spinOptions = { positiveOnly: true }; // rétro = spin positif

  const candidates = [];
  for (const spin of TOMAHAWK_RETRO_SPINS) {
    const r = evalCandidate(input_values, spin, curva, spinOptions, "ceil");
    if (!r) continue;
    if (r.ecart <= RETRO_ECART_MIN) continue; // couvert par le direct
    if (r.ecart > retroEcartMax(spin)) continue; // hors fenêtre rétro
    candidates.push(r);
  }

  if (candidates.length === 0) return null;

  // Priorité : plus petit ecart (le plus proche du trou)
  const best = candidates.reduce((a, b) =>
    Math.abs(a.ecart) < Math.abs(b.ecart) ? a : b,
  );

  return {
    success: true,
    spin: best.spin,
    curva: best.curva,
    capler: best.capler,
    distanceYards: best.distanceYards,
    ecart: best.ecart,
    usedRetro: true,
    warningKey: null, // pas de warning UI, décision de jeu assumée
    warningParams: {},
  };
}

/**
 * BOUTON 1 : Optimisation du Spin pour un Dunk (courbe fixe, entrée ou 0).
 * Tolérance symétrique ±0.10. Deux paliers : facile (-15/+15) puis le
 * reste de la plage utilisable jusqu'à ±30.
 */
function findBestDunkSpin(input_values, options = {}) {
  const tolerance =
    options.tolerance != null ? options.tolerance : DUNK_TOLERANCE;
  const spinOptions = options.spinOptions || {};
  const fixedCurve =
    options.curva != null ? options.curva : input_values.curva || 0;

  function evalSpin(spin) {
    return evalCandidate(input_values, spin, fixedCurve, spinOptions);
  }

  const easyResults = DUNK_EASY_SPINS.map(evalSpin).filter(Boolean);
  let pool = easyResults.filter((r) => Math.abs(r.ecart) <= tolerance);
  let usedHardSpin = false;
  let allResults = easyResults;

  if (pool.length === 0) {
    const hardResults = DUNK_HARD_SPINS.map(evalSpin).filter(Boolean);
    allResults = allResults.concat(hardResults);
    const hardWithinTolerance = hardResults.filter(
      (r) => Math.abs(r.ecart) <= tolerance,
    );
    if (hardWithinTolerance.length > 0) {
      pool = hardWithinTolerance;
      usedHardSpin = true;
    }
  }

  // Rien dans la tolérance à aucun palier : on prend le meilleur résultat
  // valide (power <= 100%) trouvé toutes plages confondues plutôt que
  // d'abandonner.
  if (pool.length === 0) pool = allResults;

  // "pool" (et donc "allResults") est vide UNIQUEMENT si, pour TOUS les
  // spins testés (easy + hard), aucun n'a de puissance <= 100%. C'est le
  // seul vrai cas "impossible".
  if (pool.length === 0) {
    return {
      success: false,
      reasonKey: "shot_out_of_range",
      reasonParams: { maxSpin: 30 },
    };
  }

  const best = pool.reduce((a, b) =>
    Math.abs(a.ecart) < Math.abs(b.ecart) ? a : b,
  );
  const withinTolerance = Math.abs(best.ecart) <= tolerance;

  return {
    success: true, // choix délibéré : un candidat existe, on l'applique
    spin: best.spin,
    curva: best.curva,
    capler: best.capler,
    distanceYards: best.distanceYards,
    ecart: best.ecart,
    withinTolerance: withinTolerance,
    usedHardSpin: usedHardSpin,
    warningKey: usedHardSpin
      ? "dunk_hard_spin_used"
      : !withinTolerance
        ? "dunk_out_of_tolerance"
        : null,
    warningParams: usedHardSpin ? {} : !withinTolerance ? { tolerance } : {},
  };
}

/**
 * BOUTON 2 : Optimisation du Spin pour un Tomahawk/Spike.
 *
 * Palier 1 — Direct : jamais de spin négatif, jamais "devant" (trop
 *   court). Plage [0, +0.10], arrondi ceil. Facile 0/+8, repli +8.5/+30.
 *
 * Palier 2 — Rétro : si rien en direct, on autorise la balle à tomber
 *   derrière le trou dans la fenêtre où le backspin la ramène dedans.
 *   Spin ∈ [1, 7], ecart ∈ ]0.10, retroEcartMax(spin)] (interpolation
 *   linéaire spin 1 → 0.10y, spin 7 → 1.00y). Priorité au plus petit
 *   écart (le plus proche du trou).
 *
 * Palier 3 — Fallback : si ni direct ni rétro, on retourne le résultat
 *   direct même hors tolérance (comportement historique).
 */
function findBestTomahawkSpikeSpin(input_values, options = {}) {
  const curva = options.curva != null ? options.curva : input_values.curva || 0;
  const fallbackSpin = options.fallbackSpin != null ? options.fallbackSpin : 7;

  // --- Palier 1 : direct (jamais devant) ---
  const direct = findBestShotSpin(input_values, {
    spins: TOMAHAWK_EASY_SPINS,
    extendedSpins: TOMAHAWK_EXTENDED_SPINS,
    curva: curva,
    spinOptions: { positiveOnly: true },
    minDelta: 0,
    maxDelta: DUNK_TOLERANCE,
    fallbackSpin: fallbackSpin,
    roundMode: "ceil",
  });

  if (direct.success) return direct;

  // --- Palier 2 : rétro ---
  const retro = findBestRetroSpin(input_values, { curva });
  if (retro) return retro;

  // --- Palier 3 : fallback (résultat direct même hors tolérance) ---
  return direct;
}
