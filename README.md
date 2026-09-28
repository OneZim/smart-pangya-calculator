# Smart Pangya Calculator

Outil overlay multi-fenêtres pour **Pangya Reborn**, conçu pour aider à calculer la puissance, le spin et les trajectoires directement par-dessus le jeu.

## ✨ Fonctionnalités

- Calcul de puissance et décalage (PB) basé sur la physique réelle du jeu
- Overlay de spin/curve avec dial 2D
- Optimiseur de dunk (Dunk, Tomahawk, Spike)
- Base de données de parcours (20 parcours, 302 trous, 821 pins) sélectionnable Map → Trou → Pin
- Éditeur de parcours intégré pour ajuster les positions de pins
- Règle de visée PB, cadran spin et infos de tir (PB réel, %, distance) en overlays
- Support multi-résolution avec calibration par preset
- Clic automatique dans le jeu via raccourci global
- Interface multilingue (FR, EN, IT, ES, DE, PT) et 4 thèmes

## 🛠️ Stack technique

- **Frontend** : JavaScript vanilla (pas de bundler)
- **Backend** : Rust
- **Framework** : [Tauri 2](https://tauri.app/)

## 🚧 Statut

Projet personnel en développement actif. Les fonctionnalités et l'interface évoluent régulièrement.

## 📦 Installation

```bash
git clone https://github.com/OneZim/smart-pangya-calculator.git
cd smart-pangya-calculator
npm install
npm run tauri dev
```

## 🗂️ Données de parcours

Les parcours sont livrés avec l'application dans `src-tauri/data/parcours.json` et copiés dans
`%APPDATA%\com.onezim.smart-pangya-calculator\` au premier enregistrement depuis l'éditeur.

Pour revenir aux parcours d'origine : quittez l'application, supprimez `parcours.json` et
`pin_location.json` (ancien format) de ce dossier, puis relancez l'application.

## 📄 Licence

[PolyForm Noncommercial 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0/) — libre d'utilisation, de modification et de redistribution, usage commercial interdit sans autorisation.
