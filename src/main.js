/**
 * Echolocation — Slice A + B + C
 * A: move, walls, ping memory, void/exit, restart
 * B: energy + regen, score HUD, localStorage best depth, ping SFX
 * C: seeded procgen cave — new layout each run
 *
 * Vision rules:
 * - World is dark by default (map does NOT move/change mid-run).
 * - Space = sonar: paints nearby tiles into a fading memory buffer (costs energy).
 * - Bumping a wall briefly reveals that wall (contact echo).
 */

// --- Tuning knobs ---
const TILE_SIZE = 40;
const MOVE_SPEED = 165;
const PLAYER_RADIUS = 9;
const PING_RADIUS = 4.25 * TILE_SIZE;
const MEMORY_FLOOR = 0.06;
const MEMORY_DECAY_TO_FLOOR_SEC = 3.2;
const CONTACT_REVEAL = 0.85;
const PING_COOLDOWN_SEC = 0.25;
const CAMERA_LERP = 0.18;
const START_REVEAL_RADIUS = 2.4 * TILE_SIZE;

// Slice B — energy
const ENERGY_MAX = 5;
const PING_COST = 1;
const ENERGY_REGEN_PER_S = 0.25; // 1 charge / 4s

// Slice C — procgen map size (includes solid border)
const MAP_W = 27;
const MAP_H = 33;
const GEN_ROOM_COUNT = 8;
const GEN_VOID_COUNT = 5;
const GEN_MAX_ATTEMPTS = 24;

const STORAGE_BEST_DEPTH = "echolocation_best_depth";
const STORAGE_BEST_ESCAPE = "echolocation_best_escape_time";

// Tile codes
const T_EMPTY = 0;
const T_WALL = 1;
const T_VOID = 2;
const T_EXIT = 3;

// --- Map state (filled by generator) ---
let mapW = MAP_W;
let mapH = MAP_H;
/** @type {number[][]} */
let grid = [];
/** @type {number[][]} */
let memory = [];
let spawnTile = { x: 1, y: 1 };
let exitTile = { x: 1, y: 1 };
let currentSeed = 0;

/** Optional fixed seed from ?seed=123 — same map every restart while set */
function parseUrlSeed() {
  try {
    const raw = new URLSearchParams(window.location.search).get("seed");
    if (raw == null || raw === "") return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    return n >>> 0;
  } catch {
    return null;
  }
}

const fixedSeed = parseUrlSeed();

function randomSeed() {
  return (Math.random() * 0xffffffff) >>> 0;
}

/** Mulberry32 — deterministic [0,1) */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randInt(rng, min, maxInclusive) {
  return min + Math.floor(rng() * (maxInclusive - min + 1));
}

function inBounds(x, y) {
  return x >= 0 && y >= 0 && x < mapW && y < mapH;
}

function carveRoom(x0, y0, w, h) {
  const x1 = Math.min(mapW - 2, x0 + w - 1);
  const y1 = Math.min(mapH - 2, y0 + h - 1);
  const sx = Math.max(1, x0);
  const sy = Math.max(1, y0);
  for (let y = sy; y <= y1; y++) {
    for (let x = sx; x <= x1; x++) {
      grid[y][x] = T_EMPTY;
    }
  }
  return {
    x: sx,
    y: sy,
    w: x1 - sx + 1,
    h: y1 - sy + 1,
    cx: (sx + x1) >> 1,
    cy: (sy + y1) >> 1,
  };
}

function carveCorridor(x0, y0, x1, y1, rng) {
  let x = x0;
  let y = y0;
  const horizFirst = rng() < 0.5;

  const stepX = () => {
    while (x !== x1) {
      grid[y][x] = T_EMPTY;
      // widen corridor by 1 occasionally for playability
      if (y + 1 < mapH - 1) grid[y + 1][x] = T_EMPTY;
      x += Math.sign(x1 - x);
    }
  };
  const stepY = () => {
    while (y !== y1) {
      grid[y][x] = T_EMPTY;
      if (x + 1 < mapW - 1) grid[y][x + 1] = T_EMPTY;
      y += Math.sign(y1 - y);
    }
  };

  if (horizFirst) {
    stepX();
    stepY();
  } else {
    stepY();
    stepX();
  }
  grid[y1][x1] = T_EMPTY;
}

