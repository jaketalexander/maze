import { Player }                  from './player.js';
import { Renderer, HUD_HEIGHT }    from './renderer.js';
import { AudioManager }            from './audio.js';
import { show, hide }              from './ui.js';
import { startLobby }              from './lobby.js';

// ─── Shared constants ────────────────────────────────────────────────────────

const DIFFICULTIES = {
  easy:   { cols: 15, rows: 11, name: 'EASY' },
  medium: { cols: 25, rows: 17, name: 'MEDIUM' },
  hard:   { cols: 37, rows: 25, name: 'HARD' },
  expert: { cols: 51, rows: 35, name: 'EXPERT' },
};

const PLAYER_COLORS = { p1: '#ff4444', p2: '#4488ff' };

const S = { LOBBY:'LOBBY', COUNTDOWN:'COUNTDOWN', PLAYING:'PLAYING', WIN:'WIN' };

const WIN_MODAL_DELAY = 1.5;

// ─── Modules ────────────────────────────────────────────────────────────────
const canvas   = document.getElementById('game-canvas');
const renderer = new Renderer(canvas);
const audio    = new AudioManager();

const hudDiff   = document.getElementById('hud-difficulty');
const hudRoom   = document.getElementById('hud-room-code');
const hudP1Name = document.getElementById('hud-p1-name');
const hudP2Name = document.getElementById('hud-p2-name');

// ─── Game session state ─────────────────────────────────────────────────────

let state = S.LOBBY;

let net, mySlot, peerSlot, isHost;
let code, difficulty;

let maze, cols, rows;
let cellSize, offsetX, offsetY;

let p1Start, p1Exit, p2Start, p2Exit;

let myPlayer   = null;  // local Player instance for prediction
let myInput    = { left:false, right:false, up:false, down:false };
let lastSentInput = '';

// Latest server snapshot + short interpolation buffer
let serverState = null; // { p1, p2, lifecycle, tick }
let opp = null;         // { cx, cy, col, row, angle, bumped, color, radius, snapCol, snapRow }
let oppTargetCx = 0, oppTargetCy = 0;

let cdValue = 3;
let winner = null, winReason = null, winFakeWalls = { p1:null, p2:null };

let winModalTimer = 0;
let winModalVisible = false;
let winModalHidden  = false;

let lastMineFakeWallUsed = false;
let fakeWallToastUntil = 0;

let lastTs = 0;

// ─── Boot ───────────────────────────────────────────────────────────────────

renderer.resize();
lastTs = performance.now();
requestAnimationFrame(loop);

runLobby();

async function runLobby() {
  state = S.LOBBY;
  hide('hud');
  hide('win-screen');
  hide('win-show-btn');
  const res = await startLobby();
  audio.init();
  net = res.net; mySlot = res.slot; peerSlot = mySlot === 'p1' ? 'p2' : 'p1';
  isHost = res.isHost;
  code = res.code; difficulty = res.difficulty;
  bindNetHandlers(res.firstGameMsg);
}

function bindNetHandlers(firstGameMsg) {
  // `gameStart` already fired once before lobby resolved — handle it.
  beginGame(firstGameMsg);

  net.on('gameStart', (m) => beginGame(m));

  net.on('countdown', (m) => {
    state = S.COUNTDOWN;
    cdValue = m.value;
    if (m.value > 0)   audio.playCountdown(m.value);
    else if (m.value === 0) audio.playStart();
  });

  net.on('state', (m) => {
    serverState = m;
    // Reconcile my own player
    const mine = m[mySlot];
    const other = m[peerSlot];
    if (mine && myPlayer) reconcileMe(mine);
    if (other) updateOpponent(other);
    if (m.lifecycle === 'playing' && state !== S.PLAYING) state = S.PLAYING;
  });

  net.on('win', (m) => {
    winner        = m.winner;
    winReason     = m.reason;
    winFakeWalls  = m.fakeWalls || { p1:null, p2:null };
    showWinScreen();
  });

  net.on('peerLeft', () => {
    if (state === S.COUNTDOWN || state === S.PLAYING) {
      // Server will also send a `win` message; peerLeft arrives first in
      // edge cases. Flag the reason here as a fallback.
      winReason = 'peerLeft';
    }
  });

  net.on('forcedMenu', () => {
    goToMenu();
  });

  net.on('close', () => {
    if (state !== S.LOBBY) {
      // Reset UI back to lobby on socket drop.
      goToMenu();
    }
  });
}

// ─── Game start / reset ─────────────────────────────────────────────────────

