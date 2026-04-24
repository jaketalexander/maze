import { generateMaze }                          from './maze.js';
import { Player }                                 from './player.js';
import { Renderer, HUD_HEIGHT }                  from './renderer.js';
import { AudioManager }                           from './audio.js';
import { show, hide, updateWallIndicator }        from './ui.js';

// ─── Difficulties ─────────────────────────────────────────────────────────────

const DIFFICULTIES = {
  easy:   { cols: 15, rows: 11, name: 'EASY' },
  medium: { cols: 25, rows: 17, name: 'MEDIUM' },
  hard:   { cols: 37, rows: 25, name: 'HARD' },
  expert: { cols: 51, rows: 35, name: 'EXPERT' },
};

// Player colours
const P1_COLOR = '#ff4444';
const P2_COLOR = '#4488ff';

// ─── State machine ───────────────────────────────────────────────────────────

const S = { MENU:'MENU', COUNTDOWN:'COUNTDOWN', PLAYING:'PLAYING', PAUSED:'PAUSED', WIN:'WIN' };

let state      = S.MENU;
let difficulty = 'easy';
let mazeNum    = 1;

// Game objects
let maze, p1, p2;
let cellSize, offsetX, offsetY;

// P1: top-left start → bottom-right exit
// P2: bottom-right start → top-left exit  (symmetric / fair)
let p1StartCol, p1StartRow, p1ExitCol, p1ExitRow;
let p2StartCol, p2StartRow, p2ExitCol, p2ExitRow;

let cdValue  = 3;
let cdTimer  = 1.0;

// Win-modal timing / toggle state. Players should see the red-flash of the
// fake walls reveal before the modal covers any of it.
const WIN_MODAL_DELAY = 1.5; // seconds
let winModalTimer = 0;       // counts down from WIN_MODAL_DELAY once we enter S.WIN
let winModalVisible = false; // true once the modal is on screen
let winModalHidden  = false; // user has collapsed the modal to peek at maze

// Input state — two independent players on same keyboard
const inp1 = { left:false, right:false, up:false, down:false };
const inp2 = { left:false, right:false, up:false, down:false };

let lastTs = 0;

// ─── Modules ─────────────────────────────────────────────────────────────────

const canvas   = document.getElementById('game-canvas');
const renderer = new Renderer(canvas);
const audio    = new AudioManager();

const hudDiff    = document.getElementById('hud-difficulty');
const hudMazeNum = document.getElementById('hud-maze-num');

// ─── Game actions ─────────────────────────────────────────────────────────────

function startGame() {
  const cfg = DIFFICULTIES[difficulty];
  maze = generateMaze(cfg.cols, cfg.rows);

  const lay  = renderer.layout(cfg.cols, cfg.rows);
  cellSize   = lay.cellSize;
  offsetX    = lay.offsetX;
  offsetY    = lay.offsetY;

  // P1: top-left start, bottom-right exit
  p1StartCol = 0;           p1StartRow = 0;
  p1ExitCol  = cfg.cols-1;  p1ExitRow  = cfg.rows-1;

  // P2: bottom-right start, top-left exit  (exactly opposite — fair by symmetry)
  p2StartCol = cfg.cols-1;  p2StartRow = cfg.rows-1;
  p2ExitCol  = 0;           p2ExitRow  = 0;

  p1 = new Player(cellCx(p1StartCol), cellCy(p1StartRow), cellSize, P1_COLOR);
  p1.setSnap(p1StartCol, p1StartRow);

  p2 = new Player(cellCx(p2StartCol), cellCy(p2StartRow), cellSize, P2_COLOR);
  p2.setSnap(p2StartCol, p2StartRow);
  p2.angle = -Math.PI / 2;

  cdValue = 3;
  cdTimer = 1.0;

  hudDiff.textContent    = cfg.name;
  hudMazeNum.textContent = `MAZE ${mazeNum}`;

  updateWallIndicator(1, false);
  updateWallIndicator(2, false);

  hide('menu-screen');
  hide('win-screen');
  hide('pause-screen');
  show('hud');

  state = S.COUNTDOWN;
  audio.playCountdown(3);
}

function restartGame() {
  hide('pause-screen');
  hide('win-screen');
  hide('win-show-btn');

  const lay = renderer.layout(DIFFICULTIES[difficulty].cols, DIFFICULTIES[difficulty].rows);
  cellSize  = lay.cellSize;
  offsetX   = lay.offsetX;
  offsetY   = lay.offsetY;

  p1.reposition(cellCx(p1StartCol), cellCy(p1StartRow), cellSize);
  p1.setSnap(p1StartCol, p1StartRow);
  p1.resetFakeWall();

  p2.reposition(cellCx(p2StartCol), cellCy(p2StartRow), cellSize);
  p2.setSnap(p2StartCol, p2StartRow);
  p2.resetFakeWall();
  p2.angle = -Math.PI / 2;

  updateWallIndicator(1, false);
  updateWallIndicator(2, false);

  cdValue = 3;
  cdTimer = 1.0;

  state = S.COUNTDOWN;
  audio.playCountdown(3);
}