function walkable(t) {
  return t === T_EMPTY || t === T_EXIT;
}

/** BFS on floor/exit; returns parent map or null if unreachable */
function bfsParents(sx, sy) {
  const key = (x, y) => y * mapW + x;
  const parent = new Map();
  const q = [[sx, sy]];
  parent.set(key(sx, sy), null);

  while (q.length) {
    const [x, y] = q.shift();
    if (x === exitTile.x && y === exitTile.y) return parent;
    const nbs = [
      [x + 1, y],
      [x - 1, y],
      [x, y + 1],
      [x, y - 1],
    ];
    for (const [nx, ny] of nbs) {
      if (!inBounds(nx, ny)) continue;
      const k = key(nx, ny);
      if (parent.has(k)) continue;
      const t = grid[ny][nx];
      if (!walkable(t) && !(nx === exitTile.x && ny === exitTile.y)) continue;
      if (t === T_WALL || t === T_VOID) continue;
      parent.set(k, [x, y]);
      q.push([nx, ny]);
    }
  }
  return null;
}

function pathCells(sx, sy, parents) {
  const set = new Set();
  const key = (x, y) => y * mapW + x;
  let cur = [exitTile.x, exitTile.y];
  while (cur) {
    set.add(key(cur[0], cur[1]));
    const p = parents.get(key(cur[0], cur[1]));
    cur = p;
  }
  set.add(key(sx, sy));
  return set;
}

function tryGenerate(seed) {
  const rng = mulberry32(seed);
  mapW = MAP_W;
  mapH = MAP_H;
  grid = Array.from({ length: mapH }, () => Array(mapW).fill(T_WALL));
  memory = Array.from({ length: mapH }, () => Array(mapW).fill(0));

  const rooms = [];
  const bandH = Math.floor((mapH - 4) / GEN_ROOM_COUNT);

  for (let i = 0; i < GEN_ROOM_COUNT; i++) {
    const rw = randInt(rng, 4, 7);
    const rh = randInt(rng, 3, 6);
    const bandY0 = 2 + i * bandH;
    const bandY1 = Math.min(mapH - 3, bandY0 + bandH - 1);
    const maxY = Math.max(bandY0, bandY1 - rh);
    const ry = randInt(rng, bandY0, Math.max(bandY0, maxY));
    const rx = randInt(rng, 2, Math.max(2, mapW - 2 - rw));
    rooms.push(carveRoom(rx, ry, rw, rh));
  }

  // Ensure rooms progress downward: sort by center y
  rooms.sort((a, b) => a.cy - b.cy);

  for (let i = 0; i < rooms.length - 1; i++) {
    carveCorridor(rooms[i].cx, rooms[i].cy, rooms[i + 1].cx, rooms[i + 1].cy, rng);
  }

  // Extra side branches for variety (dead-ish rooms)
  const branchCount = randInt(rng, 1, 3);
  for (let b = 0; b < branchCount; b++) {
    const base = rooms[randInt(rng, 1, rooms.length - 2)];
    const rw = randInt(rng, 3, 5);
    const rh = randInt(rng, 3, 5);
    const rx = randInt(rng, 2, mapW - 2 - rw);
    const ry = clamp(
      base.y + randInt(rng, -2, 3),
      2,
      mapH - 2 - rh
    );
    const side = carveRoom(rx, ry, rw, rh);
    carveCorridor(base.cx, base.cy, side.cx, side.cy, rng);
  }

  const start = rooms[0];
  const end = rooms[rooms.length - 1];
  spawnTile = { x: start.cx, y: start.cy };
  exitTile = { x: end.cx, y: end.cy };
  grid[spawnTile.y][spawnTile.x] = T_EMPTY;
  grid[exitTile.y][exitTile.x] = T_EXIT;

  // Clear small pad around spawn
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const x = spawnTile.x + dx;
      const y = spawnTile.y + dy;
      if (inBounds(x, y) && x > 0 && y > 0 && x < mapW - 1 && y < mapH - 1) {
        if (grid[y][x] === T_WALL) grid[y][x] = T_EMPTY;
      }
    }
  }
  grid[exitTile.y][exitTile.x] = T_EXIT;

  const parents = bfsParents(spawnTile.x, spawnTile.y);
  if (!parents) return false;

  const critical = pathCells(spawnTile.x, spawnTile.y, parents);

  // Floor candidates for voids
  const floors = [];
  for (let y = 1; y < mapH - 1; y++) {
    for (let x = 1; x < mapW - 1; x++) {
      if (grid[y][x] !== T_EMPTY) continue;
      if (x === spawnTile.x && y === spawnTile.y) continue;
      const distSpawn =
        Math.abs(x - spawnTile.x) + Math.abs(y - spawnTile.y);
      if (distSpawn < 6) continue;
      floors.push([x, y]);
    }
  }

  // Shuffle floors
  for (let i = floors.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = floors[i];
    floors[i] = floors[j];
    floors[j] = tmp;
  }

  let placed = 0;
  for (const [x, y] of floors) {
    if (placed >= GEN_VOID_COUNT) break;
    const k = y * mapW + x;
    // Prefer off critical path; allow a few near path for tension
    if (critical.has(k) && rng() < 0.85) continue;
    grid[y][x] = T_VOID;
    placed++;
  }

  // Re-check path still open (voids shouldn't block if we avoided critical)
  const parents2 = bfsParents(spawnTile.x, spawnTile.y);
  if (!parents2) {
    // repair: clear voids on a recovered path attempt — fail gen instead
    return false;
  }

  // Border always wall
  for (let x = 0; x < mapW; x++) {
    grid[0][x] = T_WALL;
    grid[mapH - 1][x] = T_WALL;
  }
  for (let y = 0; y < mapH; y++) {
    grid[y][0] = T_WALL;
    grid[y][mapW - 1] = T_WALL;
  }
  grid[exitTile.y][exitTile.x] = T_EXIT;
  grid[spawnTile.y][spawnTile.x] = T_EMPTY;

  return true;
}

