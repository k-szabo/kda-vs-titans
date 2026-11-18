# K/DA vs. Godzilla — Encore Spire

A zero-build, turn-based deckbuilding roguelike inspired by *Slay the Spire*, starring **K/DA** defending a world-tour dome against an 8-wave gauntlet of **Toho / MonsterVerse Kaiju**. The project is split into static HTML, CSS, and JavaScript files and can be served directly or deployed to GitHub Pages.

> **Note for GitHub Copilot / AI Agents:** The page markup lives in `index.html`, custom styles in `css/styles.css`, and game behavior is split across ES modules under `js/`. The app uses Tailwind CSS (via CDN) and Google Fonts (`Orbitron` and `Inter`). Keep references relative so the site works from a GitHub Pages project subpath.

---

## 1. Quick Start & Controls

- **Run:** Serve the project root with a static web server (for example, `python -m http.server 8000`) and open `http://localhost:8000` (no build step required). Fetching JSON data does not work when opening the page directly with `file://`.
- **Save:** The active run and profile stats autosave to this browser's local storage. Neither is shared across browsers or devices.
- **GitHub Pages:** Publish the repository root using GitHub Pages' branch deployment (Settings → Pages). The relative CSS and JavaScript URLs work from project sites.
- **Keyboard Shortcuts:**
  - `1` – `5`: Play the corresponding card in hand.
  - `E`: End the player's turn and resolve the Kaiju's telegraphed intent.
- **Debug / Wave Jumpers:** Clicking `W1` through `W8` in the top header immediately jumps to that Kaiju encounter (`startStage(waveIdx)`).

---

## 2. Core Gameplay Loop & Mechanics

1. **Player Turn:**
   - Starts with `3 / 3` Hype Energy (`state.player.maxEnergy`) and draws `5` cards from `state.drawPile` (reshuffling `state.discardPile` when empty; max hand size `8`).
   - Playing a card deducts its effective cost (including upgrades), moves its instance to `discardPile` (or `exhaustPile` if `card.exhaust === true`), executes its ordered effects through `executeCardEffects(card, ctx, upgradeLevel)`, and charges **Crowd Cheer** by `5 + (effective cost * 3)%`.
2. **Crowd Cheer // Joint Finale (`triggerJointAttack`):**
   - At `100%` Crowd Cheer, the button `#btnJointAttack` unlocks for a free (`0` Energy) 4-member synchronized ultimate: deals `28` base attack damage, grants `+10` Holo Shield, applies `2` Charm to the Kaiju, and refunds `+1` Hype Energy.
3. **Enemy Intent & End Turn (`endPlayerTurn`):**
   - Unused hand cards are discarded, the enemy's previous `block` resets to `0`, and `getCurrentEnemyIntent()` resolves (`attack`, `atomic`, `multi`, `charge`, or `debuff_atk`).
   - Status durations (`charm`, `marked`, `weak`) decrement by `1`, `enemy.patternStep` advances, and the next player turn begins.
4. **Post-Battle Rewards (`openDraftModal`):**
   - Defeating a Kaiju opens a reward choice for a new card, an unowned relic, or an upgrade to one unupgraded card instance. Card and relic rewards restore `+18 HP`; resting restores `+25 HP` and takes no other reward. Upgrades do not heal.
5. **Damage and Crowd Cheer:**
   - Damage absorbed by Holo Shield does not reduce Cheer. After shields, Cheer decreases by the HP actually lost, down to `0%`.
6. **Profile and audio:**
   - Cleared waves, fastest full victory, and the Kaiju codex persist separately from the active run. Synthesized card, Joint Finale, and Kaiju roar effects can be toggled in the header.

---

## 3. Code Architecture

The app is organized into these files:

| File | Responsibility |
| :--- | :--- |
| `index.html` | Page structure, controls, and modal containers. Loads Tailwind CSS, Google Fonts, the custom stylesheet, and the game script. |
| `css/styles.css` | Custom theme, card styling, and combat animations. |
| `js/app.js` | Run state, combat rules, progression, persistence integration, and event wiring. |
| `js/combat-rules.js` | Resolves player damage through Holo Shield, HP, and Crowd Cheer. |
| `js/game-data.js` | Loads and validates the manifest, cards, relics, and boss encounters. |
| `js/card-effects.js` | Executes card effect actions, applies upgrade values, and formats card logs. |
| `js/run-storage.js` | Reads and writes versioned run saves in browser `localStorage`. |
| `js/run-state.js` | Migrates version-1 saves and validates current saved-run state. |
| `js/profile-storage.js` | Reads and writes persistent run statistics and codex unlocks. |
| `js/audio.js` | Synthesizes optional sound effects with the Web Audio API. |
| `js/ui.js` | Rendering, card views, combat animation, rewards, and profile modals. |
| `assets/data.json` | Portrait/backdrop URLs and ordered data-file paths. |
| `assets/cards.json` | Card metadata, upgrade effects, log templates, and starter deck. |
| `assets/relics.json` | Passive relic metadata and declarative trigger effects. |
| `assets/bosses/*.json` | Individual boss stats, intent patterns, backdrop and illustration paths, and arena fallback styling. |
| `assets/kaiju/*.svg` | Standalone Kaiju illustrations, including a separate Burning Godzilla variant. |

