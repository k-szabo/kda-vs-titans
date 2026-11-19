# Encore Spire — Main Menu: How to Play & Options Plan

This plan integrates a **How to Play** guide and an **Options** modal (Sound On/Off, Custom Keybinds, and Changelog) into your existing modular architecture (`index.html`, `js/profile-storage.js`, `js/audio.js`, `js/app.js`, and `js/ui.js`) without breaking v3 run saves.

---

## 1. Where Each Feature Lives

| File | Responsibility |
| :--- | :--- |
| **`js/profile-storage.js`** | Persist `settings` in `localStorage` alongside profile stats & codex:<br>• `soundEnabled: true`<br>• `keybinds: { card1: '1', card2: '2', card3: '3', card4: '4', card5: '5', endTurn: 'e', jointFinale: 'q', leaderAbility: 'r' }` |
| **`js/audio.js`** | Check `settings.soundEnabled` at the entry point of sound playback helpers so toggling sound off immediately mutes all Web Audio synth effects (and resumes cleanly when toggled back on). |
| **`index.html` & `js/ui.js`** | • Add **`📖 HOW TO PLAY`** and **`⚙️ OPTIONS`** buttons to `#mainMenuOverlay` (plus a compact **`⚙️`** icon in the in-game header so players can mute or check keybinds mid-run).<br>• **`#howToPlayModal`**: Clean 3-card quick-reference guide covering **1. Turn Loop & Hype Energy**, **2. Interrupts, Piercing & Status Cards**, and **3. Leaders, Joint Finale & Art Studio**.<br>• **`#optionsModal`**: Unified settings modal with three sections:<br>  1. **Audio:** On/Off toggle switch with instant test chime.<br>  2. **Controls (Keybinds):** Click any action button → *"Press a key..."* listener (with duplicate-key swap/warning, `Esc` to cancel, and **Reset Defaults**).<br>  3. **Changelog:** Displays the version history loaded from `assets/changelog.json`. |
| **`js/app.js`** | Route keyboard shortcuts dynamically through `profile.settings.keybinds` instead of hardcoded keys, and pause gameplay hotkeys while any modal or keybind listener is active. |

---

## 2. Single-Pass Copilot Prompt (50% Credit Efficient)

Copy and paste this single prompt into GitHub Copilot to implement both sections, wire persistence, rebuild `css/tailwind.css`, and bump the version hash in one pass:

> Add a **How to Play** modal and an **Options** modal (with **Sound On/Off**, **Rebindable Keybinds**, and **Changelog**) to the Main Menu and in-game header across `index.html`, `js/profile-storage.js`, `js/audio.js`, `js/ui.js`, and `js/app.js`:
>
> 1. **Persistent Settings (`js/profile-storage.js`):** Add a `settings` object to the saved profile with defaults `{ soundEnabled: true, keybinds: { card1: '1', card2: '2', card3: '3', card4: '4', card5: '5', endTurn: 'e', jointFinale: 'q', leaderAbility: 'r' } }`, safely normalizing missing fields on existing profiles.
> 2. **Audio Toggle (`js/audio.js`):** Guard Web Audio playback functions with the persisted `soundEnabled` flag so muting immediately silences all SFX and unmuting restores them.
> 3. **How to Play Modal (`index.html`, `js/ui.js`):** Add a `📖 HOW TO PLAY` button to the Main Menu opening `#howToPlayModal` with concise, scannable sections explaining: (a) Hype Energy, Holo Shield, and Crowd Cheer Joint Finale; (b) Enemy Intents, `interruptThreshold`, `pierce`, Charm/Marked, and Ethereal/Burn Status cards; (c) Once-per-run Leader Abilities, Relics, and Art Studio skin/border progression.
> 4. **Options Modal (`index.html`, `js/ui.js`, `js/app.js`):** Add an `⚙️ OPTIONS` button to the Main Menu (and an `⚙️` button in the combat header) opening `#optionsModal` with:
>    - **Sound On/Off** toggle button (plays a confirmation sound when turned on).
>    - **Keybinds Editor** listing Card Slots 1–5, End Turn, Joint Finale, and Leader Ability—clicking a binding enters a listening state for the next key press (`Escape` cancels, duplicate keys swap cleanly), plus a **Reset Defaults** button. Update `js/app.js`'s `keydown` handler to use these dynamic keybinds (and display bound key hints on cards/buttons if shown), ignoring hotkeys while listening for a rebind or while modals are open.
>    - **Changelog** section inside Options rendering the release history from `assets/changelog.json`.
> 5. **Build & Version Bump:** If any new Tailwind classes were added, run `npx --yes @tailwindcss/cli -i ./css/tailwind.input.css -o ./css/tailwind.css --minify`, update `docs/dev-readme.md` if needed, and bump the version + SHA-256 suffix in `assets/changelog.json` and `assets/data.json`.