function generateCave(seed) {
  let s = seed >>> 0;
  for (let attempt = 0; attempt < GEN_MAX_ATTEMPTS; attempt++) {
    const trySeed = (s + attempt * 9973) >>> 0;
    if (tryGenerate(trySeed)) {
      currentSeed = trySeed;
      return currentSeed;
    }
  }
  // Absolute fallback: simple open tunnel
  mapW = MAP_W;
  mapH = MAP_H;
  grid = Array.from({ length: mapH }, () => Array(mapW).fill(T_WALL));
  memory = Array.from({ length: mapH }, () => Array(mapW).fill(0));
  const mid = (mapW / 2) | 0;
  for (let y = 1; y < mapH - 1; y++) {
    for (let dx = -2; dx <= 2; dx++) {
      const x = mid + dx;
      if (x > 0 && x < mapW - 1) grid[y][x] = T_EMPTY;
    }
  }
  spawnTile = { x: mid, y: 2 };
  exitTile = { x: mid, y: mapH - 3 };
  grid[spawnTile.y][spawnTile.x] = T_EMPTY;
  grid[exitTile.y][exitTile.x] = T_EXIT;
  currentSeed = s;
  return currentSeed;
}

// --- Persist ---
function loadBestDepth() {
  const n = Number(localStorage.getItem(STORAGE_BEST_DEPTH));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function loadBestEscapeTime() {
  const n = Number(localStorage.getItem(STORAGE_BEST_ESCAPE));
  return Number.isFinite(n) && n > 0 ? n : null;
}

function saveBestDepth(depth) {
  if (depth > meta.bestDepth) {
    meta.bestDepth = depth;
    localStorage.setItem(STORAGE_BEST_DEPTH, String(depth));
    return true;
  }
  return false;
}

function saveBestEscape(time) {
  if (meta.bestEscapeTime == null || time < meta.bestEscapeTime) {
    meta.bestEscapeTime = time;
    localStorage.setItem(STORAGE_BEST_ESCAPE, String(time));
    return true;
  }
  return false;
}

const meta = {
  bestDepth: loadBestDepth(),
  bestEscapeTime: loadBestEscapeTime(),
};

// --- Audio (Web Audio, unlock on first input) ---
let audioCtx = null;

function ensureAudio() {
  if (audioCtx) return audioCtx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  audioCtx = new AC();
  return audioCtx;
}

function playPingSfx(ok) {
  const ctxA = ensureAudio();
  if (!ctxA) return;
  if (ctxA.state === "suspended") ctxA.resume();

  const t0 = ctxA.currentTime;
  const osc = ctxA.createOscillator();
  const gain = ctxA.createGain();
  osc.connect(gain);
  gain.connect(ctxA.destination);

  if (ok) {
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, t0);
    osc.frequency.exponentialRampToValueAtTime(180, t0 + 0.18);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.12, t0 + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.22);
    osc.start(t0);
    osc.stop(t0 + 0.24);
  } else {
    osc.type = "triangle";
    osc.frequency.setValueAtTime(90, t0);
    gain.gain.setValueAtTime(0.0001, t0);
    gain.gain.exponentialRampToValueAtTime(0.06, t0 + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.08);
    osc.start(t0);
    osc.stop(t0 + 0.1);
  }
}

