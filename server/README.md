# Multiplayer relay server

A small server that links two players' games for Multiplayer. It doesn't know the rules. It pairs two players by a
4-letter room code and passes their orders back and forth, while the two copies of the game keep the battle in step
themselves. The game itself stays on GitHub Pages. Only this relay runs on your own machine.

The game connects to `wss://battle-fleet-relay.dwyer.dev` by default (`MP_DEFAULT_SERVER` in the MULTIPLAYER section
of `game.js`). Players can type a different address on the Multiplayer screen.

## What you need

- Docker and Docker Compose on an always-on machine.
- A running **Traefik** on that machine with:
  - a Docker network the relay can join (default name `traefik`),
  - an HTTPS entrypoint (default name `websecure`),
  - a certificate resolver named **`le`**.
- `battle-fleet-relay.dwyer.dev` pointing at that machine.

The game is served from a secure (https) page, and browsers only let secure pages connect to secure servers. So the
relay is reached through Traefik's HTTPS. Traefik passes WebSocket connections through with no extra settings.

## Start it

```sh
cd server
docker compose up -d
```

If your Traefik network or entrypoint has a different name, first `cp .env.example .env` and change them there.

Check it: `https://battle-fleet-relay.dwyer.dev/health` should show `{"ok":true,...}` in a browser.

## Day to day

- Logs: `docker compose logs -f relay`
- Update after pulling a new version of this repo: `docker compose up -d --build`
- Stop: `docker compose down`

The container restarts on its own after a reboot.

## Settings (`.env`, all optional)

| Setting | Default | What it does |
|---|---|---|
| `DOMAIN` | `battle-fleet-relay.dwyer.dev` | The host name Traefik routes to the relay. |
| `TRAEFIK_NETWORK` | `traefik` | The external Docker network Traefik is on. |
| `TRAEFIK_ENTRYPOINT` | `websecure` | Traefik's HTTPS entrypoint. |
| `ALLOWED_ORIGINS` | `https://dwyer.github.io,null` | Which web pages may connect, comma-separated. `https://dwyer.github.io` covers the main site and every PR preview; `null` is the game opened straight from a file. Set it empty to allow any page. |

## Running it without Docker

Node.js 18 or later: `npm ci && node relay.js` (it listens on port 8080, or `PORT`). You'd then need your own
HTTPS in front of it.
