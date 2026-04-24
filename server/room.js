import { Player } from '../src/player.js';
import { generateFairMaze } from '../src/maze.js';
import { MSG, DIFFICULTIES } from './protocol.js';

// Server tick: 30 Hz authoritative simulation. Player class runs in
// *cell space* (cellSize = 1, offsets = 0), so positions broadcast to
// clients are in cell units. Clients multiply by their own cellSize.
const TICK_HZ           = 30;
const TICK_MS           = 1000 / TICK_HZ;
const COUNTDOWN_STEP_MS = 1000;  // between 3 → 2, 2 → 1, 1 → GO
const GO_HOLD_MS        = 550;   // GO shown before play begins
const EMPTY_TTL_MS      = 60_000; // drop empty rooms after a minute

const PLAYER_COLORS = { p1: '#ff4444', p2: '#4488ff' };

/**
 * One authoritative game room.
 *
 * lifecycle:
 *   'lobby'     — waiting for players / host to start
 *   'countdown' — 3-2-1-GO
 *   'playing'   — race running
 *   'win'       — winner chosen, waiting on host for rematch / next
 */
export class Room {
  constructor(code, onDispose) {
    this.code       = code;
    this.onDispose  = onDispose;
    this.lifecycle  = 'lobby';
    this.difficulty = 'medium';

    // Slots keyed by 'p1' / 'p2'. Each value: { ws, name, input, ready }.
    this.slots = { p1: null, p2: null };
    this.hostId = null; // which ws is host (set to first joiner)

    // Simulation state (set on start).
    this.maze    = null;
    this.cols    = 0;
    this.rows    = 0;
    this.p1Obj   = null;
    this.p2Obj   = null;
    this.p1Start = null; this.p1Exit = null;
    this.p2Start = null; this.p2Exit = null;

    this.cdValue     = 3;
    this.cdNextAt    = 0;
    this.goStartedAt = 0;

    this.winner    = null;
    this.fakeWalls = null;

    this.lastTickAt = 0;
    this.tickTimer  = null;
    this.disposeTimer = null;
    this.tickCount  = 0;
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────

  addConnection(ws, name) {
    if (this.slots.p1 && this.slots.p2) {
      this._sendTo(ws, { type: MSG.ERROR, code: 'room_full', msg: 'Room is full' });
      return null;
    }
    const slot = this.slots.p1 ? 'p2' : 'p1';
    this.slots[slot] = {
      ws,
      name: (name || `Player ${slot === 'p1' ? 1 : 2}`).slice(0, 20),
      input: { left: false, right: false, up: false, down: false },
    };
    if (!this.hostId) this.hostId = ws;
    if (this.disposeTimer) { clearTimeout(this.disposeTimer); this.disposeTimer = null; }

    this._sendTo(ws, {
      type: MSG.JOINED,
      slot,
      code: this.code,
      you:  { name: this.slots[slot].name, color: PLAYER_COLORS[slot] },
      host: ws === this.hostId,
    });
    this._broadcastRoomState();
    return slot;
  }

  removeConnection(ws) {
    const slot = this.slotFor(ws);
    if (!slot) return;

    const otherSlot = slot === 'p1' ? 'p2' : 'p1';
    const hadOther    = !!this.slots[otherSlot];
    const otherWs     = this.slots[otherSlot]?.ws;

    this.slots[slot] = null;

    // If host dropped, promote the remaining player.
    if (this.hostId === ws) {
      this.hostId = otherWs ?? null;
    }

    // Mid-race peer drop → end the race, other player wins.
    if (this.lifecycle === 'countdown' || this.lifecycle === 'playing') {
      this._stopTick();
      if (this.slots[otherSlot]) {
        this._declareWin(otherSlot, { reason: 'peerLeft' });
      } else {
        this.lifecycle = 'lobby';
      }
    } else if (this.lifecycle === 'win' && hadOther) {
      // Post-game: one player went to main menu — end the session for everyone.
      // Rematch/next must not run with a missing opponent.
      if (otherWs?.readyState === 1) {
        this._sendTo(otherWs, { type: MSG.FORCED_MENU, reason: 'peer_menu' });
      }
      this._resetSessionAfterWin();
    }

    this._broadcast({ type: MSG.PEER_LEFT, slot });
    this._broadcastRoomState();

    if (!this.slots.p1 && !this.slots.p2) {
      this._stopTick();
      this.disposeTimer = setTimeout(() => this.onDispose?.(this.code), EMPTY_TTL_MS);
    }
  }

  slotFor(ws) {
    if (this.slots.p1?.ws === ws) return 'p1';
    if (this.slots.p2?.ws === ws) return 'p2';
    return null;
  }

  // ── Message handling ────────────────────────────────────────────────────

  onMessage(ws, msg) {
    const slot = this.slotFor(ws);
    if (!slot) return;

    switch (msg.type) {
      case MSG.INPUT: {
        if (this.lifecycle !== 'playing' && this.lifecycle !== 'countdown') return;
        const s = this.slots[slot];
        if (!s) return;
        s.input.left  = !!msg.left;
        s.input.right = !!msg.right;
        s.input.up    = !!msg.up;
        s.input.down  = !!msg.down;
        break;
      }
      case MSG.ACTION: {
        if (this.lifecycle !== 'playing') return;
        if (msg.action === 'fakeWall') {
          const obj = slot === 'p1' ? this.p1Obj : this.p2Obj;
          if (obj && !obj.fakeWallUsed) obj.placeFakeWall(this.maze);
        }
        break;
      }
      case MSG.START: {
        if (ws !== this.hostId) return;
        if (this.lifecycle !== 'lobby' && this.lifecycle !== 'win') return;
        if (!this.slots.p1 || !this.slots.p2) {
          this._sendTo(ws, { type: MSG.ERROR, code: 'need_two', msg: 'Need two players' });
          return;
        }
        if (msg.difficulty && DIFFICULTIES[msg.difficulty]) {
          this.difficulty = msg.difficulty;
        }
        this._startNewGame({ regenMaze: true });
        break;
      }
      case MSG.SET_DIFFICULTY: {
        if (ws !== this.hostId) return;
        if (this.lifecycle !== 'lobby' && this.lifecycle !== 'win') return;
        if (msg.difficulty && DIFFICULTIES[msg.difficulty]) {
          this.difficulty = msg.difficulty;
          this._broadcastRoomState();
        }
        break;
      }
      case MSG.REMATCH: {
        if (ws !== this.hostId) return;
        if (this.lifecycle !== 'win') return;
        if (!this.slots.p1 || !this.slots.p2) return;
        this._startNewGame({ regenMaze: false });
        break;
      }
      case MSG.NEXT: {
        if (ws !== this.hostId) return;
        if (this.lifecycle !== 'win') return;
        if (!this.slots.p1 || !this.slots.p2) return;
        this._startNewGame({ regenMaze: true });
        break;
      }
      case MSG.LEAVE: {
        this.removeConnection(ws);
        break;
      }
    }
  }

  // ── Game lifecycle ──────────────────────────────────────────────────────

  _startNewGame({ regenMaze }) {
    const cfg = DIFFICULTIES[this.difficulty];
    this.cols = cfg.cols;
    this.rows = cfg.rows;

    if (regenMaze || !this.maze) {
      this.maze = generateFairMaze(cfg.cols, cfg.rows);
    }

    this.p1Start = { col: 0,           row: 0 };
    this.p1Exit  = { col: cfg.cols - 1, row: cfg.rows - 1 };
    this.p2Start = { col: cfg.cols - 1, row: cfg.rows - 1 };
    this.p2Exit  = { col: 0,           row: 0 };

    // Player in cell space: cellSize=1 → positions are col+0.5, row+0.5
    this.p1Obj = new Player(this.p1Start.col + 0.5, this.p1Start.row + 0.5, 1, PLAYER_COLORS.p1);
    this.p1Obj.setSnap(this.p1Start.col, this.p1Start.row);
    this.p2Obj = new Player(this.p2Start.col + 0.5, this.p2Start.row + 0.5, 1, PLAYER_COLORS.p2);
    this.p2Obj.setSnap(this.p2Start.col, this.p2Start.row);
    this.p2Obj.angle = -Math.PI / 2;

    // Clear inputs
    for (const s of [this.slots.p1, this.slots.p2]) {
      if (s) s.input = { left: false, right: false, up: false, down: false };
    }

    this.winner    = null;
    this.fakeWalls = null;
    this.cdValue   = 3;
    this.cdNextAt  = Date.now() + COUNTDOWN_STEP_MS;
    this.goStartedAt = 0;
    this.lifecycle = 'countdown';
    this.tickCount = 0;

    this._broadcast({
      type: MSG.GAME_START,
      difficulty: this.difficulty,
      cols: cfg.cols,
      rows: cfg.rows,
      maze: this.maze,
      p1Start: this.p1Start,
      p1Exit:  this.p1Exit,
      p2Start: this.p2Start,
      p2Exit:  this.p2Exit,
    });
    this._broadcast({ type: MSG.COUNTDOWN, value: this.cdValue });

    this._startTick();
  }

  _startTick() {
    this._stopTick();
    this.lastTickAt = Date.now();
    this.tickTimer = setInterval(() => this._tick(), TICK_MS);
  }

  _stopTick() {
    if (this.tickTimer) { clearInterval(this.tickTimer); this.tickTimer = null; }
  }

  _tick() {
    const now = Date.now();
    const dt  = Math.min((now - this.lastTickAt) / 1000, 0.05);
    this.lastTickAt = now;

    // ── Countdown ────────────────────────────────────────────────────────
    if (this.lifecycle === 'countdown') {
      if (this.goStartedAt === 0) {
        if (now >= this.cdNextAt) {
          this.cdValue--;
          if (this.cdValue >= 0) {
            this._broadcast({ type: MSG.COUNTDOWN, value: this.cdValue });
            this.cdNextAt = now + COUNTDOWN_STEP_MS;
          }
          if (this.cdValue === 0) {
            this.goStartedAt = now;
            this.cdNextAt = now + GO_HOLD_MS;
          }
        }
      }
      if (this.goStartedAt && now >= this.cdNextAt) {
        this.lifecycle = 'playing';
      }
      this._broadcastState();
      return;
    }

    // ── Playing ──────────────────────────────────────────────────────────
    if (this.lifecycle === 'playing') {
      // Advance both players with a shared Player.update step.
      this.p1Obj.update(dt, this.slots.p1?.input ?? zeroInput(), this.maze, 1, 0, 0, null);
      this.p2Obj.update(dt, this.slots.p2?.input ?? zeroInput(), this.maze, 1, 0, 0, null);

      const p1Won = this.p1Obj.isAtExit(this.p1Exit.col, this.p1Exit.row);
      const p2Won = this.p2Obj.isAtExit(this.p2Exit.col, this.p2Exit.row);

      if (p1Won || p2Won) {
        const winner = p1Won && !p2Won ? 'p1' : p2Won && !p1Won ? 'p2' : 'p1';
        this._declareWin(winner, { reason: 'exit' });
        return;
      }

      this.tickCount++;
      this._broadcastState();
      return;
    }
  }

  _declareWin(winnerSlot, { reason }) {
    this.lifecycle = 'win';
    this.winner    = winnerSlot;
    this.fakeWalls = {
      p1: this.p1Obj?.fakeWall ?? null,
      p2: this.p2Obj?.fakeWall ?? null,
    };
    this._stopTick();
    this._broadcast({
      type:      MSG.WIN,
      winner:    winnerSlot,
      reason,
      fakeWalls: this.fakeWalls,
      finalTick: this.tickCount,
    });
    this._broadcastRoomState();
  }

  // ── Broadcasting ────────────────────────────────────────────────────────

  _broadcastState() {
    const snap = {
      type: MSG.STATE,
      tick: this.tickCount,
      p1:   this._snapshotPlayer(this.p1Obj),
      p2:   this._snapshotPlayer(this.p2Obj),
      lifecycle: this.lifecycle,
    };
    this._broadcast(snap);
  }

  _snapshotPlayer(p) {
    if (!p) return null;
    return {
      col:    p.snapCol,
      row:    p.snapRow,
      tCol:   p.targetCol,
      tRow:   p.targetRow,
      cx:     p.cx,
      cy:     p.cy,
      angle:  p.angle,
      moving: p.isMoving,
      bumped: p.bumpTimer > 0,
      fakeWall: p.fakeWall,
      fakeWallUsed: p.fakeWallUsed,
    };
  }

  _broadcastRoomState() {
    const slots = ['p1', 'p2'].map(slot => {
      const s = this.slots[slot];
      if (!s) return { slot, empty: true };
      return {
        slot,
        name:  s.name,
        host:  s.ws === this.hostId,
        color: PLAYER_COLORS[slot],
      };
    });
    const msg = {
      type: MSG.ROOM_STATE,
      code: this.code,
      lifecycle: this.lifecycle,
      difficulty: this.difficulty,
      slots,
      canStart: !!(this.slots.p1 && this.slots.p2)
              && (this.lifecycle === 'lobby' || this.lifecycle === 'win'),
    };
    this._broadcast(msg);
  }

  _broadcast(msg) {
    const s = JSON.stringify(msg);
    for (const slot of ['p1', 'p2']) {
      const peer = this.slots[slot];
      if (peer && peer.ws.readyState === 1) peer.ws.send(s);
    }
  }

  _sendTo(ws, msg) {
    if (ws.readyState === 1) ws.send(JSON.stringify(msg));
  }

  /** Clear win / game state so the room is back in lobby (no dangling rematch). */
  _resetSessionAfterWin() {
    this._stopTick();
    this.lifecycle = 'lobby';
    this.winner     = null;
    this.fakeWalls  = null;
    this.maze       = null;
    this.p1Obj      = null;
    this.p2Obj      = null;
    this.tickCount  = 0;
    this.cdValue    = 3;
    this.goStartedAt = 0;
  }
}

function zeroInput() {
  return { left: false, right: false, up: false, down: false };
}
