export class Player {
  constructor(cx, cy, cellSize, color) {
    this.color        = color;
    this.fakeWall     = null;
    this.fakeWallUsed = false;
    this._init(cx, cy, cellSize);
  }

  _init(cx, cy, cellSize) {
    this.cx        = cx;
    this.cy        = cy;
    this.cellSize  = cellSize;
    this.radius    = cellSize * 0.22;
    // 4 cells/sec → ~250 ms per cell traversal
    this.speed     = cellSize * 4.0;

    this.snapCol   = 0;
    this.snapRow   = 0;
    this.targetCol = 0;
    this.targetRow = 0;
    this.isMoving  = false;

    this.moveDx    = 0;
    this.moveDy    = 0;

    // ── Tap-vs-hold state (OS keyboard-style autorepeat) ────────
    // pressStarted: we've already fired the first cell for this press.
    // repeatMode:   hold-delay passed → subsequent cells fire instantly.
    // holdTime:     seconds the current direction has been held.
    // lastDx/lastDy: to detect direction changes.
    this.pressStarted = false;
    this.repeatMode   = false;
    this.holdTime     = 0;
    this.lastDx       = 0;
    this.lastDy       = 0;

    this.angle      = -Math.PI / 2;
    this.trail      = [];
    this.trailMax   = 18;
    this.trailTimer = 0;
    this.bumpTimer  = 0;
    this.moving     = false;
  }

  reposition(cx, cy, cellSize) { this._init(cx, cy, cellSize); }

  setSnap(col, row) {
    this.snapCol   = col;
    this.snapRow   = row;
    this.targetCol = col;
    this.targetRow = row;
  }

  resetFakeWall() {
    this.fakeWall     = null;
    this.fakeWallUsed = false;
  }

  placeFakeWall(maze) {
    if (this.fakeWallUsed) return false;
    const cols = maze[0].length;
    const rows = maze.length;
    const col  = this.snapCol;
    const row  = this.snapRow;
    if (col < 0 || col >= cols || row < 0 || row >= rows) return false;

    let side;
    const a = this.angle;
    if      (Math.abs(a) < 0.1)               side = 'right';
    else if (Math.abs(a - Math.PI / 2) < 0.1) side = 'bottom';
    else if (Math.abs(a + Math.PI / 2) < 0.1) side = 'top';
    else                                        side = 'left';

    for (const s of [side, 'right', 'left', 'bottom', 'top']) {
      if (canPlaceOn(maze, col, row, s, cols, rows)) {
        this.fakeWall     = { col, row, side: s };
        this.fakeWallUsed = true;
        return true;
      }
    }
    return false;
  }

  update(dt, input, maze, cellSize, offsetX, offsetY, opponentFakeWall) {
    const cols = maze[0].length;
    const rows = maze.length;

    // Hold-delay before continuous-move kicks in. MUST be >= cellTime (~250 ms)
    // or a long tap would trigger a second cell. 0.32 s gives a small buffer.
    const HOLD_DELAY = 0.32;

    // ── 4-directional input — horizontal wins ties ─────────────────────────
    let dx = 0, dy = 0;
    if (input.left)  dx -= 1;
    if (input.right) dx += 1;
    if (input.up)    dy -= 1;
    if (input.down)  dy += 1;
    if (dx !== 0) dy = 0;
    const pressing = dx !== 0 || dy !== 0;

    // ── Track tap-vs-hold state ────────────────────────────────────────────
    // Any key release or direction change resets the "press cycle".
    if (!pressing || dx !== this.lastDx || dy !== this.lastDy) {
      this.pressStarted = false;
      this.repeatMode   = false;
      this.holdTime     = 0;
    }
    this.lastDx = dx;
    this.lastDy = dy;
    if (pressing) this.holdTime += dt;

    // ── Mid-movement: glide toward target ──────────────────────────────────
    if (this.isMoving) {
      const tx   = offsetX + this.targetCol * cellSize + cellSize / 2;
      const ty   = offsetY + this.targetRow * cellSize + cellSize / 2;
      const remX = tx - this.cx;
      const remY = ty - this.cy;
      const rem  = Math.hypot(remX, remY);
      const step = this.speed * dt;

      if (step >= rem) {
        this.cx       = tx;
        this.cy       = ty;
        this.snapCol  = this.targetCol;
        this.snapRow  = this.targetRow;
        this.isMoving = false;
      } else {
        this.cx += (remX / rem) * step;
        this.cy += (remY / rem) * step;
      }
    }

    // ── Idle: decide whether to start the next cell ────────────────────────
    //   First cell of a press  → fires instantly.
    //   Cell 2+ during the initial hold-delay → DOES NOT fire (this is what
    //     guarantees "tap = 1 cell" even if the tap outlasts cell 1).
    //   After hold-delay expires → enter repeatMode, cells fire seamlessly.
    if (!this.isMoving && pressing) {
      let shouldMove = false;

      if (!this.pressStarted) {
        // Fresh key press — fire first cell immediately.
        shouldMove = true;
        this.pressStarted = true;
      } else if (this.repeatMode) {
        // Already in continuous-hold mode — fire next cell seamlessly.
        shouldMove = true;
      } else if (this.holdTime >= HOLD_DELAY) {
        // Hold threshold reached — engage repeat mode from here on.
        shouldMove = true;
        this.repeatMode = true;
      }

      if (shouldMove) {
        if (!this._tryMove(dx, dy, maze, cols, rows, offsetX, offsetY, cellSize, opponentFakeWall)) {
          if (this.bumpTimer <= 0) this.bumpTimer = 0.08;
        }
      }
    }

    this.moving    = this.isMoving;
    this.bumpTimer = Math.max(0, this.bumpTimer - dt);

    this.trailTimer -= dt;
    if (this.trailTimer <= 0 && this.isMoving) {
      this.trailTimer = 0.05;
      this.trail.push({ x: this.cx, y: this.cy });
      if (this.trail.length > this.trailMax) this.trail.shift();
    }
  }

  _tryMove(dx, dy, maze, cols, rows, offsetX, offsetY, cellSize, _oppFW) {
    const newCol = this.snapCol + dx;
    const newRow = this.snapRow + dy;
    if (newCol < 0 || newCol >= cols || newRow < 0 || newRow >= rows) return false;

    const side = dirToSide(dx, dy);
    if (maze[this.snapRow][this.snapCol].walls[side]) return false;
    // Fake walls are passable by both players — they are visual deceptions only.

    this.targetCol = newCol;
    this.targetRow = newRow;
    this.isMoving  = true;
    this.moveDx    = dx;
    this.moveDy    = dy;

    if      (dx > 0) this.angle = 0;
    else if (dx < 0) this.angle = Math.PI;
    else if (dy > 0) this.angle = Math.PI / 2;
    else             this.angle = -Math.PI / 2;

    return true;
  }

  isAtExit(exitCol, exitRow) {
    return this.snapCol === exitCol && this.snapRow === exitRow;
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function dirToSide(dx, dy) {
  if (dx ===  1) return 'right';
  if (dx === -1) return 'left';
  if (dy ===  1) return 'bottom';
  return 'top';
}


function canPlaceOn(maze, col, row, side, cols, rows) {
  if (maze[row][col].walls[side]) return false;
  const nc = col + (side === 'right' ? 1 : side === 'left' ? -1 : 0);
  const nr = row + (side === 'bottom' ? 1 : side === 'top'  ? -1 : 0);
  return nc >= 0 && nc < cols && nr >= 0 && nr < rows;
}