// --- Canvas ---
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");
const view = { w: 0, h: 0, x: 0, y: 0 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = Math.floor(w * dpr);
  canvas.height = Math.floor(h * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  view.w = w;
  view.h = h;
}

window.addEventListener("resize", resize);

// --- Input ---
const keys = new Set();
const justPressed = new Set();

window.addEventListener("keydown", (e) => {
  ensureAudio();
  const k = normalizeKey(e.key);
  if (!k) return;
  if (
    k === "Space" ||
    k === "ArrowUp" ||
    k === "ArrowDown" ||
    k === "ArrowLeft" ||
    k === "ArrowRight"
  ) {
    e.preventDefault();
  }
  if (!keys.has(k)) justPressed.add(k);
  keys.add(k);
});

window.addEventListener("keyup", (e) => {
  const k = normalizeKey(e.key);
  if (k) keys.delete(k);
});

function normalizeKey(key) {
  if (key === " ") return "Space";
  if (key.length === 1) return key.toLowerCase();
  return key;
}

function pressed(k) {
  return keys.has(k);
}

// --- Game state ---
const STATE = { RUN: "run", DEAD: "dead", ESCAPED: "escaped" };

function tileCenter(tx, ty) {
  return {
    x: tx * TILE_SIZE + TILE_SIZE / 2,
    y: ty * TILE_SIZE + TILE_SIZE / 2,
  };
}

function clearMemory() {
  for (let y = 0; y < mapH; y++) {
    if (memory[y]) memory[y].fill(0);
  }
}

function createRun() {
  const c = tileCenter(spawnTile.x, spawnTile.y);
  clearMemory();
  return {
    state: STATE.RUN,
    x: c.x,
    y: c.y,
    pingCd: 0,
    rings: [],
    time: 0,
    pings: 0,
    depth: 0,
    maxDepth: 0,
    energy: ENERGY_MAX,
    bumped: false,
    denyFlash: 0,
    newBestDepth: false,
    newBestEscape: false,
    seed: currentSeed,
  };
}

/** @type {ReturnType<typeof createRun>} */
let run;

function worldW() {
  return mapW * TILE_SIZE;
}
function worldH() {
  return mapH * TILE_SIZE;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function tileAtWorld(wx, wy) {
  const tx = Math.floor(wx / TILE_SIZE);
  const ty = Math.floor(wy / TILE_SIZE);
  if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) return T_WALL;
  return grid[ty][tx];
}

function isSolidTile(t) {
  return t === T_WALL;
}

function circleHitsSolid(cx, cy, r, contactOut) {
  const minTx = Math.floor((cx - r) / TILE_SIZE);
  const maxTx = Math.floor((cx + r) / TILE_SIZE);
  const minTy = Math.floor((cy - r) / TILE_SIZE);
  const maxTy = Math.floor((cy + r) / TILE_SIZE);
  let hit = false;

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const solid =
        tx < 0 || ty < 0 || tx >= mapW || ty >= mapH || isSolidTile(grid[ty][tx]);
      if (!solid) continue;

      const nearestX = clamp(cx, tx * TILE_SIZE, (tx + 1) * TILE_SIZE);
      const nearestY = clamp(cy, ty * TILE_SIZE, (ty + 1) * TILE_SIZE);
      const dx = cx - nearestX;
      const dy = cy - nearestY;
      if (dx * dx + dy * dy < r * r) {
        hit = true;
        if (contactOut && tx >= 0 && ty >= 0 && tx < mapW && ty < mapH) {
          contactOut.push(tx, ty);
        }
      }
    }
  }
  return hit;
}

