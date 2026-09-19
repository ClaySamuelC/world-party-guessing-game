# World Party Guessing Game

A browser party game for up to 8 friends: click countries and pin cities on a shared world map. One player hosts, the others join with a room code, and everything runs peer-to-peer over WebRTC. There is no game server.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
```

```sh
npm run build      # static site in dist/ (relative paths, works on GitHub Pages)
npm run data       # rebuild public/data from upstream sources (add --fresh to re-download)
```

## How it plays

- **Host a party** creates a 6-character room code and an invite link (`?room=CODE`).
- **Join** with the code. The host's browser is authoritative: it generates questions, times rounds, and scores answers. Guests only send their answers.
- **Practice solo** runs the same engine without a room. **Explore the map** is a free-roam browser with search and country facts.
- Question types: **country click** (by English name, flag, local name, or capital) and **pin the location** (a city or a country's capital). Points: 500–1000 for a correct click depending on speed; pins earn 1000 within 25 km and decay with distance.
- Small countries are hard to tap, so every click round has a search box. Any listed name works: English exonym, endonym, or alternates (e.g. `Nippon`, `日本`, `Holy See`, `Czech Republic`).

## Data

Everything is snapshotted into `public/data/` by `scripts/build-data.ts` and shipped with the app, so every player scores against the same numbers. Sources are public domain or intergovernmental open data; no national factbooks.

| Data | Source |
| --- | --- |
| Country polygons, UN regions | Natural Earth 50m Admin 0 (10m for microstates missing at 50m), public domain |
| Capitals and major cities | Natural Earth 10m Populated Places, public domain |
| English names, endonyms per official language, UN member list, ISO codes | Unicode CLDR |
| Population | UN World Population Prospects (via Our World in Data CSV mirror) |
| Land area | World Bank `AG.LND.TOTL.K2`; computed from the map polygon where the World Bank has no row (TW, XK, VA) |
| Flags | `flag-icons` (MIT) |

Playable countries are the 193 UN member states plus Taiwan, Kosovo, Palestine, and Vatican City. Other Natural Earth polygons are drawn but not playable.

Contested and alternate names live in `scripts/name-overrides.ts`. They are best-effort and accepted as valid answers; listing a name is not a statement about recognition.

## Networking notes

- Signaling uses Trystero over public Nostr relays; after the handshake all traffic is WebRTC data channels between browsers. Relay errors in the console for a single relay are normal.
- Only public STUN is configured. Some school or office networks block WebRTC entirely; if a friend cannot connect, that is the likely cause.
- If the host closes the tab the match ends for everyone. Host migration is out of scope for v1.
- Late joiners during a match are politely rejected until the host returns to the lobby.

## Layout

- `scripts/build-data.ts` — download, filter, join, and write the data snapshot
- `src/data/` — types, loader, search
- `src/map/` — Leaflet map with clickable countries and pins
- `src/game/` — question generation, scoring, host engine, client reducer, session hook
- `src/net/` — Trystero room wrapper and room codes
- `src/ui/` — home, lobby, play, results, explore screens
