# K/DA vs. Godzilla: Encore Spire

A browser-based, turn-based deckbuilding roguelike. Build a K/DA deck, manage Hype Energy and Crowd Cheer, and fight through a ten-wave kaiju setlist.

Play at [GitHub Pages](https://k-szabo.github.io/kda-vs-titans/).

## Features

- Ten boss encounters per tour, drafted per wave from rotating pools, with telegraphed attacks and distinct artwork
- Daily World Tour with community leaderboards (daily/weekly/monthly), score auto-submit, and opt-out
- Draftable cards, individual card upgrades, passive relics, shields, and status effects
- Crowd Cheer-powered K/DA Joint Finale
- Four selectable run leaders, each with a once-per-run special ability, a signature starter relic, and a flavored starter deck
- Member keyword identities (Charm, Pierce, Drain, Encore) with keyword payoff cards
- Member combos, voice lines, and stage buffs with speech-bubble callouts
- Between-wave tour events, Leona tour routing, and a Merch Token shop (cards, relics, removal, healing, no free Cut/Rest)
- Missions and achievements paying Spotlight Shards; Card Atelier with permanent shiny/platinum/holo card finishes
- Encore Ascension tiers 1–5 with cumulative boss modifiers, plus per-wave boss scaling
- Unlockable POP/STARS, MORE, FIRESTARTER, and PRESTIGE leader art with ranked portrait borders
- Collapsible battle log, compact by default on smaller screens
- Death log on defeat, copyable Tour Receipt, persistent run records / Kaiju codex
- Synthesized sound effects and persistent profile statistics
- In-app version number and release changelog
- Keyboard shortcuts (`1`–`5` play, `E` end turn, `Q` finale, `R` leader ability) and a testing-only wave selector on the `#devtools` subpage
- Current run and profile statistics save to this browser (not synced across devices); starting a new run replaces the active run
- Responsive, static web app

## Controls

| Input | Action |
| --- | --- |
| Click a playable card | Play that card |
| `1`–`5` | Play the matching card in your hand |
| `E` | End your turn |
| Leader ability button | Use your chosen leader's special ability once per run |

For testing, open the `#devtools` subpage (for example, append `#devtools` to the game URL) to jump directly to a wave.
Choose a leader when starting a new run. Clear all 10 waves with that leader to unlock MORE art; further full clears unlock FIRESTARTER, then PRESTIGE. Use **ART STUDIO** to equip unlocked art and spend Spotlight Shards on permanent card finishes. Each 10 waves cleared while an art style is equipped advances its ranked border.

## Development

See the [developer README](docs/dev-readme.md) for local setup, project structure, asset editing, and GitHub Pages deployment.

## Fan project and third-party resources

This is an unofficial fan-made project and is not affiliated with or endorsed by Riot Games, Toho, or Legendary Entertainment. All related names and trademarks belong to their respective owners.

K/DA portraits are served from Riot's Data Dragon CDN; encounter backdrops use Unsplash. Tailwind CSS and Google Fonts are loaded from their CDNs, so these resources require an internet connection. This project does not grant rights to third-party characters or images.
