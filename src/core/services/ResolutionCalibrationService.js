// core/services/ResolutionCalibrationService.js
//
// Table de calibration par résolution de jeu Pangya (Auto Fit HitBar DÉSACTIVÉ).
//
// POURQUOI UNE TABLE ET PAS UNE FORMULE :
// La jauge du jeu n'a pas de comportement prévisible selon la résolution
// (sensibilité ET position non proportionnelles, mesurées à l'appui). Chaque
// entrée est donc calibrée à la main, indépendante des autres : aucun
// héritage de valeurs entre résolutions, seulement un repli sur la référence
// si un champ manque.
//
// RÉSOLUTION NON CALIBRÉE :
// Repli simple sur la référence 1920x1080 (valeurs complètes) — aucune
// estimation de position. La table sert telle quelle (_source: "estimated").
//
// COMMENT CALIBRER UNE NOUVELLE RÉSOLUTION :
// 1. Jeu à la résolution voulue, Auto Fit HitBar désactivé.
// 2. Capture d'écran du jeu (les pixels de l'image == coordonnées client,
//    le (0,0) étant le coin haut-gauche de la zone cliente).
// 3. Mesurer le centre de la jauge — demi-pixels acceptés (423.5 est valide).
// 4. Ajouter une entrée avec la clé "LARGEURxHAUTEUR" et noter les conditions
//    (_note / autoFitHitBar) pour s'en souvenir plus tard.

