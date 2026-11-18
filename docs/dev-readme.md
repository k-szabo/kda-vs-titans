# Developer guide

Encore Spire is a static HTML, CSS, and JavaScript project. It has no build step or package installation requirements. Active runs and player profile stats are saved in the browser's local storage.

## Run locally

The game fetches encounter and art data as JSON, so serve the project root instead of opening `index.html` directly:

```powershell
python -m http.server 8000
```

Open <http://localhost:8000>.

## Testing tools

Open <http://localhost:8000/#devtools> to use the testing-only wave selector. Selecting a wave resets the current wave and loads the chosen encounter. Remove `#devtools` to return to the game.

## Deploy to GitHub Pages

1. Push the project to a GitHub repository.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the branch and repository root (`/`) as the source, then save.

GitHub Pages publishes `index.html` and the `assets/`, `css/`, and `js/` folders together. The app uses relative paths and does not require a build command.

## Project structure

```text
.
├── assets/
│   ├── bosses/       # One JSON encounter definition per boss
│   ├── kaiju/        # Kaiju SVG illustrations
│   ├── cards.json    # Card definitions, upgrades, effects, and starter deck
│   ├── changelog.json # Version identifiers and release notes
│   ├── data.json     # Portrait/backdrop URLs and ordered data paths
│   ├── relics.json   # Passive relic definitions and effects
│   └── favicon.svg   # Browser tab icon
├── css/
│   └── styles.css
├── docs/
│   ├── copilot_handoff_architecture_guide.md
│   └── dev-readme.md
├── js/
│   ├── app.js             # Game state, rules, and event wiring
│   ├── audio.js           # Synthesized Web Audio effects
│   ├── card-effects.js    # Data-driven card effect interpreter
│   ├── combat-rules.js    # Player damage, shield, and Cheer resolution
│   ├── game-data.js       # Asset and encounter loading
│   ├── profile-storage.js # Persistent profile stats and codex
│   ├── run-state.js       # Run-save migration and validation
│   ├── run-storage.js     # Versioned local run save/load
│   └── ui.js              # Rendering, card views, and modals
└── index.html
```

Run and profile data stay in the same browser and site origin; they are not synced between devices or browsers. Starting a new run replaces only the active run.

## Version and changelog

The current version and newest-first release history live in `assets/changelog.json` and appear in the header dropdown. Use `vMAJOR.MINOR.PATCH_<8 lowercase hex characters>`. Bump the SemVer portion for a release and set the 8-character suffix to the first eight characters of the SHA-256 digest of the compact JSON object `{ "date": "<YYYY-MM-DD>", "changes": ["...", "..."] }`. Keep `currentVersion` equal to the newest release's version and set `assets/data.json`'s `version` field to the same value. This version is used to clear app caches and cache-bust JSON asset requests.

Generate the suffix for the exact date and change notes with:

```powershell
node -e "const crypto = require('node:crypto'); const release = { date: '2026-11-18', changes: ['Change one.', 'Change two.'] }; console.log(crypto.createHash('sha256').update(JSON.stringify(release)).digest('hex').slice(0, 8));"
```

## Add a boss

## Add a boss

1. Add its backdrop URL to `assets/data.json` under `backdrops`.
2. Add an SVG illustration under `assets/kaiju/`.
3. Add a JSON encounter file under `assets/bosses/`, including its stats, intent patterns, backdrop key, illustration path, and fallback background. Set the illustration path relative to `assets/data.json`, such as `./kaiju/new-boss.svg`.
4. Add the boss JSON path to the `bosses` array in `assets/data.json` at the desired wave position.

See the [architecture guide](copilot_handoff_architecture_guide.md) for the boss schema, card definitions, and gameplay architecture.

## External resources

- [Tailwind CSS Play CDN](https://tailwindcss.com/docs/installation/play-cdn) and [Google Fonts](https://fonts.google.com/) are loaded by the page.
- K/DA portrait images are served from Riot's Data Dragon CDN.
- Encounter backdrops are served from Unsplash.

This repository does not include a license granting rights to third-party characters, names, or images.
