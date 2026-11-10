const E = require('../src/engine.js');
const cell = s => (parseInt(s.slice(1)) - 1) * 15 + (s.toUpperCase().charCodeAt(0) - 65);
const name = c => String.fromCharCode(65 + c % 15) + (Math.floor(c / 15) + 1);
const pos = s => s.split(/\s+/).filter(Boolean).map(cell);
function t(label, moves, att, attToMove, q, maxd, lim) {
  E.ttClear(); E.setPosition(pos(moves));
  const t0 = Date.now(); const r = E.searchWin(att, attToMove, q, maxd, lim || 5e6, 60000);
  console.log(label, r ? `WIN d=${r.d} pv=${r.pv.map(name).join(' ')}` : 'none', `${Date.now() - t0}ms`);
}
t('T1 (expect d=2)', 'H8 A1 I8 A15 J8 O1', 0, true, 0, 6);
t('T2 (expect none)', 'H8 A1 I8 A15', 0, true, 0, 6);
t('T3 (expect none)', 'H8 A1 I8 A15 J8', 0, false, 0, 6);
t('T4 (expect d=2)', 'H8 A1 I8 A15 J8 G8 I9 K8 I10 O15', 0, true, 0, 6);
t('T5 q1 (expect none<=8)', 'H8 H9 I9 A1', 0, true, 1, 8);
t('T5 q2 (C++: d=9 with R=2,K=10)', 'H8 H9 I9 A1', 0, true, 2, 9, 2e7);
t('white attacker (expect d=2)', 'A1 H8 A15 I8 O1 J8 O15', 1, true, 0, 6);
// kinds
E.setPosition(pos('H8 A1 I8 A15 J8 G8 I9 K8 O15 O1'));
console.log('kind I10 (three):', E.moveKind(cell('I10'), 0), ' kind L8?:', E.moveKind(cell('L8'), 0));
E.setPosition(pos('H8 A1 I8 A15 J8 G8 I9 A2 I10 O15'));
console.log('kind I7 :', E.moveKind(cell('I7'), 0), 'kind I11:', E.moveKind(cell('I11'), 0));