function paintMemoryDisk(wx, wy, radius, strength) {
  const r2 = radius * radius;
  const minTx = Math.floor((wx - radius) / TILE_SIZE);
  const maxTx = Math.floor((wx + radius) / TILE_SIZE);
  const minTy = Math.floor((wy - radius) / TILE_SIZE);
  const maxTy = Math.floor((wy + radius) / TILE_SIZE);

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      if (tx < 0 || ty < 0 || tx >= mapW || ty >= mapH) continue;
      const cx = tx * TILE_SIZE + TILE_SIZE / 2;
      const cy = ty * TILE_SIZE + TILE_SIZE / 2;
      const dx = cx - wx;
      const dy = cy - wy;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2) continue;
      const fall = 1 - Math.sqrt(d2) / radius;
      const s = strength * (0.55 + 0.45 * fall);
      if (s > memory[ty][tx]) memory[ty][tx] = s;
    }
  }
}

function revealContactWalls(contacts) {
  for (let i = 0; i < contacts.length; i += 2) {
    const tx = contacts[i];
    const ty = contacts[i + 1];
    if (memory[ty][tx] < CONTACT_REVEAL) memory[ty][tx] = CONTACT_REVEAL;
  }
}

function movePlayer(dt) {
  let ix = 0;
  let iy = 0;
  if (pressed("a") || pressed("ArrowLeft")) ix -= 1;
  if (pressed("d") || pressed("ArrowRight")) ix += 1;
  if (pressed("w") || pressed("ArrowUp")) iy -= 1;
  if (pressed("s") || pressed("ArrowDown")) iy += 1;
  if (ix === 0 && iy === 0) {
    run.bumped = false;
    return;
  }

  const len = Math.hypot(ix, iy) || 1;
  const stepX = (ix / len) * MOVE_SPEED * dt;
  const stepY = (iy / len) * MOVE_SPEED * dt;
  const contacts = [];
  let bumped = false;

  if (stepX !== 0) {
    if (!circleHitsSolid(run.x + stepX, run.y, PLAYER_RADIUS, contacts)) {
      run.x += stepX;
    } else {
      bumped = true;
    }
  }
  if (stepY !== 0) {
    if (!circleHitsSolid(run.x, run.y + stepY, PLAYER_RADIUS, contacts)) {
      run.y += stepY;
    } else {
      bumped = true;
    }
  }

  if (bumped && contacts.length) {
    revealContactWalls(contacts);
    run.bumped = true;
  } else {
    run.bumped = false;
  }
}

function doPing() {
  if (run.pingCd > 0) return;

  if (run.energy < PING_COST) {
    run.denyFlash = 0.35;
    playPingSfx(false);
    return;
  }

  run.energy -= PING_COST;
  run.pingCd = PING_COOLDOWN_SEC;
  run.pings += 1;

  paintMemoryDisk(run.x, run.y, PING_RADIUS, 1);
  playPingSfx(true);

  run.rings.push({
    x: run.x,
    y: run.y,
    born: run.time,
    ttl: 0.4,
    radius: PING_RADIUS,
  });
}

function regenEnergy(dt) {
  if (run.energy >= ENERGY_MAX) {
    run.energy = ENERGY_MAX;
    return;
  }
  run.energy = Math.min(ENERGY_MAX, run.energy + ENERGY_REGEN_PER_S * dt);
}

function decayMemory(dt) {
  const rate = dt / MEMORY_DECAY_TO_FLOOR_SEC;
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      let m = memory[y][x];
      if (m <= 0) continue;
      if (m > MEMORY_FLOOR) {
        m -= rate * (1 - MEMORY_FLOOR);
        if (m < MEMORY_FLOOR) m = MEMORY_FLOOR;
      } else {
        m -= dt * 0.02;
        if (m < 0) m = 0;
      }
      memory[y][x] = m;
    }
  }
}

