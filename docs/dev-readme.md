# Developer guide

Encore Spire is a static HTML, CSS, and JavaScript project with no runtime package or deployment build requirement. Rebuilding the committed Tailwind stylesheet uses temporary npm packages. Active runs and player profile stats are saved in the browser's local storage.

For the authoritative technical and agent reference (data schemas, validation, save invariants, and change workflows), see [`AGENTS.md`](../AGENTS.md). This guide focuses on local setup, features, progression, and deployment.

## Run locally

The game fetches encounter and art data as JSON, so serve the project root instead of opening `index.html` directly:

```powershell
python -m http.server 8000
```

Open <http://localhost:8000>.

## Testing tools

Open <http://localhost:8000/#devtools> to use the testing-only wave selector. Selecting a wave resets the current wave and loads the chosen encounter. Remove `#devtools` to return to the game.

## Leader and art progression

The World Tour main menu is shown on boot unless `#devtools` is in the URL. It displays each member's equipped art and rank, total wins, highest wave, unlocked art, Codex progress, Encore tier, and daily streak. It offers Continue Tour, New World Tour, Daily World Tour, Art Studio, How to Play, and Options. The Codex and career records are inside Options. The combat header's MENU button returns to the main menu without ending the active run. Continue Tour restores the saved combat or reward screen.

A new tour begins with leader and Encore-tier selection plus optional custom modifiers (Chaos Draft, No Cuts, Double Hazard; Daily Tours always run clean). A leader's special ability can be used once during that run. Each leader starts with a flavored 10-card starter deck leaning into their keyword identity (Charm, Pierce, Drain, Encore). Completing all 10 waves with a leader unlocks that member's MORE art; a second full run unlocks FIRESTARTER; a third unlocks PRESTIGE. Choose unlocked character art in the Art Studio. Each cleared wave advances only the run leader's equipped art border, which advances once per 10 waves. The Art Studio's Card Atelier spends Spotlight Shards (earned per wave cleared) on permanent shiny, platinum, and holo card finishes. Missions in the Missions menu pay bonus Shards for wave, victory, leader, damage, deck-size, and collection goals.

Leader art uses official League of Legends Data Dragon splash assets configured in `assets/data.json`.

## Encore Ascension

Completing a 10-wave run unlocks the next Encore tier. `maxEncoreLevel` is stored in the persistent profile and ranges from `0` (Normal) through `5`. Later releases keep `PROFILE_VERSION` at 3 (profile stats, art, and codex carry over) while run saves reset with each `RUN_SAVE_VERSION` bump (currently 6), intentionally resetting active runs so all players begin a fresh tour.

- **Encore 1:** +15% boss maximum HP.
- **Encore 2:** Card and relic rewards heal 10 HP instead of 14 HP.
- **Encore 3:** Bosses start with +1 Strength.
- **Encore 4:** New runs include one non-draftable Stage Fright Status card in the starter deck.
- **Encore 5:** Charged-interrupt thresholds increase by 4 damage and boss Phase 2 triggers at 60% HP instead of 50%.

Bosses also scale by wave independent of Encore: +3% maximum HP per wave index and +1 Strength from wave 5 (+2 from wave 8).

Each new standard run also receives the selected leader's signature starter Relic and flavored 10-card starter deck: Ahri gets Nine-Tail Mic, Akali gets Neon Kunai, Evelynn gets Velvet Shades, and Kai'Sa gets Void Core. Signature Relics are leader-bound and never appear in random Relic rewards; Daily Tours draw only from the general Relic pool.

## Reactive boss mechanics

Bosses may define optional `passives` in their encounter JSON:

- `onPlayerAttack` can grant Block when an Attack card is played.
- `onSkillPlayed` can grant Strength at a configured Skill cadence.
- `onTurnEnd` can grant Strength before the boss acts.
- `onHpBelowHalf` supports a one-time enrage that clears Charm/Marked and grants Strength and Block; an optional `phase2Patterns` array replaces the normal pattern.

Enemy Strength is added to each hit. Charged intents may define `interruptThreshold` to be skipped when K/DA deals that much HP damage during the player turn; `interruptBonus` sets the extra damage if the interrupt is missed, and `pierce` controls the share of damage that bypasses Holo Shield. The `injectStatus` intent adds non-draftable Status card copies to the discard pile.

Status cards may set `endTurnDamage` and `ethereal` to deal direct HP damage and exhaust if left in hand. The hand is capped at five cards, including when loading a saved run; overflow cards return to the draw pile. The current run-save version is 6.

