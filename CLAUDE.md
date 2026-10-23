# Battle Fleet: Pre-Dreadnought

A single-player, browser-based naval wargame in plain HTML/CSS/JavaScript. No frameworks, no npm, no build step for
development: `index.html` loads `style.css` and `game.js`, which load images and music from `assets/`.

## Who you're working with

The game's designer is not a programmer and works only through this chat. With them:
- Talk about the game, not the code. Describe changes in terms of what a player will see.
- Handle all git and GitHub work yourself. Never ask them to run commands, resolve conflicts or pick branch names.
- When a change is ready, give them the preview link so they can play it (see Workflow).

Another collaborator is a developer and reviews changes on GitHub, so keep commits focused and messages descriptive.

## Workflow

1. Start each new piece of work on a fresh branch from the latest `main`.
2. Make the change, commit, push, and open a pull request with a plain-language description of what changed in the game.
3. Give the designer the preview link: `https://<owner>.github.io/<repo>/pr-preview/pr-<PR number>/` (fill in the
   real owner/repo from `git remote -v`). It goes live a minute or two after each push; a bot also comments it on the PR.
4. Keep pushing to the same branch/PR as they ask for tweaks.
5. When the designer says they're happy with it, squash-merge the PR. Merging to `main` publishes it to the main site.

If `main` has moved on while a PR was open, merge `main` into the branch and resolve conflicts yourself, keeping both
sides' intent.

## Code layout

- `index.html` - markup only: screens, panels, dialogs. One `<link>` to `style.css`, one `<script>` for `game.js`.
- `style.css` - all styles. Theme colors are CSS variables on `:root`.
- `game.js` - all logic (~6,000 lines, one global script). Sprite/sound constants (`SPRITE_*`, `SOUND_*`) near the top
  hold asset paths.
- `assets/` - PNG/JPG images and MP3 audio. Lowercase-hyphenated names describing the image.
- `docs/` - the rulebook PDF (written for v1.3.0; it lags behind the game).
- `tools/build_single_file.py` - produces the one-file distributable; CI runs it, you rarely need to.
- `server/` - the multiplayer relay (Node + `ws`, Docker Compose with Traefik labels for HTTPS). It is not part of the published
  site; the no-npm rule above is for the game, not this folder. Multiplayer logic in the game is the MULTIPLAYER section of `game.js`.

## Rules

- **Never embed base64 images or audio** in the code. Save new art as a file in `assets/` and reference it by relative
  path, e.g. `"assets/armored-cruiser-icon.png"`. Keep references in quotes or `url(...)` exactly like that so the
  single-file build can inline them.
- If the designer uploads images, save them into `assets/` with a descriptive name.
- If the designer pastes or uploads a whole single-file version of the game (e.g. from an old claude.ai chat), don't
  replace the repo with it. Extract its `<style>` and `<script>` contents, swap each base64 `data:` URI for the matching
  file in `assets/` (match by decoded content; save genuinely new ones as new files), and apply the differences.
- Stay with plain HTML/CSS/JS that works when `index.html` is opened straight from disk (`file://`): no modules,
  no `fetch` of local files, no external CDNs.
- Bump the build number in the `README.md` title for each merged change that players will notice (patch for fixes and
  small tweaks, minor for new features), and update the README if game types or controls change.
- Before pushing, run `node --check game.js` to catch syntax errors.