function beginGame(m) {
  maze       = m.maze;
  cols       = m.cols;
  rows       = m.rows;
  difficulty = m.difficulty;
  p1Start    = m.p1Start;  p1Exit = m.p1Exit;
  p2Start    = m.p2Start;  p2Exit = m.p2Exit;

  const lay = renderer.layout(cols, rows);
  cellSize = lay.cellSize;
  offsetX  = lay.offsetX;
  offsetY  = lay.offsetY;

  // Our own Player: render-space instance (uses real pixel cellSize).
  const myStart = mySlot === 'p1' ? p1Start : p2Start;
  myPlayer = new Player(
    cellCx(myStart.col), cellCy(myStart.row),
    cellSize, PLAYER_COLORS[mySlot]
  );
  myPlayer.setSnap(myStart.col, myStart.row);
  myPlayer.angle = mySlot === 'p1' ? -Math.PI / 2 : -Math.PI / 2;

  // Opponent surrogate — not a Player instance; just enough for the renderer.
  const oppStart = peerSlot === 'p1' ? p1Start : p2Start;
  opp = {
    cx: cellCx(oppStart.col),
    cy: cellCy(oppStart.row),
    angle: -Math.PI / 2,
    color: PLAYER_COLORS[peerSlot],
    radius: cellSize * 0.22,
    bumpTimer: 0,
    snapCol: oppStart.col,
    snapRow: oppStart.row,
    fakeWall: null,
  };
  oppTargetCx = opp.cx;
  oppTargetCy = opp.cy;

  // HUD
  hudDiff.textContent = DIFFICULTIES[difficulty].name;
  hudRoom.textContent = `ROOM ${code}`;
  hudP1Name.textContent = mySlot === 'p1' ? 'PLAYER 1 (YOU)' : 'PLAYER 1';
  hudP2Name.textContent = mySlot === 'p2' ? 'PLAYER 2 (YOU)' : 'PLAYER 2';

  // Reset input + win state
  myInput = { left:false, right:false, up:false, down:false };
  lastSentInput = '';
  winner = null; winReason = null;
  winFakeWalls = { p1:null, p2:null };
  winModalVisible = false; winModalHidden = false; winModalTimer = 0;
  lastMineFakeWallUsed = false;
  fakeWallToastUntil = 0;
  cdValue = 3;

  // Drop focus from any lingering lobby button so Space goes to the game,
  // not to firing a hidden button's click handler.
  if (document.activeElement && document.activeElement !== document.body) {
    document.activeElement.blur?.();
  }

  hide('win-screen');
  hide('win-show-btn');
  // Make sure the lobby overlays are dismissed so the race is visible.
  hide('menu-screen');
  hide('create-screen');
  hide('join-screen');
  hide('room-screen');
  show('hud');

  state = S.COUNTDOWN;
}

// ─── Reconciliation / opponent ──────────────────────────────────────────────

function reconcileMe(mine) {
  // Detect the placer's own fake wall succeeding (false → true on MY slot).
  if (mine.fakeWallUsed && !lastMineFakeWallUsed) {
    audio.tone(540, 0.10, 'square', 0.18);
    audio.tone(360, 0.18, 'square', 0.16, 0.05);
    showFakeWallToast();
  }
  lastMineFakeWallUsed = !!mine.fakeWallUsed;

  // Server reports in cell units (cx = col + 0.5). Convert to pixels.
  const sx = offsetX + mine.cx * cellSize;
  const sy = offsetY + mine.cy * cellSize;
  const cellDrift = Math.hypot(sx - myPlayer.cx, sy - myPlayer.cy) / cellSize;

  const snapDiff = mine.col !== myPlayer.snapCol || mine.row !== myPlayer.snapRow;
  const tgtDiff  = mine.tCol !== myPlayer.targetCol || mine.tRow !== myPlayer.targetRow;

  function applyAuth() {
    myPlayer.cx        = sx;
    myPlayer.cy        = sy;
    myPlayer.snapCol   = mine.col;
    myPlayer.snapRow   = mine.row;
    myPlayer.targetCol = mine.tCol;
    myPlayer.targetRow = mine.tRow;
    myPlayer.isMoving  = !!mine.moving;
    myPlayer.moving    = !!mine.moving;
    myPlayer.angle     = mine.angle;
    // Do not call reposition() — it clears trail[] and causes visible pops.
  }

  // When the server says we are idle on a cell, treat that as ground truth so
  // spectators (who only see server snapshots) always match your resting grid.
  if (!mine.moving) {
    if (snapDiff || tgtDiff || cellDrift > 0.12) applyAuth();
    return;
  }

  // Server mid-glide but we already snapped locally — we predicted one frame
  // ahead; pull back so we never sit on a different square than the opponent sees.
  if (mine.moving && snapDiff && !myPlayer.isMoving) {
    applyAuth();
    return;
  }

  // Different move intent (wrong target / wall disagreement).
  if (mine.moving && tgtDiff) {
    applyAuth();
    return;
  }

  // Same path but render drift from 30Hz sim vs 60Hz client (still cap so we
  // never stay ~1 cell off, which reads as "wrong square" to the peer).
  if (mine.moving && cellDrift > 0.48) applyAuth();
}