Cards may set `retain: true` to stay in hand instead of being discarded at turn end; the older `retainInHand` field remains supported for compatibility. Void Prism Bastion and Starlight Aria are draftable retained cards. Waves award deterministic Merch Tokens (`10 + wave index + Encore tier × 2`) shown in the combat header and on the tour receipt; the between-wave merch shop alongside Leona's routing sells cards (12), relics (18), deck removal (8), and +15 HP patch-ups (6). There is no free Cut or Rest — thinning and healing are economic decisions. EMP Static and Stage Fright retain until played, while Micro-Oxygen costs 1 Hype Energy and deals 4 direct HP damage if left in hand.

Playing cards from all four K/DA members in one player turn triggers Quartet Harmony once that turn: +1 Energy, +6 Shield, and +10% Crowd Cheer. Playing three cards from the same member consecutively triggers that member's Solo Spotlight: Ahri applies 1 Charm and heals 3 HP; Akali deals 6 piercing damage and draws 1 card; Evelynn applies 1 Marked and steals up to 3 boss Block; Kai'Sa gains 8 Shield and 1 turn of Encore. Neutral cards (K/DA SQUAD and guest DJ Sona support cards: Aria of Perseverance, Crescendo, Diminuendo) break the consecutive Spotlight chain without erasing Quartet progress. The combat UI shows members played and the current consecutive chain. Turn tracking is normalized when loading run saves.

Boss encounters may define an optional `stageEffect` field. Supported hazards are `overcharge_grid` (3 direct HP damage per unspent Energy at turn end), `thermonuclear_heat` (3 direct HP damage at turn end if Shield is 0), and `luminous_spores` (+3% Crowd Cheer for each Skill played). Overcharge Grid is used by King Ghidorah and Mechagodzilla; Thermonuclear Heat by Rodan and Burning Godzilla; Luminous Spores by Mothra. The active hazard is shown in the boss panel.

Daily World Tour uses the UTC date as a deterministic seed for its assigned leader, Relic, rule modifier, deck shuffles, encounter drafts, and rewards. Daily runs can auto-submit their score to the community leaderboard (opt out in Options); the board needs a configured Supabase backend — see “Leaderboard backend” below. Each wave drafts its boss from a rotating pool (29 kaiju across the 10 waves); standard runs roll randomly while Daily runs roll the same setlist all day. Acoustic Set starts with 4 max Energy and no starter Relic; Encore Pressure gives bosses +15% HP and a random starter Relic; Crowd Surf grants +15% Crowd Cheer at each wave start and a random starter Relic. Daily wins update current and best consecutive-day streaks in the existing profile.

Victory and defeat screens include a copyable Tour Receipt with waves cleared, the most-played card, and peak single-turn damage. These run metrics are stored with the v6 run state.

The battle log can be collapsed from its header control. It defaults to collapsed on narrow screens to preserve combat and hand space.

## How to Play and Options

The How to Play modal walks through the goal (all 10 waves), turn flow, boss intents and interrupts, member combos and keywords, the status-effect glossary, the between-wave event/routing/shop flow, and leader/relic progression. Options is available from the main menu and combat header and contains the Codex, career records, and changelog. Sound preference and custom keyboard bindings are stored in the existing profile v3 data; older profiles are normalized without clearing progress. This update resets run saves to v6 (old runs must restart) while leaving profile v3 data — stats, art, and codex — untouched. Default shortcuts are read from `assets/keybinds.json`, referenced by `assets/data.json`, and custom bindings override them in the profile. Sound defaults to on. The shipped defaults are `1`–`5` for hand slots, `E` to end the turn, `Q` for Joint Finale, and `R` for the Leader Ability. Bindings accept one printable key, duplicate bindings swap, Escape cancels a pending capture, and Reset Defaults restores the JSON-defined defaults. The separate Codex/Changelog menu entry has been removed.

The synthesized sound toggle takes effect immediately, including for tones already playing. Enabling sound from Options plays a short confirmation chime.

## Leaderboard backend

Daily scores live in Supabase (dedicated project). The game calls the `daily-leaderboard` Edge Function through `assets/config/leaderboard-public.json`, which the Pages workflow writes from the `SUPABASE_PUBLISHABLE_KEY` Actions variable at deploy time — the key is never committed (see `.gitignore`). Local runs create the same file with `node scripts/write-leaderboard-config.mjs` after exporting the variable; without it the board shows "unavailable" and everything else works.

Full setup (project, migration, function, verification) lives in `supabase/README.md`. Switching branches deploy to the Actions workflow in `.github/workflows/pages.yml` is required for the variable injection to reach production.

## Deploy to GitHub Pages

1. Push the project to a GitHub repository.
2. Open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the branch and repository root (`/`) as the source, then save.

GitHub Pages publishes `index.html` and the `assets/`, `css/`, and `js/` folders together. The app uses relative paths and does not require a build command.

## Project structure