function updateDepth() {
  const spawnY = spawnTile.y * TILE_SIZE;
  const d = Math.max(0, Math.floor((run.y - spawnY) / TILE_SIZE));
  run.depth = d;
  if (d > run.maxDepth) run.maxDepth = d;
}

function endRun(state) {
  run.state = state;
  run.newBestDepth = saveBestDepth(run.maxDepth);
  if (state === STATE.ESCAPED) {
    run.newBestEscape = saveBestEscape(run.time);
  }
}

function checkHazards() {
  const t = tileAtWorld(run.x, run.y);
  if (t === T_VOID) {
    endRun(STATE.DEAD);
    return;
  }
  if (t === T_EXIT) {
    endRun(STATE.ESCAPED);
  }
}

function restart() {
  const seed = fixedSeed != null ? fixedSeed : randomSeed();
  generateCave(seed);
  run = createRun();
  paintMemoryDisk(run.x, run.y, START_REVEAL_RADIUS, 0.9);
  view.x = run.x - view.w / 2;
  view.y = run.y - view.h / 2;
  clampCamera();
}

function clampCamera() {
  view.x = clamp(view.x, 0, Math.max(0, worldW() - view.w));
  view.y = clamp(view.y, 0, Math.max(0, worldH() - view.h));
}

// --- Update ---
let framePresses = new Set();

function beginFrameInput() {
  framePresses = new Set(justPressed);
  justPressed.clear();
}

function framePressed(k) {
  return framePresses.has(k);
}

function updateRun(dt) {
  beginFrameInput();

  if (framePressed("r")) {
    restart();
    return;
  }

  if (run.state !== STATE.RUN) return;

  run.time += dt;
  if (run.pingCd > 0) run.pingCd = Math.max(0, run.pingCd - dt);
  if (run.denyFlash > 0) run.denyFlash = Math.max(0, run.denyFlash - dt);

  movePlayer(dt);
  if (framePressed("Space")) doPing();

  regenEnergy(dt);
  decayMemory(dt);
  run.rings = run.rings.filter((r) => run.time - r.born < r.ttl);

  updateDepth();
  if (run.maxDepth > meta.bestDepth) {
    saveBestDepth(run.maxDepth);
    run.newBestDepth = true;
  }

  checkHazards();

  const tx = run.x - view.w / 2;
  const ty = run.y - view.h / 2;
  view.x += (tx - view.x) * CAMERA_LERP;
  view.y += (ty - view.y) * CAMERA_LERP;
  clampCamera();
}

// --- Draw ---
function drawTile(tx, ty, t, a) {
  if (a <= 0.01) return;
  const x = tx * TILE_SIZE;
  const y = ty * TILE_SIZE;

  if (t === T_EMPTY) {
    ctx.fillStyle = `rgba(18, 22, 32, ${0.55 * a})`;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    return;
  }

  if (t === T_WALL) {
    ctx.fillStyle = `rgba(110, 128, 155, ${0.72 * a})`;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = `rgba(190, 210, 240, ${0.4 * a})`;
    ctx.strokeRect(x + 0.5, y + 0.5, TILE_SIZE - 1, TILE_SIZE - 1);
    return;
  }

  if (t === T_VOID) {
    ctx.fillStyle = `rgba(30, 8, 40, ${0.85 * a})`;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
    ctx.strokeStyle = `rgba(230, 70, 110, ${0.75 * a})`;
    ctx.beginPath();
    ctx.moveTo(x + 10, y + 10);
    ctx.lineTo(x + TILE_SIZE - 10, y + TILE_SIZE - 10);
    ctx.moveTo(x + TILE_SIZE - 10, y + 10);
    ctx.lineTo(x + 10, y + TILE_SIZE - 10);
    ctx.stroke();
    return;
  }

  if (t === T_EXIT) {
    ctx.fillStyle = `rgba(40, 180, 200, ${0.55 * a})`;
    ctx.fillRect(x, y, TILE_SIZE, TILE_SIZE);
  }
}

