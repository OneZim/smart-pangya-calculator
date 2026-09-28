# AGENTS.md — Smart Pangya Calculator

## 🏗️ Architecture

Application **Tauri v2** multi-fenêtres (bureau Windows) pour le jeu Pangya Reborn. Projet 100 % JavaScript vanilla (aucun bundler/Vite) + Rust : **aucun fichier Python**.

- **Frontend** (`src/`) : JavaScript vanilla, structuré par dossiers (`core/`, `models/`, `screens/`, `overlays/`, `shared/`, `utils/`).
- **Backend Rust** (`src-tauri/`) : `lib.rs` (point d'entrée/orchestration), `main.rs` (entry point), `state.rs` (états partagés), `commands/` (IPC par domaine).
- **Données embarquées** (`src-tauri/data/`) : `parcours.json` (source canonique, 20 parcours, 302 trous, 821 pins).
- **Langues** (`src-tauri/lang/`) : traductions (`de`, `en`, `es`, `fr`, `it`, `pt`).

## 🚀 Commandes Clés

| Action | Commande | Description |
|--------|----------|-------------|
| Développement | `npm run dev` | Lance `tauri dev` (cargo run + WebView2) |
| Build | `npm run build` | Lance `tauri build` (NSIS/MSI/à la brique) |
| Vérification Rust | `cargo check --locked` | Compilation rapide (pas de build) |
| Vérification JS | `node --check <fichier>.js` | Syntaxe (sur chaque fichier JS modifié) |
| Données | `node tools/compare-parcours.mjs <a.json> <b.json>` | Comparaison structurelle |
| Migration | `node tools/migrate-pin-location.mjs [source.json]` | Conversion vers le schéma canonique |
| Vérifications hors app | `node tools/verify-all.mjs` | Invariants `parcours.json` + parité clés traduction |

## 🪟 Fenêtres (tauri.conf.json)

| Label | Rôle | URL |
|-------|------|------|
| `main` | Interface principale | `index.html` |
| `settings_screen` | Paramètres | `screens/settings/settings_screen.html` |
| `overlays_screen` | Gestion des overlays | `screens/overlays/overlays_screen.html` |
| `editor_screen` | Éditeur de parcours | `screens/editor/editor_screen.html` |
| `input_overlay` | Saisie | `overlays/calc_overlay/calc_overlay.html` |
| `ruler_overlay` | Règle de visée | `overlays/ruler_overlay/ruler_overlay.html` |
| `spin_overlay` | Spin | `overlays/spin_overlay/spin_overlay.html` |
| `infos_shot` | Infos tir (PB, %) | `overlays/infos_shot/infos_shot.html` |

## ⚠️ Points d'Attention V2

- **Permissions** : Chaque overlay doit déclarer ses capacités dans `src-tauri/capabilities/default.json` (évite les erreurs `dialog.message not allowed`).
- **Données embarquées** : `src-tauri/data/*` et `src-tauri/lang/*` sont embarqués par `tauri.conf.json` — ne pas les modifier manuellement.
- **Transparence** : Les overlays sont transparents (`transparent: true`), sans decorations, toujours au premier plan, sans barre de tâche.
- **Click-through** : Géré en Rust (`enable_transparency`, `set_overlay_click_through` avec état `ClickThroughState`).
- **Position** : Position des overlays sauvegardée (`WindowPositionHelper`), avec debounce à l'arrêt du drag.
- **Événements Tauri** : 
  - `sync-*` : synchronisation fenêtre principale ↔ overlays
  - `update-*`/`nouvelle-*` : données jeu/calculs
  - `*-visibility` : communication Rust → UI
- **Calibration** : `ResolutionCalibrationService` — table manuelle, repli sur `1920x1080`.

## 📐 Modèle de Données des Parcours

- **Source canonique** : `src-tauri/data/parcours.json` (20 parcours, 302 trous, 821 pins).
- **Indexation** : Les pins sont indexés par **clés ordinales contiguës** `"1"`, `"2"`…, triés par distance croissante.
- **Identité métier** : L'identité d'un pin est `pinDistance` — strictement positive et **unique dans un trou**. Un doublon est refusé (frontend *et* backend), jamais absorbé.
- **Libellé** : Le texte d'un pin provient **toujours de sa distance**, jamais de la clé ordinale.
- **Écriture** : Toute modification passe par `commitCurrentHole()` **avant** toute action structurelle (changement de parcours/trou, ajout/suppression de pin, enregistrement). Le formulaire affiché est la source de la saisie en cours.
- **Erreurs** : Un fichier rejeté n'est pas ignoré en silence — émettre `pin-data-warning` et l'afficher dans le bandeau principal.
- **Données embarquées** : `src-tauri/data/parcours.json` et `src-tauri/data/pin-location.json` (ancienne version) — ne pas modifier manuellement.

## 🛠️ Règles Strictes pour l'Agent

1. **Zéro Bundler (JS Vanilla strict)** : Pas d'import/export ES Module côté frontend. Accès aux scripts via l'arborescence HTML classique.
2. **Accès Tauri V2 global** : Utiliser `window.__TAURI__` ou le wrapper `TauriService`. Jamais d'importer `import { invoke } from '@tauri-apps/api/core'`.
3. **Capabilities Tauri v2** : Toute nouvelle commande Rust (`#[tauri::command]`) ou événement nécessite une mise à jour de `src-tauri/capabilities/default.json` pour autoriser les overlays.
4. **Pas de Python** : Les scripts utilitaires (ex. migration de calibration) doivent être en Node.js ou Rust.
5. **Pas de commit automatique** : Ne jamais faire `git commit`/`git add`/`git push` de ta propre initiative — l'utilisateur valide et commit lui-même.
6. **Données de parcours** : Modifier `src-tauri/data/parcours.json` uniquement avec `tools/migrate-pin-location.mjs` puis contrôler avec `tools/compare-parcours.mjs`.

## 🔧 Améliorations récentes (28/09/2026)

- **Uniformisation `PhysicalPosition`/`PhysicalSize`** : `ruler_overlay.js` + `calc_overlay.js` utilisent `const { PhysicalPosition, PhysicalSize } = window.__TAURI__.dpi;`
- **`dialog:default`** ajouté à `capabilities/default.json` — plus d'erreur `dialog.message not allowed`
- **Harnais de vérification** : `tools/verify-all.mjs`, `tools/verify/audit-data.mjs`, `tools/verify/verify-lang.mjs` créés ; contrôles négatifs passés
- **Tabulation circulaire `calc_overlay`** : `setupTabLoop()` — `curve (tabindex=8)` → `distance (tabindex=1)`, inverse `Shift+Tab` → `curve`

---
*Version 2.0 – mise à jour après correction de fiabilisation des données*