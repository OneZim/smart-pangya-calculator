# AGENTS.md — Smart Pangya Calculator

Ce document guide les agents autonomes et développeurs travaillant sur le projet **Smart Pangya Calculator**.

## 🏗️ Architecture du Projet

Application **Tauri v2** multi-fenêtres (bureau Windows) pour le jeu Pangya Reborn. Projet 100 % JavaScript vanilla (aucun bundler/Vite) + Rust : **aucun fichier Python**.

- **Frontend (`src/`)** : JavaScript vanilla (sans bundler), structuré par dossiers :
  - `src/index.html`, `src/app.js` et `src/main.js` : fenêtre principale, initialisation et orchestration de l'application.
  - `src/core/` : `components/`, `services/`, `stores/` (sélection, stockage, calibration, informations de tir et communication Tauri).
  - `src/models/` : modèles métier (`Character`, `Course`, `Hole`, `Pin`, `Player`).
  - `src/screens/<screen>/` : écrans Tauri secondaires avec leur trio HTML/CSS/JS : `settings` et `overlays`.
  - `src/overlays/<overlay>/` : une fenêtre par overlay, chacune avec son trio HTML/CSS/JS : `calc_overlay`, `wind_overlay`, `spin_overlay`, `ruler_overlay`, `infos_shot`.
  - `src/shared/` : JavaScript partagé (`i18n`, thèmes, calculateur intelligent, optimisation Dunk) et CSS des thèmes.
  - `src/style/` : styles principaux ; `src/utils/` : helpers de fenêtres, recalcul et options des boutons.
  - `src/assets/avatars/` : avatars des personnages.
- **Backend Rust (`src-tauri/src/`)** :
  - `lib.rs` : Point d'entrée principal — commandes IPC, logique Win32 (transparence, click-through), gestionnaire de fenêtres, surveillance de dossier, raccourcis globaux, interactions souris via `enigo`.
  - `main.rs` : Point d'entrée minimal appelant `smart_pangya_calculator_lib::run()`.
  - `src-tauri/data/` : données embarquées, notamment les positions des pins (`pin_location.json`).
  - `src-tauri/lang/` : traductions embarquées (`de`, `en`, `es`, `fr`, `it`, `pt`).
  - `src-tauri/capabilities/` : permissions Tauri v2 ; `src-tauri/gen/` : schémas générés ; `src-tauri/icons/` : icônes de l'application.

## 🚀 Commandes Clés

- **Développement** : `npm run dev` (lance `tauri dev`)
- **Build de production** : `npm run build` (lance `tauri build`)
- **Vérification Rust** : `cargo check` (dans `src-tauri/`)
- **Vérification JS** : `node --check <fichier>.js` (syntaxe)

## 🪟 Fenêtres (tauri.conf.json)

| Label             | Rôle                        | URL                                         |
| ----------------- | --------------------------- | ------------------------------------------- |
| `main`            | Interface principale        | `index.html`                                |
| `settings_screen` | Paramètres                  | `screens/settings/settings_screen.html`     |
| `overlays_screen` | Gestion des overlays        | `screens/overlays/overlays_screen.html`     |
| `input_overlay`   | Saisie                      | `overlays/calc_overlay/calc_overlay.html`   |
| `ruler_overlay`   | Règle de visée              | `overlays/ruler_overlay/ruler_overlay.html` |
| `wind_overlay`    | Angle de vent               | `overlays/wind_overlay/wind_overlay.html`   |
| `spin_overlay`    | Spin                        | `overlays/spin_overlay/spin_overlay.html`   |
| `infos_shot`      | Infos tir (PB, %, distance) | `overlays/infos_shot/infos_shot.html`       |

## 📌 Points d'Attention V2

- Les permissions et capabilities sont déclarées dans `src-tauri/capabilities/default.json` (chaque fenêtre d'overlay doit y figurer pour les événements/commandes autorisés).
- Les ressources `src-tauri/data/*` et `src-tauri/lang/*` sont embarquées par `src-tauri/tauri.conf.json` lors du build.
- Le frontend communique avec le backend via l'API Tauri global (`window.__TAURI__`) et le wrapper `window.TauriService`.
- Tous les overlays sont des fenêtres transparentes : `transparent: true`, `decorations: false`, `alwaysOnTop`, `skipTaskbar`, `visible: false` au démarrage, `focus: false` quand c'est possible.
- Transparence/click-through applicatifs gérés en Rust (`enable_transparency`, `set_overlay_click_through` avec état `ClickThroughState`).
- Persistance de position des overlays via `WindowPositionHelper` (clé dédiée par fenêtre, débounce à l'arrêt du drag).
- Convention de nommage des événements Tauri : `sync-*` (synchronisation fenêtre principale ↔ overlays), `update-*`/`nouvelle-*` (données jeu/calculs), `*-visibility` (Rust → UI). Les événements partagés (ex. `update-ruler`) alimentent plusieurs fenêtres.
- Calibration par résolution du jeu dans `ResolutionCalibrationService` (table à la main, repli sur `1920x1080`).

## 🛠️ Règles Strictes pour l'Agent

1. **Zéro Bundler (JS Vanilla strict) :** Ne jamais importer de modules npm côté frontend. Ne jamais utiliser de syntaxe `import/export` ES Modules à moins que le fichier HTML ne le spécifie explicitement en `type="module"`. Préférer l'accès aux scripts via l'arborescence HTML classique.
2. **Accès Tauri V2 global :** Le frontend utilise l'objet global injecté ou fourni par votre wrapper. N'écris jamais `import { invoke } from '@tauri-apps/api/core'` dans le frontend, utilise `window.__TAURI__` ou passe par `TauriService`.
3. **Capabilities Tauri v2 :** Si tu crées une nouvelle commande Rust (`#[tauri::command]`) ou un nouvel événement, rappelle-moi TOUJOURS de mettre à jour le fichier `src-tauri/capabilities/default.json` pour autoriser les overlays à l'utiliser.
4. **Pas de Python :** Si tu dois créer un script utilitaire (ex. génération de la table de calibration de résolution), écris-le en Node.js (JavaScript) ou en Rust, jamais en Python.
