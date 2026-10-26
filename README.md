# Battle Fleet: Pre-Dreadnought  (build v1.6.0)

A turn-based, d20-style naval wargame against the computer or another player online, played on a top-down map of the sea.
Build a fleet (Frigates up to Battleships), fit weapons, deploy, and fight with guns, torpedoes, mines, ramming and
special orders. It runs entirely in the browser: no install, server or internet connection needed (except for Multiplayer).

## Game types (Main Menu > Skirmish)
- **Annihilation** - sink the whole enemy fleet (1,200" x 800" board).
- **Breakthrough** - attackers run VIP ships to an Exit Zone while defenders try to stop them (800" x 800").
- **King of the Hill** - fight over capture zones (100" circles, up to two on the board at once). Before the battle choose
  how many zones (1-5) and how many points each holds (5-30). Each round, the side that outweighs the other in a zone takes
  its winning margin in points; an emptied zone vanishes and the next appears elsewhere. Ends when every zone is empty
  (800" x 800").

## Multiplayer (Main Menu > Multiplayer)
A battle between two players over the internet, through a relay server (see `server/`).
- The relay address is filled in for you (`wss://battle-fleet-relay.dwyer.dev`). The host chooses the battle
  (**Annihilation**, **Breakthrough**, or **King of the Hill** with its number of capture zones and points per zone) and the **time per
  phase** (2, 3 or 4 minutes), clicks **Host Game** and sends the other player the 4-letter code; they type it in and
  click **Join**.
- The host picks the ships, and both fleets get the same ones. Each player fits out their own fleet. In Annihilation
  each then arranges it and chooses a heading (the same heading gives a contested crossing, as in Skirmish). In
  Breakthrough the host picks their role (attacker or defender) and the number of VIPs on the fleet screen, the other
  player takes the other role, and the attacker picks the VIPs. In Breakthrough and King of the Hill each player deploys
  by hand, in secret.
- Each phase, both players give their orders at the same time without seeing the other's, then click
  **Orders Completed**. When both have, both fleets' orders are carried out together, with the same dice results on
  both screens. A clock in the top bar counts down the phase; when it runs out, the orders given so far are sent as
  they stand (ships without movement orders hold course at minimum speed). After the Firing results there are 30
  seconds to look before the phase moves on.
- If a player surrenders or leaves, the other wins.

Campaign and Missions appear on the menu as "coming soon".

## How to play
- **Online:** open the GitHub Pages site for this repo (every change merged to `main` is published there within a minute or two).
- **Single file:** the Pages site also hosts `battle-fleet-predreadnought.html`, a one-file build with all art and music
  embedded. Download it and double-click it to play offline, or send it to someone.
- **From a checkout:** double-click `index.html`.

Use a current desktop browser (Chrome, Edge, Firefox or Safari) with a mouse.

Tips: the music starts when a battle begins and has a Music button if your browser blocks autoplay. Right-drag pans the
map and the wheel zooms. The game saves nothing between sessions.

## What is in this repo
- `index.html` - the page markup (menus, panels, dialogs).
- `style.css` - all styling.
- `game.js` - all game logic.
- `assets/` - images and music, referenced from the code as `assets/<name>`.
- `docs/Battle_Fleet_Rulebook_v1.3.0.pdf` - the Captain's Rulebook (24 pages), written for build v1.3.0. It does not yet cover
  v1.3.1-v1.6.0 changes (named AI ships, the All Ahead Full display fix, King of the Hill capture zones, multiplayer).
- `server/` - the multiplayer relay server, with a Docker Compose setup for running it at home (see `server/README.md`).
- `tools/build_single_file.py` - bundles everything above into one self-contained HTML file
  (`python3 tools/build_single_file.py` writes `dist/battle-fleet-predreadnought.html`).
- `CLAUDE.md` - working instructions for Claude Code sessions on this repo.

## Previews
Each pull request gets its own playable preview at `https://<owner>.github.io/<repo>/pr-preview/pr-<number>/`;
a bot comments the link on the PR. Previews are removed when the PR is closed.
