# Developer guide

Encore Spire is a static HTML, CSS, and JavaScript project. It has no build step or package installation requirements. Active runs are autosaved in the browser's local storage.

## Run locally

The game fetches encounter and art data as JSON, so serve the project root instead of opening `index.html` directly:

```powershell
python -m http.server 8000
```

Open <http://localhost:8000>.

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
│   ├── cards.json    # Card definitions, effects, and starter deck
│   ├── data.json     # Portrait/backdrop URLs, card path, and boss order
│   └── favicon.svg   # Browser tab icon
├── css/
│   └── styles.css
├── docs/
│   ├── copilot_handoff_architecture_guide.md
│   └── dev-readme.md
├── js/
│   ├── app.js          # Game state, rules, and event wiring
│   ├── card-effects.js # Data-driven card effect interpreter
│   ├── game-data.js    # Asset and encounter loading
│   ├── run-storage.js  # Local storage save/load
│   └── ui.js           # Rendering, card views, and modals
└── index.html
```

The save stays in the same browser and site origin; it is not synced between devices or browsers. Starting a new run replaces the previous save.

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
