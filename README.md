# Echolocation

Dark-cave browser game. You are nearly blind — **sonar pings** briefly light walls and hazards, then fade. Manage energy, go deeper, escape or die, and beat your best depth.

## Play (local)

ES modules need a tiny static server (not `file://`):

```bash
python3 -m http.server 8765
```

Open [http://127.0.0.1:8765/](http://127.0.0.1:8765/)

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
