# Multiplayer relay server

A small server that links two players' games for Multiplayer. It doesn't know the rules. It pairs two players by a
4-letter room code and passes their orders back and forth, while the two copies of the game keep the battle in step
themselves. The game itself stays on GitHub Pages. Only this relay runs on your own machine.

## What you need

- A machine that's always on, with Docker and Docker Compose.
- A **domain name** that points at your home's internet address. A free one from [DuckDNS](https://www.duckdns.org)
  is fine (e.g. `battlefleet.duckdns.org`). Run their updater if your home IP address changes.
- Your router **forwarding ports 80 and 443** to that machine.

The game is served from a secure (https) page, and browsers only let secure pages connect to secure servers. So the
relay needs a certificate. The bundled [Caddy](https://caddyserver.com) gets one from Let's Encrypt and renews it
automatically. That's what the domain and port 80 are for.

## Start it

```sh
cd server
cp .env.example .env     # then edit .env: set DOMAIN to your domain name
docker compose up -d
```

Check it: `https://<your domain>/health` should show `{"ok":true,...}` in a browser.

In the game: **Multiplayer**, then put `wss://<your domain>` in **Server address**. The game remembers it. (It can
also be built into the game so nobody has to type it: set `MP_DEFAULT_SERVER` near the top of the MULTIPLAYER section
of `game.js`.)

## Day to day

- Logs: `docker compose logs -f relay`
- Update after pulling a new version of this repo: `docker compose up -d --build`
- Stop: `docker compose down`

The containers restart on their own after a reboot.

## Settings (`.env`)

| Setting | What it does |
|---|---|
| `DOMAIN` | Your domain name, used for the HTTPS certificate. |
| `ALLOWED_ORIGINS` | Which web pages may connect, comma-separated. `https://dwyer.github.io` covers the main site and every PR preview; `null` is the game opened straight from a file. Leave it empty to allow any page. |
| `RELAY_PORT` | Only if you already run your own reverse proxy instead of Caddy: start just the relay with `docker compose up -d relay` and proxy your HTTPS domain (WebSocket upgrade enabled) to `127.0.0.1:8080`, or whatever port you set here. |

## Running it without Docker

Node.js 18 or later: `npm ci && node relay.js` (it listens on port 8080, or `PORT`). You'd then need your own
HTTPS in front of it.
