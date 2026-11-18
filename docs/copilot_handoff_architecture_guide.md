# K/DA vs. Godzilla — Encore Spire

A zero-build, turn-based deckbuilding roguelike inspired by *Slay the Spire*, starring **K/DA** defending a world-tour dome against an 8-wave gauntlet of **Toho / MonsterVerse Kaiju**. The project is split into static HTML, CSS, and JavaScript files and can be served directly or deployed to GitHub Pages.

> **Note for GitHub Copilot / AI Agents:** The page markup lives in `index.html`, custom styles in `css/styles.css`, and game behavior in `js/app.js`. The app uses Tailwind CSS (via CDN), Google Fonts (`Orbitron` and `Inter`), and vanilla JavaScript wrapped in an IIFE. Keep references relative so the site works from a GitHub Pages project subpath.

---

## 1. Quick Start & Controls

- **Run:** Serve the project root with a static web server (for example, `python -m http.server 8000`) and open `http://localhost:8000` (no build step required). Fetching JSON data does not work when opening the page directly with `file://`.
- **GitHub Pages:** Publish the repository root using GitHub Pages' branch deployment (Settings → Pages). The relative CSS and JavaScript URLs work from project sites.
- **Keyboard Shortcuts:**
  - `1` – `5`: Play the corresponding card in hand.
  - `E`: End the player's turn and resolve the Kaiju's telegraphed intent.
- **Debug / Wave Jumpers:** Clicking `W1` through `W8` in the top header immediately jumps to that Kaiju encounter (`startStage(waveIdx)`).

---

## 2. Core Gameplay Loop & Mechanics

1. **Player Turn:**
   - Starts with `3 / 3` Hype Energy (`state.player.maxEnergy`) and draws `5` cards from `state.drawPile` (reshuffling `state.discardPile` when empty; max hand size `8`).
   - Playing a card deducts `card.cost` energy, moves the card to `discardPile` (or `exhaustPile` if `card.exhaust === true`), executes `card.play(ctx)`, and charges **Crowd Cheer** by `8 + (card.cost * 6)%`.
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
| `js/app.js` | Vanilla JavaScript game logic, rendering, and event wiring. Loads external data from `assets/`. |
| `assets/data.json` | Portrait and Kaiju backdrop URLs, plus the ordered list of boss JSON files. |
| `assets/bosses/*.json` | Individual boss stats, intent patterns, backdrop and illustration paths, and arena fallback styling. |
| `assets/kaiju/*.svg` | Standalone Kaiju illustrations, including a separate Burning Godzilla variant. |

The game logic in `js/app.js` has the following sections:

| Section | Identifier(s) | Responsibility |
| :--- | :--- | :--- |
| **1. Data Loading** | `ART_ASSETS`, `ENCOUNTERS`, `loadGameData`, `loadJson` | Loads portraits and backdrops from `assets/data.json` and boss definitions in manifest order; resolves illustration paths relative to each boss JSON file. |
| **2. Card Database** | `CARD_DB` | Dictionary of all playable cards (`id`, `name`, `member`, `memberName`, `type`, `cost`, `starter`, `exhaust`, `desc`, `play(ctx)`). |
| **3. Boss Data** | `assets/bosses/*.json` | Encounter definitions are external data, not JavaScript constants. Each entry provides combat patterns, asset paths, and arena styling. |
| **4. Combat Engine** | `state`, `startStage`, `playCardAtIndex`, `createEffectContext`, `endPlayerTurn` | Core state machine, damage calculation (`computeCardAttackDamage`), status math, and turn resolution. |
| **5. Draft & Modals** | `openDraftModal`, `showRunEndModal` | Post-wave card reward selection and victory/defeat overlays. |
| **6. UI Rendering** | `renderAll`, `createCardElement`, `spawnPopup` | Full DOM re-render of header wave pills, squad portraits, Crowd Cheer bar, Kaiju SVG/backdrop layers, hand grid, and battle log. |
| **7. Event Wiring** | `openPileModal`, keyboard & button listeners | Binds `End Turn`, `Joint Finale`, `Draw/Discard` pile viewers, `New Run`, and `1-5`/`E` hotkeys. |

---

## 4. Data Schemas for Extending Content

### Adding a New Card (`CARD_DB`)
Add a new key to `CARD_DB`. Any card with `starter: false` automatically enters the post-battle draft pool:

```js
seraphine_encore: {
  id: 'seraphine_encore',
  name: 'Harmonic Resonance',
  member: 'squad',           // 'ahri' | 'akali' | 'evelynn' | 'kaisa' | 'squad'
  memberName: 'K/DA SQUAD',
  type: 'SKILL',             // 'ATTACK' | 'SKILL' | 'POWER'
  cost: 1,
  starter: false,
  exhaust: false,
  desc: 'Gain <b>6</b> Holo Shield and <b>+15%</b> Crowd Cheer.',
  play: (ctx) => {
    ctx.gainBlock(6);
    ctx.addCheer(15);
    ctx.log('🎶 Harmonic Resonance boosted shields & crowd cheer!', 'text-amber-300');
  }
}
```

**Available `ctx` helpers inside `card.play(ctx)`:**
- `ctx.calcDmg(base)` — Applies `+encore` bonus, `-25%` player `weak`, and `+50%` enemy `marked`.
- `ctx.dealEnemyDmg(amount)` — Subtracts from `enemy.block` first, then `enemy.hp`, triggering hit flash & floating damage popups.
- `ctx.gainBlock(amount)` — Adds to `player.block`.
- `ctx.healPlayer(amount)` — Restores `player.hp` up to `player.maxHp`.
- `ctx.applyEnemyStatus(statusKey, turns)` — Supports `'charm'` (`-25%` Kaiju attack) and `'marked'` (`+50%` damage taken).
- `ctx.addCheer(pct)` — Increments `player.cheer` (capped at `100`).
- `ctx.draw(count)` — Draws cards into `state.hand`.
- `ctx.log(msg, tailwindColorClass)` — Appends an entry to `#combatLog`.

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