function nextMaze() {
  mazeNum++;
  hide('win-screen');
  hide('win-show-btn');
  startGame();
}

function goToMenu() {
  state = S.MENU;
  hide('win-screen');
  hide('win-show-btn');
  hide('pause-screen');
  hide('hud');
  show('menu-screen');
  mazeNum = 1;
}

function pause() {
  if (state !== S.PLAYING) return;
  state = S.PAUSED;
  show('pause-screen');
}

function resume() {
  if (state !== S.PAUSED) return;
  state = S.PLAYING;
  hide('pause-screen');
  lastTs = performance.now();
}

function triggerWin(winner) {
  state = S.WIN;
  audio.playWin();

  const winTitle = document.getElementById('win-title');
  if (winner === 1) {
    winTitle.textContent = 'PLAYER 1 WINS!';
    winTitle.className   = 'win-title p1';
  } else {
    winTitle.textContent = 'PLAYER 2 WINS!';
    winTitle.className   = 'win-title p2';
  }
  // Hold the modal off screen for a beat so the fake-wall reveal lands first.
  hide('win-screen');
  hide('win-show-btn');
  winModalVisible = false;
  winModalHidden  = false;
  winModalTimer   = WIN_MODAL_DELAY;
}

function showWinModal() {
  winModalVisible = true;
  winModalHidden  = false;
  show('win-screen');
  hide('win-show-btn');
}

function hideWinModal() {
  winModalVisible = false;
  winModalHidden  = true;
  hide('win-screen');
  show('win-show-btn');
}

function toggleWinModal() {
  if (state !== S.WIN || winModalTimer > 0) return;
  if (winModalVisible) hideWinModal();
  else                 showWinModal();
}

// ─── Game loop ────────────────────────────────────────────────────────────────

function update(dt) {
  renderer.update(dt);

  if (state === S.WIN && !winModalVisible && !winModalHidden) {
    winModalTimer -= dt;
    if (winModalTimer <= 0) showWinModal();
  }

  if (state === S.COUNTDOWN) {
    cdTimer -= dt;
    if (cdTimer <= 0) {
      cdValue--;
      if (cdValue < 0) {
        state = S.PLAYING;
        audio.playStart();
      } else {
        cdTimer = cdValue === 0 ? 0.55 : 1.0;
        audio.playCountdown(cdValue);
      }
    }
    return;
  }

  if (state !== S.PLAYING) return;


  // Update players (each passes opponent's fake wall for collision)
  const p1PrevBump = p1.bumpTimer;
  const p2PrevBump = p2.bumpTimer;

  p1.update(dt, inp1, maze, cellSize, offsetX, offsetY, p2.fakeWall);
  p2.update(dt, inp2, maze, cellSize, offsetX, offsetY, p1.fakeWall);

  if (p1.bumpTimer > 0 && p1PrevBump <= 0) audio.playWallBump();
  if (p2.bumpTimer > 0 && p2PrevBump <= 0) audio.playWallBump();

  // Win checks — P1 reaches bottom-right, P2 reaches top-left
  const p1Won = p1.isAtExit(p1ExitCol, p1ExitRow);
  const p2Won = p2.isAtExit(p2ExitCol, p2ExitRow);

  if (p1Won && p2Won) {
    // Simultaneous — whoever had less time wins (both times are equal since they start together)
    triggerWin(1);
  } else if (p1Won) {
    triggerWin(1);
  } else if (p2Won) {
    triggerWin(2);
  }
}

function render() {
  renderer.clear();
  if (state === S.MENU) return;

  renderer.drawMaze(maze, cellSize, offsetX, offsetY, p1.fakeWall, p2.fakeWall);
  renderer.drawExits(p1ExitCol, p1ExitRow, p2ExitCol, p2ExitRow, cellSize, offsetX, offsetY);

  renderer.drawTrail(p1.trail, P1_COLOR);
  renderer.drawTrail(p2.trail, P2_COLOR);

  renderer.drawPlayer(p1);
  renderer.drawPlayer(p2);

  if (state === S.WIN) {
    renderer.drawFakeWallsRevealed(cellSize, offsetX, offsetY, [p1.fakeWall, p2.fakeWall]);
  }

  renderer.drawVignette();

  const cfg = DIFFICULTIES[difficulty];
  if (cfg.cols >= 37) {
    renderer.drawMinimap(maze, p1, p2,
      p1ExitCol, p1ExitRow, p2ExitCol, p2ExitRow,
      cellSize, offsetX, offsetY);
  }

  if (state === S.COUNTDOWN) renderer.drawCountdown(cdValue);
}