(function () {
  "use strict";

  // Résolution sur laquelle les constantes génériques ont été calibrées.
  const REFERENCE_KEY = "1920x1080";

  const CALIBRATIONS = {
    "1920x1080": {
      _note:
        "Référence — centre mesuré sur capture, reste calibré à l'œil (correction rendu intégrée)",
      autoFitHitBar: false,
      spinDialCenter: { x: 436, y: 964 },
      pxParUniteSpin: 2,
      // Règle PB : px par unité, selon zoom (80 = Smart PB ~80%, 100 = PB Max).
      pxPerPb: { 80: 20.3, 100: 81 },
      // Px par PB sur la jauge réelle du joueur (calibré à l'œil).
      realPxPerPb: 72,
      // Positions verticales de la règle (ruler-container porte l'offset,
      // indicator-lines les traits). Référence 1920x1080 — héritées par les
      // autres résolutions tant qu'elles n'ont pas leur propre valeur.
      rulerContainerTop: 525,
      rulerIndicatorTop: 20,
      rulerTRepereTop: -48,

      // Depuis la recentration du marqueur (origine = centre fenêtre), ces
      // offsets ne servent plus qu'au réglage résiduel : ~0 attendu.
      ancrageZero: 0,
      ancrageZeroX: 0,
      cercleSize: 120,
      trait: { w: 10, h: 2, top: 1 },
      cercleRepere: { size: 22, top: 10 },
      traitBas: { w: 10, h: 2, top: 37 },
      traitR: { w: 2, h: 12, top: 9, offset: 20 },
      traitL: { w: 2, h: 12, top: 9, offset: 20 },
    },
    "1600x900": {
      _note: "Calibrée à l'œil le même jour que 1280x720 (Auto Fit désactivé)",
      autoFitHitBar: false,
      spinDialCenter: { x: 538, y: 842 },
      pxParUniteSpin: 1,
      // Règle PB : px par unité, selon zoom (80 = Smart PB ~80%, 100 = PB Max).
      pxPerPb: { 80: 16.9, 100: 67.9 },
      // Px par PB sur la jauge réelle du joueur (calibré à l'œil).
      realPxPerPb: 36,
      // Depuis la recentration du marqueur (origine = centre fenêtre), ces
      // offsets ne servent plus qu'au réglage résiduel : ~0 attendu.
      rulerContainerTop: 430,
      rulerIndicatorTop: 20,
      rulerTRepereTop: 43,

      ancrageZero: 0,
      ancrageZeroX: 0,
      cercleSize: 62,
      trait: { w: 7, h: 1, top: 8 },
      cercleRepere: { size: 15, top: 10 },
      traitBas: { w: 7, h: 1, top: 26 },
      traitR: { w: 1, h: 8, top: 10, offset: 10 },
      traitL: { w: 1, h: 8, top: 10, offset: 10 },
    },
    "1440x900": {
      _note:
        "Calibrée à l'œil le même jour que 1600x900 (Auto Fit désactivé) — correction rendu intégrée",
      autoFitHitBar: false,
      spinDialCenter: { x: 458, y: 842 },
      pxParUniteSpin: 0.99,
      // Règle PB : px par unité, selon zoom (80 = Smart PB ~80%, 100 = PB Max).
      pxPerPb: { 80: null, 100: 36 },
      // Px par PB sur la jauge réelle du joueur (calibré à l'œil).
      realPxPerPb: 36,
      // Depuis la recentration du marqueur (origine = centre fenêtre), ces
      // offsets ne servent plus qu'au réglage résiduel : ~0 attendu.
      rulerContainerTop: 430,
      rulerIndicatorTop: 30,
      rulerTRepereTop: 43,

      ancrageZero: 0,
      ancrageZeroX: 0,
      cercleSize: 62,
      trait: { w: 7, h: 1, top: 8 },
      cercleRepere: { size: 15, top: 10 },
      traitBas: { w: 7, h: 1, top: 26 },
      traitR: { w: 1, h: 9, top: 9.5, offset: 10 },
      traitL: { w: 1, h: 9, top: 9.5, offset: 10 },
    },

    "1400x900": {
      _note:
        "Calibrée à l'œil le même jour que 1600x900 (Auto Fit désactivé) — correction rendu intégrée",
      autoFitHitBar: false,
      spinDialCenter: { x: 438, y: 842 },
      pxParUniteSpin: 0.99,
      // Règle PB : px par unité, selon zoom (80 = Smart PB ~80%, 100 = PB Max).
      pxPerPb: { 80: 17, 100: 50 },
      // Px par PB sur la jauge réelle du joueur (calibré à l'œil).
      realPxPerPb: 36,
      // Depuis la recentration du marqueur (origine = centre fenêtre), ces
      // offsets ne servent plus qu'au réglage résiduel : ~0 attendu.
      rulerContainerTop: 430,
      rulerIndicatorTop: 40,
      rulerTRepereTop: 43,
      ancrageZero: 0,
      ancrageZeroX: 0,
      cercleSize: 62,
      trait: { w: 7, h: 1, top: 8 },
      cercleRepere: { size: 15, top: 10 },
      traitBas: { w: 7, h: 1, top: 26 },
      traitR: { w: 1, h: 9, top: 9.5, offset: 10 },
      traitL: { w: 1, h: 9, top: 9.5, offset: 10 },
    },
    "1280x720": {
      _note:
        "Calibrée à l'œil le même jour que 1600x900 (Auto Fit désactivé) — correction rendu intégrée",
      autoFitHitBar: false,
      spinDialCenter: { x: 378, y: 662 },
      pxParUniteSpin: 0.99,
      // Règle PB : px par unité, selon zoom (80 = Smart PB ~80%, 100 = PB Max).
      pxPerPb: { 80: 13.69, 100: 54.26 },
      // Px par PB sur la jauge réelle du joueur (calibré à l'œil).
      realPxPerPb: 36,
      // Depuis la recentration du marqueur (origine = centre fenêtre), ces
      // offsets ne servent plus qu'au réglage résiduel : ~0 attendu.
      rulerContainerTop: 325,
      rulerIndicatorTop: 20,
      rulerTRepereTop: 43,

      ancrageZero: 0,
      ancrageZeroX: 0,
      cercleSize: 62,
      trait: { w: 7, h: 1, top: 8 },
      cercleRepere: { size: 15, top: 10 },
      traitBas: { w: 7, h: 1, top: 26 },
      traitR: { w: 1, h: 9, top: 9.5, offset: 10 },
      traitL: { w: 1, h: 9, top: 9.5, offset: 10 },
    },
  };

  function keyFor(width, height) {
    return `${width}x${height}`;
  }

  // Fusionne une entrée partielle sur une base : les champs renseignés
  // priment, les champs absents/null gardent la valeur de base. Les champs
  // internes (préfixe _) ne participent pas à la fusion.
  function mergeEntry(base, entry) {
    const merged = { ...base };
    for (const key of Object.keys(entry)) {
      if (key.startsWith("_")) continue;
      if (entry[key] !== null && entry[key] !== undefined) {
        merged[key] = entry[key];
      }
    }
    return merged;
  }

  // Retourne la calibration pour une résolution donnée.
  // - Entrée calibrée existe -> fusion avec la référence (_source: "calibrated")
  // - Pas d'entrée           -> référence 1920x1080 telle quelle (_source: "estimated")
  function getCalibration(width, height) {
    const reference = CALIBRATIONS[REFERENCE_KEY];
    const entry = CALIBRATIONS[keyFor(width, height)];

    if (!entry) {
      return { ...reference, _source: "estimated" };
    }

    return { ...mergeEntry(reference, entry), _source: "calibrated" };
  }

  function hasCalibration(width, height) {
    return Boolean(CALIBRATIONS[keyFor(width, height)]);
  }

  function listCalibratedResolutions() {
    return Object.keys(CALIBRATIONS);
  }

  window.ResolutionCalibrationService = {
    getCalibration,
    hasCalibration,
    listCalibratedResolutions,
  };
})();
