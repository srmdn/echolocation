# Echolocation

Dark-cave browser game. You are nearly blind — **sonar pings** briefly light walls and hazards, then fade. Manage energy, go deeper, escape or die, and beat your best depth.

## Play

Serve the project root with any static file server (ES modules do not load from `file://`), then open the site in a browser.

## Controls

| Key | Action |
|-----|--------|
| WASD / arrows | Move |
| Space | Sonar ping (costs energy) |
| R | Restart run |

## Stack

- HTML + Canvas 2D + vanilla JavaScript
- No build step, no dependencies
- `localStorage` for personal bests
- Web Audio for ping SFX

## Status

Playable **Slice A + B**: handcrafted cave, vision memory, energy loop, scores.  
Next (planned): procedural caves / seeds (Slice C).

## License

All rights reserved unless a license file is added later.
