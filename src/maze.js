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

  const stack = [];
  let current = grid[0][0];
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
