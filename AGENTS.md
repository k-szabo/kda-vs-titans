# AGENTS.md — K/DA vs. Godzilla: Encore Spire

This file is the authoritative technical and agent guide for the project,
superseding the earlier architecture handoff. It is verified against the current
code (`v1.7.1_9532654b`). When this file and another document disagree, **the
code is the source of truth**; update this file when behavior changes.

Related docs: `README.md` is player-facing, and `docs/dev-readme.md` covers local
setup, feature overview, progression, and deployment for human developers.

## 1. What this project is

A zero-build, turn-based deckbuilding roguelike in static HTML/CSS/JavaScript.
K/DA defends a world-tour dome against a 10-wave kaiju setlist. There is no
runtime package manager, bundler, framework, or test runner. ES modules are
loaded directly by the browser; JSON files define cards, relics, encounters,
keybinds, and release notes.

Core loop: play cards with Hype Energy, build Holo Shield and Crowd Cheer,
unleash the Joint Finale at 100% Cheer, read the boss's telegraphed intent, end
the turn, then pick a post-battle reward.

## 2. Run it locally

Serve the repository root. Do **not** open `index.html` with `file://` — the game
fetches JSON and ES modules.

```powershell
python -m http.server 8000
# open http://localhost:8000
```

- Saved runs and profiles live in this browser's `localStorage`; they are not
  synced across browsers or devices.
- GitHub Pages deploys the repository root with branch deployment
  (Settings → Pages → Deploy from a branch → `/`). All asset paths must stay
  relative so project-site subpaths work.
- External resources (Riot Data Dragon portraits, Unsplash backdrops, Google
  Fonts) require internet access.

### Useful commands

```powershell
# Rebuild the committed Tailwind stylesheet after adding/changing classes
npm install --no-save --no-package-lock tailwindcss @tailwindcss/cli
npx --yes @tailwindcss/cli -i ./css/tailwind.input.css -o ./css/tailwind.css --minify

# Compute the 8-char version suffix for a release
node -e "const crypto = require('node:crypto'); const release = { date: 'YYYY-MM-DD', changes: ['Change one.', 'Change two.'] }; console.log(crypto.createHash('sha256').update(JSON.stringify(release)).digest('hex').slice(0, 8));"
```

There are no tests, linters, or CI checks in this repository. Use the manual
checklist in §11.

### Controls at a glance

- Default keys: `1`–`5` play the corresponding hand slot, `E` ends the turn,
  `Q` triggers the Joint Finale, and `R` uses the leader ability. Defaults live
  in `assets/keybinds.json`; players can rebind them in Options.
- The header version badge opens the changelog dropdown sourced from
  `assets/changelog.json`.
- The `W1`–`W10` header pills are display-only. Use the `#devtools` subpage to
  jump directly to a wave.
- The header MENU button returns to the main menu without ending the run.
  Options is available from both the main menu and the combat header.

### Issue tracker

Player-reported bugs and feature requests live on GitHub at
`k-szabo/kda-vs-titans`. The committed `opencode.jsonc` connects OpenCode to
GitHub's hosted MCP server (`https://api.githubcopilot.com/mcp/`) with the
`context`, `repos`, `issues`, and `labels` toolsets.

- The PAT is never committed. It is read from `~/.secrets/github-pat` through
  `{file:~/.secrets/github-pat}`. Keep that file to a single line with **no
  trailing newline**, or the `Authorization` header is rejected as malformed.
- `{env:VAR}` substitution is resolved by the OpenCode server when it starts, so
  an exported variable is ignored until OpenCode restarts. The `{file:}` form
  takes effect as soon as the config reloads.
- Writing issues needs a fine-grained PAT with Issues read/write and Metadata
  read on this repository (or a classic PAT with `repo`).
- `opencode mcp list` should report `github  connected`; if it reports a 400,
  the token file is missing, empty, or has a trailing newline.
- Triage labels: `bug` / `enhancement` for type, `priority: high|normal|low`,
  and `needs-repro` when the report lacks enough detail to reproduce. Use
  `good first issue` for self-contained, low-risk work.