function showFakeWallToast() {
  fakeWallToastUntil = performance.now() + 900;
}

function updateOpponent(other) {
  oppTargetCx       = offsetX + other.cx * cellSize;
  oppTargetCy       = offsetY + other.cy * cellSize;
  opp.angle         = other.angle;
  opp.snapCol       = other.col;
  opp.snapRow       = other.row;
  opp.bumpTimer     = other.bumped ? 0.08 : 0;
  opp.fakeWall      = other.fakeWall;
  opp.radius        = cellSize * 0.22;
}

// ─── Win screen ─────────────────────────────────────────────────────────────

function showWinScreen() {
  state = S.WIN;
  audio.playWin();

  const winTitle = document.getElementById('win-title');
  const iWon = winner === mySlot;
  const msg = winReason === 'peerLeft'
    ? (iWon ? 'OPPONENT LEFT — YOU WIN' : 'YOU LEFT')
    : (iWon ? 'YOU WIN!' : 'YOU LOSE');
  winTitle.textContent = msg;
  winTitle.className = `win-title ${winner === 'p1' ? 'p1' : 'p2'}`;

  // Only the host may start a rematch or next maze — hide those actions for player 2.
  if (isHost) {
    show('next-maze-btn');
    show('retry-btn');
    hide('win-host-only');
  } else {
    hide('next-maze-btn');
    hide('retry-btn');
    const hostOnly = document.getElementById('win-host-only');
    hostOnly.textContent = 'Only the host can start a new maze or rematch.';
    show('win-host-only');
  }

  // Delay the modal so the fake-wall reveal plays first.
  hide('win-screen');
  hide('win-show-btn');
  winModalVisible = false;
  winModalHidden  = false;
  winModalTimer   = WIN_MODAL_DELAY;
}

function showWinModal()  { winModalVisible = true;  winModalHidden = false; show('win-screen'); hide('win-show-btn'); }
function hideWinModal()  { winModalVisible = false; winModalHidden = true;  hide('win-screen'); show('win-show-btn'); }
function toggleWinModal() {
  if (state !== S.WIN || winModalTimer > 0) return;
  if (winModalVisible) hideWinModal(); else showWinModal();
}

function goToMenu() {
  // Set before close() so the socket `close` handler does not call goToMenu again.
  state = S.LOBBY;
  try { net?.send({ type: 'leave' }); } catch {}
  try { net?.close(); } catch {}
  hide('hud');
  hide('win-screen');
  hide('win-show-btn');
  // Reset URL
  const url = new URL(location.href);
  url.searchParams.delete('room');
  history.replaceState({}, '', url.toString());
  location.reload();
}

// ─── Main loop ──────────────────────────────────────────────────────────────

function update(dt) {
  renderer.update(dt);

  if (state === S.WIN && !winModalVisible && !winModalHidden) {
    winModalTimer -= dt;
    if (winModalTimer <= 0) showWinModal();
  }

  if (state !== S.PLAYING) {
    // Even when paused/countdown, keep interpolating the opponent so they
    // arrive smoothly at their start cell once we hit PLAYING.
    lerpOpp(dt);
    return;
  }

  // Local prediction for my player
  if (myPlayer && maze) {
    myPlayer.update(dt, myInput, maze, cellSize, offsetX, offsetY, null);
  }

  // Lerp opponent toward latest server position
  lerpOpp(dt);

  // Send input if changed
  maybeSendInput();
}

function lerpOpp(dt) {
  if (!opp) return;
  const k = Math.min(1, dt * 18); // ~55 ms catch-up
  opp.cx += (oppTargetCx - opp.cx) * k;
  opp.cy += (oppTargetCy - opp.cy) * k;
  opp.bumpTimer = Math.max(0, opp.bumpTimer - dt);
}

function maybeSendInput() {
  const s = `${myInput.left ? 1:0}${myInput.right ? 1:0}${myInput.up ? 1:0}${myInput.down ? 1:0}`;
  if (s === lastSentInput) return;
  lastSentInput = s;
  net?.send({ type: 'input', ...myInput });
}

