# SPEC — Echolocation (MVP)

Working design doc. Product pillars live in `AGENTS.md`. This file is **play rules + build slices**.

Status: draft for implementation. Change freely before/while coding MVP-1.

---

## 1. One-liner

You are a lone scout in a pitch-black cave. You only see what your sonar ping just touched. Go deeper. Don’t die. Come back for a better run.

---

## 2. Player fantasy

- You are small, fragile, and nearly blind.
- Sound is your eyes — and a limited resource.
- Tension comes from moving without perfect information.

Tone: tense, minimal, slightly eerie. No dialogue required for MVP.

---

## 3. Camera & presentation

| Choice | Value |
|--------|--------|
| View | Top-down 2D |
| World | Grid or continuous (MVP: **continuous** movement, **tile** walls) |
| Default look | Near-black screen |
| Player | Small readable shape (dot/chevron) always faintly visible |
| Walls/hazards | Invisible until revealed by ping (or collision death) |
| HUD | Minimal: energy, depth, best depth, hint line for controls |

No sprite pipeline required — simple canvas shapes OK.

---

## 4. Controls (desktop-first)

| Input | Action |
|-------|--------|
| `W` `A` `S` `D` or arrows | Move |
| `Space` | Sonar ping |
| `R` | Restart run (always available after death; also mid-run) |
| `P` or `Esc` | Pause (MVP-2 optional; can skip for MVP-1) |

Touch: later. Not blocking MVP.

---

## 5. Core systems

### 5.1 Movement

- Constant move speed while key held (or accel light — prefer **constant** for MVP).
- Collide solid with walls; no wall slide required v1 (stop on collision OK).
- Cannot pass through walls.

### 5.2 Darkness & memory

- Frame default: clear to near-black.
- **Revealed geometry** lives in a short-lived “echo buffer”:
  - On ping, walls (and later objects) inside radius become visible.
  - Visibility **fades over time** (e.g. 1.2–2.0s full fade).
  - After fade, those cells/segments are dark again unless re-pinged.
- Player body: always drawn (dim).
- Optional MVP-1 stretch: last ping leaves very faint residual (almost invisible) — only if it helps navigation without killing tension.

### 5.3 Ping (sonar)

| Param | MVP default (tune in playtest) |
|-------|--------------------------------|
| Trigger | `Space` (edge-triggered, not hold-spam every frame) |
| Shape | Circle from player center |
| Radius | ~6–8 tiles (or ~180–240px at base scale) |
| Reveal duration | ~1.5s linear or ease-out fade |
| Cost | MVP-2: energy. MVP-1: unlimited OK for feel-first |
| Cooldown | Short (e.g. 0.15–0.25s) so double-tap doesn’t stack ugly |
| Feedback | Flash ring expand + optional Web Audio blip (audio can wait MVP-1b) |

Reveal rule: any wall segment/tile whose distance to player ≤ radius at ping time enters the echo buffer at full alpha.

### 5.4 Energy (MVP-2)

| Param | Default |
|-------|---------|
| Max energy | 5 pings worth (or 100 units, 20 per ping) |
| Cost per ping | 1 charge |
| Regen | Slow over time while not pinging (e.g. 1 charge / 4s) |
| At 0 | Cannot ping until regen |

Spam = temporary blindness risk + less energy for panic moments.

### 5.5 Hazards & death (MVP-1)

Minimum set:

1. **Wall** — solid; not lethal.
2. **Void / pit** — tile or zone; entering = death.
3. **Spike** (optional same milestone) — contact = death.

Death:

- Freeze or brief flash.
- Show run summary: depth reached, time, pings used (pings = 0 until tracked).
- `R` or click/key → new run immediately.

Fairness: death must be readable in hindsight (player could have pinged / slowed). No random one-shots off-screen without telegraph once revealed.

### 5.6 Depth & goal

**Depth** = how far into the cave along the main axis (e.g. +Y or distance from spawn).

MVP-1:

- Handcrafted small map(s).
- Soft goal: **reach exit** (glowing node always **faintly** visible or visible on any ping) **or** survive to map end.
- If exit reached: “escape” success screen + score; `R` for another run.

MVP-3:

- Procedural map; “deeper” is the main ambition; exit optional or periodic checkpoints later.

### 5.7 Scoring (MVP-2)

Show each run + keep personal bests in `localStorage`.

| Metric | Use |
|--------|-----|
| Depth | Primary score / best |
| Time alive | Secondary |
| Pings used | Secondary (efficiency brag) |
| Outcome | died / escaped |

Best depth persists across sessions. Key e.g. `echolocation_best_depth`.

### 5.8 Procgen (MVP-3) — sketch only