function drawEnergyPips(x, y) {
  const pipW = 14;
  const pipH = 10;
  const gap = 4;
  const full = Math.floor(run.energy);
  const frac = run.energy - full;
  const deny = run.denyFlash > 0;

  ctx.fillStyle = deny
    ? "rgba(255, 120, 140, 0.85)"
    : "rgba(180, 200, 220, 0.55)";
  ctx.font = "10px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.textAlign = "left";
  ctx.fillText("ENERGY", x, y - 5);

  for (let i = 0; i < ENERGY_MAX; i++) {
    const px = x + i * (pipW + gap);
    ctx.strokeStyle = deny
      ? "rgba(255, 90, 110, 0.9)"
      : "rgba(140, 190, 255, 0.55)";
    ctx.strokeRect(px + 0.5, y + 0.5, pipW - 1, pipH - 1);

    let fill = 0;
    if (i < full) fill = 1;
    else if (i === full) fill = frac;

    if (fill > 0.02) {
      ctx.fillStyle = deny
        ? `rgba(255, 90, 110, ${0.35 + 0.5 * fill})`
        : `rgba(120, 190, 255, ${0.35 + 0.5 * fill})`;
      ctx.fillRect(px + 1, y + 1, (pipW - 2) * fill, pipH - 2);
    }
  }
}