Run state autosaves after each rendered state change and restores on reload. Version-1 saves are migrated to version 2 card instances; unsupported or invalid saves start a new run. Profile stats use their own storage key, so starting a new run does not erase them.

| Section | Identifier(s) | Responsibility |
| :--- | :--- | :--- |
| **Data Loading** | `js/game-data.js` | Loads portraits, card and relic definitions, and boss files from the manifest; resolves boss artwork paths. |
| **Card Database** | `assets/cards.json` | Stores card presentation, cost, starter membership, upgrade metadata, effect actions, and log templates without executable code. |
| **Card Effects** | `js/card-effects.js` | Interprets ordered actions such as damage, block, draw, healing, statuses, cheer, and conditional energy, including upgrade deltas. |
| **Damage Rules** | `js/combat-rules.js` | Applies incoming damage to shield, then actual HP, and reduces Cheer only by HP lost. |
| **Relics** | `assets/relics.json` | Stores passive relic metadata and supported triggers (`stageStart`, `attackPlayed`). |
| **Combat Engine** | `js/app.js` | Owns run state, stage progression, damage calculation, enemy intents, and turn resolution. |
| **Persistence** | `js/run-storage.js`, `js/run-state.js`, `js/profile-storage.js` | Store the active versioned run and persistent profile/codex separately; validate and migrate saved runs. |
| **Audio** | `js/audio.js` | Synthesizes optional card, Joint Finale, and Kaiju roar sounds with Web Audio. |
| **UI** | `js/ui.js` | Renders wave pills, squad portraits, relics, status, Kaiju layers, upgraded cards, and battle log; displays reward, profile, and run-end modals. |
| **Event Wiring** | `js/app.js` | Binds turn/combat, reward, stats, sound, pile, and run controls plus `1-5`/`E` hotkeys. |

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
  "upgrade": { "description": "Gain 8 Holo Shield and +15% Crowd Cheer." },
  "effects": [
    { "type": "gainBlock", "amount": 6, "upgradeAmount": 2 },
    { "type": "addCheer", "amount": 15 }
  ],
  "log": {
    "template": "🎶 Harmonic Resonance boosted shields & crowd cheer!",
    "colorClass": "text-amber-300"
  }
}
```

Supported effect types are `damage` (optional `hits`), `gainBlock`, `healPlayer`, `applyEnemyStatus`, `addPlayerStatus`, `clearPlayerStatus`, `addCheer`, `draw`, and `gainEnergy`. Effects execute in array order. Optional `upgradeAmount` increases a numeric effect at upgrade level 1; `upgrade.costReduction` lowers the card's energy cost. An effect or log alternative can use `"when": { "target": "enemy", "status": "charm" }` to require an active status. Log templates support `{damage}`, `{block}`, `{heal}`, and `{encore}` placeholders.

### Adding a Relic (`assets/relics.json`)
Add a unique `id`, display `name`, player-facing `description`, and effect list to `relics`. Current supported effects are `startingEnergy` on `stageStart` and `gainBlock` on `attackPlayed`; add corresponding game-engine handling before introducing a new effect type.

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

- [x] **Deck Upgrades / Relics ("Backstage Gear"):** Choose between drafting a card, equipping an unowned passive relic, upgrading a card instance, or resting after each stage.
- [x] **Card Upgrade (`+`) System:** Upgrade one unupgraded card instance at each reward stop; upgrade values and optional cost reductions are data-driven.
- [x] **Web Audio API Sound Effects:** Synthesized card, Joint Finale, and Kaiju attack sounds with a user-accessible toggle.
- [x] **Persistent Run Stats (`localStorage`):** Track highest wave cleared, fastest victory, and unlocked Kaiju codex entries separately from the active run.
- [ ] **Custom Vector Art for Additional Monsters:** Add an SVG under `assets/kaiju/` and reference it from a new boss JSON file and the ordered boss list in `assets/data.json`.