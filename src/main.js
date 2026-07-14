/**
 * Echolocation — Slice A
 * Move + walls + ping memory fade + void death + exit + R restart
 *
 * Vision rules:
 * - World is dark by default (map does NOT move/change).
 * - Space = sonar: paints nearby tiles into a fading memory buffer.
 * - Bumping a wall briefly reveals that wall (contact echo).
 */

// --- Tuning knobs ---
const TILE_SIZE = 40;
const MOVE_SPEED = 165;
const PLAYER_RADIUS = 9;
const PING_RADIUS = 4.25 * TILE_SIZE; // ~4 tiles
const PING_FADE_SEC = 3.2; // longer = less "walls keep changing"
const MEMORY_FLOOR = 0.06; // residual ghost after fade (very dim)
const MEMORY_DECAY_TO_FLOOR_SEC = 3.2;
const CONTACT_REVEAL = 0.85;
const PING_COOLDOWN_SEC = 0.25;
const CAMERA_LERP = 0.18;
const START_REVEAL_RADIUS = 2.4 * TILE_SIZE;

// Tile codes
const T_EMPTY = 0;
const T_WALL = 1;
const T_VOID = 2;
const T_EXIT = 3;
const T_SPAWN = 9;

/**
 * Handcrafted cave — wider halls so first play is readable.
 * # wall  . floor  v void  E exit  S spawn
 */
const MAP_ROWS = [
  "####################",
  "#S........#........#",
  "#.........#........#",
  "#....##...#...##...#",
  "#....##...#...##...#",
  "#.........#........#",
  "####...#######...###",
  "#........#.........#",
  "#........#....v....#",
  "#..##....#.........#",
  "#..##....#####.....#",
  "#..................#",
  "#......######......#",
  "#......#....#......#",
  "#......#....#..v...#",
  "#..................#",
  "###..####..####..###",
  "#..................#",
  "#....v.............#",
  "#..............E...#",
  "####################",
];

const CHAR_TO_TILE = {
  "#": T_WALL,
  ".": T_EMPTY,
  v: T_VOID,
  E: T_EXIT,
  S: T_SPAWN,
  " ": T_EMPTY,
};

// --- Derived map ---
const mapH = MAP_ROWS.length;
const mapW = MAP_ROWS[0].length;
const grid = Array.from({ length: mapH }, () => Array(mapW).fill(T_EMPTY));
/** @type {number[][]} vision memory 0..1 per tile (stable positions — map never moves) */
const memory = Array.from({ length: mapH }, () => Array(mapW).fill(0));
let spawnTile = { x: 1, y: 1 };
let exitTile = { x: mapW - 2, y: mapH - 2 };

for (let y = 0; y < mapH; y++) {
  const row = MAP_ROWS[y];
  for (let x = 0; x < mapW; x++) {
    const t = CHAR_TO_TILE[row[x]] ?? T_EMPTY;
    grid[y][x] = t === T_SPAWN ? T_EMPTY : t;
    if (t === T_SPAWN) spawnTile = { x, y };
    if (t === T_EXIT) exitTile = { x, y };
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
  for (let y = 0; y < mapH; y++) memory[y].fill(0);
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
    bumped: false,
  };
}

let run = createRun();

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

/** Circle vs solid tiles; optionally collect contacted wall cells */
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
      // Soft edge: full strength in center, falloff near radius
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
  run.pingCd = PING_COOLDOWN_SEC;
  run.pings += 1;

  paintMemoryDisk(run.x, run.y, PING_RADIUS, 1);

  run.rings.push({
    x: run.x,
    y: run.y,
    born: run.time,
    ttl: 0.4,
    radius: PING_RADIUS,
  });
}

function decayMemory(dt) {
  // Exponential-ish linear decay toward MEMORY_FLOOR, then slowly to 0
  const rate = dt / MEMORY_DECAY_TO_FLOOR_SEC;
  for (let y = 0; y < mapH; y++) {
    for (let x = 0; x < mapW; x++) {
      let m = memory[y][x];
      if (m <= 0) continue;
      if (m > MEMORY_FLOOR) {
        m -= rate * (1 - MEMORY_FLOOR);
        if (m < MEMORY_FLOOR) m = MEMORY_FLOOR;
      } else {
        // residual ghost decays very slowly so layout feels stable, not flickering
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

function checkHazards() {
  const t = tileAtWorld(run.x, run.y);
  if (t === T_VOID) {
    run.state = STATE.DEAD;
    return;
  }
  if (t === T_EXIT) {
    run.state = STATE.ESCAPED;
  }
}

function restart() {
  run = createRun();
  // Spawn room already "known" a bit so player isn't totally lost on boot
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

  movePlayer(dt);
  if (framePressed("Space")) doPing();

  decayMemory(dt);
  run.rings = run.rings.filter((r) => run.time - r.born < r.ttl);

  updateDepth();
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
    // Soft floor so rooms feel solid, not only wall chunks popping
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

function draw() {
  const w = view.w;
  const h = view.h;

  ctx.fillStyle = "#03040a";
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(-Math.round(view.x), -Math.round(view.y));

  // Only iterate visible tile range for perf
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

  // Ping rings (visual only)
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

  // Exit beacon always faintly visible
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
  ctx.textAlign = "left";
  ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillStyle = "rgba(200, 210, 220, 0.55)";
  ctx.fillText("WASD move · SPACE sonar · R restart", 16, 22);

  ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillStyle = "rgba(210, 220, 230, 0.9)";
  ctx.fillText(`Depth ${run.maxDepth}`, 16, 44);

  if (run.state === STATE.RUN && run.time < 12) {
    ctx.fillStyle = "rgba(170, 190, 210, 0.55)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillText(
      "Map stays fixed. SPACE only lights memory briefly — then it fades.",
      16,
      view.h - 36
    );
    ctx.fillText("Bump a wall to feel/reveal it. Avoid X voids. Reach cyan exit.", 16, view.h - 18);
  } else if (run.bumped && run.state === STATE.RUN) {
    ctx.fillStyle = "rgba(255, 170, 130, 0.65)";
    ctx.font = "12px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
    ctx.fillText("Wall contact — lit that wall for a moment.", 16, view.h - 18);
  }
}

function drawSummary() {
  const w = view.w;
  const h = view.h;
  ctx.fillStyle = "rgba(3, 4, 10, 0.75)";
  ctx.fillRect(0, 0, w, h);

  ctx.textAlign = "center";
  ctx.font = "bold 28px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

  if (run.state === STATE.DEAD) {
    ctx.fillStyle = "#ff6b8a";
    ctx.fillText("LOST IN THE DARK", w / 2, h / 2 - 36);
  } else {
    ctx.fillStyle = "#5ee0e8";
    ctx.fillText("ESCAPED", w / 2, h / 2 - 36);
  }

  ctx.font = "14px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  ctx.fillStyle = "rgba(210, 220, 230, 0.9)";
  ctx.fillText(`Depth ${run.maxDepth}`, w / 2, h / 2 + 4);
  ctx.fillText(`Time ${run.time.toFixed(1)}s · Pings ${run.pings}`, w / 2, h / 2 + 28);
  ctx.fillStyle = "rgba(180, 190, 200, 0.7)";
  ctx.fillText("Press R to run again", w / 2, h / 2 + 64);
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
restart(); // also applies start memory + camera
last = performance.now();
requestAnimationFrame(frame);
