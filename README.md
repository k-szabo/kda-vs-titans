# K/DA vs. Godzilla: Encore Spire

A browser-based, turn-based deckbuilding roguelike. Build a K/DA deck, manage Hype Energy and Crowd Cheer, and fight through a ten-wave kaiju setlist.

Play at [GitHub Pages](https://k-szabo.github.io/kda-vs-titans/).

## Features

- Ten boss encounters with telegraphed attacks and distinct artwork
- Draftable cards, individual card upgrades, passive relics, shields, and status effects
- Crowd Cheer-powered K/DA Joint Finale
- Four selectable run leaders, each with a once-per-run special ability
- Unlockable POP/STARS, MORE, and FIRESTARTER leader art with ranked portrait borders
- Synthesized sound effects and persistent run records / Kaiju codex
- In-app version number and release changelog
- Keyboard shortcuts and a testing-only wave selector on the `#devtools` subpage
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
Choose a leader when starting a new run. Clear all 10 waves with that leader to unlock MORE art; a second full clear unlocks FIRESTARTER. Use **ART STUDIO** to equip unlocked art. Each 10 waves cleared while an art style is equipped advances its ranked border.

## Development

See the [developer README](docs/dev-readme.md) for local setup, project structure, asset editing, and GitHub Pages deployment.

## Fan project and third-party resources

This is an unofficial fan-made project and is not affiliated with or endorsed by Riot Games, Toho, or Legendary Entertainment. All related names and trademarks belong to their respective owners.

K/DA portraits are served from Riot's Data Dragon CDN; encounter backdrops use Unsplash. Tailwind CSS and Google Fonts are loaded from their CDNs, so these resources require an internet connection. This project does not grant rights to third-party characters or images.
