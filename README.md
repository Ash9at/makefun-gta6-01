# Solmaris Heat

[![Make GTA 6 on make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01)
[![Rank on make.fun](https://make.fun/badge/gta6-01/Ash9at/makefun-gta6-01/rank.svg)](https://make.fun/bounty/gta6-01)
[![Reward on make.fun](https://make.fun/badge/gta6-01/Ash9at/makefun-gta6-01/reward.svg)](https://make.fun/bounty/gta6-01)

An original top-down open-world crime game for the [Make GTA 6 bounty on make.fun](https://make.fun/bounty/gta6-01). Plain JavaScript and HTML5 canvas — no dependencies, no build step, no network. Serve `game/` with any static file server (or open `game/index.html`) and play in a desktop browser.

## The city

Solmaris is a sun-soaked coastal city on an 8×7 street grid: eight named districts, twenty signed shops, a beach and a pier with a lighthouse at the end of it. Buildings come in towers, slabs and houses with domes, solar roofs, gardens and terraces, and their windows light up as the five-minute day rolls into night and the streetlights take over.

## What you do

- **Work for Marisol Vega.** Five story jobs from the Vega Logistics warehouse: steal a gold coupe, run a crate off the pier against the clock, collect three briefcases, move a watched van, and make a final run to the lighthouse at four stars. Each pays cash and respect; after the chain, the city is yours.
- **Drive anything.** Steal parked cars, carjack traffic, drift on the handbrake, watch the speedometer. Traffic follows the street grid and keeps to its lane; pedestrians wander, flee, and drop cash when they go down.
- **Outrun the law.** Crime builds heat, heat builds stars (1–5). Police route through junctions to hunt you and chase directly up close; at three stars they shoot. Get pinned and you are busted; get flattened and Hospital del Mar sends the bill.
- **Earn on the side.** Hail a taxi fare and beat the clock for a tip, or step into the Mercado plaza ring and score 300 rampage points in 45 seconds.
- **Live in it.** A full day-night cycle with a HUD clock, a live minimap with police and objective blips, dialogue panels, toasts, autosave and manual save (progress persists in `localStorage`).

## Controls

| Input | Action |
| --- | --- |
| WASD / Arrow keys | Walk and drive |
| Shift | Run |
| E | Enter / exit car · advance dialogue |
| F or mouse click (hold) | Punch · shoot |
| Mouse | Aim |
| Space | Handbrake (drift) |
| H | Horn |
| V | Save now |
| P or Esc | Pause (controls and session stats) |

## Layout

- `main.ts` — the entry program (Node 22, standard library only): copies `game/` and `screenshots/` to the output directory and writes `dossier.json` with the vendored make.fun library.
- `game/index.html` — the page; loads the modules below in order.
- `game/src/rng.js` — seeded randomness and math helpers (the city is deterministic per seed).
- `game/src/config.js` — grid dimensions, tuning, names.
- `game/src/world.js` — city generation: streets, buildings, shops, beach, pier, collisions.
- `game/src/entities.js` — cars, pedestrians, traffic and police driving.
- `game/src/missions.js` — Marisol's job chain, taxi fares, the rampage.
- `game/src/render.js` — all drawing: world, day-night light, HUD, minimap, menus.
- `game/src/main.js` — game state, input, combat, crime and police response, saving, screenshot scenes.
- `screenshots/` — four renders of the game itself (`?shot=cover|foot|chase|pier&seed=7`), listed in `shots.json`.

## License

MIT — see `LICENSE`.
