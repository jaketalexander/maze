export const HUD_HEIGHT = 64;

// ─── colours ─────────────────────────────────────────────────────────────────
const PATH_COLOR  = '#080806';   // near-black path floor

const EXIT_P1_COLOR = '#ff5555';
const EXIT_P2_COLOR = '#5588ff';

// ─── Renderer ─────────────────────────────────────────────────────────────────
export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.pulse  = 0;
    this._mazeCache   = null;
    this._dirtPattern = this._buildDirtPattern();
  }

  /** 80×80 earthy dirt tile — kept for background surround. */
  _buildDirtPattern() {
    const SIZE = 80;
    const oc   = document.createElement('canvas');
    oc.width = oc.height = SIZE;
    const c = oc.getContext('2d');
    c.fillStyle = '#7a5028';
    c.fillRect(0, 0, SIZE, SIZE);

    let s = 1337;
    const rnd = () => { s = (s * 1664525 + 1013904223) & 0xffffffff; return (s >>> 0) / 0xffffffff; };

    const blobColors = ['#6b4420','#8c5e30','#5a3610','#9a6a38','#6e4824','#a07035','#4e2e0c'];
    for (let i = 0; i < 60; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      const r = 1 + rnd() * 4;
      c.fillStyle = blobColors[Math.floor(rnd() * blobColors.length)];
      c.beginPath();
      c.ellipse(x, y, r, r * (0.5 + rnd() * 0.8), rnd() * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
    for (let i = 0; i < 18; i++) {
      const x = rnd() * SIZE;
      const y = rnd() * SIZE;
      c.fillStyle = `rgba(200,160,90,${0.15 + rnd() * 0.25})`;
      c.fillRect(x, y, 1 + Math.floor(rnd() * 2), 1 + Math.floor(rnd() * 2));
    }
    return this.ctx.createPattern(oc, 'repeat');
  }

  resize() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
    this._mazeCache    = null; // invalidate cache on resize
  }

  layout(cols, rows) {
    const availW = this.canvas.width;
    const availH = this.canvas.height - HUD_HEIGHT;
    const cellSize = Math.floor(Math.min(availW / cols, availH / rows) * 0.93);
    const mazeW  = cols * cellSize;
    const mazeH  = rows * cellSize;
    const offsetX = Math.floor((availW - mazeW) / 2);
    const offsetY = Math.floor(HUD_HEIGHT + (availH - mazeH) / 2);
    return { cellSize, offsetX, offsetY };
  }

  update(dt) { this.pulse += dt; }

  clear() {
    const { ctx, canvas } = this;
    ctx.fillStyle = this._dirtPattern;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawMaze(maze, cellSize, offsetX, offsetY, p1FakeWall, p2FakeWall) {
    const { ctx } = this;
    const cols  = maze[0].length;
    const rows  = maze.length;
    const mazeW = cols * cellSize;
    const mazeH = rows * cellSize;
    const wt    = Math.max(3, Math.round(cellSize * 0.22));

    // ── 1. Solid bright green wall fill ──────────────────────────────────────
    ctx.fillStyle = '#2ec820';
    ctx.fillRect(offsetX, offsetY, mazeW, mazeH);

    // ── 2. Carve near-black paths ─────────────────────────────────────────────
    ctx.fillStyle = PATH_COLOR;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        ctx.fillRect(
          offsetX + c * cellSize + wt,
          offsetY + r * cellSize + wt,
          cellSize - 2 * wt,
          cellSize - 2 * wt
        );
      }
    }

    // ── 3. Open passage connectors ────────────────────────────────────────────
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = maze[r][c];
        const x    = offsetX + c * cellSize;
        const y    = offsetY + r * cellSize;

        if (c < cols - 1 && !cell.walls.right
            && !hasFW(p1FakeWall, c, r, 'right')
            && !hasFW(p2FakeWall, c, r, 'right')) {
          ctx.fillRect(x + cellSize - wt, y + wt, 2 * wt, cellSize - 2 * wt);
        }
        if (r < rows - 1 && !cell.walls.bottom
            && !hasFW(p1FakeWall, c, r, 'bottom')
            && !hasFW(p2FakeWall, c, r, 'bottom')) {
          ctx.fillRect(x + wt, y + cellSize - wt, cellSize - 2 * wt, 2 * wt);
        }
      }
    }

    // ── 4. Single thin bright outline on the very top of the maze ────────────
    //    (matches the top-lit look in the reference without any per-cell grid)
    ctx.fillStyle = 'rgba(140,255,80,0.5)';
    ctx.fillRect(offsetX, offsetY, mazeW, Math.max(2, Math.round(cellSize * 0.07)));

    // ── 5. Outer border ───────────────────────────────────────────────────────
    ctx.strokeStyle = '#0a380a';
    ctx.lineWidth   = 3;
    ctx.strokeRect(offsetX, offsetY, mazeW, mazeH);
  }

  drawExits(p1ExitCol, p1ExitRow, p2ExitCol, p2ExitRow, cellSize, offsetX, offsetY) {
    const pulse = 0.6 + 0.4 * Math.sin(this.pulse * 3.5);
    this._drawExit(p1ExitCol, p1ExitRow, cellSize, offsetX, offsetY, EXIT_P1_COLOR, 'P1 EXIT', pulse);
    this._drawExit(p2ExitCol, p2ExitRow, cellSize, offsetX, offsetY, EXIT_P2_COLOR, 'P2 EXIT', pulse);
  }

  _drawExit(col, row, cellSize, offsetX, offsetY, color, label, alpha) {
    const { ctx } = this;
    const x   = offsetX + col * cellSize;
    const y   = offsetY + row * cellSize;
    const wt  = Math.max(3, Math.round(cellSize * 0.23));
    const pad = wt + 1;

    ctx.save();
    ctx.globalAlpha = alpha * 0.45;
    ctx.fillStyle   = color;
    ctx.fillRect(x + pad, y + pad, cellSize - 2 * pad, cellSize - 2 * pad);
    ctx.globalAlpha = alpha;
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2;
    ctx.shadowColor = color;
    ctx.shadowBlur  = 12;
    ctx.strokeRect(x + pad, y + pad, cellSize - 2 * pad, cellSize - 2 * pad);
    ctx.shadowBlur  = 0;

    if (cellSize >= 20) {
      const fs = Math.max(6, cellSize * 0.17);
      ctx.fillStyle    = color;
      ctx.font         = `700 ${fs}px "Nunito", Arial, sans-serif`;
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor  = color;
      ctx.shadowBlur   = 8;
      ctx.fillText(label, x + cellSize / 2, y + cellSize / 2);
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  drawTrail(trail, color) {
    const { ctx } = this;
    if (trail.length < 2) return;
    for (let i = 0; i < trail.length; i++) {
      const t     = i / trail.length;
      const alpha = t * 0.45;
      ctx.beginPath();
      ctx.arc(trail[i].x, trail[i].y, 2.5 * t + 0.5, 0, Math.PI * 2);
      ctx.fillStyle = colorAlpha(color, alpha);
      ctx.fill();
    }
  }

  /** Draws a cute ladybug facing the player's current angle. */
  drawPlayer(player) {
    const { ctx } = this;
    const { cx, cy, radius: r, angle, color, bumpTimer } = player;

    // Slight squish when bumping a wall
    const squishX = bumpTimer > 0 ? 0.80 : 1;
    const squishY = bumpTimer > 0 ? 1.18 : 1;

    ctx.save();
    ctx.translate(cx, cy);
    // angle: 0=right, π/2=down, π=left, -π/2=up
    // Ladybug head points "up" in local space (-y), so we add π/2 to align
    ctx.rotate(angle + Math.PI / 2);
    ctx.scale(squishX, squishY);

    // ── Shell (body) ──
    ctx.shadowColor = color;
    ctx.shadowBlur  = 10;
    ctx.fillStyle   = color;
    ctx.beginPath();
    ctx.ellipse(0, r * 0.12, r * 0.88, r * 1.05, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur  = 0;

    // ── Elytra split line ──
    ctx.strokeStyle = 'rgba(0,0,0,0.65)';
    ctx.lineWidth   = Math.max(0.8, r * 0.16);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.82);
    ctx.lineTo(0,  r * 1.02);
    ctx.stroke();

    // ── Spots (2 per wing) ──
    ctx.fillStyle = 'rgba(0,0,0,0.7)';
    const sr = r * 0.21;
    for (const [sx, sy] of [
      [-0.42, -0.22], [0.42, -0.22],
      [-0.48,  0.42], [0.48,  0.42],
    ]) {
      ctx.beginPath();
      ctx.arc(sx * r, sy * r, sr, 0, Math.PI * 2);
      ctx.fill();
    }

    // ── Head ──
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.ellipse(0, -r * 1.08, r * 0.40, r * 0.44, 0, 0, Math.PI * 2);
    ctx.fill();

    // ── Eyes ──
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(-r * 0.17, -r * 1.04, r * 0.10, 0, Math.PI * 2);
    ctx.arc( r * 0.17, -r * 1.04, r * 0.10, 0, Math.PI * 2);
    ctx.fill();

    // ── Eye pupils ──
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(-r * 0.17, -r * 1.04, r * 0.05, 0, Math.PI * 2);
    ctx.arc( r * 0.17, -r * 1.04, r * 0.05, 0, Math.PI * 2);
    ctx.fill();

    // ── Antennae ──
    const lw = Math.max(0.6, r * 0.08);
    ctx.strokeStyle = '#111';
    ctx.lineWidth   = lw;
    ctx.lineCap     = 'round';
    ctx.beginPath();
    ctx.moveTo(-r * 0.14, -r * 1.38);
    ctx.quadraticCurveTo(-r * 0.25, -r * 1.65, -r * 0.42, -r * 1.78);
    ctx.moveTo( r * 0.14, -r * 1.38);
    ctx.quadraticCurveTo( r * 0.25, -r * 1.65,  r * 0.42, -r * 1.78);
    ctx.stroke();

    // Antenna tips
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(-r * 0.42, -r * 1.78, r * 0.09, 0, Math.PI * 2);
    ctx.arc( r * 0.42, -r * 1.78, r * 0.09, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  drawMinimap(maze, p1, p2, p1ExitCol, p1ExitRow, p2ExitCol, p2ExitRow, cellSize, offsetX, offsetY) {
    const { ctx, canvas } = this;
    const cols = maze[0].length;
    const rows = maze.length;
    const MAP  = Math.min(120, Math.floor(canvas.width * 0.12));
    const mapX = canvas.width  - MAP - 12;
    const mapY = canvas.height - MAP - 12;
    const cw   = MAP / cols;
    const ch   = MAP / rows;

    ctx.save();
    ctx.fillStyle   = 'rgba(20, 8, 2, 0.85)';
    ctx.strokeStyle = 'rgba(90, 55, 15, 0.7)';
    ctx.lineWidth   = 1;
    ctx.fillRect(mapX, mapY, MAP, MAP);
    ctx.strokeRect(mapX, mapY, MAP, MAP);

    // Walls
    ctx.strokeStyle = WALL_COLOR;
    ctx.lineWidth   = Math.max(0.4, cw * 0.5);
    ctx.beginPath();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = maze[r][c];
        const x = mapX + c * cw;
        const y = mapY + r * ch;
        if (cell.walls.top)    { ctx.moveTo(x,      y);  ctx.lineTo(x + cw, y);      }
        if (cell.walls.right)  { ctx.moveTo(x + cw, y);  ctx.lineTo(x + cw, y + ch); }
        if (cell.walls.bottom) { ctx.moveTo(x, y + ch);  ctx.lineTo(x + cw, y + ch); }
        if (cell.walls.left)   { ctx.moveTo(x,      y);  ctx.lineTo(x,      y + ch); }
      }
    }
    ctx.stroke();

    // Exits
    const dotR = Math.max(2, cw * 0.8);
    miniDot(ctx, mapX + (p1ExitCol + 0.5) * cw, mapY + (p1ExitRow + 0.5) * ch, dotR, EXIT_P1_COLOR);
    miniDot(ctx, mapX + (p2ExitCol + 0.5) * cw, mapY + (p2ExitRow + 0.5) * ch, dotR, EXIT_P2_COLOR);

    // Players
    const pr = Math.max(2.5, cw * 1.1);
    miniDot(ctx, mapX + ((p1.cx - offsetX) / (cols * cellSize)) * MAP,
                 mapY + ((p1.cy - offsetY) / (rows * cellSize)) * MAP, pr, p1.color);
    miniDot(ctx, mapX + ((p2.cx - offsetX) / (cols * cellSize)) * MAP,
                 mapY + ((p2.cy - offsetY) / (rows * cellSize)) * MAP, pr, p2.color);

    ctx.restore();
  }

  drawVignette() {
    const { ctx, canvas } = this;
    const grad = ctx.createRadialGradient(
      canvas.width / 2, canvas.height / 2, 0,
      canvas.width / 2, canvas.height / 2, Math.max(canvas.width, canvas.height) * 0.65
    );
    grad.addColorStop(0,   'transparent');
    grad.addColorStop(0.7, 'transparent');
    grad.addColorStop(1,   'rgba(0,0,0,0.45)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  drawCountdown(value) {
    const { ctx, canvas } = this;
    const label = value === 0 ? 'GO!' : String(value);
    const size  = Math.min(canvas.width, canvas.height) * 0.22;
    ctx.save();
    ctx.textAlign    = 'center';
    ctx.textBaseline = 'middle';
    ctx.font         = `400 ${size}px "Fredoka One", "Arial Rounded MT Bold", sans-serif`;
    ctx.fillStyle    = value === 0 ? '#44ff44' : '#ffffff';
    ctx.shadowColor  = value === 0 ? '#44ff44' : '#44cc44';
    ctx.shadowBlur   = 50;
    ctx.fillText(label, canvas.width / 2, canvas.height / 2);
    ctx.restore();
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function hasFW(fw, col, row, side) {
  if (!fw) return false;
  if (fw.col === col && fw.row === row && fw.side === side) return true;
  // mirror pairs
  if (side === 'right'  && fw.col === col + 1 && fw.row === row && fw.side === 'left')   return true;
  if (side === 'left'   && fw.col === col - 1 && fw.row === row && fw.side === 'right')  return true;
  if (side === 'bottom' && fw.col === col && fw.row === row + 1 && fw.side === 'top')    return true;
  if (side === 'top'    && fw.col === col && fw.row === row - 1 && fw.side === 'bottom') return true;
  return false;
}

function colorAlpha(hex, a) {
  // quick rgba from 6-char hex
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8)  & 255;
  const b =  n        & 255;
  return `rgba(${r},${g},${b},${a.toFixed(2)})`;
}

function miniDot(ctx, x, y, r, color) {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.fillStyle   = color;
  ctx.shadowColor = color;
  ctx.shadowBlur  = 5;
  ctx.fill();
  ctx.shadowBlur  = 0;
}