```text
.
├── AGENTS.md         # Authoritative technical/agent guide
├── assets/
│   ├── bosses/       # One JSON encounter definition per boss
│   ├── kaiju/        # Kaiju SVG illustrations
│   ├── cards.json    # Card definitions, upgrades, effects, and per-leader starter decks
│   ├── changelog.json # Version identifiers and release notes
│   ├── data.json     # Portrait/backdrop URLs, encounter pools, and ordered data paths
│   ├── keybinds.json # Default keyboard shortcuts for game actions
│   ├── missions.json # Mission definitions with data-driven unlock conditions
│   ├── relics.json   # Passive relic definitions and effects
│   └── favicon.svg   # Browser tab icon
├── css/
│   └── styles.css
├── docs/
│   └── dev-readme.md
├── js/
│   ├── app.js             # Game state, run flow, and event wiring
│   ├── audio.js           # Synthesized Web Audio effects
│   ├── card-effects.js    # Data-driven card effect interpreter
│   ├── card-finishes.js   # Permanent card finish track (shiny/platinum/holo)
│   ├── changelog-ui.js    # Shared release-history rendering
│   ├── combat-rules.js    # Player damage, shield, and Cheer resolution
│   ├── daily-challenge.js # Date-seeded Daily World Tour assignments and modifiers
│   ├── deck.js            # Shared deck-instance helpers (add/remove)
│   ├── game-data.js       # Asset and encounter loading
│   ├── keybinds.js        # Validated, normalized, and remappable keyboard controls
│   ├── keywords.js        # Member keyword identities
│   ├── missions.js        # Mission condition-DSL interpreter
│   ├── options-ui.js      # How to Play, Options, and Codex UI
│   ├── profile-storage.js # Persistent profile stats and codex
│   ├── progression-ui.js  # Main menu, Codex, Art Studio, Card Atelier, Missions, and leader selection
│   ├── run-state.js       # Run-save migration and validation
│   ├── run-storage.js     # Versioned local run save/load
│   ├── shop.js            # Merch shop prices and purchase flow
│   ├── tour-events.js     # Tour-event data and between-wave event flow
│   ├── tour-routes.js     # Leona tour-route definitions
│   ├── voice-lines.js     # Member voice lines for combos and finales
│   └── ui.js              # Combat rendering, card views, and reward/run modals
└── index.html
```

Run and profile data stay in the same browser and site origin; they are not synced between devices or browsers. Starting a new run replaces only the active run. Release v1.6.1 resets existing run and profile data for all players.

## Version and changelog

The current version and newest-first release history live in `assets/changelog.json` and appear in the header dropdown. Use `vMAJOR.MINOR.PATCH_<8 lowercase hex characters>`. Bump the SemVer portion for a release and set the 8-character suffix to the first eight characters of the SHA-256 digest of the compact JSON object `{ "date": "<YYYY-MM-DD>", "changes": ["...", "..."] }`. Keep `currentVersion` equal to the newest release's version and set `assets/data.json`'s `version` field to the same value. This version is used to clear app caches and cache-bust JSON asset requests.

Generate the suffix for the exact date and change notes with:

```powershell
node -e "const crypto = require('node:crypto'); const release = { date: '2026-11-18', changes: ['Change one.', 'Change two.'] }; console.log(crypto.createHash('sha256').update(JSON.stringify(release)).digest('hex').slice(0, 8));"
```

## Add a boss

1. Add its backdrop URL to `assets/data.json` under `backdrops` (or reuse a fitting existing key).
2. Add an SVG illustration under `assets/kaiju/`.
3. Add a JSON encounter file under `assets/bosses/`, including its stats, intent patterns, backdrop key, illustration path, and fallback background. Set the illustration path relative to `assets/data.json`, such as `./kaiju/new-boss.svg`.
4. Add the boss JSON path to a wave slot in the `encounterPools` array in `assets/data.json` (one array per wave; waves with multiple entries rotate the boss per run, seeded for Daily tours).

See [`AGENTS.md`](../AGENTS.md) for the boss schema, card definitions, save invariants, and gameplay architecture.

## External resources

Tailwind utilities are compiled into the committed `css/tailwind.css` stylesheet, avoiding the Play CDN runtime warning on GitHub Pages. After adding Tailwind classes to `index.html` or `js/*.js`, regenerate it from the project root:

```powershell
npm install --no-save --no-package-lock tailwindcss @tailwindcss/cli
npx --yes @tailwindcss/cli -i ./css/tailwind.input.css -o ./css/tailwind.css --minify
```

[Google Fonts](https://fonts.google.com/) are loaded by the page.
- K/DA portrait images are served from Riot's Data Dragon CDN.
- Encounter backdrops are served from Unsplash.

This repository does not include a license granting rights to third-party characters, names, or images.
