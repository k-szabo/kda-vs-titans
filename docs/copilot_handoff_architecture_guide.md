# K/DA vs. Godzilla — Encore Spire

A zero-build, turn-based deckbuilding roguelike inspired by *Slay the Spire*, starring **K/DA** defending a world-tour dome against an 8-wave gauntlet of **Toho / MonsterVerse Kaiju**. The project is split into static HTML, CSS, and JavaScript files and can be served directly or deployed to GitHub Pages.

> **Note for GitHub Copilot / AI Agents:** The page markup lives in `index.html`, custom styles in `css/styles.css`, and game behavior is split across ES modules under `js/`. The app uses Tailwind CSS (via CDN) and Google Fonts (`Orbitron` and `Inter`). Keep references relative so the site works from a GitHub Pages project subpath.

---

## 1. Quick Start & Controls

- **Run:** Serve the project root with a static web server (for example, `python -m http.server 8000`) and open `http://localhost:8000` (no build step required). Fetching JSON data does not work when opening the page directly with `file://`.
- **Save:** The current run autosaves to this browser's local storage and resumes after reload. It is not shared across browsers or devices.
- **GitHub Pages:** Publish the repository root using GitHub Pages' branch deployment (Settings → Pages). The relative CSS and JavaScript URLs work from project sites.
- **Keyboard Shortcuts:**
  - `1` – `5`: Play the corresponding card in hand.
  - `E`: End the player's turn and resolve the Kaiju's telegraphed intent.
- **Debug / Wave Jumpers:** Clicking `W1` through `W8` in the top header immediately jumps to that Kaiju encounter (`startStage(waveIdx)`).

---

## 2. Core Gameplay Loop & Mechanics

1. **Player Turn:**
   - Starts with `3 / 3` Hype Energy (`state.player.maxEnergy`) and draws `5` cards from `state.drawPile` (reshuffling `state.discardPile` when empty; max hand size `8`).
   - Playing a card deducts `card.cost` energy, moves the card to `discardPile` (or `exhaustPile` if `card.exhaust === true`), executes its ordered effects through `executeCardEffects(card, ctx)`, and charges **Crowd Cheer** by `8 + (card.cost * 6)%`.
2. **Crowd Cheer // Joint Finale (`triggerJointAttack`):**
   - At `100%` Crowd Cheer, the button `#btnJointAttack` unlocks for a free (`0` Energy) 4-member synchronized ultimate: deals `28` base attack damage, grants `+10` Holo Shield, applies `2` Charm to the Kaiju, and refunds `+1` Hype Energy.
3. **Enemy Intent & End Turn (`endPlayerTurn`):**
   - Unused hand cards are discarded, the enemy's previous `block` resets to `0`, and `getCurrentEnemyIntent()` resolves (`attack`, `atomic`, `multi`, `charge`, or `debuff_atk`).
   - Status durations (`charm`, `marked`, `weak`) decrement by `1`, `enemy.patternStep` advances, and the next player turn begins.
4. **Post-Battle Draft (`openDraftModal`):**
   - Defeating a Kaiju lets the player draft `1` of `3` non-starter cards into `state.masterDeck` and heal `+18 HP` (or skip to heal `+25 HP`) before advancing to the next wave.

---

## 3. Code Architecture

The app is organized into these files:

| File | Responsibility |
| :--- | :--- |
| `index.html` | Page structure, controls, and modal containers. Loads Tailwind CSS, Google Fonts, the custom stylesheet, and the game script. |
| `css/styles.css` | Custom theme, card styling, and combat animations. |
| `js/app.js` | Run state, combat rules, persistence integration, and event wiring. |
| `js/game-data.js` | Loads and validates the manifest, cards, and boss encounters. |
| `js/card-effects.js` | Executes card effect actions and formats card logs. |
| `js/run-storage.js` | Reads and writes versioned run saves in browser `localStorage`. |
| `js/ui.js` | Rendering, card views, combat animation, and modal behavior. |
| `assets/data.json` | Portrait/backdrop URLs and ordered card/boss data paths. |
| `assets/cards.json` | Card metadata, declarative effects, log templates, and starter deck. |
| `assets/bosses/*.json` | Individual boss stats, intent patterns, backdrop and illustration paths, and arena fallback styling. |
| `assets/kaiju/*.svg` | Standalone Kaiju illustrations, including a separate Burning Godzilla variant. |

Run state autosaves after each rendered state change and restores on reload. Saves are local to the current browser and site origin; starting a new run overwrites the active save.

