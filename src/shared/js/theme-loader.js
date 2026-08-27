// theme-loader.js

(function () {
  "use strict";

  const theme = localStorage.getItem("pangya_theme") || "pangya-classic";

  const styles = {
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

  const root = document.documentElement;
  const themeVars = styles[theme] || styles["pangya-classic"];

  for (const [key, value] of Object.entries(themeVars)) {
    root.style.setProperty(key, value);
  }
})();
