// utils/dunk_options_utils.js
(function () {
  "use strict";

  document.addEventListener("DOMContentLoaded", function () {
    const chkPos = document.getElementById("chk-spin-positive");
    const chkNeg = document.getElementById("chk-spin-negative");
    // Exclusion mutuelle pour les spins (positif / négatif)
    if (chkPos && chkNeg) {
      chkPos.addEventListener("change", function () {
        if (this.checked) chkNeg.checked = false;
      });

      chkNeg.addEventListener("change", function () {
        if (this.checked) chkPos.checked = false;
      });
    }
  });
})();