- Seeded RNG (`seed` in URL or random each run).
- Rooms + corridors or drunkard-walk cave on a grid.
- Guaranteed path from spawn toward increasing depth.
- Place void/spikes with clear spacing from spawn.
- Daily seed = later, not MVP-3 required.

---

## 6. Run lifecycle

```
BOOT → TITLE/READY (optional: key to start)
  → RUN
      move / ping / update echo / collide
      → DEATH or ESCAPE
  → SUMMARY
  → RUN (on R) with new seed (when procgen exists)
```

Instant restart is non-negotiable for the “one more run” loop.

---

## 7. HUD (minimal)

During RUN:

- Energy pips or bar (from MVP-2)
- Depth (integer)
- Best depth (grey)
- Tiny control legend first 10s or on title only

SUMMARY:

- Outcome
- Depth / time / pings
- “Press R to run again”

---

## 8. Build slices

### Slice A — MVP-1 (feel)

- [ ] `index.html` + canvas full viewport
- [ ] Game loop (`requestAnimationFrame`), fixed or semi-fixed update
- [ ] Player move + wall collision
- [ ] Handcrafted tile map (spawn, walls, void, exit)
- [ ] Ping reveal + fade echo buffer
- [ ] Death on void; restart on `R`
- [ ] Exit reach = success summary
- **Exit criteria:** You want to ping carefully without being told to.

### Slice B — MVP-2 (loop)

- [ ] Energy cost + regen
- [ ] Track time + pings
- [ ] Score HUD + summary
- [ ] `localStorage` best depth
- [ ] Optional: simple ping SFX
- **Exit criteria:** After death you hit R without thinking.

### Slice C — MVP-3 (variety)

- [ ] Seeded procgen cave
- [ ] New layout each run
- [ ] Spawn safety + path toward depth
- **Exit criteria:** Two runs feel different; still fair.

### Slice D — later

- Sound-sensitive enemy (ping attracts)
- Daily seed
- Modifiers / unlocks
- Juice (screen shake, better VFX), accessibility options

---

## 9. Technical sketch

| Item | Choice |
|------|--------|
| Files | `index.html`, `src/main.js` (+ split only when needed: `map.js`, `input.js`, …) |
| Modules | ES modules OK if served statically with a tiny local server; **or** single script tag for double-click open. Prefer **playable path documented** in README when added. |
| Map format | 2D number grid: `0` empty, `1` wall, `2` void, `3` exit, `9` spawn |
| Render order | clear black → faded echo walls → hazards if known → player → HUD |
| Resolution | Canvas internal size scales with `devicePixelRatio`; CSS 100vw/100vh |
| No deps | Until user approves otherwise |

### Echo buffer (simple approach)

- Keep list of revealed wall cells: `{ x, y, born, ttl }`
- Or offscreen canvas / alpha map — cell list is enough for MVP.
- Each frame: draw walls in buffer with `alpha = 1 - age/ttl`; drop when alpha ≤ 0.

### Collision

- Player = circle or small AABB.
- Walls = solid tiles; void = death tiles (center-point or overlap test).

---

## 10. Content for MVP-1 map

One handcrafted cave, ~30–60s for a careful player:

- Spawn in small alcove
- 2–3 branching corridors (one safe-ish, one with void)
- Exit deeper than spawn
- At least one “must ping” choke (narrow turn into void)

Art: monochrome + one accent (e.g. exit cyan/amber).

---

## 11. Tuning knobs (expose as consts)

```text
MOVE_SPEED
PING_RADIUS
PING_FADE_SEC
PING_COOLDOWN_SEC
PING_COST          // MVP-2
ENERGY_MAX         // MVP-2
ENERGY_REGEN_PER_S // MVP-2
PLAYER_RADIUS
TILE_SIZE
```

Tune only after first playable, not before.

---

## 12. Out of scope (this SPEC version)

- Three.js / WebGL
- Physics engine
- Mobile controls
- Accounts / leaderboards online
- Story cutscenes
- Vercel-specific setup

---

## 13. Open questions (user can decide later)

1. Top-down only confirmed — side-view ever? (**Assume no.**)
2. Exit required every run vs endless depth only? (**MVP-1: exit. MVP-3: depth-first, exit optional.**)
3. Double-click `index.html` vs local static server? (**Prefer whatever works first; document one path.**)
4. Player always-on glow intensity — more readable vs more dread?

Defaults above apply until overridden.

---

## 14. Acceptance — “MVP done enough to share”

- Open game in browser, learn controls without README.
- Complete one escape **or** die once; restart; beat previous depth or try again.
- Ping feels like the star mechanic (not a gimmick on a normal maze).
- No console errors on happy path.
- No secrets, no deps, no AI commit trailers.

---

## 15. Next implementation step

After this SPEC is accepted (or lightly edited):

→ Implement **Slice A** only: scaffold + handcrafted map + move + ping fade + death/restart/exit.