## 3. Project map

| Path | Responsibility |
| --- | --- |
| `opencode.jsonc` | OpenCode project config: connects the GitHub MCP server for issue triage. References the PAT from a file outside the repo; never store the token here. |
| `index.html` | Page structure, main menu, combat arena, modals, `#devtools` page. Loads `css/tailwind.css`, `css/styles.css`, Google Fonts, and `js/app.js` as a module. |
| `css/tailwind.css` | **Generated and minified.** Do not hand-edit; regenerate from `css/tailwind.input.css`. |
| `css/tailwind.input.css` | Tailwind source with `@source` globs for `index.html` and `js/**/*.js`. |
| `css/styles.css` | Hand-written theme, card styling, log layout, and combat animations. |
| `js/app.js` | Run lifecycle, combat engine, progression, persistence wiring, event binding, boot sequence. |
| `js/game-data.js` | Loads and validates the manifest, cards, relics, keybinds, changelog, and bosses; cache-busts by version. |
| `js/combat-rules.js` | Pure-ish combat helpers: damage/shield/Cheer resolution, enemy Strength, interrupts, Encore scaling, member-chain tracking, hand cap. |
| `js/card-effects.js` | Interprets ordered card effect actions, upgrade deltas, conditions, and log templates. |
| `js/run-storage.js` | Versioned run save/load in `localStorage` (`RUN_SAVE_VERSION = 4`). |
| `js/run-state.js` | Migrates legacy v1 saves and strictly validates v4 run state. |
| `js/profile-storage.js` | Persistent profile, settings, codex, art progress, daily streaks (`PROFILE_VERSION = 3`). |
| `js/leader-data.js` | Leader definitions, art styles, rank tiers, unlock helpers. |
| `js/daily-challenge.js` | UTC-date-seeded Daily World Tour assignment and seeded RNG. |
| `js/keybinds.js` | Default/custom keybind validation, normalization, lookup, and rebinding. |
| `js/audio.js` | Synthesized Web Audio SFX and mute handling. |
| `js/ui.js` | Combat rendering, card views, reward/pile/run-end modals, changelog dropdown, battle-log collapse. |
| `js/progression-ui.js` | Main menu, Art Studio, leader selection, Encore tier UI. |
| `js/options-ui.js` | How to Play, Options (sound, keybinds, codex, changelog). |
| `js/changelog-ui.js` | Shared changelog renderer. |
| `assets/data.json` | Version, portrait/leader-art URLs, backdrop URLs, and ordered data-file paths. |
| `assets/cards.json` | Card definitions, upgrades, effects, log templates, starter deck. |
| `assets/relics.json` | Passive relic definitions and declarative triggers. |
| `assets/keybinds.json` | Default keyboard bindings. |
| `assets/changelog.json` | Current version and newest-first release history. |
| `assets/bosses/*.json` | One encounter definition per boss. |
| `assets/kaiju/*.svg` | Standalone kaiju illustrations (including `burning-godzilla.svg`). |

`docs/dev-readme.md` covers setup, progression, hazards, and deployment. This
file is the authoritative technical reference; `README.md` is the player-facing
overview.

## 4. Runtime architecture

1. `index.html` loads `js/app.js` as `type="module"`.
2. `initializeGame()` calls `loadGameData()`:
   - fetch `assets/data.json`,
   - validate the manifest,
   - clear caches if the manifest version changed,
   - fetch cards, relics, keybinds, changelog, and every boss in parallel,
   - resolve boss backdrop keys and illustration paths to absolute URLs,
   - validate all data shapes and fail with a visible `#loadError` if invalid.
3. Profile is loaded (or reset), audio state is applied, options UI is created.
4. A saved run is loaded, migrated/validated, and either the main menu or the
   `#devtools` leader selection is shown.
5. `app.js` owns `state`; `ui.js` receives getters and callbacks and only renders.
   `renderAll()` calls `ui.renderAll()` and then `saveRunState()`, so autosave is
   tied to rendering.
6. `state` is a plain serializable object. Keep it that way: no DOM nodes, class
   instances, functions, or cyclic references in run state.