function draw() {
  const w = view.w;
  const h = view.h;

  ctx.fillStyle = "#03040a";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(-Math.round(view.x), -Math.round(view.y));

  const minTx = clamp(Math.floor(view.x / TILE_SIZE) - 1, 0, mapW - 1);
  const maxTx = clamp(Math.ceil((view.x + w) / TILE_SIZE) + 1, 0, mapW - 1);
  const minTy = clamp(Math.floor(view.y / TILE_SIZE) - 1, 0, mapH - 1);
  const maxTy = clamp(Math.ceil((view.y + h) / TILE_SIZE) + 1, 0, mapH - 1);

  for (let ty = minTy; ty <= maxTy; ty++) {
    for (let tx = minTx; tx <= maxTx; tx++) {
      const a = memory[ty][tx];
      if (a <= 0) continue;
      drawTile(tx, ty, grid[ty][tx], a);
    }
  }

  for (const ring of run.rings) {
    const age = run.time - ring.born;
    const u = age / ring.ttl;
    const a = 1 - u;
    const rad = ring.radius * (0.12 + 0.88 * u);
    ctx.beginPath();
    ctx.arc(ring.x, ring.y, rad, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(150, 210, 255, ${0.5 * a})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  // Exit beacon
  {
    const ex = exitTile.x * TILE_SIZE;
    const ey = exitTile.y * TILE_SIZE;
    const pulse = 0.14 + 0.07 * Math.sin(run.time * 2.5);
    ctx.fillStyle = `rgba(70, 210, 220, ${pulse})`;
    ctx.fillRect(ex + 8, ey + 8, TILE_SIZE - 16, TILE_SIZE - 16);
    ctx.strokeStyle = `rgba(120, 240, 250, ${pulse + 0.1})`;
    ctx.strokeRect(ex + 8.5, ey + 8.5, TILE_SIZE - 17, TILE_SIZE - 17);
  }

  // Player
  ctx.beginPath();
  ctx.arc(run.x, run.y, PLAYER_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = "rgba(235, 240, 248, 0.95)";
  ctx.fill();
  ctx.strokeStyle = run.bumped
    ? "rgba(255, 160, 120, 0.95)"
    : "rgba(140, 190, 255, 0.85)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.restore();

  drawHud();
  if (run.state !== STATE.RUN) drawSummary();
}

function drawHud() {
  const pad = 18;
  const mono = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  // Top-right: run stats
  ctx.textAlign = "right";
  ctx.font = `15px ${mono}`;
  ctx.fillStyle = "rgba(220, 230, 240, 0.92)";
  ctx.fillText(`Depth ${run.maxDepth}`, view.w - pad, pad + 14);

  ctx.font = `12px ${mono}`;
  ctx.fillStyle =
    run.maxDepth >= meta.bestDepth && run.maxDepth > 0
      ? "rgba(240, 215, 140, 0.85)"
      : "rgba(150, 165, 185, 0.7)";
  ctx.fillText(`Best ${meta.bestDepth}`, view.w - pad, pad + 34);

  ctx.fillStyle = "rgba(140, 155, 175, 0.55)";
  ctx.fillText(
    `${run.time.toFixed(1)}s · ${run.pings} pings`,
    view.w - pad,
    pad + 52
  );

  ctx.fillStyle = "rgba(120, 140, 160, 0.45)";
  ctx.fillText(`Seed ${run.seed}`, view.w - pad, pad + 70);

  // Bottom center: energy
  const pipW = 14;
  const gap = 4;
  const energyBlockW = ENERGY_MAX * pipW + (ENERGY_MAX - 1) * gap;
  const energyX = Math.round(view.w / 2 - energyBlockW / 2);
  const energyY = view.h - 42;
  drawEnergyPips(energyX, energyY);

  ctx.textAlign = "center";
  ctx.font = `12px ${mono}`;

  if (run.state === STATE.RUN && run.time < 12) {
    ctx.fillStyle = "rgba(170, 190, 210, 0.45)";
    ctx.fillText(
      "WASD move · SPACE sonar · R new cave",
      view.w / 2,
      view.h - 14
    );
  } else if (run.denyFlash > 0 && run.state === STATE.RUN) {
    ctx.fillStyle = "rgba(255, 120, 140, 0.85)";
    ctx.fillText("No energy — wait for regen", view.w / 2, view.h - 14);
  } else if (run.bumped && run.state === STATE.RUN) {
    ctx.fillStyle = "rgba(255, 170, 130, 0.7)";
    ctx.fillText("Wall contact", view.w / 2, view.h - 14);
  }
}

function drawSummary() {
  const w = view.w;
  const h = view.h;
  ctx.fillStyle = "rgba(3, 4, 10, 0.78)";
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.font = "bold 28px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  if (run.state === STATE.DEAD) {
    ctx.fillStyle = "#ff6b8a";
    ctx.fillText("LOST IN THE DARK", w / 2, h / 2 - 56);
  } else {
    ctx.fillStyle = "#5ee0e8";
    ctx.fillText("ESCAPED", w / 2, h / 2 - 56);
  }

  ctx.font = "15px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillStyle = "rgba(210, 220, 230, 0.95)";
  ctx.fillText(`Depth ${run.maxDepth}`, w / 2, h / 2 - 14);
  ctx.fillText(
    `Time ${run.time.toFixed(1)}s · Pings ${run.pings}`,
    w / 2,
    h / 2 + 10
  );

  ctx.font = "13px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillStyle = "rgba(160, 175, 195, 0.85)";
  ctx.fillText(`Personal best depth: ${meta.bestDepth}`, w / 2, h / 2 + 36);
  ctx.fillStyle = "rgba(130, 150, 170, 0.7)";
  ctx.fillText(`Seed ${run.seed}`, w / 2, h / 2 + 56);

  if (run.newBestDepth) {
    ctx.fillStyle = "#f0d78c";
    ctx.fillText("NEW BEST DEPTH", w / 2, h / 2 + 78);
  } else if (run.state === STATE.ESCAPED && run.newBestEscape) {
    ctx.fillStyle = "#8cf0c8";
    ctx.fillText("NEW BEST ESCAPE TIME", w / 2, h / 2 + 78);
  } else if (run.state === STATE.ESCAPED && meta.bestEscapeTime != null) {
    ctx.fillStyle = "rgba(140, 200, 180, 0.7)";
    ctx.fillText(
      `Best escape: ${meta.bestEscapeTime.toFixed(1)}s`,
      w / 2,
      h / 2 + 78
    );
  }

  ctx.fillStyle = "rgba(180, 190, 200, 0.75)";
  ctx.fillText("Press R for a new cave", w / 2, h / 2 + 108);
}

// --- Loop ---
let last = performance.now();

function frame(now) {
  let dt = (now - last) / 1000;
  last = now;
  dt = Math.min(dt, 0.05);
  updateRun(dt);
  draw();
  requestAnimationFrame(frame);
}

resize();
restart();
last = performance.now();
requestAnimationFrame(frame);
