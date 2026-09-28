# CONTEXT.md — Smart Pangya Calculator

Document de contexte issu d'un audit complet du dépôt (à jour au 28/09/2026). Il complète `README.md` et `AGENTS.md` avec l'état réel du code, l'inventaire des fonctionnalités opérationnelles et les chantiers en cours.

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
| `src/core/stores/`                      | `CharacterStore`, `CourseStore`, `PlayerStore` (fenêtre principale). Pattern factory + observateurs.                                                                                            |
| `src/core/components/`                  | `WindAngleSelector` (visée à 2 clics), `CharacterManager`, `CourseSelector`, `ScreenshotManager`.                                                                                      |
| `src/models/`                           | `Character.js` (exposé sur `window`).                                                                                                                                                    |
| `src/screens/`                          | `settings` (résolution, dossier captures, verrous dev), `overlays` (visibilité/lock/déplacement des overlays, options règle) et `editor` (éditeur de parcours, pins par distance).       |
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
  - `i18n.rs` : `get_available_languages`, `load_language_json`, `parcours` (lecture/validation de `data/parcours.json`, repli sur le fichier legacy), `save_pin_location` (écriture atomique + backup).
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
| `editor_screen`   | `screens/editor/editor_screen.html`         | Éditeur de parcours    | 600×500, masquée au lieu de fermée                          |
| `input_overlay`   | `overlays/calc_overlay/calc_overlay.html`   | Saisie du tir          | 350×420 transparent, toujours au premier plan, `skipTaskbar` |
| `ruler_overlay`   | `overlays/ruler_overlay/ruler_overlay.html` | Règle de visée PB      | 1920×150 transparent, AoT                                    |
| `spin_overlay`    | `overlays/spin_overlay/spin_overlay.html`   | Cadran spin/curve      | 200×200 transparent                                          |
| `infos_shot`      | `overlays/infos_shot/infos_shot.html`       | PB réel, %, distance   | 500×150 transparent                                          |

### Communications

- **Commandes IPC** : `window.TauriService.invoke(command, args)` → backend (`invoke_handler` de `lib.rs`).
- **Événements Tauri** (convention `sync-*` / `update-*` / `nouvelle-*` / `*-visibility`) : liste complète en fin de document.
- **Permissions** : toutes les fenêtres partagent UNE capability `default` (`src-tauri/capabilities/default.json`) avec `core:event:allow-emit`/`allow-listen` en `allow: ["*"]`, `store`, `global-shortcut`… **Tout nouvel événement/commande utilisable par un overlay doit y figurer.** Les permissions du plugin `dialog` ont été retirées (le plugin reste enregistré côté Rust).

### Données embarquées

- `src-tauri/data/parcours.json` : **20 parcours, 302 trous, 821 pins**. Schéma canonique :

  ```json
  {
    "course": {
      "<Map>": {
        "name": "Blue Lagoon",
        "holes": {
          "H1": {
            "par": 4,
            "name": "H1",
            "pins": {
              "1": { "pinDistance": 381.1, "pinHeight": -0.98, "teeSlope": -0.23, "ground": 100 }
            }
          }
        }
      }
    }
  }
  ```

  Invariants garantis par le validateur Rust **et** par l'éditeur :
  - les pins sont indexés par **clés ordinales contiguës `"1"`, `"2"`…**, réécrites à chaque enregistrement ;
  - l'identité métier d'un pin est **`pinDistance`** : elle doit être **strictement positive et unique dans un trou** (un doublon est refusé, frontend et backend) ;
  - les pins sont **triés par distance croissante** ;
  - les trous sont indexés `H1`…`H18` et leur `name` est cohérent avec la clé ;
  - le champ `short`, obsolète, a été supprimé ; `Silvia Cannon/H14.name` vaut `"H14"`.

  À la lecture, `parcours()` normalise puis valide. L'ordre de recherche est : `parcours.json` (données utilisateur) → `parcours.json` embarqué (via `include_str!`) → ancien `pin_location.json` (legacy, converti à la volée). Tout fichier rejeté est signalé à l'interface par l'événement `pin-data-warning`, qui affiche un bandeau listant les sources écartées et le motif. Résultat mis en cache (`PinLocationCache`), invalidé à chaque sauvegarde.