### Boot/menu behavior

- Main menu is shown on boot unless the URL hash is `#devtools`.
- Continue Tour restores a saved `playing` or `draft` run (and reopens the draft
  modal if needed).
- New World Tour opens leader + Encore selection.
- Daily World Tour starts the deterministic daily run at Encore 0.
- Art Studio equips unlocked art and shows per-art ranks.
- The combat header's MENU button returns to the main menu without ending the
  run.
- `#devtools` shows a wave selector; it requires a run state (or opens leader
  selection if none exists).

## 5. Game rules the engine assumes

### Player turn

- Player starts each run at `80/80` HP; default max Hype Energy is `3`
  (`4` in the Acoustic Set daily modifier).
- At wave start: shield resets to 0, energy refills, statuses reset to
  `{ encore: 0, weak: 0 }`, draw pile is shuffled from the master deck, and
  5 cards are drawn. **Crowd Cheer is not reset between waves.**
- Hand cap is `5` (`MAX_HAND_SIZE` in `js/combat-rules.js`) by default. Effects
  such as `raiseHandLimit` raise `state.handLimit` for the current turn only
  (Kai'Sa's leader ability adds 3 temporary slots); it resets to 5 at the start
  of every turn and every wave and never exceeds `MAX_HAND_LIMIT` (10). Drawing
  stops at the limit; reshuffle discard into draw when the draw pile is empty.
- **Keep one card:** `state.keptCardInstanceId` marks a single hand card. It is
  retained at end of turn exactly like a `retain` card, the mark clears, and the
  next draw still stops at the 5-card cap — so keeping a card draws one fewer.
- Playing a card:
  - checks effective cost (base minus upgrade `costReduction`),
  - spends energy,
  - increments `cardPlayCounts`,
  - adds `5 + effectiveCost * 3` Crowd Cheer (capped at 100),
  - applies `cardPlayed` relics,
  - moves the instance to discard, or exhaust if `card.exhaust`,
  - executes effects in array order,
  - applies `attackPlayed` / `skillPlayed` relics and boss passives,
  - records member synergy,
  - handles a mid-turn kill.
- Damage calculation for card hits (`computeCardAttackDamage`):
  `base + player.encore`, then `×0.75` (floor) if player Weak, then `×1.5`
  (ceil) if enemy Marked, minimum 0. Multi-hit cards calculate per hit.
- Unused energy is lost when the next turn refills energy.
- Player shield carries between turns and is only spent by incoming damage; it
  resets when a new wave starts.

### Crowd Cheer / Joint Finale

- Cheer is charged by cards and some relics/effects.
- Damage absorbed by shield does not reduce Cheer. Cheer drops by HP actually
  lost (capped at current Cheer).
- At 100% Cheer, `triggerJointAttack()` is free: damage `calcDmg(28)`, `+10`
  shield, `2` Charm, `+1` energy, then Cheer resets to 0.

### End turn

`endPlayerTurn()` resolves in this order:

1. Ethereal hazard cards in hand: deal `endTurnDamage` as direct HP damage
   (pierce 1), exhaust them, and log.
2. Discard non-retained hand cards; keep `retain` / `retainInHand`.
3. Apply stage hazards (`overcharge_grid` or `thermonuclear_heat`).
4. If the player died, defeat.
5. Reset enemy block, run `onTurnEnd` passives, read the intent.
6. Resolve the intent (see §6).
7. Decrement enemy `charm`, enemy `marked`, and player `weak` by 1.
8. If alive: advance turn, reset per-turn counters/member chain, refill energy,
   draw 5, render.

### Buff cards

- Three fixed slots (`MAX_BUFF_SLOTS = 3`), stored in `state.buffs` as
  `{ instanceId, cardId, upgradeLevel, remaining }`. `remaining` is `null` for
  one-shot buffs and a positive integer for timed ones.
- Buff cards use `type: "BUFF"` with a single `buff` block instead of immediate
  effects: trigger `passive` / `turnStart` / `onLethal` / `onDamage`, effect
  `bonusAttackDamage` / `gainBlock` / `heal` / `gainEnergy` / `revive` /
  `negateDamage`.
