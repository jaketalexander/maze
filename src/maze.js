/**
 * Maze generation via recursive backtracker (depth-first search).
 * Each cell: { col, row, walls: { top, right, bottom, left } }
 */
export function generateMaze(cols, rows) {
  const grid = Array.from({ length: rows }, (_, row) =>
    Array.from({ length: cols }, (_, col) => ({
      col,
      row,
      walls: { top: true, right: true, bottom: true, left: true },
      visited: false,
    }))
  );

  // Random root — always starting carve at (0,0) biases local topology toward
  // that corner (red) vs bottom-right (blue). Any cell works for a spanning tree.
  const stack = [];
  const startCol = Math.floor(Math.random() * cols);
  const startRow = Math.floor(Math.random() * rows);
  let current = grid[startRow][startCol];
  current.visited = true;
  let visitedCount = 1;
  const total = rows * cols;

  while (visitedCount < total) {
    const neighbors = unvisitedNeighbors(current, grid, cols, rows);
    if (neighbors.length > 0) {
      const next = neighbors[Math.floor(Math.random() * neighbors.length)];
      stack.push(current);
      carve(current, next);
      current = next;
      current.visited = true;
      visitedCount++;
    } else if (stack.length > 0) {
      current = stack.pop();
    }
  }

  // Strip generation-only data
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      delete grid[r][c].visited;
    }
  }

  return grid;
}

function unvisitedNeighbors(cell, grid, cols, rows) {
  const { col, row } = cell;
  const out = [];
  if (row > 0       && !grid[row - 1][col].visited) out.push(grid[row - 1][col]);
  if (col < cols-1  && !grid[row][col + 1].visited) out.push(grid[row][col + 1]);
  if (row < rows-1  && !grid[row + 1][col].visited) out.push(grid[row + 1][col]);
  if (col > 0       && !grid[row][col - 1].visited) out.push(grid[row][col - 1]);
  return out;
}

function carve(a, b) {
  const dx = b.col - a.col;
  const dy = b.row - a.row;
  if (dx ===  1) { a.walls.right  = false; b.walls.left   = false; }
  if (dx === -1) { a.walls.left   = false; b.walls.right  = false; }
  if (dy ===  1) { a.walls.bottom = false; b.walls.top    = false; }
  if (dy === -1) { a.walls.top    = false; b.walls.bottom = false; }
}

// ─── Fairness: dead-end stems near each start ───────────────────────────────
// A perfect maze is a tree. Each leaf (deg 1) sits at the tip of a dead-end
// corridor. Walk from the leaf until the first junction (deg ≥ 3); that edge
// count is the stem length. Sum stem lengths for every leaf whose *junction*
// lies within BFS distance k of `start`, excluding the two race spawn corners
// so they are never mistaken for dead-end tips.

function openNeighbors(maze, cols, rows, c, r) {
  const w = maze[r][c].walls;
  const out = [];
  if (!w.top    && r > 0)        out.push([c, r - 1]);
  if (!w.right  && c < cols - 1) out.push([c + 1, r]);
  if (!w.bottom && r < rows - 1) out.push([c, r + 1]);
  if (!w.left   && c > 0)        out.push([c - 1, r]);
  return out;
}

function bfsDist(maze, cols, rows, sc, sr) {
  const dist = Array.from({ length: rows }, () => Array(cols).fill(-1));
  const q = [[sc, sr]];
  dist[sr][sc] = 0;
  for (let i = 0; i < q.length; i++) {
    const [c, r] = q[i];
    const d = dist[r][c];
    for (const [nc, nr] of openNeighbors(maze, cols, rows, c, r)) {
      if (dist[nr][nc] === -1) {
        dist[nr][nc] = d + 1;
        q.push([nc, nr]);
      }
    }
  }
  return dist;
}

/** @returns {{ junctionCol: number, junctionRow: number, stemLen: number } | null} */
function stemFromLeaf(maze, cols, rows, leafC, leafR) {
  const startNs = openNeighbors(maze, cols, rows, leafC, leafR);
  if (startNs.length !== 1) return null;

  let c = startNs[0][0];
  let r = startNs[0][1];
  let stem = 1;
  let pc = leafC;
  let pr = leafR;

  for (;;) {
    const ns = openNeighbors(maze, cols, rows, c, r);
    if (ns.length >= 3) {
      return { junctionCol: c, junctionRow: r, stemLen: stem };
    }
    if (ns.length === 2) {
      const nx = ns.find(([x, y]) => x !== pc || y !== pr);
      if (!nx) return { junctionCol: c, junctionRow: r, stemLen: stem };
      stem++;
      pc = c;
      pr = r;
      c = nx[0];
      r = nx[1];
      continue;
    }
    return { junctionCol: c, junctionRow: r, stemLen: stem };
  }
}

function isRaceSpawnCorner(c, r, cols, rows) {
  return (c === 0 && r === 0) || (c === cols - 1 && r === rows - 1);
}

function sumDeadEndStemLengthsWithinK(maze, cols, rows, startCol, startRow, k) {
  const dist = bfsDist(maze, cols, rows, startCol, startRow);
  let sum = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if (isRaceSpawnCorner(c, r, cols, rows)) continue;
      if (openNeighbors(maze, cols, rows, c, r).length !== 1) continue;
      const info = stemFromLeaf(maze, cols, rows, c, r);
      if (!info) continue;
      const jd = dist[info.junctionRow][info.junctionCol];
      if (jd >= 0 && jd <= k) sum += info.stemLen;
    }
  }
  return sum;
}

const FAIR_K_FRAC     = 0.32; // k scales with maze size
const FAIR_MAX_TRIES  = 55;
const FAIR_TOL_FRAC   = 0.18; // allow |Δ| ≤ max(3, 18% of larger side metric)

/**
 * Generate a maze and reject until dead-end "temptation mass" near each spawn
 * is roughly balanced: sum of dead-end stem lengths (leaf → first junction)
 * whose junction lies within k steps of that player's start.
 */
export function generateFairMaze(cols, rows) {
  const k = Math.max(6, Math.min(14, Math.floor(Math.min(cols, rows) * FAIR_K_FRAC)));

  let bestMaze = null;
  let bestDiff = Infinity;

  for (let t = 0; t < FAIR_MAX_TRIES; t++) {
    const maze = generateMaze(cols, rows);
    const s1 = sumDeadEndStemLengthsWithinK(maze, cols, rows, 0, 0, k);
    const s2 = sumDeadEndStemLengthsWithinK(maze, cols, rows, cols - 1, rows - 1, k);
    const diff = Math.abs(s1 - s2);
    const tol = Math.max(3, Math.round(FAIR_TOL_FRAC * Math.max(s1, s2, 1)));

    if (diff <= tol) return maze;
    if (diff < bestDiff) {
      bestDiff = diff;
      bestMaze = maze;
    }
  }
  return bestMaze;
}
