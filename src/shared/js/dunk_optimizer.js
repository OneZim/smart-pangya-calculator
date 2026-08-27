// dunk_optimizer.js
//
// Cherche le meilleur couple (spin, capler) pour réussir un dunk, en
// recalculant la vraie distance via le moteur physique du jeu (find_power)
// pour chaque spin candidat, plutôt que d'approximer avec une table de
// référence. Ce fichier réutilise find_power(), déjà défini dans
// smart_calculator.js — il doit donc être chargé APRÈS smart_calculator.js
// (via <script>, dans le même scope global classique, sans type="module").
//
// Nécessite en entrée le même "input_values" que calc() construit déjà
// (power_player, club_info, shot, power_shot, distance, height, wind,
// degree, ground, curva, slope) — seul le spin varie d'un appel à l'autre.

const DUNK_TOTAL_CRANS = 360; // nombre de crans fixes sur toute la jauge (0 à 100%)
// Génère une liste de spins de `start` à `end` inclus, par pas de 0.5.
function generateSpinRange(start, end) {
  const list = [];
  for (let s = start; s <= end + 1e-9; s += 0.5) {
    list.push(Math.round(s * 2) / 2);
  }
  return list;
}

const DUNK_EASY_SPINS = generateSpinRange(0, 1).concat(
  generateSpinRange(3, 15),
); // 0,0.5,1,6,6.5,...,11
const DUNK_HARD_SPINS = generateSpinRange(0, 2); // 2,2.5,3,3.5,4,4.5,5
const DUNK_EXTENDED_SPINS = generateSpinRange(15, 30); // fallback si 0-11 ne suffit pas (power > 100%)
const DUNK_TOLERANCE = 0.1; // tolérance de dunk en jeu (+/- 0.10)

