/**
 * =====================================================================
 * FICHIER : main.js
 * DESCRIPTION : Point d'entrée principal de l'application Smart Pangya Calculator
 * AUTEUR : Onezim
 * DÉPENDANCES : Tauri (core, window)
 * =====================================================================
 * Ce fichier gère :
 *   1. L'initialisation de l'application
 *   2. La barre de titre personnalisée (minimiser, maximiser, fermer)
 *   3. L'affichage de la fenêtre principale
 *   4. Les interactions avec le backend Tauri (invoke)
 * =====================================================================
 */

/**
 * IIFE (Immediately Invoked Function Expression)
 * Permet d'isoler le code dans son propre scope pour éviter les conflits
 * avec d'autres scripts de l'application.
 */
(function () {
  "use strict"; // Active le mode strict pour une meilleure sécurité et détection d'erreurs

  // ================================================================
  // DÉPENDANCES TAURI
  // ================================================================

  /**
   * Récupération des modules Tauri depuis l'objet global window.__TAURI__
   * - invoke : Permet d'appeler des fonctions du backend Rust
   * - getCurrentWindow : Récupère l'instance de la fenêtre actuelle
   */
  const { invoke } = window.__TAURI__.core;
  const { getCurrentWindow } = window.__TAURI__.window;

  // ================================================================
  // VARIABLES GLOBALES (scope de l'IIFE)
  // ================================================================

  let greetInputEl; // Champ de saisie pour le nom (fonctionnalité de démonstration)
  let greetMsgEl; // Élément d'affichage du message de salutation
  let win = null; // Instance de la fenêtre Tauri (initialisée dans setupTitlebar)

  // ================================================================
  // FONCTION : greet()
  // DESCRIPTION : Appelle le backend Tauri pour afficher un message de salutation
  // USAGE : Utilisée par le formulaire #greet-form (fonctionnalité de démo)
  // ================================================================

  /**
   * Appelle la fonction Rust "greet" via Tauri invoke
   * Envoie le nom saisi et affiche la réponse dans greetMsgEl
   * @async
   * @returns {Promise<void>}
   */
  async function greet() {
    greetMsgEl.textContent = await invoke("greet", {
      name: greetInputEl.value,
    });
  }

  // ================================================================
  // FONCTION : setupTitlebar()
  // DESCRIPTION : Configure les boutons de la barre de titre personnalisée
  // ================================================================

  /**
   * Initialise les événements des boutons de la barre de titre
   * - Minimiser : Réduit la fenêtre
   * - Maximiser : Agrandit/rétablit la fenêtre (icône change dynamiquement)
   * - Fermer : Ferme l'application
   *
   * @throws {Error} Si les boutons ne sont pas trouvés dans le DOM
   */
  function setupTitlebar() {
    // Récupération de l'instance de la fenêtre Tauri
    win = getCurrentWindow();

    // Sélection des boutons de la barre de titre
    const minimizeBtn = document.getElementById("titlebar-minimize");
    const maximizeBtn = document.getElementById("titlebar-maximize");
    const closeBtn = document.getElementById("titlebar-close");

    // Vérification de la présence des boutons dans le DOM
    if (!minimizeBtn && !maximizeBtn && !closeBtn) {
      console.warn("⚠️ Aucun bouton de barre de titre trouvé !");
      console.warn("Vérifie les IDs dans index.html :");
      console.warn("  - titlebar-minimize");
      console.warn("  - titlebar-maximize");
      console.warn("  - titlebar-close");
      return;
    }

    /**
     * Événement : BOUTON MINIMISER
     * Réduit la fenêtre au minimum
     */
    if (minimizeBtn) {
      minimizeBtn.addEventListener("click", () => {
        win.minimize();
      });
    }

    /**
     * Événement : BOUTON MAXIMISER
     * Bascule entre maximisé et rétabli
     * L'icône change selon l'état : ☐ (normal) / ☒ (maximisé)
     */
    if (maximizeBtn) {
      maximizeBtn.addEventListener("click", async () => {
        try {
          if (await win.isMaximized()) {
            // Si maximisé, on rétablit la fenêtre
            await win.unmaximize();
            maximizeBtn.textContent = "☐"; // Icône "normal"
          } else {
            // Sinon, on maximise
            await win.maximize();
            maximizeBtn.textContent = "☒"; // Icône "maximisé"
          }
        } catch (err) {
          console.error("❌ Erreur maximisation:", err);
        }
      });

      /**
       * Synchronisation de l'icône au démarrage
       * Vérifie l'état actuel de la fenêtre et ajuste l'icône en conséquence
       */
      win
        .isMaximized()
        .then((isMax) => {
          if (isMax) maximizeBtn.textContent = "☒";
        })
        .catch(() => {
          // Ignorer les erreurs - l'icône reste par défaut
        });
    }

    /**
     * Événement : BOUTON FERMER
     * Ferme définitivement l'application
     */
    if (closeBtn) {
      closeBtn.addEventListener("click", () => {
        win.close();
      });
    }
  }

  // ================================================================
  // FONCTION : showWindow()
  // DESCRIPTION : Affiche la fenêtre principale de l'application
  // ================================================================

  /**
   * Affiche la fenêtre Tauri
   * Utilisée après le chargement du DOM pour garantir que tout est prêt
   * @async
   * @returns {Promise<void>}
   */
  async function showWindow() {
    try {
      // Récupère l'instance si elle n'existe pas encore
      if (!win) win = getCurrentWindow();
      await win.show(); // Affiche la fenêtre
    } catch (error) {
      console.error("❌ Erreur affichage fenêtre:", error);
    }
  }

  // ================================================================
  // INITIALISATION DE L'APPLICATION
  // ================================================================

  /**
   * Point d'entrée principal
   * S'exécute lorsque le DOM est complètement chargé
   */
  document.addEventListener("DOMContentLoaded", () => {
    // ============================================================
    // 1. CONFIGURATION DU FORMULAIRE DE SALUTATION (DÉMO)
    // ============================================================
    // Note : Cette section est une fonctionnalité de démonstration
    // Elle peut être supprimée ou désactivée dans la version finale
    // ============================================================

    greetInputEl = document.querySelector("#greet-input");
    greetMsgEl = document.querySelector("#greet-msg");

    // Écoute la soumission du formulaire de salutation
    document.querySelector("#greet-form")?.addEventListener("submit", (e) => {
      e.preventDefault(); // Empêche le rechargement de la page
      greet(); // Appelle le backend pour afficher le message
    });

    // ============================================================
    // 2. CONFIGURATION DE LA BARRE DE TITRE
    // ============================================================

    setupTitlebar(); // Initialise les boutons de contrôle de la fenêtre

    // ============================================================
    // 3. AFFICHAGE DE LA FENÊTRE
    // ============================================================
    // Un délai de 300ms permet au DOM et aux styles de se charger
    // avant d'afficher la fenêtre, évitant les flashs visuels
    // ============================================================

    setTimeout(showWindow, 300);
  });
})(); // Fin de l'IIFE - le code est isolé du scope global
