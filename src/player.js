/**
 * Tile-based player — always moves center-to-center like Pac-Man.
 * The player pixel position interpolates between cell centres;
 * it is NEVER off-grid.
 */
export class Player {
  constructor(cx, cy, cellSize, color) {
    this.color        = color;
    this.fakeWall     = null;
    this.fakeWallUsed = false;
    this._init(cx, cy, cellSize);
  }

  _init(cx, cy, cellSize) {
    this.cx       = cx;
    this.cy       = cy;
    this.cellSize = cellSize;
    this.radius   = cellSize * 0.22;
    this.speed    = cellSize * 6.0; // px per second (cell-to-cell travel)

    // The cell the player currently occupies (or just left from)
    this.snapCol = Math.round((cx - 0) / cellSize - 0.5); // rough; reposition corrects it
    this.snapRow = Math.round((cy - 0) / cellSize - 0.5);

    // The cell the player is currently heading toward
    this.targetCol = this.snapCol;
    this.targetRow = this.snapRow;
    this.isMoving  = false;

    // Queued input buffer
    this.queuedDx = 0;
    this.queuedDy = 0;
    this.queueAge = 0;

    // Direction currently being travelled (used as straight-ahead fallback)
    this.moveDx = 0;
    this.moveDy = 0;

    // Facing angle (snaps to cardinal directions)
    this.angle = -Math.PI / 2; // facing up by default

    this.trail      = [];
    this.trailMax   = 18;
    this.trailTimer = 0;
    this.bumpTimer  = 0;
    this.moving     = false;
  }

  /** Called after a resize or restart — snaps cx/cy to a known cell centre. */
  reposition(cx, cy, cellSize) {
    this.cx       = cx;
    this.cy       = cy;
    this.cellSize = cellSize;
    this.radius   = cellSize * 0.22;
    this.speed    = cellSize * 6.0;
    this.isMoving = false;
    this.trail    = [];
    this.trailTimer = 0;
    this.bumpTimer  = 0;
    this.queuedDx  = 0;
    this.queuedDy  = 0;
    this.queueAge  = 0;
    this.moveDx    = 0;
    this.moveDy    = 0;
    // snap and target will be set properly by the caller via setSnap()
  }

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

