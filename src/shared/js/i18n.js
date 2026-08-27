// =====================================================================
// LE SYSTÈME D'INTERNATIONALISATION
// =====================================================================

let currentLang = "fr"; // valeur par défaut, corrigée dans initLanguageSystem() une fois storage.init() terminé
let currentTranslations = {};
window.i18nReady = false;
let availableLanguages = [];

// Storage (Tauri Store) — assigné dans initLanguageSystem(). Fallback
// silencieux sur localStorage si StorageService n'est pas chargé dans
// cette fenêtre, pour ne rien casser dans les fenêtres d'overlay.
let storage = null;

window.t = function (key) {
  return currentTranslations[key] || key;
};

function getTauriCore() {
  if (window.__TAURI__ && window.__TAURI__.core) return window.__TAURI__.core;
  return null;
}

function getTauriEvent() {
  if (window.__TAURI__ && window.__TAURI__.event) return window.__TAURI__.event;
  return null;
}

// ================================================================
// APPLIQUER UNE LANGUE (cœur commun)
// ================================================================
//
// broadcast: true  -> diffuse le changement aux autres fenêtres (choix utilisateur)
// broadcast: false -> n'applique que localement (chargement initial, ou
//                      réception d'un changement venant d'une autre fenêtre)
//                      pour éviter les boucles de diffusion infinies.

async function applyLanguage(lang, { broadcast = false } = {}) {
  try {
    const tauriCore = getTauriCore();
    if (!tauriCore) return;

    const jsonStr = await tauriCore.invoke("load_language_json", {
      lang: lang,
    });
    currentTranslations = JSON.parse(jsonStr);
    window.i18nReady = true;

    currentLang = lang;
    if (storage) {
      storage.set("app_lang", lang);
    } else {
      localStorage.setItem("app_lang", lang);
    }

    // === METTRE À JOUR TOUS LES ÉLÉMENTS data-i18n ===
    document.querySelectorAll("[data-i18n]").forEach((element) => {
      const key = element.getAttribute("data-i18n");
      if (currentTranslations[key]) {
        element.textContent = currentTranslations[key];
      }
    });

    document.querySelectorAll("[data-i18n-placeholder]").forEach((element) => {
      const key = element.getAttribute("data-i18n-placeholder");
      if (currentTranslations[key]) {
        element.placeholder = currentTranslations[key];
      }
    });

    // === METTRE À JOUR LE SÉLECTEUR ===
    const langSelector = document.getElementById("lang-selector");
    if (langSelector) {
      langSelector.value = lang;
    }

    // === FORCER LA MISE À JOUR DE short-error ===
    const shortError = document.getElementById("short-error");
    if (shortError) {
      const key = shortError.getAttribute("data-i18n");
      if (key && currentTranslations[key]) {
        shortError.textContent = currentTranslations[key];
      }
    }

    // === DIFFUSER AUX AUTRES FENÊTRES (uniquement sur choix explicite) ===
    if (broadcast) {
      try {
        const tauriEvent = getTauriEvent();
        if (tauriEvent) {
          await tauriEvent.emit("app-lang-changed", { lang: lang });
        }
      } catch (e) {
        console.warn("Impossible de diffuser le changement de langue", e);
      }
    }

    // === DÉCLENCHER L'ÉVÉNEMENT LOCAL ===
    document.dispatchEvent(
      new CustomEvent("i18n-loaded", {
        detail: { translations: currentTranslations },
      }),
    );
  } catch (err) {
    console.error("Impossible de charger la langue :", err);
    if (lang !== "fr") applyLanguage("fr", { broadcast });
  }
}

// ================================================================
// CHANGER LA LANGUE (choix utilisateur explicite -> diffuse)
// ================================================================

async function changeLanguage(lang) {
  await applyLanguage(lang, { broadcast: true });
}

// ================================================================
// ÉCOUTER LES CHANGEMENTS VENANT D'AUTRES FENÊTRES
// ================================================================

async function setupCrossWindowLangSync() {
  const tauriEvent = getTauriEvent();
  if (!tauriEvent) {
    setTimeout(setupCrossWindowLangSync, 50);
    return;
  }

  await tauriEvent.listen("app-lang-changed", (event) => {
    const { lang } = event.payload;
    if (lang === currentLang) return; // déjà à jour, rien à faire
    applyLanguage(lang, { broadcast: false });
  });
}

// ================================================================
// CHARGER LE NOM D'UNE LANGUE
// ================================================================

async function getLanguageName(lang) {
  try {
    const tauriCore = getTauriCore();
    if (!tauriCore) return lang.toUpperCase();

    const jsonStr = await tauriCore.invoke("load_language_json", {
      lang: lang,
    });
    const translations = JSON.parse(jsonStr);
    return translations._name || lang.toUpperCase();
  } catch (err) {
    console.warn(`⚠️ Impossible de charger le nom pour ${lang}`);
    return lang.toUpperCase();
  }
}

// ================================================================
// REMPLIR LE SÉLECTEUR DE LANGUE
// ================================================================

async function populateLangSelector() {
  const selector = document.getElementById("lang-selector");
  if (!selector) {
    console.warn("⚠️ Sélecteur de langue non trouvé");
    return;
  }

  try {
    const tauriCore = getTauriCore();
    if (!tauriCore) return;

    availableLanguages = await tauriCore.invoke("get_available_languages");

    selector.innerHTML = "";

    for (const lang of availableLanguages) {
      const option = document.createElement("option");
      option.value = lang;
      const langName = await getLanguageName(lang);
      option.textContent = langName;

      if (lang === currentLang) {
        option.selected = true;
      }
      selector.appendChild(option);
    }

    selector.addEventListener("change", () => {
      const newLang = selector.value;
      if (newLang !== currentLang) {
        changeLanguage(newLang);
      }
    });
  } catch (err) {
    console.error("Erreur lors du chargement des langues :", err);
  }
}

// ================================================================
// INITIALISATION
// ================================================================

async function initLanguageSystem() {
  const tauriCore = getTauriCore();
  if (!tauriCore) {
    setTimeout(initLanguageSystem, 50);
    return;
  }

  // Storage : chargé et initialisé ici (fallback silencieux sur
  // localStorage si StorageService n'est pas présent dans cette fenêtre).
  storage = window.StorageService || null;
  if (storage) {
    await storage.init();
    currentLang = storage.get("app_lang", "fr");
  } else {
    currentLang = localStorage.getItem("app_lang") || "fr";
  }

  await populateLangSelector();
  // Chargement initial : pas de diffusion, chaque fenêtre s'initialise
  // avec la langue déjà stockée, pas besoin de le crier aux autres
  // fenêtres qui font la même chose de leur côté.
  await applyLanguage(currentLang, { broadcast: false });
  await setupCrossWindowLangSync();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLanguageSystem);
} else {
  initLanguageSystem();
}