- `src-tauri/lang/{de,en,es,fr,it,pt}.json` : traductions embarquées (cache `LanguagesCache`), **146 clés identiques** dans les 6 fichiers.
- `src/assets/avatars/` : avatars des personnages (`.webp` + `.png`).

### Fichiers de parcours côté utilisateur

Dans `%APPDATA%\com.onezim.smart-pangya-calculator\` :

| Fichier                                    | Rôle                                                                                        |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `parcours.json`                            | Données en cours d'utilisation, écrites par l'éditeur.                                        |
| `parcours_primary.json`                    | Copie de la version embarquée, créée au premier enregistrement si absente.                    |
| `parcours_backup.json`                     | Copie de sauvegarde immédiate avant chaque écriture.                                           |
| `pin_location.json`                        | Ancien format, lu seulement si `parcours.json` est absent. **À supprimer pour repasser aux données officielles.** |

**Restauration manuelle (sans bouton dans l'interface)** : quitter l'application, supprimer `parcours.json` (s'il existe) et `pin_location.json`, puis relancer. L'application recharge les données embarquées et les recreera au premier enregistrement.

Outils de maintenance (Node.js, jamais Python) :

- `tools/migrate-pin-location.mjs` : convertit un fichier legacy vers le schéma canonique, avec contrôles (un seul pin identique peut être écrasé si le fichier contient déjà la forme migrée) ; sortie idempotente. Usage : `node tools/migrate-pin-location.mjs [chemin/vers/source.json]`.
- `tools/compare-parcours.mjs` : compare structurellement deux jeux de parcours (clés, distances, champs) et signale les écarts.


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
- Chemin effectif : l'overlay de saisie émet `click-optimize-dunk`, la fenêtre principale clique le bouton `btn-optimize-spin` (elle seule détient le DOM de saisie et le `power_player` du personnage sélectionné), et `dunk_button.js` renvoie le résultat sur **`dunk-optimize-result`**, que l'overlay consomme.
- `dunk_request_listener.js` fournit une seconde voie (`request-dunk-optimization` → même événement `dunk-optimize-result`) : la fenêtre principale y reconstruit les entrées depuis son DOM après avoir appliqué les champs reçus. Les deux émetteurs utilisent volontairement le même nom d'événement.

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

- Base de 20 parcours / 302 trous / 821 pins avec distance, hauteur, pente de tee et ground ; sélection Map → Trou → Pin (tri numérique + Par), application automatique aux champs (`CourseSelector.applyPinData` : distance, height, ground=100, teeSlope→slope_break, curve).
- Les listes déroulantes du store principal **et** de l'overlay de saisie sont construites par les mêmes fonctions (`buildMapOptions`, `buildHoleOptions`, `buildPinOptions`) : le libellé d'un pin est **toujours sa distance** (` 415.96Y`), jamais la clé ordinale.
- La dernière sélection (`lastMap`/`lastHole`/`lastPin`) est relue de façon tolérante : un parcours, un trou ou un pin disparu laisse simplement la sélection vide au lieu de casser le chargement.
- 11 personnages par défaut, avatars, stats complètes (power, ring, carte, mascotto, card PS, max spin/curve), puissances et total persistés (`pangya_characters`).

### Éditeur de parcours (`screens/editor/`)

- Modification des pins d'un trou avec lecture/écriture dans le modèle en mémoire, puis enregistrement via `save_pin_location`.
- **Toute action structurelle (changement de parcours, de trou, ajout ou suppression d'un pin, enregistrement) écrit d'abord le formulaire affiché** : les valeurs saisies mais non validées ne sont jamais perdues. Le commit est refusé, avec message, si une distance est invalide ou dupliquée.
- Ajout d'un pin : une ligne à distance 0 est insérée en fin de liste et le champ distance est focalisé ; l'enregistrement reste refusé tant que la distance n'est pas renseignée.
- Suppression par index avec renumérotation immédiate des clés ordinales.
- La fenêtre est repositionnée au-dessus de la fenêtre principale à chaque ouverture, comme `settings_screen` et `overlays_screen`.

### Captures d'écran (`ScreenshotManager` + `media.rs`)

- Choix du dossier de captures (bouton « vider le dossier » avec modal de confirmation), lecture de la dernière image (base64), surveillance automatique du dossier (`nouvelle-capture-detectee`), positionnement calibré de l'image vent/ballet (ancre × zoom + offsets persistés), boutons de recadrage ±0,5 px.

### Multilingue / Thèmes

- 6 langues (`fr`, `en`, `es`, `it`, `de`, `pt`), synchronisées entre fenêtres (`app-lang-changed`), repli `fr`, attributs `data-i18n-*`.
- 4 thèmes CSS synchronisés (`app-theme-changed`), `theme-loader.js` anti-flash (lecture `localStorage.pangya_theme` avant peinture).

---

## 3. Tâches en cours, bugs connus et restant à développer

### Corrigé lors du chantier de fiabilisation des données (28/09/2026)

- Identité des pins basée sur `pinDistance` : doublons désormais détectés et refusés des deux côtés.
- Migration du schéma vers des clés ordinales, tri par distance, suppression du champ `short`, correction de `Silvia Cannon/H14.name`.
- Contraste frontend : plus de store `CoursesSelectorCalcOverlay` ; les deux fenêtres partagent les mêmes constructeurs d'options.
- `dunk_request_listener.js` émettait `dunk-optimization-result` → corrigé en `dunk-optimize-result`.
- Suppression du stub de zoom (`update-zoom-step`, touches `P`/`O`/`End`) : événement non consommé.
- Bandeau `pin-data-warning` : fichier de parcours rejeté plus ignoré en silence.
- Permissions `dialog:allow-*` retirées de la capability : plus de boîte de dialogue plugin.
- Fenêtre éditeur centrée sur fenêtre principale à l'ouverture.
- **Uniformisation `PhysicalPosition`/`PhysicalSize`** : `ruler_overlay.js` + `calc_overlay.js` utilisent `const { PhysicalPosition, PhysicalSize } = window.__TAURI__.dpi;`
- **`dialog:default` ajouté à `capabilities/default.json`** : plus d'erreur `dialog.message not allowed`.
- **Harnais de vérification des données** : `tools/verify-all.mjs`, `tools/verify/audit-data.mjs`, `tools/verify/verify-lang.mjs` créés ; contrôles négatifs passés.
- **Tabulation circulaire `calc_overlay`** : `setupTabLoop()` — `curve (tabindex=8)` → `distance (tabindex=1)`, inverse `Shift+Tab` → `curve`.

### Points d'attention / bugs potentiels (issus de l'audit)

1. **Incohérence de puissance totale** (`Character.getTotalPower()` = 6 termes inclut `cardSpin` vs `Player.getTotalPower()` = 5 termes) — **obsolète**, `Player.getTotalPower` n'est plus appelé nulle part.
2. **Defaults `ShotInfoService`** (`pxPerPb=81`, `realPxPerPb=72`) vs calibration 1080p (20.3/72) — les defaults ne servent qu'en cas d'échec de calibration ; les valeurs par défaut restent incohérentes avec la table (*point ouvert*).

### Écart README vs code

- Fonctionnalité « automatisation clic/clavier » = clic spin + raccourci global `Ctrl+Shift+X` (pas d'automatisation clavier avancée).
- L'éditeur de parcours, la règle PB, les infos de tir et la fenêtre de gestion des overlays sont des points d'entrée de l'interface principale à documenter.

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
| Tests automatisés                     | `cargo test --locked` (dans `src-tauri/`)                    | 5 tests Rust natifs dans `commands/i18n.rs` : normalisation/idempotence des pins legacy, refus des distances dupliquées, refus des clés non ordinales, trous sans pin acceptés                            |
| Vérification données                  | `node tools/verify-all.mjs`               | Invariants `parcours.json` + parité clés traduction                                                                 |
| Migration fichier parcours            | `node tools/migrate-pin-location.mjs [source.json]` | Convertit vers schéma canonique ; idempotent                                                                                                          |
| Comparaison structurelle              | `node tools/compare-parcours.mjs <a.json> <b.json>` | Compare deux jeux de parcours                                                                                                                 |
| Migration d'un fichier de parcours     | `node tools/migrate-pin-location.mjs [source.json]`          | Produit le schéma canonique ; idempotent                                                                                                                          |
| Prérequis                             | Node, Rust toolchain (MSVC), WebView2                       | Positions des overlays et calibration dépendent de la résolution du jeu                                                                                           |

Astuce debug backend : lancer les commandes depuis `src-tauri` ; les `eprintln!` (ex. « Fenêtre Pangya introuvable », « Impossible de donner le focus ») s'affichent dans la console du `tauri dev`.

---

## Annexes

### Commandes Tauri (backend)

`enable_click_through`, `disable_click_through`, `set_overlay_click_through`, `set_ruler_visibility`, `set_spin_visibility`, `set_input_bar_visibility`, `move_spin_overlay`, `set_infos_shot_visibility`, `get_settings_visibility`, `get_overlays_screen_visibility`, `get_editor_visibility`, `move_infos_shot`, `move_ruler`, `select_folder`, `get_latest_image`, `clear_screenshot_folder`, `get_available_languages`, `load_language_json`, `parcours`, `save_pin_location`, `move_and_click`, `get_mouse_position`, `move_and_click_focused`, `get_game_resolution`, `refresh_game_resolution`, `get_game_info`, `get_game_client_rect_on_screen`, `get_game_dpi_debug`, `list_all_visible_windows`.

### Événements Tauri

- **Backend → front** : `sync-ruler-visibility`, `sync-spin-visibility`, `sync-infos-shot-visibility`, `update-game-resolution`, `nouvelle-capture-detectee`, `global-trigger-click-pb`, `pin-data-warning` (liste des fichiers de parcours écartés et motif), `courses-updated` (enregistrement depuis l'éditeur).
- **Front ⇄ front (bus Tauri)** : `sync-input-value`, `sync-dropdown-parcours`, `sync-spin-force`, `sync-wind-angle`, `sync-input-bar-visibility`, `update-spin`, `update-ruler`, `update-ruler-smart-color`, `update-ruler-t-repere`, `ruler-visibility`, `ruler-lock`, `ruler-move`, `spin-visibility`, `toggle-settings-visibility`, `toggle-overlays-visibility`, `toggle-editor-visibility`, `screenshot-folder-changed`, `click-optimize-dunk`, `click-spin-only`, `request-dunk-optimization`, `dunk-optimize-result`, `trigger-main-calculation`, `current-course-state`, `request-current-course`, `app-lang-changed`, `app-theme-changed`.
- **Diffusion de l'état du parcours** : la fenêtre principale publie `current-course-state` `{ source: "main", revision, courses, selected, mapOptions, holeOptions, pinOptions }`. L'overlay ne fait que relayer les requêtes `request-current-course` vers la fenêtre principale et appliquer la réponse reçue ; toute charge utile dont `source` diffère de `main` est ignorée. L'overlay redemande l'état à chaque affichage (`sync-input-bar-visibility`), ce qui rend la synchronisation déterministe.
- **Déduplication à sens unique** : une signature (révision + sélection) évite de rediffuser un état identique à toutes les fenêtres lors d'un changement d'état. Elle ne s'applique **pas** à la réponse à `request-current-course`, qui est toujours envoyée : le demandeur ne peut pas savoir s'il a déjà reçu la diffusion (démarrage tardif, diffusion ratée), donc dédupliquer ici reviendrait à le priver de tout état tant que la sélection de la fenêtre principale n'aurait pas changé.

### Note sur le plugin dialog

`tauri-plugin-dialog` reste enregistré dans `lib.rs`, mais ses permissions ont été retirées de `capabilities/default.json` : aucune boîte de dialogue plugin n'est atteignable depuis le frontend. Les retours utilisateur passent par des bandeaux et des `alert` du DOM.

### Clés de stockage (toutes préfixées `pangya_` via `StorageService`)

`lastMap`, `lastHole`, `lastPin`, `lastSelection` (overlay), `power`, `auxpart_pwr`, `card_pwr`, `mascot_pwr`, `card_ps_pwr`, `characters`, `characters_selected`, `screenshot_folder`, `imgOffsetX`, `imgOffsetY`, `ballImgOffsetX`, `ballImgOffsetY`, `spin_force`, `calc_overlay_size`, `ruler_overlay_position`, `spin_overlay_position`, `infos_shot_position`, `ruler_smart_color`, `ruler_show_t_repere`, `rel-width`, `rel-height`, `smart-dev-limit`, `auto-fit`, `app_lang`, `theme` (+ miroir `localStorage.pangya_theme`, `localStorage.app_lang`).

L'angle du vent n'est **pas** persisté : il est recalculé à chaque coup, `WindAngleSelector` ne lit ni n'écrit dans `StorageService`.
