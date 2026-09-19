// utils/recalc.js - Fichier central pour le recalcul
(function () {
  "use strict";

  // === FONCTION DE RECALCUL UNIQUE ===
  function triggerCalc() {
    if (typeof window.calc === "function") {
      clearTimeout(window._calcTimeout);
      window._calcTimeout = setTimeout(() => {
        window.calc();
      }, 150);
    }
  }

  // === EXPOSER GLOBALEMENT ===
  window.triggerCalc = triggerCalc;

  // === FONCTION POUR ATTACHER LES ÉCOUTEURS ===
  function attachListeners() {
    const elements = document.querySelectorAll(
      "#content1 input, #content1 select",
    );
    elements.forEach((el) => {
      el.removeEventListener("input", triggerCalc);
      el.removeEventListener("change", triggerCalc);
      el.addEventListener("input", triggerCalc);
      el.addEventListener("change", triggerCalc);
    });
  }

  // === EXPOSER LA FONCTION D'ATTACHEMENT ===
  window.attachRecalcListeners = attachListeners;

  // === ATTACHER AUTOMATIQUEMENT AU CHARGEMENT ===
  function init() {
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", attachListeners);
    } else {
      attachListeners();
    }
  }

  init();
})();
