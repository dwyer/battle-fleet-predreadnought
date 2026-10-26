# Battle Fleet: Pre-Dreadnought  (build v1.5.0)

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
An Annihilation battle between two players over the internet, through a relay server (see `server/`).
- The relay address is filled in for you (`wss://battle-fleet-relay.dwyer.dev`). One player clicks **Host Game** and
  sends the other the 4-letter code; the other types it in and clicks **Join**.
- The host picks the ships, and both fleets get the same ones. Each player then fits out, arranges and chooses a
  heading for their own fleet. Choosing the same heading gives a contested crossing, as in Skirmish.
- Each phase, both players give their orders at the same time without seeing the other's. When both have ended the
  phase, both fleets' orders are carried out together, with the same dice results on both screens.
- If a player surrenders or leaves, the other wins.

Campaign and Missions appear on the menu as "coming soon". Breakthrough and King of the Hill are single-player only for now.

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
  v1.3.1-v1.5.0 changes (named AI ships, the All Ahead Full display fix, King of the Hill capture zones, multiplayer).
- `server/` - the multiplayer relay server, with a Docker Compose setup for running it at home (see `server/README.md`).
- `tools/build_single_file.py` - bundles everything above into one self-contained HTML file
  (`python3 tools/build_single_file.py` writes `dist/battle-fleet-predreadnought.html`).
- `CLAUDE.md` - working instructions for Claude Code sessions on this repo.

## Previews
Each pull request gets its own playable preview at `https://<owner>.github.io/<repo>/pr-preview/pr-<number>/`;
a bot comments the link on the PR. Previews are removed when the PR is closed.