function render() {
  renderer.clear();
  if (state === S.LOBBY || !maze) return;

  const p1FakeWall = serverState?.p1?.fakeWall ?? null;
  const p2FakeWall = serverState?.p2?.fakeWall ?? null;

  renderer.drawMaze(maze, cellSize, offsetX, offsetY, p1FakeWall, p2FakeWall);
  renderer.drawExits(p1Exit.col, p1Exit.row, p2Exit.col, p2Exit.row, cellSize, offsetX, offsetY);

  // Trails
  if (myPlayer) renderer.drawTrail(myPlayer.trail, myPlayer.color);

  // Players — place by slot so P1 renders underneath P2 consistently.
  const me  = myPlayer;
  const them = opp;
  const p1Render = mySlot === 'p1' ? me : them;
  const p2Render = mySlot === 'p2' ? me : them;
  if (p1Render) renderer.drawPlayer(p1Render);
  if (p2Render) renderer.drawPlayer(p2Render);

  if (state === S.WIN) {
    renderer.drawFakeWallsRevealed(cellSize, offsetX, offsetY, [winFakeWalls.p1, winFakeWalls.p2]);
  }

  renderer.drawVignette();

  if (cols >= 37 && me && them) {
    renderer.drawMinimap(maze,
      mySlot === 'p1' ? me : them,
      mySlot === 'p2' ? me : them,
      p1Exit.col, p1Exit.row, p2Exit.col, p2Exit.row,
      cellSize, offsetX, offsetY);
  }

  if (state === S.COUNTDOWN) renderer.drawCountdown(cdValue);

  drawFakeWallToast();
}

function drawFakeWallToast() {
  const now = performance.now();
  if (now > fakeWallToastUntil || !myPlayer) return;
  const remaining = (fakeWallToastUntil - now) / 900;
  const ctx = canvas.getContext('2d');
  ctx.save();
  ctx.globalAlpha = Math.min(1, remaining * 1.4);
  ctx.font = `bold ${Math.max(14, cellSize * 0.55)}px 'Fredoka One', cursive`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const x = myPlayer.cx;
  const y = myPlayer.cy - cellSize * (1.6 - 0.6 * remaining);
  ctx.lineWidth = 4;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.fillStyle   = '#ffd54a';
  ctx.strokeText('FAKE WALL!', x, y);
  ctx.fillText  ('FAKE WALL!', x, y);
  ctx.restore();
}

function loop(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.05);
  lastTs = ts;
  update(dt);
  render();
  requestAnimationFrame(loop);
}

// ─── Input ──────────────────────────────────────────────────────────────────

window.addEventListener('keydown', (e) => {
  audio.resume();

  // Movement: Arrows OR WASD — whichever slot you are, you control one bug.
  switch (e.code) {
    case 'ArrowLeft':  case 'KeyA': myInput.left  = true; break;
    case 'ArrowRight': case 'KeyD': myInput.right = true; break;
    case 'ArrowUp':    case 'KeyW': myInput.up    = true; break;
    case 'ArrowDown':  case 'KeyS': myInput.down  = true; break;
    case 'Space':
      // Always preventDefault first so Space never falls through to a
      // hidden lobby button click or page scroll.
      e.preventDefault();
      if (state === S.PLAYING) {
        net?.send({ type: 'action', action: 'fakeWall' });
      } else if (state === S.WIN) {
        toggleWinModal();
      }
      break;
  }

  if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.code)) e.preventDefault();
});

window.addEventListener('keyup', (e) => {
  switch (e.code) {
    case 'ArrowLeft':  case 'KeyA': myInput.left  = false; break;
    case 'ArrowRight': case 'KeyD': myInput.right = false; break;
    case 'ArrowUp':    case 'KeyW': myInput.up    = false; break;
    case 'ArrowDown':  case 'KeyS': myInput.down  = false; break;
  }
});

// ─── UI listeners ───────────────────────────────────────────────────────────

document.getElementById('next-maze-btn').addEventListener('click',  () => { if (isHost) net?.send({ type: 'next' });   });
document.getElementById('retry-btn').addEventListener('click',      () => { if (isHost) net?.send({ type: 'rematch' }); });
document.getElementById('menu-btn').addEventListener('click',       goToMenu);
document.getElementById('win-hide-btn').addEventListener('click',   hideWinModal);
document.getElementById('win-show-btn').addEventListener('click',   showWinModal);

// ─── Resize ─────────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  renderer.resize();
  if (!maze) return;
  const lay = renderer.layout(cols, rows);
  cellSize = lay.cellSize;
  offsetX  = lay.offsetX;
  offsetY  = lay.offsetY;

  if (myPlayer) {
    const sc = clamp(myPlayer.snapCol, 0, cols - 1);
    const sr = clamp(myPlayer.snapRow, 0, rows - 1);
    myPlayer.reposition(cellCx(sc), cellCy(sr), cellSize);
    myPlayer.setSnap(sc, sr);
  }
  if (opp) {
    const sc = clamp(opp.snapCol, 0, cols - 1);
    const sr = clamp(opp.snapRow, 0, rows - 1);
    opp.cx = cellCx(sc);
    opp.cy = cellCy(sr);
    opp.radius = cellSize * 0.22;
    oppTargetCx = opp.cx;
    oppTargetCy = opp.cy;
  }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function cellCx(col) { return offsetX + col * cellSize + cellSize / 2; }
function cellCy(row) { return offsetY + row * cellSize + cellSize / 2; }
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
