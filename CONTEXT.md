# CONTEXT.md — Smart Pangya Calculator

Document de contexte issu d'un audit complet du dépôt (à jour au 25/09/2026). Il complète `README.md` et `AGENTS.md` avec l'état réel du code, l'inventaire des fonctionnalités opérationnelles et les chantiers en cours.

---

## 1. Architecture et choix techniques

### Stack

- **Application Tauri v2 multi-fenêtres** (Windows uniquement), version **3.0.3** (`identifier`: `com.onezim.smart-pangya-calculator`).
- **Frontend 100 % JavaScript vanilla** (aucun bundler, aucun framework) + HTML/CSS, distribué directement depuis `src/` (`frontendDist: "../src"`).
- **Backend Rust** (`src-tauri/`), crates : `tauri 2`, `windows 0.61`, `enigo 0.2` (souris), `notify 6` (surveillance dossier), `tauri-plugin-store`, `tauri-plugin-dialog`, `tauri-plugin-opener`, `tauri-plugin-global-shortcut`, `base64`, `serde`, `thiserror`.
- **API Tauri globale** (`withGlobalTauri: true`) : le frontend accède au runtime via `window.__TAURI__`, encadré par le wrapper `window.TauriService`.
- **Persistance** : plugin Store (`storage.json` dans `appDataDir`), clés préfixées `pangya_`, via `window.StorageService` (cache mémoire + debounce 300 ms + `flush()`).

### Frontend (`src/`)

