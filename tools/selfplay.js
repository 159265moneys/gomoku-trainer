const E = require('../src/engine.js');
const name = c => String.fromCharCode(65 + c % 15) + (Math.floor(c / 15) + 1);
function five(moves) { // check win for last mover
  const n = moves.length; if (!n) return false; const last = moves[n - 1], col = (n - 1) % 2;
  const set = new Set(moves.filter((_, i) => i % 2 === col));
  const x = last % 15, y = Math.floor(last / 15);
  for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
    let k = 1;
    for (let s = 1; s < 5; s++) { const xx = x + dx * s, yy = y + dy * s; if (xx < 0 || xx > 14 || yy < 0 || yy > 14 || !set.has(yy * 15 + xx)) break; k++; }
    for (let s = 1; s < 5; s++) { const xx = x - dx * s, yy = y - dy * s; if (xx < 0 || xx > 14 || yy < 0 || yy > 14 || !set.has(yy * 15 + xx)) break; k++; }
    if (k >= 5) return true;
  }
  return false;
}
function game(lb, lw, verbose) {
  const moves = []; let maxT = 0, sumT = 0;
  while (moves.length < 120) {
    const side = moves.length % 2 === 0 ? 1 : 2, lvl = side === 1 ? lb : lw;
    E.setPosition(moves); const t0 = Date.now(); const r = E.chooseMove(side, lvl, false); const dt = Date.now() - t0;
    maxT = Math.max(maxT, dt); sumT += dt;
    if (r.move < 0 || moves.includes(r.move)) { console.log('ILLEGAL', r); return null; }
    moves.push(r.move);
    if (verbose) console.log(moves.length, side === 1 ? 'B' : 'W', name(r.move), r.why, r.winIn || '', dt + 'ms');
    if (five(moves)) return { winner: side, n: moves.length, maxT, avgT: Math.round(sumT / moves.length), moves };
  }
  return { winner: 0, n: moves.length, maxT, avgT: Math.round(sumT / moves.length), moves };
}
const [lb, lw, reps, verbose] = process.argv.slice(2).map(Number);
let bw = 0, ww = 0, dr = 0;
for (let i = 0; i < reps; i++) {
  const g = game(lb, lw, verbose && i === 0);
  if (!g) break;
  if (g.winner === 1) bw++; else if (g.winner === 2) ww++; else dr++;
  console.log(`B(L${lb}) vs W(L${lw}): winner=${['draw', 'B', 'W'][g.winner]} moves=${g.n} maxT=${g.maxT}ms avgT=${g.avgT}ms :: ${g.moves.map(name).join(' ')}`);
}
console.log(`TOTAL B=${bw} W=${ww} draw=${dr}`);