function loop(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

// ─── Input ────────────────────────────────────────────────────────────────────

window.addEventListener('keydown', e => {
  audio.resume();

  // Player 1 — WASD
  switch (e.code) {
    case 'KeyA': inp1.left  = true; break;
    case 'KeyD': inp1.right = true; break;
    case 'KeyW': inp1.up    = true; break;
    case 'KeyS': inp1.down  = true; break;
    case 'KeyQ':
      if (state === S.PLAYING) {
        const placed = p1.placeFakeWall(maze);
        if (placed) { audio.playFakeWall(); updateWallIndicator(1, true); }
      }
      break;
  }

  // Player 2 — Arrow keys
  switch (e.code) {
    case 'ArrowLeft':  inp2.left  = true; break;
    case 'ArrowRight': inp2.right = true; break;
    case 'ArrowUp':    inp2.up    = true; break;
    case 'ArrowDown':  inp2.down  = true; break;
    case 'Slash':
      if (state === S.PLAYING) {
        const placed = p2.placeFakeWall(maze);
        if (placed) { audio.playFakeWall(); updateWallIndicator(2, true); }
      }
      break;
  }

  // Pause
  if (e.code === 'KeyP' || e.code === 'Escape') {
    if      (state === S.PLAYING) pause();
    else if (state === S.PAUSED)  resume();
  }

  // Toggle winner modal so players can peek at the revealed fake walls.
  if (e.code === 'Space' && state === S.WIN) {
    e.preventDefault();
    toggleWinModal();
  }

  // Prevent page scrolling
  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
});

window.addEventListener('keyup', e => {
  switch (e.code) {
    case 'KeyA': inp1.left  = false; break;
    case 'KeyD': inp1.right = false; break;
    case 'KeyW': inp1.up    = false; break;
    case 'KeyS': inp1.down  = false; break;

    case 'ArrowLeft':  inp2.left  = false; break;
    case 'ArrowRight': inp2.right = false; break;
    case 'ArrowUp':    inp2.up    = false; break;
    case 'ArrowDown':  inp2.down  = false; break;
  }
});

// ─── UI listeners ─────────────────────────────────────────────────────────────

document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.diff-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    difficulty = btn.dataset.diff;
  });
});

document.getElementById('start-btn').addEventListener('click',     () => { audio.init(); startGame(); });
document.getElementById('next-maze-btn').addEventListener('click',  nextMaze);
document.getElementById('retry-btn').addEventListener('click',      restartGame);
document.getElementById('menu-btn').addEventListener('click',       goToMenu);
document.getElementById('resume-btn').addEventListener('click',     resume);
document.getElementById('restart-btn').addEventListener('click',    restartGame);
document.getElementById('pause-menu-btn').addEventListener('click', goToMenu);
document.getElementById('win-hide-btn').addEventListener('click',   hideWinModal);
document.getElementById('win-show-btn').addEventListener('click',   showWinModal);

// ─── Resize ───────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  renderer.resize();
  if (!maze || !p1 || !p2) return;

  const cfg = DIFFICULTIES[difficulty];
  const lay = renderer.layout(cfg.cols, cfg.rows);

  // Preserve maze-cell position using snap coords (always accurate)
  cellSize = lay.cellSize;
  offsetX  = lay.offsetX;
  offsetY  = lay.offsetY;

  const sc1 = clamp(p1.snapCol, 0, cfg.cols-1), sr1 = clamp(p1.snapRow, 0, cfg.rows-1);
  const sc2 = clamp(p2.snapCol, 0, cfg.cols-1), sr2 = clamp(p2.snapRow, 0, cfg.rows-1);
  p1.reposition(cellCx(sc1), cellCy(sr1), cellSize); p1.setSnap(sc1, sr1);
  p2.reposition(cellCx(sc2), cellCy(sr2), cellSize); p2.setSnap(sc2, sr2);
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cellCx(col) { return offsetX + col * cellSize + cellSize / 2; }
function cellCy(row) { return offsetY + row * cellSize + cellSize / 2; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

// ─── Boot ─────────────────────────────────────────────────────────────────────

renderer.resize();
show('menu-screen');
lastTs = performance.now();
requestAnimationFrame(loop);
