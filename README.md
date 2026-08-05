# Echolocation

Dark-cave browser game. You are nearly blind — **sonar pings** briefly light walls and hazards, then fade. Manage energy, go deeper, escape or die, and beat your best depth.

## Play

For source development, serve the project root with any static file server (ES modules do not load from `file://`), then open the site in a browser.

```bash
# source preview
python3 -m http.server 8765
```

For a production bundle:

```bash
npm install
npm run build
python3 -m http.server 8765 --directory dist
```

## Controls

| Key | Action |
|-----|--------|
| WASD / arrows | Move |
| Space | Sonar ping (costs energy) |
| R | Restart run |

## Stack

- HTML + Canvas 2D + vanilla JavaScript
- esbuild development dependency for the production bundle; no runtime dependencies
- `localStorage` for personal bests
- Web Audio for ping SFX

## Status

Playable **Slice A–D1**: vision memory, energy loop, seeded caves each run (`R`), and **listeners** that hunt when they hear your sonar.

## License

All rights reserved unless a license file is added later.