- Playing a buff moves the instance into a slot instead of the discard pile and
  logs its `log.template`; an empty `effects` array is valid for BUFF cards.
- Timed buffs tick at the start of the player's turn and are removed when a wave
  ends. One-shots (`revive`, `negateDamage`) persist across waves until they
  fire, then go to the discard pile.
- `buff.upgradeAmount` is added to `buff.amount` at upgrade level 1.
- With all three slots full, playing another buff opens the replace prompt; the
  card returns to hand unspent if the prompt is cancelled.
- Buff instances belong to `masterDeck` but live outside the four piles, so
  `run-state.js` treats them as an active location and `startStage()` excludes
  them when rebuilding the draw pile.

### Member synergy

- **Quartet Harmony** (once per turn): play cards from all four members →
  `+1` energy, `+6` shield, `+10%` Cheer.
- **Solo Spotlight** (after 3 consecutive cards from the same member):
  - Ahri: 1 Charm + heal 3 HP
  - Akali: 6 piercing damage + draw 1
  - Evelynn: 1 Marked + steal up to 3 enemy Block
  - Kai'Sa: +8 shield +1 turn of Encore
- A non-member card (e.g. `squad`) breaks the consecutive chain but does not
  erase members already played this turn.

### Post-battle rewards

After each non-final wave, `state.runStatus = 'draft'` and the player chooses:

- **Card**: one of 3 non-starter, draftable cards; heals 18 HP (12 at Encore 2+).
- **Relic**: one of 3 unowned, non-leader relics; heals 18 HP (12 at Encore 2+).
- **Upgrade**: upgrade one unupgraded card instance (no heal).
- **Cut**: remove one deck card and heal 10 HP.
- **Rest**: skip rewards and heal 25 HP.

Clearing wave 10 sets `runStatus = 'victory'`. Player death sets `'defeat'`.

## 6. Boss intents, passives, and hazards

Encounter JSON lives in `assets/bosses/`. The renderer reads it directly, so
new bosses usually need no JS changes.

### Intent types

| `type` | Behavior |
| --- | --- |
| `attack` | Damage the player; optional `weak`. |
| `atomic` | Same resolution as `attack`; used for telegraphed signature attacks. |
| `multi` | Damage the player `hits` times. |
| `charge` | Gain `block`. |
| `debuff_atk` | Damage the player and apply `weak`. |
| `injectStatus` | Add `count` copies of `cardId` (must be a non-draftable STATUS card) to the discard pile; optional `block`. |

Optional intent fields:

- `charged: true` — marks the intent as charged (visual pulse).
- `interruptThreshold` — only valid with `charged` and numeric `dmg`. If
  `damageDealtThisTurn >= threshold`, the intent is skipped. The threshold
  counts HP damage **after** enemy Block; the boss panel shows a live
  `STUN x / N HP DMG` meter so the gap is visible. Interrupted intents log a
  fizzle line and never log `executes`.
- `interruptBonus` — multiplier added to effective damage when the interrupt is
  missed; defaults to `0.35` in `app.js`.
- `pierce` — `0..1` share of damage that bypasses Holo Shield.

Damage math: `base + enemy.strength`, then `×0.75` (floor) while Charmed.
`damageDealtThisTurn` counts **HP damage after enemy Block**, not attempted
damage, and drives both interrupts and the run receipt's peak turn.

### Passives

Supported `passives` entries (validated in `js/game-data.js`):

- `onPlayerAttack` + `gainBlock` + `value`
- `onSkillPlayed` + `gainStrengthEvery` + `value` + `every`
- `onTurnEnd` + `gainStrength` + `value`
- `onHpBelowHalf` + `enrage` + `strength` + `block`

Enrage triggers once when `enemy.hp <= enemy.maxHp * ratio` (`0.5`, or `0.6` at
Encore 5), clears Charm/Marked, grants Strength/Block, and optionally swaps to
`phase2Patterns` and resets `patternStep`. The save loader re-applies an unclaimed
enrage if a save was taken below the threshold.

### Stage hazards (`stageEffect`)