  placeFakeWall(maze, cellSize, offsetX, offsetY) {
    if (this.fakeWallUsed) return false;
    const cols = maze[0].length;
    const rows = maze.length;
    const col  = this.snapCol;
    const row  = this.snapRow;
    if (col < 0 || col >= cols || row < 0 || row >= rows) return false;

    // Prefer the direction the player is currently facing
    let side;
    const a = this.angle;
    if      (Math.abs(a) < 0.1)                  side = 'right';
    else if (Math.abs(a - Math.PI / 2)  < 0.1)   side = 'bottom';
    else if (Math.abs(a + Math.PI / 2)  < 0.1)   side = 'top';
    else                                           side = 'left';

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

    // ── 4-directional input (horizontal takes priority) ──────────────
    let dx = 0, dy = 0;
    if (input.left)  dx -= 1;
    if (input.right) dx += 1;
    if (input.up)    dy -= 1;
    if (input.down)  dy += 1;
    if (dx !== 0) dy = 0;

    const pressing = dx !== 0 || dy !== 0;

    // ── Update input buffer (queue a direction with a short time window) ─
    if (pressing) {
      this.queuedDx  = dx;
      this.queuedDy  = dy;
      this.queueAge  = 0;          // reset buffer timer on any keypress
    } else {
      this.queueAge += dt;
      if (this.queueAge > 0.25) {  // clear buffer 250 ms after key release
        this.queuedDx = 0;
        this.queuedDy = 0;
      }
    }

    // ── If mid-movement: interpolate toward target cell centre ────────
    if (this.isMoving) {
      const tx   = offsetX + this.targetCol * cellSize + cellSize / 2;
      const ty   = offsetY + this.targetRow * cellSize + cellSize / 2;
      const remX = tx - this.cx;
      const remY = ty - this.cy;
      const rem  = Math.hypot(remX, remY);
      const step = this.speed * dt;

      if (step >= rem) {
        // Arrived at target cell
        this.cx       = tx;
        this.cy       = ty;
        this.snapCol  = this.targetCol;
        this.snapRow  = this.targetRow;
        this.isMoving = false;

        const qdx = this.queuedDx;
        const qdy = this.queuedDy;

        // 1. Try the buffered/queued direction
        if ((qdx !== 0 || qdy !== 0) &&
            this._tryMove(qdx, qdy, maze, cols, rows, offsetX, offsetY, cellSize, opponentFakeWall)) {
          // turned or continued — good
        }
        // 2. Queued direction was blocked (or nothing queued) → keep going straight
        else if (!this.isMoving && (this.moveDx !== 0 || this.moveDy !== 0)) {
          this._tryMove(this.moveDx, this.moveDy, maze, cols, rows, offsetX, offsetY, cellSize, opponentFakeWall);
        }

        // Clear the buffer after it has been consumed
        if (!pressing) {
          this.queuedDx = 0;
          this.queuedDy = 0;
        }
      } else {
        // Still travelling
        this.cx += (remX / rem) * step;
        this.cy += (remY / rem) * step;
      }

    } else {
      // ── Idle at a cell centre: respond to input immediately ─────────
      if (pressing) {
        if (!this._tryMove(dx, dy, maze, cols, rows, offsetX, offsetY, cellSize, opponentFakeWall)) {
          // Blocked — small visual bump
          if (this.bumpTimer <= 0) this.bumpTimer = 0.08;
        }
      }
    }

    this.moving = this.isMoving;
    this.bumpTimer = Math.max(0, this.bumpTimer - dt);

    // Trail
    this.trailTimer -= dt;
    if (this.trailTimer <= 0 && this.isMoving) {
      this.trailTimer = 0.05;
      this.trail.push({ x: this.cx, y: this.cy });
      if (this.trail.length > this.trailMax) this.trail.shift();
    }
  }

  /** Attempt to move one cell in direction (dx,dy). Returns true if successful. */
  _tryMove(dx, dy, maze, cols, rows, offsetX, offsetY, cellSize, oppFW) {
    const newCol = this.snapCol + dx;
    const newRow = this.snapRow + dy;
    if (newCol < 0 || newCol >= cols || newRow < 0 || newRow >= rows) return false;

    const side = dirToSide(dx, dy);
    if (maze[this.snapRow][this.snapCol].walls[side]) return false;
    if (matchesFW(oppFW, this.snapCol, this.snapRow, side)) return false;

    this.targetCol = newCol;
    this.targetRow = newRow;
    this.isMoving  = true;
    this.moveDx    = dx;
    this.moveDy    = dy;

    // Snap angle to movement direction
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

function matchesFW(fw, col, row, side) {
  if (!fw) return false;
  if (fw.col === col && fw.row === row && fw.side === side) return true;
  if (side === 'right'  && fw.col === col+1 && fw.row === row   && fw.side === 'left')   return true;
  if (side === 'left'   && fw.col === col-1 && fw.row === row   && fw.side === 'right')  return true;
  if (side === 'bottom' && fw.col === col   && fw.row === row+1 && fw.side === 'top')    return true;
  if (side === 'top'    && fw.col === col   && fw.row === row-1 && fw.side === 'bottom') return true;
  return false;
}

function canPlaceOn(maze, col, row, side, cols, rows) {
  if (maze[row][col].walls[side]) return false;
  const nc = col + (side === 'right' ? 1 : side === 'left' ? -1 : 0);
  const nr = row + (side === 'bottom' ? 1 : side === 'top'  ? -1 : 0);
  return nc >= 0 && nc < cols && nr >= 0 && nr < rows;
}
