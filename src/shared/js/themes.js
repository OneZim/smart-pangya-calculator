// themes.js

(function () {
  "use strict";

  const THEMES = {
    "dark-golf": {
      name: "🌙 Dark Golf",
      css: "shared/css/themes/dark-golf.css",
    },
    "pangya-pastel": {
      name: "🌸 PangYa Pastel",
      css: "shared/css/themes/pangya-pastel.css",
    },
    "pangya-classic": {
      name: "🌊 PangYa Classic",
      css: "shared/css/themes/pangya-classic.css",
    },
  };

  // Storage (Tauri Store) — assigné dans initThemesSystem(). Fallback
  // silencieux sur localStorage si StorageService n'est pas chargé dans
  // cette fenêtre.
  let storage = null;

  // Valeur par défaut ; corrigée dans initThemesSystem() une fois
  // storage.init() terminé (lecture async, donc pas dispo à ce stade).
  let currentTheme = "pangya-classic";

  // ================================================================
  // CHARGER LE CSS DU THÈME
  // ================================================================

  function loadThemeCSS(themeKey) {
    const theme = THEMES[themeKey];
    if (!theme) return;

    // Supprimer l'ancien fichier CSS
    const oldLink = document.getElementById("theme-stylesheet");
    if (oldLink) {
      oldLink.remove();
    }

    // Créer un nouveau lien
    const link = document.createElement("link");
    link.id = "theme-stylesheet";
    link.rel = "stylesheet";
    link.href = theme.css;

    link.onload = function () {};
    link.onerror = function () {
      // Fallback : utiliser les variables CSS
      applyThemeVariables(themeKey);
    };

    document.head.appendChild(link);
  }

  // ================================================================
  // APPLIQUER LES VARIABLES CSS (fallback)
  // ================================================================

  function applyThemeVariables(themeKey) {
    const root = document.documentElement;

    const variables = {
      "dark-golf": {
        "--bg-body": "#111318",
        "--bg-card": "#181b22",
        "--bg-input": "#0d0f14",
        "--border": "#252830",
        "--border-input": "#2e323e",
        "--text": "#dde0ea",
        "--text-soft": "#7a7e90",
        "--text-label": "#7a7e90",
        "--accent": "#3d6b50",
        "--accent-hover": "#4e8864",
        "--accent-dark": "#2e5240",
        "--gold": "#c9a84c",
        "--shadow": "0 4px 20px rgba(0, 0, 0, 0.45)",
        "--shadow-hover": "0 8px 32px rgba(61, 107, 80, 0.12)",
        "--panel-bg": "#14171e",
        "--toggle-bg": "#1e2128",
        "--toggle-checked": "#2e3a32",
        "--modal-bg": "#1e2128",
        "--modal-border": "#8b2a33",
        "--scrollbar": "#3d6b50",
        "--scrollbar-hover": "#4e8864",
      },
      "pangya-pastel": {
        "--bg-body":
          "linear-gradient(180deg, #8fd8f8 0%, #cdeaff 45%, #ffd6ec 100%)",
        "--bg-card": "#fffaf3",
        "--bg-input": "#fff3f9",
        "--border": "#ffc2e0",
        "--border-input": "#ffd3e8",
        "--text": "#4a3b52",
        "--text-soft": "#9a86a0",
        "--text-label": "#9a86a0",
        "--accent": "#ff6fa5",
        "--accent-hover": "#ff8fbb",
        "--accent-dark": "#d94f83",
        "--gold": "#ffb400",
        "--shadow": "0 6px 20px rgba(255, 111, 165, 0.18)",
        "--shadow-hover": "0 8px 28px rgba(255, 111, 165, 0.25)",
        "--panel-bg": "#fff6ef",
        "--toggle-bg": "#ffe3f0",
        "--toggle-checked": "#ffd3e8",
        "--modal-bg": "#fffaf3",
        "--modal-border": "#ef5a70",
        "--scrollbar": "#ffc2e0",
        "--scrollbar-hover": "#ff6fa5",
      },
      "pangya-classic": {
        "--bg-body":
          "linear-gradient(180deg, #79cbff 0%, #bfe8ff 45%, #eefbff 100%)",
        "--bg-card": "linear-gradient(135deg, #ffffff, #edf8ff)",
        "--bg-input": "#ffffff",
        "--border": "#72c8ff",
        "--border-input": "#97d8ff",
        "--text": "#2f5879",
        "--text-soft": "#6587a5",
        "--text-label": "#34678f",
        "--accent": "#2f96e5",
        "--accent-hover": "#5ec1ff",
        "--accent-dark": "#2997ff",
        "--gold": "#ffb200",
        "--shadow": "0 6px 20px rgba(0, 110, 180, 0.18)",
        "--shadow-hover": "0 10px 26px rgba(0, 120, 220, 0.22)",
        "--panel-bg": "#edf8ff",
        "--toggle-bg": "#d8f3ff",
        "--toggle-checked": "#8de4ff",
        "--modal-bg": "#ffffff",
        "--modal-border": "#2f96e5",
        "--scrollbar": "#97e6ff",
        "--scrollbar-hover": "#4eb8ff",
      },
    };

    const themeVars = variables[themeKey];
    if (!themeVars) return;

    for (const [key, value] of Object.entries(themeVars)) {
      root.style.setProperty(key, value);
    }
  }

  // ================================================================
  // CHARGER UN THÈME COMPLET
  // ================================================================

  function loadTheme(themeKey) {
    const theme = THEMES[themeKey];
    if (!theme) {
      console.warn(`⚠️ Thème "${themeKey}" inconnu`);
      return;
    }

    // 1. Charger le CSS du thème
    loadThemeCSS(themeKey);

    // 2. Appliquer les variables CSS (fallback)
    applyThemeVariables(themeKey);

    currentTheme = themeKey;
    if (storage) {
      storage.set("theme", themeKey);
    }
    // Miroir synchrone pour theme-loader.js : ce script s'exécute très
    // tôt (avant peinture) pour éviter un flash du thème par défaut, et
    // ne peut pas attendre une lecture async du plugin Store. On garde
    // donc localStorage à jour en parallèle, uniquement pour cet usage.
    localStorage.setItem("pangya_theme", themeKey);

    // 3. Mettre à jour le sélecteur
    const selector = document.getElementById("theme-selector");
    if (selector) {
      selector.value = themeKey;
    }
  }

  // ================================================================
  // GESTION DE LA LANGUE
  // ================================================================

  function initLanguageSelector() {
    const selector = document.getElementById("lang-selector");
    if (!selector) return;

    const savedLang = storage
      ? storage.get("app_lang", "fr")
      : localStorage.getItem("app_lang") || "fr";
    selector.value = savedLang;

    selector.addEventListener("change", () => {
      const lang = selector.value;
      if (storage) {
        storage.set("app_lang", lang);
      } else {
        localStorage.setItem("app_lang", lang);
      }
      if (typeof applyTranslations === "function") {
        applyTranslations(lang);
      } else {
        location.reload();
      }
    });
  }

  // ================================================================
  // INITIALISATION
  // ================================================================

  function initThemeSelector() {
    const selector = document.getElementById("theme-selector");
    if (!selector) {
      console.warn("⚠️ Sélecteur de thème non trouvé");
      return;
    }

    // Charger le thème sauvegardé
    selector.value = currentTheme;

    // === CHARGER LE THÈME AU DÉMARRAGE ===
    loadTheme(currentTheme);

    // Écouter les changements
    selector.addEventListener("change", () => {
      const themeKey = selector.value;
      if (themeKey && themeKey !== currentTheme) {
        loadTheme(themeKey);
      }
    });
  }

  // ================================================================
  // POINT D'ENTRÉE (storage d'abord, puis sélecteurs)
  // ================================================================

  async function initThemesSystem() {
    // Fenêtre séparée : StorageService doit être chargé (balise <script>
    // dans le HTML de cette fenêtre) et initialisé ici indépendamment.
    storage = window.StorageService || null;
    if (storage) {
      await storage.init();
      currentTheme = storage.get("theme", "pangya-classic");
    } else {
      console.warn(
        "⚠️ StorageService non chargé dans cette fenêtre — fallback localStorage pour thème/langue.",
      );
      currentTheme = localStorage.getItem("pangya_theme") || "pangya-classic";
    }

    initThemeSelector();
    initLanguageSelector();
  }

  // Attendre que le DOM soit chargé
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", initThemesSystem);
  } else {
    initThemesSystem();
  }
})();