- `overcharge_grid` — at turn end, each unspent Energy deals 3 direct HP damage.
- `thermonuclear_heat` — at turn end, 0 Shield deals 3 direct HP damage.
- `luminous_spores` — each Skill played grants `+3%` extra Cheer.

Only one hazard per encounter. The active hazard is shown in the boss panel.

### Status cards

Status cards are `type: "STATUS"` and normally `draftable: false`:

- `stage_fright`, `emp_static`: retain in hand; playing them spends their cost
  and exhausts them.
- `micro_oxygen`: `ethereal: true` + `endTurnDamage: 4`; if left in hand at end
  of turn it deals direct HP damage and exhausts.
- `ethereal` alone does not implement exhaust; the end-turn damage path does.
- `retain: true` keeps a card in hand (`retainInHand` is a legacy alias).

## 7. Data schemas and validation

All JSON must be valid JSON: double-quoted keys/strings, no comments, no
JavaScript expressions. IDs are stable identifiers; do not rename them without a
save migration.

### Cards (`assets/cards.json`)

Required by validation: unique `id`, an `effects` array (empty is allowed for
STATUS and BUFF cards), `log` object,
valid optional booleans (`draftable`, `ethereal`, `retain`, `retainInHand`), a
valid `upgrade` if present, and starter-deck IDs that exist.

Common fields:

```json
{
  "id": "seraphine_encore",
  "name": "Harmonic Resonance",
  "member": "squad",
  "memberName": "K/DA SQUAD",
  "type": "SKILL",
  "cost": 1,
  "starter": false,
  "retain": false,
  "exhaust": false,
  "draftable": true,
  "desc": "Gain <b>6</b> Holo Shield and <b>+15%</b> Crowd Cheer.",
  "upgrade": { "description": "Gain 8 Holo Shield and +15% Crowd Cheer.", "costReduction": 0 },
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

Supported effect types (`js/card-effects.js`):
`damage` (optional `hits`), `gainBlock`, `healPlayer`, `applyEnemyStatus`,
`addPlayerStatus`, `clearPlayerStatus`, `addCheer`, `draw`, `gainEnergy`,
`raiseHandLimit`.

- Effects run in array order.
- `upgradeAmount` is added to `amount` per upgrade level (max level 1). It does
  **not** upgrade `turns` or `count`.
- `upgrade.costReduction` reduces effective cost per upgrade level.
- `"when": { "target": "enemy" | "player", "status": "..." }` gates an effect.
- Log alternatives use the same `when` shape and may override `template` /
  `colorClass`.
- Log placeholders are `{damage}`, `{block}`, `{heal}`, `{encore}`. Unknown
  placeholders throw.
- `desc` and `upgrade.description` are rendered as HTML; keep authored markup
  limited to simple formatting tags.
- Draft pool = `!starter && draftable !== false`.
- Add starter cards to `starterDeck`; duplicate IDs are allowed there.

### Buff cards (`type: "BUFF"`)

```json
{
  "id": "buff_locket",
  "type": "BUFF",
  "cost": 1,
  "art": "https://ddragon.leagueoflegends.com/cdn/16.23.1/img/item/3190.png",
  "buff": {
    "trigger": "turnStart",
    "effect": "gainBlock",
    "amount": 5,
    "upgradeAmount": 2,
    "duration": 3
  },
  "effects": [],
  "log": { "template": "🎛️ Locket of the Iron Solari projected a barrier.", "colorClass": "text-cyan-300" }
}
```

- `art` is an absolute Data Dragon URL. Cards without it fall back to the
  member's selected artwork, so only item-style cards need it.
- `duration` is omitted for one-shot buffs (`revive`, `negateDamage`).
- The trigger/effect pair must exist in `SUPPORTED_BUFFS` in
  `js/game-data.js`; `amount` must be positive and `upgradeAmount` may add to it.
- `effects` stays empty: a buff has no immediate effect when played.

### Relics (`assets/relics.json`)

Required: unique `id`, `name`, `description`, non-empty `effects`, each with a
supported trigger/type pair and a finite positive `amount`. Optional `leaderId`
must be one of the four leaders. Leader relics are starter-only and excluded
from random rewards.

Supported pairs (enforced in `js/game-data.js`):

| Trigger | Type |
| --- | --- |
| `stageStart` | `startingEnergy` |
| `attackPlayed` | `gainBlock` |
| `attackPlayed` | `zeroCostAttackDamage` |
| `cardPlayed` | `cheerGainPercent` |
| `skillPlayed` | `charmDuration` |
| `skillPlayed` | `skillGainBlock` |

Adding a new pair requires both validation in `game-data.js` and handling in
`applyRelicEffects()` in `app.js`.

### Bosses (`assets/bosses/*.json`)

```json
{
  "id": "biollante_w9",
  "name": "BIOLLANTE: SPORE LEVIATHAN",
  "subtitle": "WAVE 9 // MUTAGENIC BLOOM",
  "maxHp": 170,
  "spriteType": "biollante",
  "burning": false,
  "stageEffect": "luminous_spores",
  "passives": [
    { "trigger": "onPlayerAttack", "effect": "gainBlock", "value": 3, "desc": "..." }
  ],
  "patterns": [
    { "type": "debuff_atk", "dmg": 12, "weak": 1, "label": "ACID SAP: 12 DMG + WEAK" },
    { "type": "charge", "block": 20, "label": "VINE CARAPACE: +20 BLOCK", "charged": true },
    { "type": "atomic", "dmg": 30, "label": "CORROSIVE BREATH: 30 DMG", "charged": true }
  ],
  "phase2Patterns": [],
  "assets": {
    "backdrop": "biollante",
    "illustration": "./kaiju/biollante.svg"
  },
  "visuals": {
    "background": "radial-gradient(circle, #14532d, #020617)"
  }
}
```

- `assets.backdrop` must be a key in `assets/data.json` → `backdrops`.
- `assets.illustration` is relative to `assets/data.json` (e.g.
  `./kaiju/biollante.svg`).
- `visuals.background` is required and used as the sprite container background.
- `patterns` must be a non-empty array. `phase2Patterns`, if present, must be a
  non-empty array.
- `maxHp`, `name`, and `subtitle` are not schema-validated; include them.
- `spriteType` and `burning` are presentation/legacy fields; current JS does not
  read them. Keep them consistent with the artwork.
- To add a wave, create the JSON + SVG, add the backdrop URL, then insert the
  boss path at the desired position in `assets/data.json` → `bosses`.

### Manifest (`assets/data.json`)

Required: `version`, `portraits` (all four leaders + `squad`), `leaderArts`
(`more` and `firestarter` for each leader), `backdrops`, `cards`, `relics`,
`keybinds`, `changelog`, and a non-empty `bosses` array. `version` must exactly
match `assets/changelog.json` → `currentVersion`.

### Keybinds (`assets/keybinds.json`)

Exactly one unique printable key for each of:
`card1`–`card5`, `endTurn`, `jointFinale`, `leaderAbility`.
Custom bindings live in profile settings; defaults come from this file.
Rebinding swaps duplicate keys; Escape cancels; gameplay hotkeys pause while a
modal is open or a rebind is listening.

## 8. Persistence and versioning

| Key | Contents |
| --- | --- |
| `encore-spire.run` | `{ version: 4, state }` active run |
| `encore-spire.profile` | `version: 3` profile/settings/codex/art/daily data |
| `kda-vs-titans:cache-version` | Last manifest version used to clear Cache Storage |

- Run state autosaves after each `renderAll()` and at key transitions. It is
  restored on reload only if `RUN_SAVE_VERSION` matches and
  `isValidSavedRun()` passes; otherwise the save is discarded and the menu is
  shown with a notice.
- `migrateSavedRun()` contains a v1 → current migration, but `app.js` currently
  clears any save whose version is not 4 before migration. If you introduce a
  new version, add a migration **and** update that pre-check.
- Profile data with an older `PROFILE_VERSION` triggers
  `OutdatedProfileStatsError` and is reset with a notice. Invalid profile data
  is also reset. A storage failure disables further saves and shows a notice.
- Starting a new run replaces only the active run, not the profile.
- Validation is intentionally strict. If you add a `runStatus`, state field, or
  enemy field, update `isValidSavedRun()` and `migrateSavedRun()` in
  `js/run-state.js`. Keep `nextCardInstanceId` greater than every instance ID,
  keep every master-deck instance present in exactly one active pile, keep the
  hand at or below `state.handLimit`, and keep `handLimit` between 5 and 10.
  `keptCardInstanceId` is `null` or the instance ID of a card currently in hand.
  `state.buffs` holds at most 3 `{ instanceId, cardId, upgradeLevel, remaining }`
  entries; buff instances stay out of the four piles and count as an active
  location for deck coverage.

Profile fields: `settings` (`soundEnabled`, `keybinds`), `highestWaveCleared`,
`maxEncoreLevel`, `fastestWinMs`, `dailyWinStreak`, `dailyBestWinStreak`,
`lastDailyWinDate`, `unlockedKaiju`, `leaderWins`, `selectedArts`,
`artWaveClears`.

### Release versioning

Format: `vMAJOR.MINOR.PATCH_<8 lowercase hex>`.

1. Add a release object at the **top** of `assets/changelog.json` → `releases`
   with `version`, `date` (`YYYY-MM-DD`), and a non-empty `changes` array.
2. Set `currentVersion` to that same version.
3. Set `assets/data.json` → `version` to that same version.
4. Generate the suffix from the exact compact `{ date, changes }` object (see
   §2). Keep versions unique and newest-first.
5. Rebuild `css/tailwind.css` if you added classes.
6. Update `README.md` / `docs/dev-readme.md` when behavior or setup changes.

The version also drives cache clearing and JSON cache-busting.

## 9. Change recipes

### Add a card

1. Add an object to `cards` in `assets/cards.json`.
2. Use an existing effect type or add engine + validation support.
3. Set `starter: false` for the draft pool; add the ID to `starterDeck` if it
   belongs in a new run.
4. Provide `upgrade.description` if the card can be upgraded.
5. Keep `log.template` placeholders limited to the supported set.

### Add a buff card

1. Add a `type: "BUFF"` card with an empty `effects` array and a `buff` block
   using a pair from `SUPPORTED_BUFFS`.
2. Set `art` to a Data Dragon item icon (pinned version) when the card is gear;
   omit it for character cards so they use the leader's selected art.
3. Give it an `upgrade` with a real benefit: `costReduction` or
   `buff.upgradeAmount`.
4. Timed buffs need `duration`; one-shots omit it and must consume themselves
   in `app.js` (`revive` in `finishPlayerDefeat`, `negateDamage` in
   `applyDamageToPlayer`).
5. Verify slot replacement, wave expiry, and reload behaviour.

### Add a relic

1. Add `{ id, name, description, effects }` to `assets/relics.json`.
2. Use a supported trigger/type pair and positive `amount`.
3. Add `leaderId` only for a signature starter relic (and ensure the leader
   exists in `js/leader-data.js`).
4. For a new effect type, update `supportedRelicEffects` in `game-data.js` and
   `applyRelicEffects()` in `app.js`.

### Add a boss / wave

1. Add an SVG under `assets/kaiju/`.
2. Add a backdrop URL under `backdrops` in `assets/data.json`.
3. Add `assets/bosses/<name>_wN.json` with stats, patterns, assets, visuals.
4. Insert its path into `bosses` at the intended wave index.
5. Test the encounter, its intent labels, phase 2, and hazard.
6. Update Codex expectations (unlock is automatic on clear) and docs.

### Add a leader

Leaders are currently hardcoded in `js/leader-data.js` and referenced by:
`game-data.js` (portrait/leader-art validation), `profile-storage.js`,
`combat-rules.js` (`KDA_MEMBER_IDS`), `app.js` (abilities + starter relic),
`ui.js`/`progression-ui.js` (portraits, art), and `assets/data.json`
(`portraits`, `leaderArts`). Add a starter relic with matching `leaderId`, plus
card art mappings and tests across these files.

### Change save data shape

1. Update the in-memory state creation and every read/write site.
2. Update `isValidSavedRun()` and, if needed, `migrateSavedRun()`.
3. Bump `RUN_SAVE_VERSION` or `PROFILE_VERSION` only when intentional; explain
   the reset in the changelog and docs.
4. Verify reload mid-combat, mid-draft, victory, and defeat.

## 10. Conventions and guardrails

- **No build step at runtime.** Do not introduce a bundler, framework, or npm
  dependency for the game itself.
- **Relative URLs only** (`./assets/...`, `new URL(..., import.meta.url)`). Do
  not hardcode `/`-rooted or absolute local paths.
- **Data stays declarative.** No executable code, comments, or functions in
  JSON. Add engine support instead.
- **Validate new data** in `js/game-data.js` and surface failures through the
  existing load-error path.
- **Keep `state` serializable.** No DOM nodes or functions in run state.
- **Avoid `innerHTML` for untrusted data.** Existing uses are for authored card
  HTML and known asset URLs. Use `textContent` for names/descriptions from data
  where possible.
- **Do not hand-edit `css/tailwind.css`.** Add classes in `index.html` or
  `js/*.js`, then regenerate.
- **Do not edit generated/minified files** other than by regeneration.
- **Keep the 5-card hand cap, 80 HP start, 3 default energy, 10-wave setlist,
  and 100% Cheer threshold** unless the change explicitly targets balance; then
  update docs, receipts, and Encore text.
- **Preserve save compatibility** unless a deliberate reset is part of the
  release. Update both save versions and docs when resetting.
- **Respect `.gitignore`**: several historical plan docs under `docs/` are
  intentionally ignored; do not commit them.
- **Keep UI text and labels consistent** with the game's tone and existing
  casing (e.g. "Holo Shield", "Hype Energy", "Crowd Cheer", "Encore").
- **Manual accessibility**: dialogs use `role="dialog"`, `aria-modal`,
  `aria-expanded`/`aria-pressed`, and `aria-live` status text. Preserve these
  attributes when editing markup.

## 11. Manual test checklist

Run through this before considering a change complete:

1. Serve over HTTP; no console errors and no `#loadError`.
2. New run: leader selection, Encore tier gating, starter deck/relic, wave 1.
3. Play cards; verify cost, upgrades, exhaust, retain, status cards, and hand cap.
   Mark a card with the 📌 toggle and confirm it survives one turn and that the
   next hand is 4 + kept card. Use Kai'Sa's ability on a full hand and confirm
   the temporary 3 slots are used and reset next turn.
4. Reach 100% Cheer; use Joint Finale; use the leader ability once.
5. Trigger Quartet Harmony and each Solo Spotlight; open the COMBOS panel and
   confirm its text matches the effects that fire.
6. Enemy intents: attack, multi, charge, atomic, debuff, inject; charged
   interrupt success/failure; piercing damage; enrage/phase 2; each hazard.
7. Post-battle rewards: card, relic, upgrade, cut, rest; confirm heals.
7a. Buff zone: play a timed buff and confirm its countdown; play a fourth buff
    and confirm the replace prompt; let a timed buff expire at a wave end;
    trigger Guardian Angel and Zhonya's and confirm they are consumed.
8. Reload mid-combat and mid-draft; confirm state, piles, logs, and modal.
9. Win and lose a run; copy the Tour Receipt; verify profile stats, codex,
   Encore unlock, and Art Studio progress.
10. Daily World Tour: same date → same leader/relic/modifier; streak updates.
11. Options: sound toggle (including muting active tones), rebind/swap/reset,
    How to Play, Codex, changelog.
12. `#devtools` wave selector; return to game.
13. Narrow viewport: battle log defaults collapsed; hand and modals usable.
14. Bump version only after the above passes; verify `data.json` and changelog
    versions match.

## 12. Documentation maintenance

`README.md` is the player-facing overview. `docs/dev-readme.md` is the human
developer guide for setup, features, progression, and deployment. This file is
the authoritative technical reference for agents and contributors. When behavior
changes, update the affected document; when documents conflict, the code wins.
