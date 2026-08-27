// dunk_request_listener.js
//
// À charger dans la FENÊTRE PRINCIPALE (app.js), après smart_calculator.js,
// dunk_optimizer.js et dunk_button.js (réutilise buildInputValuesFromForm
// définie dans dunk_button.js).
//
// Écoute "request-dunk-optimization" émis par calc_overlay (ou toute autre
// fenêtre), reconstruit les input_values à partir du DOM de la fenêtre
// principale (donc avec le vrai power_player du personnage sélectionné),
// applique les champs reçus depuis l'overlay (distance/height/wind/etc.
// peuvent différer si l'overlay n'est pas synchronisé à 100%), calcule le
// meilleur spin/capler, puis émet "dunk-optimization-result".

(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    if (!window.TauriService?.isAvailable) return;

    window.TauriService.listen("request-dunk-optimization", function (event) {
      const payload = event.payload || {};

      // Les champs synchronisés (sync-input-value) sont normalement déjà
      // à jour dans le DOM de la fenêtre principale ; par sécurité, on
      // applique quand même les valeurs reçues si fournies, pour être sûr
      // de calculer sur les mêmes données que l'overlay affichait.
      const idsToApply = [
        "club",
        "shot",
        "power_shot",
        "distance",
        "height",
        "wind",
        "degree",
        "ground",
        "curve",
        "slope_break",
      ];
      idsToApply.forEach(function (id) {
        if (payload[id] !== undefined) {
          const el = document.getElementById(id);
          if (el) el.value = payload[id];
        }
      });

      const input_values = window.buildInputValuesFromForm
        ? window.buildInputValuesFromForm()
        : null;

      if (!input_values) {
        console.error("❌ buildInputValuesFromForm indisponible");
        window.TauriService.emit("dunk-optimization-result", {
          success: false,
          reason: "Fonction de construction des paramètres indisponible.",
        });
        return;
      }

      const dunkResult = (function () {
        const shotValue = String(input_values.shot);
        if (shotValue === String(SHOT_TYPE.DUNK))
          return findBestDunkSpin(input_values);
        if (
          shotValue === String(SHOT_TYPE.TOMAHAWK) ||
          shotValue === String(SHOT_TYPE.SPIKE)
        )
          return findBestTomahawkSpikeSpin(input_values);
        return {
          success: false,
          reason: "Type de shot non optimisable (Cobra).",
        };
      })();
      window.TauriService.emit("dunk-optimization-result", dunkResult);
    });
  });
})();
