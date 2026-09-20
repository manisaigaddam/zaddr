export const MOVE_MS = 20_000;
export const GAME_MS = 5 * 60_000;
export const REJOIN_MS = 60_000;

export function lines(b) {
  const L = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8],
    [0, 3, 6], [1, 4, 7], [2, 5, 8],
    [0, 4, 8], [2, 4, 6],
  ];
  for (const [a, c, d] of L) {
    if (b[a] && b[a] === b[c] && b[a] === b[d]) return b[a];
  }
  return null;
}

export function result(b) {
  const w = lines(b);
  if (w) return w;
  if (b.every(Boolean)) return "D";
  return null;
}

export function cpuMove(board, ai = "O", human = "X") {
  if (Math.random() < 0.25) {
    const open = board.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    return open[Math.floor(Math.random() * open.length)];
  }
  return minimax(board, ai, human, true).i;
}

function minimax(board, ai, human, maxing) {
  const w = result(board);
  if (w === ai) return { s: 10, i: -1 };
  if (w === human) return { s: -10, i: -1 };
  if (w === "D") return { s: 0, i: -1 };
  let best = maxing ? { s: -99, i: 0 } : { s: 99, i: 0 };
  for (let i = 0; i < 9; i++) {
    if (board[i]) continue;
    board[i] = maxing ? ai : human;
    const r = minimax(board, ai, human, !maxing);
    board[i] = null;
    if (maxing ? r.s > best.s : r.s < best.s) best = { s: r.s, i };
  }
  return best;
}