// Recalcule distanceYards pour un spin donné, en relançant la même boucle
// de convergence que calc() (find_power + do-while sur le désvio), mais
// avec un spin différent des autres paramètres identiques.
function computeDistanceForSpin(input_values, spin) {
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
    input_values.curva,
    input_values.slope,
  );

  let f = [found];
  let index_f = 0;

  if (found.power != -1) {
    do {
      index_f++;
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
          input_values.curva,
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

  if (f[index_f].power == -1) return null;

  const distanceYards =
    parseFloat((f[index_f].power_range * f[index_f].power).toFixed(1)) || 0.0;

  return {
    distanceYards: distanceYards,
    powerRange: f[index_f].power_range,
    power: f[index_f].power,
  };
}

// Fonction générique : cherche, parmi une liste de spins candidats, celui
// dont le capler atteignable (arrondi au cran réel) respecte une plage
// d'écart [minDelta, maxDelta] (en yards) par rapport à la distance
// nécessaire pour ce spin. Si aucun spin ne rentre dans la plage, on
// retombe sur un spin par défaut (fallbackSpin), avec un avertissement.
//
// - Dunk : plage symétrique [-0.20, +0.20] (voir findBestDunkSpin)
// - Tomahawk/Spike : la balle ne doit jamais tomber "trop court" ; plage
//   [0, +0.30] (ne peut être qu'à l'exact ou légèrement au-delà)
function findBestShotSpin(input_values, options) {
  options = options || {};
  const spins = options.spins || [];
  const extendedSpins = options.extendedSpins || [];
  const minDelta =
    options.minDelta != null ? options.minDelta : -DUNK_TOLERANCE;
  const maxDelta = options.maxDelta != null ? options.maxDelta : DUNK_TOLERANCE;
  const fallbackSpin = options.fallbackSpin;

  function evalSpin(spin) {
    const res = computeDistanceForSpin(input_values, spin);
    if (!res) return null;

    // power > 1.0 (100%) : la distance nécessaire pour ce spin dépasse ce
    // que le club peut atteindre à fond — ce spin ne peut pas réaliser ce
    // tir, quel que soit le cran visé. On l'exclut des candidats.
    if (res.power > 1.0) return null;

    const step = res.powerRange / DUNK_TOTAL_CRANS;
    const nCrans = Math.round(res.distanceYards / step);
    const achievableCapler = Math.round(nCrans * step * 10) / 10;
    const ecart =
      Math.round((achievableCapler - res.distanceYards) * 100) / 100;

    return {
      spin: spin,
      capler: achievableCapler,
      distanceYards: res.distanceYards,
      ecart: ecart,
    };
  }

  let results = spins.map(evalSpin).filter(function (r) {
    return r !== null;
  });

  let withinRange = results.filter(function (r) {
    return r.ecart >= minDelta && r.ecart <= maxDelta;
  });

  let usedExtendedSpin = false;

  // Rien dans la plage principale : on étend la recherche (typiquement un
  // tir qui dépasse 100% de power avec les spins habituels).
  if (withinRange.length === 0 && extendedSpins.length > 0) {
    const extResults = extendedSpins.map(evalSpin).filter(function (r) {
      return r !== null;
    });
    results = results.concat(extResults);
    withinRange = results.filter(function (r) {
      return r.ecart >= minDelta && r.ecart <= maxDelta;
    });
    if (withinRange.length > 0) usedExtendedSpin = true;
  }

  let best;
  let usedFallback = false;

  if (withinRange.length > 0) {
    best = withinRange.reduce(function (a, b) {
      return Math.abs(a.ecart) < Math.abs(b.ecart) ? a : b;
    });
  } else {
    const fallbackResult = fallbackSpin != null ? evalSpin(fallbackSpin) : null;

    if (fallbackResult) {
      // Le spin par défaut donne au moins un résultat exploitable, même
      // hors tolérance (ex: distance vraiment hors de portée du club).
      best = fallbackResult;
      usedFallback = true;
    } else if (results.length > 0) {
      // Le spin par défaut lui-même échoue (find_power impossible pour ce
      // spin précis), mais d'autres spins testés donnent un résultat :
      // on prend le meilleur disponible plutôt que d'abandonner.
      best = results.reduce(function (a, b) {
        return Math.abs(a.ecart) < Math.abs(b.ecart) ? a : b;
      });
      usedFallback = true;
    } else {
      // Vraiment aucun spin testé ne permet de calculer une distance :
      // le tir est hors de portée du club quel que soit le spin.
      return {
        success: false,
        reason: "Tir hors de portée du club, quel que soit le spin testé.",
      };
    }
  }

  const withinConstraint = best.ecart >= minDelta && best.ecart <= maxDelta;

  return {
    success: withinConstraint,
    spin: best.spin,
    capler: best.capler,
    distanceYards: best.distanceYards,
    ecart: best.ecart,
    usedFallback: usedFallback,
    usedExtendedSpin: usedExtendedSpin,
    warningKey: usedExtendedSpin
      ? "shot_extended_spin_used"
      : usedFallback
        ? "shot_fallback_spin_used"
        : null,
    warningParams: usedExtendedSpin
      ? {}
      : usedFallback
        ? { minDelta: minDelta, maxDelta: maxDelta, fallbackSpin: fallbackSpin }
        : {},
  };
}

// Wrapper Tomahawk/Spike : spins de 1 à 9 (par pas de 0.5), écart
// obligatoirement entre 0 et +0.30 (jamais trop court), fallback sur
// spin=7 sinon.
function findBestTomahawkSpikeSpin(input_values) {
  const spins = generateSpinRange(2, 8);
  const extendedSpins = generateSpinRange(8.5, 30);
  return findBestShotSpin(input_values, {
    spins: spins,
    extendedSpins: extendedSpins,
    minDelta: 0,
    maxDelta: 0.2,
    fallbackSpin: 7,
  });
}

// vent/etc déjà fixés), cherche le spin qui permet au capler réellement
// atteignable (cran de powerRange/360) de tomber le plus près possible de
// la distance nécessaire pour ce spin, avec une préférence pour les spins
// "faciles" à caler.
//
// options.tolerance      : tolérance de dunk (défaut 0.20)
// options.allowHardSpins : autoriser 2-5 si rien de "facile" ne rentre
//                          dans la tolérance (défaut true)
function findBestDunkSpin(input_values, options) {
  options = options || {};
  const tolerance =
    options.tolerance != null ? options.tolerance : DUNK_TOLERANCE;
  const allowHardSpins =
    options.allowHardSpins != null ? options.allowHardSpins : true;

  function evalSpin(spin) {
    const res = computeDistanceForSpin(input_values, spin);
    if (!res) return null;

    // power > 1.0 (100%) : distance hors de portée pour ce spin, quel que
    // soit le cran visé. On l'exclut des candidats.
    if (res.power > 1.0) return null;

    const step = res.powerRange / DUNK_TOTAL_CRANS;
    const nCrans = Math.round(res.distanceYards / step);
    const achievableCapler = Math.round(nCrans * step * 10) / 10;
    const ecart =
      Math.round((achievableCapler - res.distanceYards) * 100) / 100;

    return {
      spin: spin,
      capler: achievableCapler,
      distanceYards: res.distanceYards,
      ecart: ecart,
    };
  }

  const easyResults = DUNK_EASY_SPINS.map(evalSpin).filter(function (r) {
    return r !== null;
  });
  const easyWithinTolerance = easyResults.filter(function (r) {
    return Math.abs(r.ecart) <= tolerance;
  });

  let pool = easyWithinTolerance;
  let usedHardSpin = false;
  let usedExtendedSpin = false;
  let allResults = easyResults;

  if (pool.length === 0 && allowHardSpins) {
    const hardResults = DUNK_HARD_SPINS.map(evalSpin).filter(function (r) {
      return r !== null;
    });
    allResults = allResults.concat(hardResults);
    const hardWithinTolerance = hardResults.filter(function (r) {
      return Math.abs(r.ecart) <= tolerance;
    });
    if (hardWithinTolerance.length > 0) {
      pool = hardWithinTolerance;
      usedHardSpin = true;
    }
  }

  // 3e palier : si rien dans 0-11 ne fonctionne (typiquement un tir qui
  // dépasse 100% de power avec un spin faible), on étend jusqu'à 30 — un
  // spin élevé peut suffire à ramener le power sous 100%.
  if (pool.length === 0) {
    const extendedResults = DUNK_EXTENDED_SPINS.map(evalSpin).filter(
      function (r) {
        return r !== null;
      },
    );
    allResults = allResults.concat(extendedResults);
    const extendedWithinTolerance = extendedResults.filter(function (r) {
      return Math.abs(r.ecart) <= tolerance;
    });
    if (extendedWithinTolerance.length > 0) {
      pool = extendedWithinTolerance;
      usedExtendedSpin = true;
    }
  }

  // Rien dans la tolérance à aucun palier : on prend le meilleur résultat
  // valide (power <= 100%) trouvé toutes plages confondues, plutôt que
  // d'abandonner.
  if (pool.length === 0) pool = allResults;

  if (pool.length === 0) {
    return {
      success: false,
      reasonKey: "dunk_out_of_range",
      reasonParams: { maxSpin: 30 },
    };
  }
  const best = pool.reduce(function (a, b) {
    return Math.abs(a.ecart) < Math.abs(b.ecart) ? a : b;
  });

  const withinTolerance = Math.abs(best.ecart) <= tolerance;

  return {
    success: withinTolerance,
    spin: best.spin,
    capler: best.capler,
    distanceYards: best.distanceYards,
    ecart: best.ecart,
    withinTolerance: withinTolerance,
    usedHardSpin: usedHardSpin,
    usedExtendedSpin: usedExtendedSpin,
    warning: usedExtendedSpin
      ? "Spin élevé (>11) nécessaire pour ramener le tir sous 100% de power."
      : usedHardSpin
        ? "Spin intermédiaire (2-5) utilisé car aucune solution avec spin habituel ne rentrait dans la tolérance."
        : !withinTolerance
          ? "Aucune combinaison ne rentre dans la tolérance +/- " +
            tolerance +
            ", résultat le plus proche affiché."
          : null,
  };
}
