// =====================================================================
// PRÉREQUIS POUR QU'UNE FENÊTRE BÉNÉFICIE DE LA TRADUCTION/SYNC LANGUE :
//   1. Inclure <script src=".../shared/js/i18n.js"></script> dans son HTML
//   2. Ajouter la fenêtre dans src-tauri/capabilities/default.json :
//      - tableau "windows"
//      - core:event:allow-emit
//      - core:event:allow-listen
//   3. Utiliser data-i18n="clé" sur les éléments HTML à traduire
// =====================================================================

let currentLang = "fr"; // corrigée dans initLanguageSystem() après storage.init()
let currentTranslations = {};
window.i18nReady = false;
let availableLanguages = [];

// Storage (Tauri Store) — assigné dans initLanguageSystem(). Fallback
// silencieux sur localStorage si StorageService n'est pas chargé.
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

function getCurrentWindowLabel() {
  try {
    return window.__TAURI__?.window?.getCurrentWindow?.()?.label || "?";
  } catch {
    return "?";
  }
}

// ================================================================
// APPLIQUER UNE LANGUE (cœur commun)
// ================================================================
//
// broadcast: true  -> diffuse le changement aux autres fenêtres (choix utilisateur)
// broadcast: false -> n'applique que localement (chargement initial, ou
//                      réception d'un changement venant d'une autre fenêtre)

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

    // === DIFFUSER AUX AUTRES FENÊTRES (uniquement sur choix explicite) ===
    if (broadcast) {
      try {
        const tauriEvent = getTauriEvent();
        if (tauriEvent) {
          console.log(`[i18n] ▶ ÉMISSION app-lang-changed : ${lang}`);
          await tauriEvent.emit("app-lang-changed", { lang });
        } else {
          console.warn("[i18n] ⚠️ getTauriEvent() null → émission ignorée");
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

async function setupCrossWindowLangSync(retry = 0) {
  const tauriEvent = getTauriEvent();
  if (!tauriEvent) {
    if (retry >= 50) {
      console.error(
        "[i18n] ❌ __TAURI__.event indisponible après 5s — sync inter-fenêtres désactivée",
      );
      return;
    }
    setTimeout(() => setupCrossWindowLangSync(retry + 1), 100);
    return;
  }

  if (window.__langSyncRegistered) return;
  window.__langSyncRegistered = true;

  console.log(
    "[i18n] 🔌 LISTENER app-lang-changed ENREGISTRÉ dans :",
    getCurrentWindowLabel(),
  );

  await tauriEvent.listen("app-lang-changed", (event) => {
    const { lang } = event.payload;
    if (!lang) return;
    if (lang === currentLang && window.i18nReady) return;

    console.log(`[i18n] 📥 REÇU app-lang-changed : ${lang}`);
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
  if (!selector) return;

  const tauriCore = getTauriCore();
  if (!tauriCore) return;

  // Charger la liste des langues (une fois)
  if (availableLanguages.length === 0) {
    try {
      availableLanguages = await tauriCore.invoke("get_available_languages");
    } catch (err) {
      console.error("[i18n] ❌ get_available_languages :", err);
      return;
    }
  }

  // Remplir les options si pas déjà fait
  if (selector.options.length === 0) {
    try {
      for (const lang of availableLanguages) {
        const option = document.createElement("option");
        option.value = lang;
        option.textContent = await getLanguageName(lang);
        selector.appendChild(option);
      }
    } catch (err) {
      console.error("[i18n] ❌ Remplissage options :", err);
    }
  }

  // Sélectionne la langue actuelle
  selector.value = currentLang;

  // Pose le listener UNE SEULE FOIS, en utilisant un flag sur un objet JS
  // (pas sur le DOM, pour éviter les conflits)
  if (populateLangSelector._listenerBound) return;
  populateLangSelector._listenerBound = true;

  selector.onchange = () => {
    const newLang = selector.value;
    console.log(
      "[i18n] 🔄 Select → " + newLang + " (actuel : " + currentLang + ")",
    );
    if (newLang !== currentLang) {
      changeLanguage(newLang);
    }
  };

  console.log("[i18n] ✅ Listener posé sur le select");
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

  // Storage : idempotent, donc safe même si settings_screen.js l'appelle aussi
  storage = window.StorageService || null;
  if (storage) {
    await storage.init();
    currentLang = storage.get("app_lang", "fr");
  } else {
    currentLang = localStorage.getItem("app_lang") || "fr";
  }

  await populateLangSelector();
  await applyLanguage(currentLang, { broadcast: false });
  await setupCrossWindowLangSync();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initLanguageSystem);
} else {
  initLanguageSystem();
}

// ================================================================
// EXPOSITION GLOBALE
// ================================================================

window.applyLanguage = applyLanguage;
window.changeLanguage = changeLanguage;
window.getCurrentLang = function () {
  return currentLang;
};
window.getCurrentTranslations = function () {
  return currentTranslations;
};