| Section | Identifier(s) | Responsibility |
| :--- | :--- | :--- |
| **Data Loading** | `js/game-data.js` | Loads portraits, card definitions, and boss files from the manifest; resolves boss artwork paths. |
| **Card Database** | `assets/cards.json` | Stores card presentation, cost, starter membership, effect actions, and log templates without executable code. |
| **Card Effects** | `js/card-effects.js` | Interprets ordered actions such as damage, block, draw, healing, statuses, cheer, and conditional energy. |
| **Combat Engine** | `js/app.js` | Owns run state, stage progression, damage calculation, enemy intents, and turn resolution. |
| **Persistence** | `js/run-storage.js` | Versioned local save access; `js/app.js` validates state and restores draft/end-of-run screens. |
| **UI** | `js/ui.js` | Renders wave pills, squad portraits, status, Kaiju layers, cards, and battle log; displays draft and run-end modals. |
| **Event Wiring** | `js/app.js` | Binds `End Turn`, `Joint Finale`, pile viewers, `New Run`, and `1-5`/`E` hotkeys. |

---

## 4. Data Schemas for Extending Content

### Adding a New Card (`assets/cards.json`)
Add an entry to the `cards` array. Any card with `starter: false` automatically enters the post-battle draft pool. Add its ID to `starterDeck` if it should appear in a new run:

```json
{
  "id": "seraphine_encore",
  "name": "Harmonic Resonance",
  "member": "squad",
  "memberName": "K/DA SQUAD",
  "type": "SKILL",
  "cost": 1,
  "starter": false,
  "desc": "Gain <b>6</b> Holo Shield and <b>+15%</b> Crowd Cheer.",
  "effects": [
    { "type": "gainBlock", "amount": 6 },
    { "type": "addCheer", "amount": 15 }
  ],
  "log": {
    "template": "🎶 Harmonic Resonance boosted shields & crowd cheer!",
    "colorClass": "text-amber-300"
  }
}
```

Supported effect types are `damage` (optional `hits`), `gainBlock`, `healPlayer`, `applyEnemyStatus`, `addPlayerStatus`, `clearPlayerStatus`, `addCheer`, `draw`, and `gainEnergy`. Effects execute in array order. An effect or log alternative can use `"when": { "target": "enemy", "status": "charm" }` to require an active status. Log templates support the `{damage}` placeholder.

### Adding a New Kaiju Boss
Create a JSON file in `assets/bosses/` with the encounter's combat stats, intent patterns, asset references, and arena fallback background. Add its backdrop URL to `assets/data.json`'s `backdrops`, then add its JSON path to the manifest's `bosses` array to control its position in the setlist. The illustration path is relative to `assets/data.json` and should point to an SVG under `assets/kaiju/`. The renderer reads the boss configuration directly, so no boss-specific code change is needed:

```json
{
  "id": "biollante_w9",
  "name": "BIOLLANTE: SPORE LEVIATHAN",
  "subtitle": "WAVE 9 // MUTAGENIC BLOOM",
  "maxHp": 170,
  "spriteType": "biollante",
  "burning": false,
  "assets": {
    "backdrop": "biollante",
    "illustration": "./kaiju/biollante.svg"
  },
  "visuals": {
    "background": "radial-gradient(circle, #14532d, #020617)"
  },
  "patterns": [
    { "type": "debuff_atk", "dmg": 12, "weak": 1, "label": "ACID SAP: 12 DMG + WEAK" },
    { "type": "charge", "block": 20, "label": "VINE CARAPACE: +20 BLOCK", "charged": true },
    { "type": "atomic", "dmg": 30, "label": "CORROSIVE BREATH: 30 DMG", "charged": true }
  ]
}
```

Save boss definitions as valid JSON (quoted keys and double-quoted strings), rather than JavaScript object literals.

---

## 5. Planned / Suggested Next Features for Copilot

- [ ] **Deck Upgrades / Relics ("Backstage Gear"):** Let players choose between drafting a card or equipping a passive relic (e.g., *Lightstick Amplifier*: `+1` starting energy on Turn 1; *Monarch Sub-Woofer*: `+2` block whenever an Attack is played).
- [ ] **Card Upgrade (`+`) System:** Allow upgrading existing cards in `state.masterDeck` at rest stops (increasing base damage/block or reducing cost by `1`).
- [ ] **Web Audio API Sound Effects:** Add synthesized laser/bass-drop SFX on card play, Joint Finale activation, and Kaiju roars without external audio files.
- [ ] **Persistent Run Stats (`localStorage`):** Track highest wave cleared, fastest win, and unlocked Kaiju codex entries.
- [ ] **Custom Vector Art for Additional Monsters:** Add an SVG under `assets/kaiju/` and reference it from a new boss JSON file and the ordered boss list in `assets/data.json`.