| Zone                                    | Contenu                                                                                                                                                                                  |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.html` + `app.js` + `main.js` | Fenêtre principale (2 onglets : Calculs, Statistiques ; barre de titre personnalisée). `app.js` orchestre stores/composants/listeners ; `main.js` gère titlebar + flush avant fermeture. |
| `src/core/services/`                    | `TauriService`, `StorageService`, `ShotInfoService`, `ResolutionCalibrationService` (IIFE, exposés sur `window.*`).                                                                      |
| `src/core/stores/`                      | `CharacterStore`, `CourseStore`, `PlayerStore` (fenêtre principale), `CoursesSelectorCalcOverlay`, `PlayerStoreCalcOverlay` (overlay de saisie). Pattern factory + observateurs.         |
| `src/core/components/`                  | `WindAngleSelector` (visée à 2 clics), `CharacterManager`, `CourseSelector`, `ScreenshotManager`.                                                                                      |
| `src/models/`                           | `Character.js` (exposé sur `window`).                                                                                                                                                    |
| `src/screens/`                          | `settings` (résolution, dossier captures, verrous dev) et `overlays` (visibilité/lock/déplacement des overlays, options règle).                                                          |
| `src/overlays/`                         | `calc_overlay`, `ruler_overlay`, `spin_overlay`, `infos_shot` — chacun un trio HTML/CSS/JS.                                                                                            |
| `src/shared/js/`                        | `i18n`, `theme-loader`, `themes`, `smart_calculator` (moteur physique), `dunk_optimizer`, `dunk_button`, `dunk_request_listener`.                                                        |
| `src/utils/`                            | `recalc` (`window.triggerCalc`), `WindowDragHelper`, `WindowPositionHelper`, `dunk_options_boutons`.                                                                                     |
| `src/style/`, `src/shared/css/themes/`  | Styles principaux + 4 thèmes (`win11`, `dark-golf`, `pangya-pastel`, `pangya-classic`).                                                                                                  |

### Backend Rust (`src-tauri/src/`)

- `lib.rs` : orchestration, états `Arc<Mutex<…>>` partagés, transparence de base des overlays via `enable_transparency`, raccourci global `Ctrl+Shift+X` (émet `global-trigger-click-pb`), affichage de la fenêtre `main` à `on_page_load` (anti-FOUC), fenêtres `settings_screen`/`overlays_screen` masquées au lieu de fermées (`prevent_close` + `hide`).
- `commands/` (IPC par domaine) :
  - `overlays.rs` : visibilité des overlays (`set_*_visibility` + événement `sync-*`), click-through (`set_overlay_click_through`, `enable_click_through`/`disable_click_through`), déplacements (`move_ruler`, `move_spin_overlay`, `move_infos_shot`).
  - `game.rs` : `get_game_resolution`, `refresh_game_resolution`, `get_game_info`, `get_game_client_rect_on_screen`, `get_game_dpi_debug`, `list_all_visible_windows` — correction DPI (scale factor) + correspondance aux 16 résolutions officielles Pangya.
  - `input.rs` : `move_and_click`, `get_mouse_position`, `move_and_click_focused` (force le focus du jeu via `AttachThreadInput` + polling `wait_for_focus`).
  - `media.rs` : `select_folder`, `get_latest_image` (base64 + MIME), `clear_screenshot_folder` — sous surveillance `notify` (`nouvelle-capture-detectee`).
  - `i18n.rs` : `get_available_languages`, `load_language_json`, `parcours` (lit `data/pin_location.json`).
- `detection.rs` : détection de la fenêtre Pangya par `EnumWindows` (processus `projectg` / `pangya_client`), cache TTL 2 s (`PangyaWindowCache`), mémoïsation des noms de processus.
- `window_style.rs` : click-through Windows via `GWL_EXSTYLE` (`WS_EX_TRANSPARENT`/`WS_EX_LAYERED`).
- `foreground.rs` : `force_foreground` + `wait_for_focus`.
- `error.rs` : `AppError` centralisé, sérialisé en simple chaîne pour préserver le contrat frontend.
- `build.rs` + `windows-app-manifest.xml` : manifeste Win32 avec `tauri_build::try_build`.

### Fenêtres (tauri.conf.json)

| Label             | URL                                         | Rôle                   | Particularités                                               |
| ----------------- | ------------------------------------------- | ---------------------- | ------------------------------------------------------------ |
| `main`            | `index.html`                                | Interface principale   | 950×850, `visible: false` au démarrage, sans décorations    |
| `settings_screen` | `screens/settings/settings_screen.html`     | Paramètres             | 800×620, `alwaysOnTop: false`, masquée au lieu de fermée     |
| `overlays_screen` | `screens/overlays/overlays_screen.html`     | Gestion des overlays   | idem                                                         |
| `input_overlay`   | `overlays/calc_overlay/calc_overlay.html`   | Saisie du tir          | 350×420 transparent, toujours au premier plan, `skipTaskbar` |
| `ruler_overlay`   | `overlays/ruler_overlay/ruler_overlay.html` | Règle de visée PB      | 1920×150 transparent, AoT                                    |
| `spin_overlay`    | `overlays/spin_overlay/spin_overlay.html`   | Cadran spin/curve      | 200×200 transparent                                          |
| `infos_shot`      | `overlays/infos_shot/infos_shot.html`       | PB réel, %, distance   | 500×150 transparent                                          |

### Communications

- **Commandes IPC** : `window.TauriService.invoke(command, args)` → backend (`invoke_handler` de `lib.rs`).
- **Événements Tauri** (convention `sync-*` / `update-*` / `nouvelle-*` / `*-visibility`) : liste complète en fin de document.
- **Permissions** : toutes les fenêtres partagent UNE capability `default` (`src-tauri/capabilities/default.json`) avec `core:event:allow-emit`/`allow-listen` en `allow: ["*"]`, `store`, `dialog`, `global-shortcut`… **Tout nouvel événement/commande utilisable par un overlay doit y figurer.**

### Données embarquées

- `src-tauri/data/pin_location.json` : **20 parcours, 821 pins**. Schéma : `{ "course": { "<Map>": { name, short, holes: { "H1": { par, name, pins: { "415.96y": { pinDistance, pinHeight, teeSlope, ground } } } } } } }` (alias `trous`/`positions` tolérés). Chargé une seule fois et mis en cache (`PinLocationCache`).
- `src-tauri/lang/{de,en,es,fr,it,pt}.json` : traductions embarquées (cache `LanguagesCache`).
- `src/assets/avatars/` : avatars des personnages (`.webp` + `.png`).

---

## 2. Fonctionnalités développées et opérationnelles

### Moteur de calcul (`shared/js/smart_calculator.js`, ~1500 lignes)

- Simulation physique complète (portage de l'ingénierie inverse Pangya, auteur Acrisio) : gravité 34.295, effet Magnus, résistance de l'air, spin, curve, vent, hauteur, pente.
- 15 clubs (`CLUB_INFO` : 1W→9I, PW, SW, PT), 4 types de tir (`DUNK`/`TOMAHAWK`/`SPIKE`/`COBRA`), 4 power shots (0/1/2/15y).
- `find_power()` : recherche itérative du % de puissance (feed correctif « bisection-like », bornes [0.1 ; 1.3]) et calcul de la déviation.
- Conversion des unités : `YARDS_TO_PB 0.2167`, `DESVIO_SCALE_PANGYA_TO_YARD 0.3125/1.5`, smart PB (`smartDesvio`) borné par `smart-dev-limit`.
- Sortie : `%`, yards, **PB réel** (`pb Real`), PB, et envoi du payload **`update-ruler`** `{ pb, distance, percent, recommendedSpin, recommendedCapler }` à tous les overlays.

### Optimiseur Dunk (`shared/js/dunk_optimizer.js`)

- Recherche du couple (spin, curve) optimal pour Dunk/Tomahawk/Spike en réévaluant la distance via `find_power()`.
- Dunk : paliers facile (−15…+15) puis dur (±15,5…30), tolérance ±0,10 y ; tolère le spin négatif.
- Tomahawk/Spike : tir direct (jamais « devant » le trou) puis option « rétro » (spin 1…7, tolérance interpolée 0,10→1,00 y).
- Entrée depuis l'overlay de saisie via `request-dunk-optimization` → `dunk_request_listener.js` (fenêtre principale) → résultat `dunk-optimization-result`.

### Clic automatique dans le jeu (`dunk_button.js` + `input.rs` + `foreground.rs`)

- Bouton « Appliquer le spin » : conversion spin/curve en coordonnées écran (dial calibré `spinDialCenter`/`pxParUniteSpin` + scale), `move_and_click_focused` avec mise au premier plan du jeu confirmée par polling.
- Raccourci global `Ctrl+Shift+X` (`global-trigger-click-pb`) → clic sur la règle PB à la position calibrée.

### Calibration par résolution (`ResolutionCalibrationService`)

- Table manuelle (pas de formule) : `1920x1080`, `1600x900`, `1440x900`, `1400x900`, `1280x720` ; repli sur la référence `1920x1080` sinon (flag `_source: calibrated|estimated`).
- Chaque entrée fournit : `spinDialCenter`, `pxParUniteSpin`, `pxPerPb` (zoom Smart PB ~80 %), `realPxPerPb`, paramètres de rendu de la règle, ancres/zooms vent et balle.
- `ShotInfoService` agrège résolution + données `update-ruler` et calcule `pxPerPb`, `realPxPerPb` et le PB réel (`pb * pxPerPb / realPxPerPb`).

### Overlays

- **calc_overlay** (input bar) : formulaire complet synchro bidirectionnel avec la fenêtre principale (`sync-input-value`, `sync-dropdown-parcours`), sélecteur d'angle canvas, captures vent/ballet (visée 2 clics + pente auto), fenêtre redimensionnable (grip, ratio 360×400), toggle spin forcé, boutons optimiseur Dunk.
- **ruler_overlay** : règle PB centrée sur le jeu, **gestion du surplus > 47 PB** (repère principal clampé à ±45 + indicateur secondaire recalibré via `realPxPerPb`), zoom Smart PB ~80 %, couleurs et repère T configurables, position persistée (`ruler_overlay_position`).
- **spin_overlay** : repère spin/curve construit depuis la calibration, marqueur positionné selon `update-spin`, accepte spins négatifs (Dunk).
- **infos_shot** : PB réel calibré, % (classe `percent-low` sous 80 %), distance — alimenté uniquement par `ShotInfoService`.

### Données & personnages

- Base de 20 parcours / 821 pins avec distance, hauteur, pente de tee et ground ; sélection Map → Trou → Pin (tri numérique + Par), application automatique aux champs (`CourseSelector.applyPinData` : distance, height, ground=100, teeSlope→slope_break, curve).
- 11 personnages par défaut, avatars, stats complètes (power, ring, carte, mascotto, card PS, max spin/curve), puissances et total persistés (`pangya_characters`).

### Captures d'écran (`ScreenshotManager` + `media.rs`)

- Choix du dossier de captures (bouton « vider le dossier » avec modal de confirmation), lecture de la dernière image (base64), surveillance automatique du dossier (`nouvelle-capture-detectee`), positionnement calibré de l'image vent/ballet (ancre × zoom + offsets persistés), boutons de recadrage ±0,5 px.

### Multilingue / Thèmes

- 6 langues (`fr`, `en`, `es`, `it`, `de`, `pt`), synchronisées entre fenêtres (`app-lang-changed`), repli `fr`, attributs `data-i18n-*`.
- 4 thèmes CSS synchronisés (`app-theme-changed`), `theme-loader.js` anti-flash (lecture `localStorage.pangya_theme` avant peinture).

---

## 3. Tâches en cours, bugs connus et restant à développer

### Points d'attention / bugs potentiels (issus de l'audit)

1. **Incohérence de puissance totale** : `Character.getTotalPower()` = 6 termes (inclut `cardSpin`) vs `Player.getTotalPower()` = 5 termes (sans `cardSpin`/`cardCurve`).
2. **`PlayerStoreCalcOverlay` ignore le stockage** : le joueur de l'overlay de saisie est toujours `{}` (choix assumé ?).
3. **`WindAngleSelector` déclare `storageKey` sans l'utiliser** — pas de persistance de l'angle (volontaire : l'angle change à chaque coup).
4. **Defaults de `ShotInfoService`** (`pxPerPb=81`, `realPxPerPb=72`) différents de la calibration 1080p (20.3/72) — les defaults ne servent qu'en cas d'échec de calibration, mais à surveiller.
5. **Clic PB** : coordonnées fixes `960/540` dans `setupTauriListeners()` (étape 7 du plan) — incohérent avec les résolutions/scalings autres que 1080p.
6. Suivi git : dossier `.vs/` non suivi (ignoré dans `.gitignore`).

### Écart README vs code

- Fonctionnalité « automatisation clic/clavier » = clic spin + raccourci global `Ctrl+Shift+X` (pas d'automatisation clavier avancée).

---

## 4. Commandes pour build et tester

Depuis la racine :

| Action                                | Commande                                                    | Remarques                                                                                                                                                         |
| ------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Développement (Tauri dev, hot reload) | `npm run dev` (équiv. `npm run tauri dev`)                  | Lance `cargo run` + WebView2 ; nécessite le jeu **Pangya Reborn** lancé pour tester la détection/calibration                                                      |
| Build de production                   | `npm run build` (équiv. `npm run tauri build`)              | NSIS/MSI/à la brique, icônes incluses                                                                                                                             |
| Vérification JS (syntaxe)             | `node --check <fichier>.js`                                 | À faire sur chaque fichier JS modifié                                                                                                                             |
| Vérification Rust                     | `Set-Location "D:\Dev\smart-pangya-calculator\src-tauri"` ; `cargo check --locked` | Compilation rapide (pas de build) ; `cargo build` pour un binaire local                                                                                           |
| Lint/typecheck                        | **Aucun** configuré (ni ESLint, ni Prettier, ni TypeScript) | Contrôles manuels `node --check` uniquement                                                                                                                       |
| Tests automatisés                     | **Aucun framework de test**                                 | Validation manuelle : scénarios du `plan.md` (init idempotent, sélection pin, angle distant, payloads invalides, flush à la fermeture, clic PB multi-résolutions) |
| Prérequis                             | Node, Rust toolchain (MSVC), WebView2                       | Positions des overlays et calibration dépendent de la résolution du jeu                                                                                           |

Astuce debug backend : lancer les commandes depuis `src-tauri` ; les `eprintln!` (ex. « Fenêtre Pangya introuvable », « Impossible de donner le focus ») s'affichent dans la console du `tauri dev`.

---

## Annexes

### Commandes Tauri (backend)

`enable_click_through`, `disable_click_through`, `set_overlay_click_through`, `set_ruler_visibility`, `set_spin_visibility`, `set_input_bar_visibility`, `move_spin_overlay`, `set_infos_shot_visibility`, `get_settings_visibility`, `get_overlays_screen_visibility`, `move_infos_shot`, `move_ruler`, `select_folder`, `get_latest_image`, `clear_screenshot_folder`, `get_available_languages`, `load_language_json`, `parcours`, `move_and_click`, `get_mouse_position`, `move_and_click_focused`, `get_game_resolution`, `refresh_game_resolution`, `get_game_info`, `get_game_client_rect_on_screen`, `get_game_dpi_debug`, `list_all_visible_windows`.

### Événements Tauri

- **Backend → front** : `sync-ruler-visibility`, `sync-spin-visibility`, `sync-infos-shot-visibility`, `update-game-resolution`, `nouvelle-capture-detectee`, `global-trigger-click-pb`.
- **Front ⇄ front (bus Tauri)** : `sync-input-value`, `sync-dropdown-parcours`, `sync-spin-force`, `sync-wind-angle`, `update-spin`, `update-ruler`, `update-ruler-smart-color`, `update-ruler-t-repere`, `update-zoom-step`, `ruler-visibility`, `ruler-lock`, `ruler-move`, `spin-visibility`, `toggle-settings-visibility`, `toggle-overlays-visibility`, `screenshot-folder-changed`, `click-optimize-dunk`, `click-spin-only`, `request-dunk-optimization`, `dunk-optimization-result`, `dunk-optimize-result`, `trigger-main-calculation`, `app-lang-changed`, `app-theme-changed`.

### Clés de stockage (toutes préfixées `pangya_` via `StorageService`)

`lastMap`, `lastHole`, `lastPin`, `lastSelection` (overlay), `power`, `auxpart_pwr`, `card_pwr`, `mascot_pwr`, `card_ps_pwr`, `characters`, `characters_selected`, `screenshot_folder`, `imgOffsetX`, `imgOffsetY`, `ballImgOffsetX`, `ballImgOffsetY`, `spin_force`, `wind_angle`, `calc_overlay_size`, `ruler_overlay_position`, `spin_overlay_position`, `infos_shot_position`, `ruler_smart_color`, `ruler_show_t_repere`, `rel-width`, `rel-height`, `smart-dev-limit`, `auto-fit`, `app_lang`, `theme` (+ miroir `localStorage.pangya_theme`, `localStorage.app_lang`).
