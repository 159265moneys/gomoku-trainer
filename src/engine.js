'use strict';
// 五目並べ（15路・制限なし・五連以上で勝ち）思考エンジン
// 連続攻め（四・三）による詰み探索 + 形の評価。Web Worker / Node 両対応。
var N = 15, NC = 225, MAXPLY = 160, QMAX = 2, QN = QMAX + 1;
var DX = [1, 0, 1, 1], DY = [0, 1, 1, -1];
var P3 = [1, 3, 9, 27, 81, 243, 729, 2187, 6561];
var tFive = new Uint8Array(19683), tN5 = new Uint8Array(19683), tOwn2 = new Uint8Array(19683), tScore = new Int32Array(19683);
(function () {
  var W = [1, 6, 36, 216, 1296], a = new Array(9), i, j;
  for (var code = 0; code < 19683; code++) {
    var t = code; for (i = 0; i < 9; i++) { a[i] = t % 3; t = (t / 3) | 0; }
    if (a[4] !== 0) continue;
    a[4] = 1;
    var L = 0; for (i = 3; i >= 0 && a[i] === 1; i--) L++;
    var R = 0; for (i = 5; i < 9 && a[i] === 1; i++) R++;
    if (L + R >= 4) tFive[code] = 1;
    var cnt = 0;
    for (i = 0; i < 9; i++) {
      if (i === 4 || a[i] !== 0) continue;
      var l = 0; for (j = i - 1; j >= 0 && a[j] === 1; j--) l++;
      var r = 0; for (j = i + 1; j < 9 && a[j] === 1; j++) r++;
      if (l + r >= 4) cnt++;
    }
    tN5[code] = cnt;
    var sc = 0;
    for (var s = 0; s <= 4; s++) {
      var own = 0, ok = true;
      for (j = s; j < s + 5; j++) { if (a[j] === 2) { ok = false; break; } if (a[j] === 1 && j !== 4) own++; }
      if (ok) { sc += W[own]; if (own >= 2) tOwn2[code] = 1; }
    }
    tScore[code] = sc;
  }
})();

var nb = new Int16Array(NC * 36), rel = new Int16Array(NC * NC), baseCode = new Int32Array(NC * 4), nearList = [];
(function () {
  var i, c, d, xx, yy;
  for (i = 0; i < NC * NC; i++) rel[i] = -1;
  for (c = 0; c < NC; c++) {
    var x = c % N, y = (c / N) | 0;
    for (d = 0; d < 4; d++) {
      var cb = 0;
      for (i = 0; i < 9; i++) {
        xx = x + (i - 4) * DX[d]; yy = y + (i - 4) * DY[d];
        if (xx < 0 || xx >= N || yy < 0 || yy >= N) { nb[c * 36 + d * 9 + i] = -1; if (i !== 4) cb += 2 * P3[i]; }
        else { nb[c * 36 + d * 9 + i] = yy * N + xx; if (i !== 4) rel[c * NC + yy * N + xx] = d * 9 + i; }
      }
      baseCode[c * 4 + d] = cb;
    }
    var nl = [];
    for (var dy = -2; dy <= 2; dy++) for (var dx = -2; dx <= 2; dx++) {
      xx = x + dx; yy = y + dy; if (xx < 0 || xx >= N || yy < 0 || yy >= N) continue; nl.push(yy * N + xx);
    }
    nearList.push(nl);
  }
})();

var bd = new Uint8Array(NC), code = [new Int32Array(NC * 4), new Int32Array(NC * 4)], stonesNear = new Int16Array(NC);
var h1 = 0, h2 = 0, nStones = 0, hist = [];
var Z1 = new Int32Array(3 * NC), Z2 = new Int32Array(3 * NC);
(function () { var s = 0x2545F491; function r() { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return s | 0; } for (var i = 0; i < 3 * NC; i++) { Z1[i] = r(); Z2[i] = r(); } })();

function place(c, col) {
  bd[c] = col; h1 ^= Z1[col * NC + c]; h2 ^= Z2[col * NC + c]; nStones++;
  var co = code[col - 1], cp = code[2 - col];
  for (var d = 0; d < 4; d++) {
    var base = c * 36 + d * 9;
    for (var i = 0; i < 9; i++) { if (i === 4) continue; var e = nb[base + i]; if (e < 0) continue; var p = P3[8 - i]; co[e * 4 + d] += p; cp[e * 4 + d] += 2 * p; }
  }
  var nl = nearList[c]; for (var k = 0; k < nl.length; k++) stonesNear[nl[k]]++;
}
function unplace(c) {
  var col = bd[c]; bd[c] = 0; h1 ^= Z1[col * NC + c]; h2 ^= Z2[col * NC + c]; nStones--;
  var co = code[col - 1], cp = code[2 - col];
  for (var d = 0; d < 4; d++) {
    var base = c * 36 + d * 9;
    for (var i = 0; i < 9; i++) { if (i === 4) continue; var e = nb[base + i]; if (e < 0) continue; var p = P3[8 - i]; co[e * 4 + d] -= p; cp[e * 4 + d] -= 2 * p; }
  }
  var nl = nearList[c]; for (var k = 0; k < nl.length; k++) stonesNear[nl[k]]--;
}
function setPosition(moves) {
  bd.fill(0); code[0].set(baseCode); code[1].set(baseCode); stonesNear.fill(0); h1 = 0; h2 = 0; nStones = 0;
  for (var i = 0; i < moves.length; i++) place(moves[i], (i % 2 === 0) ? 1 : 2);
  hist = moves.slice();
}

var N5 = [new Uint8Array(MAXPLY * NC), new Uint8Array(MAXPLY * NC)], FIVE = new Int16Array(MAXPLY * 8), NFIVE = new Uint8Array(MAXPLY * 2);
function scan(ply) {
  var o = ply * NC, n0 = N5[0], n1 = N5[1], f0 = 0, f1 = 0, c0 = code[0], c1 = code[1], a, b, cc, dd;
  for (var c = 0; c < NC; c++) {
    if (bd[c]) { n0[o + c] = 0; n1[o + c] = 0; continue; }
    var k = c * 4;
    a = c0[k]; b = c0[k + 1]; cc = c0[k + 2]; dd = c0[k + 3];
    if (tFive[a] | tFive[b] | tFive[cc] | tFive[dd]) { if (f0 < 4) FIVE[ply * 8 + f0] = c; f0++; n0[o + c] = 0; }
    else n0[o + c] = tN5[a] + tN5[b] + tN5[cc] + tN5[dd];
    a = c1[k]; b = c1[k + 1]; cc = c1[k + 2]; dd = c1[k + 3];
    if (tFive[a] | tFive[b] | tFive[cc] | tFive[dd]) { if (f1 < 4) FIVE[ply * 8 + 4 + f1] = c; f1++; n1[o + c] = 0; }
    else n1[o + c] = tN5[a] + tN5[b] + tN5[cc] + tN5[dd];
  }
  NFIVE[ply * 2] = f0; NFIVE[ply * 2 + 1] = f1;
}
function createsD(m, ply, p) {
  var cp = code[p], n5 = N5[p], o = ply * NC;
  for (var d = 0; d < 4; d++) {
    if (!tOwn2[cp[m * 4 + d]]) continue;
    var base = m * 36 + d * 9;
    for (var i = 0; i < 9; i++) {
      if (i === 4) continue; var e = nb[base + i]; if (e < 0 || bd[e]) continue;
      var old = cp[e * 4 + d], nw = old + P3[8 - i]; if (tFive[nw]) continue;
      if (n5[o + e] - tN5[old] + tN5[nw] >= 2) return true;
    }
  }
  return false;
}
function heur(c, p) { var a = code[p], k = c * 4; return tScore[a[k]] + tScore[a[k + 1]] + tScore[a[k + 2]] + tScore[a[k + 3]]; }

// ---- 置換表 ----
var TTBITS = 20, TTSIZE = 1 << TTBITS, TTMASK = TTSIZE - 1;
var ttChk = new Int32Array(TTSIZE), ttDat = new Uint8Array(TTSIZE * QN * 3);
var SALT1 = [0x3243F6A8, 0x05A308D3, 0x13198A2E, 0x03707344], SALT2 = [0x24093822, 0x299F31D0, 0x082EFA98, 0x6C4E6C89];
function ttClear() { ttChk.fill(0); ttDat.fill(0); }
function ttProbe(s) { var i = (h1 ^ SALT1[s]) & TTMASK, chk = (h2 ^ SALT2[s]) | 0; if (chk === 0) chk = 1; return ttChk[i] === chk ? i * QN * 3 : -1; }
function ttSlot(s) {
  var i = (h1 ^ SALT1[s]) & TTMASK, chk = (h2 ^ SALT2[s]) | 0; if (chk === 0) chk = 1; var b = i * QN * 3;
  if (ttChk[i] !== chk) { ttChk[i] = chk; for (var k = 0; k < QN * 3; k++) ttDat[b + k] = 0; }
  return b;
}
function storeWin(s, q, d, best) { var b = ttSlot(s); if (ttDat[b + q] === 0 || d < ttDat[b + q]) { ttDat[b + q] = d; if (best >= 0) ttDat[b + 2 * QN + q] = best + 1; } }
function storeFail(s, q, d, best) { var b = ttSlot(s); if (d > 255) d = 255; if (d > ttDat[b + QN + q]) ttDat[b + QN + q] = d; if (best >= 0 && ttDat[b + q] === 0) ttDat[b + 2 * QN + q] = best + 1; }

// ---- 詰み探索（ATT = 攻める側 0:黒 1:白）----
var lastAborted = false, ATT = 0, nodes = 0, nodeLimit = 1e15, deadline = 1e18, aborted = false, Kquiet = 8, OUT = -1;
var histD = new Int32Array(NC), killerA = new Int16Array(MAXPLY).fill(-1);
function desc(x, y) { return y - x; }
function now() { return Date.now(); }

function threatReplies(ply, D) {
  var a = ATT, df = 1 - a, o = ply * NC, na = N5[a], nd = N5[df], ca = code[a], rep = [], mark = {}, c, k;
  for (c = 0; c < NC; c++) if (!bd[c] && nd[o + c] >= 1) { mark[c] = 1; rep.push(c); }
  var e0 = D[0];
  for (k = -1; k < 36; k++) {
    var x;
    if (k < 0) x = e0; else { if (k % 9 === 4) continue; x = nb[e0 * 36 + k]; }
    if (x < 0 || bd[x] || mark[x]) continue;
    var ok = true;
    for (var j = 0; j < D.length && ok; j++) {
      var e = D[j]; if (e === x) continue; var r = rel[e * NC + x]; if (r < 0) { ok = false; break; }
      var d = (r / 9) | 0, i = r % 9, old = ca[e * 4 + d], nw = old + 2 * P3[i];
      if (na[o + e] - tN5[old] + tN5[nw] >= 2) ok = false;
    }
    if (ok) { mark[x] = 1; rep.push(x); }
  }
  return rep;
}
function freeCells() { var out = []; for (var c = 0; c < NC; c++) if (!bd[c] && stonesNear[c] > 0) out.push(c); return out; }

function An(q, d, ply, want) {
  if (aborted) return false;
  if (++nodes > nodeLimit || ((nodes & 1023) === 0 && now() > deadline)) { aborted = true; return false; }
  if (d <= 0 || ply >= MAXPLY - 4) return false;
  var s = ATT * 2, b = ttProbe(s), ttBest = -1, qq, w;
  if (b >= 0) {
    for (qq = 0; qq <= q; qq++) { w = ttDat[b + qq]; if (w && w <= d) { if (!want) return true; if (ttDat[b + 2 * QN + qq]) { OUT = ttDat[b + 2 * QN + qq] - 1; return true; } } }
    if (!want) for (qq = q; qq <= QMAX; qq++) if (ttDat[b + QN + qq] >= d) return false;
    for (qq = q; qq >= 0; qq--) if (ttDat[b + 2 * QN + qq]) { ttBest = ttDat[b + 2 * QN + qq] - 1; break; }
  }
  scan(ply);
  var a = ATT, df = 1 - a, col = a + 1, o = ply * NC, na = N5[a];
  var nfa = NFIVE[ply * 2 + a], nfd = NFIVE[ply * 2 + df], m, r, c, i, sc;
  if (nfa > 0) { m = FIVE[ply * 8 + a * 4]; storeWin(s, 0, 1, m); if (want) OUT = m; return true; }
  if (nfd >= 2) { storeFail(s, QMAX, 255, -1); return false; }
  if (nfd === 1) {
    m = FIVE[ply * 8 + df * 4]; place(m, col); r = Dn(q, d - 1, ply + 1); unplace(m);
    if (aborted) return false;
    if (r) { storeWin(s, q, d, m); if (want) OUT = m; } else storeFail(s, q, d, -1);
    return r;
  }
  if (d < 2) { storeFail(s, QMAX, 1, -1); return false; }
  for (c = 0; c < NC; c++) if (na[o + c] >= 2) { storeWin(s, 0, 2, c); if (want) OUT = c; return true; }
  if (d < 3) { storeFail(s, QMAX, 2, -1); return false; }
  if (q > 0) { if (An(q - 1, d, ply, want)) return true; if (aborted) return false; }
  var mv = [], isT = q > 0 ? new Uint8Array(NC) : null, ca = code[a];
  for (c = 0; c < NC; c++) {
    if (bd[c]) continue;
    if (na[o + c] >= 1) sc = createsD(c, ply, a) ? 3000000 : 1000000;
    else { var k = c * 4; if (!(tOwn2[ca[k]] | tOwn2[ca[k + 1]] | tOwn2[ca[k + 2]] | tOwn2[ca[k + 3]])) continue; if (!createsD(c, ply, a)) continue; sc = 2000000; }
    if (isT) isT[c] = 1;
    sc += heur(c, a); if (c === ttBest) sc += 100000000; if (c === killerA[ply]) sc += 50000000;
    mv.push(sc * 256 + c);
  }
  mv.sort(desc);
  for (i = 0; i < mv.length; i++) {
    c = mv[i] & 255; place(c, col); r = Dn(q, d - 1, ply + 1); unplace(c); if (aborted) return false;
    if (r) { storeWin(s, q, d, c); killerA[ply] = c; if (want) OUT = c; return true; }
  }
  if (q > 0) {
    mv = [];
    for (c = 0; c < NC; c++) {
      if (bd[c] || isT[c] || stonesNear[c] === 0) continue;
      sc = heur(c, a) * 2 + heur(c, df); if (c === ttBest) sc += 100000000; if (c === killerA[ply]) sc += 50000000;
      mv.push(sc * 256 + c);
    }
    mv.sort(desc); var n = Math.min(mv.length, Kquiet);
    for (i = 0; i < n; i++) {
      c = mv[i] & 255; place(c, col); r = Dn(q, d - 1, ply + 1); unplace(c); if (aborted) return false;
      if (r) { storeWin(s, q, d, c); killerA[ply] = c; if (want) OUT = c; return true; }
    }
  }
  storeFail(s, q, d, -1); return false;
}
function Dn(q, d, ply) {
  if (aborted) return false;
  if (++nodes > nodeLimit || ((nodes & 1023) === 0 && now() > deadline)) { aborted = true; return false; }
  if (d <= 0 || ply >= MAXPLY - 4) return false;
  var s = ATT * 2 + 1, b = ttProbe(s), ttBest = -1, qq, w;
  if (b >= 0) {
    for (qq = 0; qq <= q; qq++) { w = ttDat[b + qq]; if (w && w <= d) return true; }
    for (qq = q; qq <= QMAX; qq++) if (ttDat[b + QN + qq] >= d) return false;
    for (qq = q; qq >= 0; qq--) if (ttDat[b + 2 * QN + qq]) { ttBest = ttDat[b + 2 * QN + qq] - 1; break; }
  }
  scan(ply);
  var a = ATT, df = 1 - a, dcol = df + 1, o = ply * NC, na = N5[a];
  var nfa = NFIVE[ply * 2 + a], nfd = NFIVE[ply * 2 + df], x, r, i, c, sc;
  if (nfd > 0) { storeFail(s, QMAX, 255, -1); return false; }
  if (nfa >= 2) { storeWin(s, 0, 1, -1); return true; }
  if (nfa === 1) {
    x = FIVE[ply * 8 + a * 4]; place(x, dcol); r = An(q, d, ply + 1, false); unplace(x); if (aborted) return false;
    if (r) storeWin(s, q, d, x); else storeFail(s, q, d, x);
    return r;
  }
  var D = []; for (c = 0; c < NC; c++) if (na[o + c] >= 2) D.push(c);
  var mv = [];
  if (D.length > 0) {
    if (d < 2) { storeFail(s, QMAX, 1, -1); return false; }
    var rep = threatReplies(ply, D);
    for (i = 0; i < rep.length; i++) { c = rep[i]; sc = histD[c]; if (c === ttBest) sc += 100000000; mv.push(sc * 256 + c); }
    mv.sort(desc);
    for (i = 0; i < mv.length; i++) {
      x = mv[i] & 255; place(x, dcol); r = An(q, d, ply + 1, false); unplace(x); if (aborted) return false;
      if (!r) { storeFail(s, q, d, x); histD[x]++; return false; }
    }
    storeWin(s, q, d, -1); return true;
  }
  if (q === 0) { storeFail(s, 0, 255, -1); return false; }
  if (!An(q - 1, d, ply + 1, false)) { if (!aborted) storeFail(s, q, d, -1); return false; }
  var cells = freeCells();
  for (i = 0; i < cells.length; i++) { c = cells[i]; sc = histD[c] * 1000 + heur(c, 0) + heur(c, 1); if (sc > 90000000) sc = 90000000; if (c === ttBest) sc += 100000000; mv.push(sc * 256 + c); }
  mv.sort(desc);
  for (i = 0; i < mv.length; i++) {
    x = mv[i] & 255; place(x, dcol); r = An(q - 1, d, ply + 1, false); unplace(x); if (aborted) return false;
    if (!r) { storeFail(s, q, d, x); histD[x] += 4; return false; }
  }
  storeWin(s, q, d, -1); return true;
}
function exactA(q, dmax, ply) { for (var d = 1; d <= dmax; d++) { if (An(q, d, ply, false)) return d; if (aborted) return 0; } return 0; }

// 読み筋（守る側は最も長く粘る手を選ぶ）
function pvA(q, d, ply, line) {
  scan(ply); var a = ATT;
  OUT = -1; if (!An(q, d, ply + 1, true) || OUT < 0) return false;
  var m = OUT, five = NFIVE[ply * 2 + a] > 0;
  line.push(m);
  if (five) return true;
  place(m, a + 1); var ok = pvD(q, d - 1, ply + 1, line); unplace(m); return ok;
}
function pvD(q, d, ply, line) {
  if (d <= 0) return false;
  scan(ply); var a = ATT, df = 1 - a, o = ply * NC, na = N5[a], nd = N5[df], x, v, ok;
  if (NFIVE[ply * 2 + df] > 0) return false;
  if (NFIVE[ply * 2 + a] >= 1) {
    x = FIVE[ply * 8 + a * 4]; var two = NFIVE[ply * 2 + a] >= 2;
    place(x, df + 1); line.push(x); v = two ? 1 : exactA(q, d, ply + 1); ok = v > 0 && pvA(q, v, ply + 1, line); unplace(x); return ok;
  }
  var D = []; for (var c = 0; c < NC; c++) if (na[o + c] >= 2) D.push(c);
  var cand, free = false;
  if (D.length) { cand = threatReplies(ply, D); if (!cand.length) cand = [D[0]]; } else { if (q === 0) return false; free = true; cand = freeCells(); }
  var qq = free ? q - 1 : q, best = -1, bestv = -1, bestsc = -1e18;
  for (var i = 0; i < cand.length; i++) {
    x = cand[i]; var sc = heur(x, df) + heur(x, a); if (!free && nd[o + x] >= 1) sc -= 1000000;
    place(x, df + 1); v = exactA(qq, d, ply + 1); unplace(x); if (aborted || v === 0) return false;
    if (v > bestv || (v === bestv && sc > bestsc)) { best = x; bestv = v; bestsc = sc; }
  }
  place(best, df + 1); line.push(best); ok = pvA(qq, bestv, ply + 1, line); unplace(best); return ok;
}
// att(0/1) が勝てるか。attToMove=false なら守る側の手番から。返り値 {d, pv} or null
function searchWin(att, attToMove, q, maxd, maxNodes, ms) {
  ATT = att; nodes = 0; nodeLimit = maxNodes; deadline = now() + ms; aborted = false;
  var res = 0;
  for (var d = 1; d <= maxd; d++) {
    var r = attToMove ? An(q, d, 0, false) : Dn(q, d, 0);
    if (r) { res = d; break; }
    if (aborted) break;
  }
  lastAborted = aborted;
  if (!res) return null;
  nodes = 0; nodeLimit = Math.max(maxNodes, 200000); deadline = now() + Math.max(ms, 800); aborted = false;
  var line = [], ok = attToMove ? pvA(q, res, 0, line) : pvD(q, res, 0, line);
  if (!ok || !line.length) {
    line = [];
    if (attToMove) { nodes = 0; aborted = false; deadline = now() + 800; OUT = -1; if (An(q, res, 0, true) && OUT >= 0) line = [OUT]; }
  }
  aborted = false;
  return { d: res, pv: line };
}

// ---- 手の種類 ----
function moveKind(c, p) {
  var S = MAXPLY - 1; scan(S);
  var cp = code[p], n5 = N5[p], o = S * NC, k = c * 4, d;
  if (tFive[cp[k]] | tFive[cp[k + 1]] | tFive[cp[k + 2]] | tFive[cp[k + 3]]) return 'five';
  var tot = 0, straight = false;
  for (d = 0; d < 4; d++) { var t = tN5[cp[k + d]]; tot += t; if (t >= 2) straight = true; }
  var threeDirs = 0;
  for (d = 0; d < 4; d++) {
    if (!tOwn2[cp[k + d]] || tN5[cp[k + d]] >= 1) continue;
    var base = c * 36 + d * 9, found = false;
    for (var i = 0; i < 9 && !found; i++) {
      if (i === 4) continue; var e = nb[base + i]; if (e < 0 || bd[e]) continue;
      var old = cp[e * 4 + d], nw = old + P3[8 - i]; if (tFive[nw]) continue;
      if (n5[o + e] - tN5[old] + tN5[nw] >= 2) found = true;
    }
    if (found) threeDirs++;
  }
  if (tot >= 2) return straight ? 'open4' : '44';
  if (tot === 1) return threeDirs >= 1 ? '43' : 'four';
  if (threeDirs >= 2) return '33';
  if (threeDirs === 1) return 'three';
  return 'quiet';
}
// 現局面の急所: side の「五になる点」「打つと止まらない四になる点」
function threatsOf(side) {
  var S = MAXPLY - 1, p = side - 1; scan(S);
  var f = [], dd = [], o = S * NC, n = Math.min(4, NFIVE[S * 2 + p]);
  for (var i = 0; i < n; i++) f.push(FIVE[S * 8 + p * 4 + i]);
  for (var c = 0; c < NC; c++) if (N5[p][o + c] >= 2) dd.push(c);
  return { five: f, dbl: dd };
}

// ---- 定石 ----
var MATS = [[1, 0, 0, 1], [-1, 0, 0, 1], [1, 0, 0, -1], [-1, 0, 0, -1], [0, 1, 1, 0], [0, -1, 1, 0], [0, 1, -1, 0], [0, -1, -1, 0]];
function inv(m) { var det = m[0] * m[3] - m[1] * m[2]; return [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det]; }
function ap(m, v) { return [m[0] * v[0] + m[1] * v[1], m[2] * v[0] + m[3] * v[1]]; }
function relOf(c, origin) { return [c % N - origin % N, ((c / N) | 0) - ((origin / N) | 0)]; }
function cellAt(origin, v) { var x = origin % N + v[0], y = ((origin / N) | 0) + v[1]; return (x < 0 || x >= N || y < 0 || y >= N) ? -1 : y * N + x; }
var BOOK5 = {"kagetsu":{"-2,2":[2,2],"-2,3":[1,0],"-1,3":[-1,-1],"0,-2":[1,0],"0,-1":[-1,-1],"2,1":[2,2],"3,-2":[1,0],"3,1":[1,0]},"ugetsu":{"-2,2":[2,0],"-2,3":[2,0],"-2,-3":[0,-1],"-2,-2":[-1,1],"-1,3":[0,-1],"-1,-3":[0,-1],"-1,-2":[-1,1],"0,2":[2,0],"0,3":[0,-1],"1,2":[2,0],"1,3":[2,0],"1,-3":[0,-1],"2,2":[0,-1],"2,3":[-1,1],"3,2":[0,-1],"3,3":[-1,1],"3,-3":[0,-1],"3,0":[-1,1],"3,1":[-1,1]}};
function openingName() {
  if (hist.length < 3) return '';
  var w = relOf(hist[1], hist[0]), b = relOf(hist[2], hist[0]);
  for (var i = 0; i < 8; i++) {
    var mw = ap(MATS[i], w), mb = ap(MATS[i], b);
    if (mw[0] === 0 && mw[1] === 1 && mb[0] === 1 && mb[1] === 1) return 'kagetsu:' + i;
    if (mw[0] === 1 && mw[1] === 1 && mb[0] === 1 && mb[1] === -1) return 'ugetsu:' + i;
  }
  return '';
}
function bookMove(side) {
  var n = hist.length, c, v, i;
  if (n === 0) return 112;
  if (n === 1) {
    var opts = [];
    for (var dy = -1; dy <= 1; dy++) for (var dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; c = cellAt(hist[0], [dx, dy]); if (c >= 0) opts.push(c); }
    return opts.length ? opts[(Math.random() * opts.length) | 0] : -1;
  }
  if (n === 2 && side === 1) {
    v = relOf(hist[1], hist[0]);
    var ax = Math.abs(v[0]), ay = Math.abs(v[1]);
    if (ax + ay === 1) c = cellAt(hist[0], [v[0] + v[1], v[1] - v[0]]);
    else if (ax === 1 && ay === 1) c = cellAt(hist[0], [v[0], -v[1]]);
    else c = -1;
    return (c >= 0 && !bd[c]) ? c : -1;
  }
  if (n === 4 && side === 1) {
    var on = openingName(); if (!on) return -1;
    var parts = on.split(':'), m = MATS[+parts[1]], tbl = BOOK5[parts[0]];
    var w4 = ap(m, relOf(hist[3], hist[0])), key = w4[0] + ',' + w4[1], ans = tbl[key] || tbl['*'];
    if (!ans) return -1;
    c = cellAt(hist[0], ap(inv(m), ans));
    return (c >= 0 && !bd[c]) ? c : -1;
  }
  return -1;
}

// ---- 手の選択 ----
var LEVELS = [
  null,
  { vct: 8, vctNodes: 50000, q1: false, thrD: 8, thrNodes: 50000, defNodes: 20000, cand: 9, atkD: 4, atkNodes: 3000, ms: 2500, defQ1: false, abDepths: [2], abNodes: 12000 },
  { vct: 14, vctNodes: 400000, q1: true, q1D: 8, q1Nodes: 200000, thrD: 12, thrNodes: 300000, defNodes: 180000, cand: 12, atkD: 8, atkNodes: 8000, ms: 7000, defQ1: true, q1ThrNodes: 250000, abDepths: [2, 4, 6], abNodes: 140000 }
];
function rankCells(p, K, wOwn, wOpp) {
  var o = 1 - p, arr = [];
  for (var c = 0; c < NC; c++) { if (bd[c] || stonesNear[c] === 0) continue; arr.push((wOwn * heur(c, p) + wOpp * heur(c, o)) * 256 + c); }
  arr.sort(desc); if (arr.length > K) arr.length = K;
  return arr.map(function (v) { return v & 255; });
}
// 先読み（αβ）: 静かな局面での形勢判断。三・四が絡む間は読みを延長する。
var WINV = 10000000, abCount = 0, abLimit = 0, abAbort = false, abMaxPly = 0;
function evalStatic(p) {
  var o = 1 - p, s = 0, mx = 0, c0 = code[p], c1 = code[o];
  for (var c = 0; c < NC; c++) {
    if (bd[c] || stonesNear[c] === 0) continue; var k = c * 4;
    var a = tScore[c0[k]] + tScore[c0[k + 1]] + tScore[c0[k + 2]] + tScore[c0[k + 3]];
    var b = tScore[c1[k]] + tScore[c1[k + 1]] + tScore[c1[k + 2]] + tScore[c1[k + 3]];
    s += a - b; if (a > mx) mx = a;
  }
  return s + (mx >> 1);
}
function ab(p, depth, alpha, beta, ply) {
  if (++abCount > abLimit || ((abCount & 255) === 0 && now() > deadline)) { abAbort = true; return 0; }
  scan(ply);
  var o = 1 - p, off = ply * NC, np = N5[p], no = N5[o], col = p + 1, c, v, i;
  if (NFIVE[ply * 2 + p] > 0) return WINV - ply;
  var nfo = NFIVE[ply * 2 + o];
  if (nfo >= 2) return -WINV + ply + 1;
  if (nfo === 1) {
    if (ply >= abMaxPly) return evalStatic(p);
    c = FIVE[ply * 8 + o * 4]; place(c, col); v = -ab(o, depth, -beta, -alpha, ply + 1); unplace(c); return v;
  }
  for (c = 0; c < NC; c++) if (np[off + c] >= 2) return WINV - ply - 2;
  var cand, D = [];
  for (c = 0; c < NC; c++) if (no[off + c] >= 2) D.push(c);
  if (D.length) {
    if (depth <= 0 && ply >= abMaxPly) return evalStatic(p) - 300;
    ATT = o; cand = threatReplies(ply, D);
    if (!cand.length) return -WINV + ply + 3;
    cand.sort(function (x, y) { return (2 * heur(y, p) + heur(y, o)) - (2 * heur(x, p) + heur(x, o)); });
    if (depth <= 0) depth = 1;
  } else {
    if (depth <= 0) return evalStatic(p);
    cand = rankCells(p, ply < 2 ? 9 : 7, 2, 1);
  }
  var best = -Infinity;
  for (i = 0; i < cand.length; i++) {
    c = cand[i]; place(c, col); v = -ab(o, depth - 1, -beta, -alpha, ply + 1); unplace(c);
    if (abAbort) return 0;
    if (v > best) { best = v; if (v > alpha) { alpha = v; if (alpha >= beta) break; } }
  }
  return best;
}
function normalMove(side) {
  var p = side - 1, o = 1 - p, S = MAXPLY - 1, off = S * NC, c, i;
  scan(S);
  for (c = 0; c < NC; c++) if (N5[p][off + c] >= 2) return { move: c, why: 'attack' };
  var D = []; for (c = 0; c < NC; c++) if (N5[o][off + c] >= 2) D.push(c);
  if (D.length) {
    ATT = o; var rep = threatReplies(S, D), best = -1, bs = -1;
    for (i = 0; i < rep.length; i++) { var sc = 2 * heur(rep[i], p) + heur(rep[i], o) + (N5[p][off + rep[i]] >= 1 ? 0 : 500); if (sc > bs) { bs = sc; best = rep[i]; } }
    return { move: best >= 0 ? best : D[0], why: 'defend' };
  }
  var top = rankCells(p, 6, 10, 9);
  for (i = 0; i < top.length; i++) { var kd = moveKind(top[i], p); if (kd === '43' || kd === '44' || kd === '33') return { move: top[i], why: 'attack' }; }
  var s0 = 10 * heur(top[0], p) + 9 * heur(top[0], o), pool = [top[0]];
  for (i = 1; i < Math.min(3, top.length); i++) { if (10 * heur(top[i], p) + 9 * heur(top[i], o) >= s0 * 0.8) pool.push(top[i]); }
  return { move: pool[(Math.random() * pool.length) | 0], why: 'build' };
}
function chooseMove(side, level, keepTT) {
  var p = side - 1, o = 1 - p, S = MAXPLY - 1, c, i;
  if (nStones === 0) return { move: 112, why: 'book' };
  var bk = bookMove(side); if (bk >= 0) return { move: bk, why: 'book' };
  scan(S);
  if (NFIVE[S * 2 + p] > 0) return { move: FIVE[S * 8 + p * 4], why: 'five' };
  if (NFIVE[S * 2 + o] > 0) return { move: FIVE[S * 8 + o * 4], why: 'block5', lost: NFIVE[S * 2 + o] >= 2 };
  if (level === 0) return normalMove(side);
  var cfg = LEVELS[level], tEnd = now() + cfg.ms;
  function rem() { return Math.max(250, tEnd - now()); }
  if (!keepTT) { ttClear(); histD.fill(0); killerA.fill(-1); }
  // 1) 自分の詰み
  var w = searchWin(p, true, 0, cfg.vct, cfg.vctNodes, rem());
  if (w && w.pv.length) return { move: w.pv[0], why: 'win', winIn: w.d, pv: w.pv };
  if (cfg.q1) { w = searchWin(p, true, 1, cfg.q1D, cfg.q1Nodes, rem()); if (w && w.pv.length) return { move: w.pv[0], why: 'win', winIn: w.d, pv: w.pv }; }
  // 2) 相手の詰み筋（こちらがパスしたら負けるか）
  var threat = searchWin(o, true, 0, cfg.thrD, cfg.thrNodes, rem()), thrUnknown = lastAborted;
  var set = {}, cands = rankCells(p, cfg.cand, 2, 1);
  cands.forEach(function (x) { set[x] = 1; });
  if (threat) {
    threat.pv.forEach(function (x) { if (!set[x] && !bd[x]) { set[x] = 1; cands.push(x); } });
    scan(S);
    for (c = 0; c < NC; c++) if (!bd[c] && N5[p][S * NC + c] >= 1 && !set[c]) { set[c] = 1; cands.push(c); }
    var D = []; for (c = 0; c < NC; c++) if (N5[o][S * NC + c] >= 2) D.push(c);
    if (D.length) { ATT = o; threatReplies(S, D).forEach(function (x) { if (!set[x]) { set[x] = 1; cands.push(x); } }); }
  }
  var safe = [], worst = -1, worstV = -1, needCheck = !!threat || thrUnknown, pn = threat ? cfg.defNodes : (cfg.defNodes >> 2);
  for (i = 0; i < cands.length; i++) {
    c = cands[i];
    var base = 2 * heur(c, p) + heur(c, o);
    place(c, side);
    if (needCheck && now() < tEnd) {
      var ow = searchWin(o, true, 0, cfg.thrD, pn, rem());
      if (ow) { if (ow.d > worstV) { worstV = ow.d; worst = c; } unplace(c); continue; }
    }
    ATT = p; nodes = 0; nodeLimit = cfg.atkNodes; deadline = now() + rem(); aborted = false;
    var av = exactA(0, cfg.atkD, 0); aborted = false;
    unplace(c);
    safe.push({ c: c, h: base, bonus: av > 0 ? 250 + (cfg.atkD - av) * 30 : 0, sc: 0 });
  }
  if (!safe.length) return { move: worst >= 0 ? worst : cands[0], why: 'lost', threat: threat };
  safe.sort(function (x, y) { return (y.h + y.bonus * 4) - (x.h + x.bonus * 4); });
  for (i = 0; i < safe.length; i++) safe[i].sc = (safe.length - i);
  // 3) 先読みで並べ替え
  abCount = 0; abLimit = cfg.abNodes; deadline = now() + rem(); abAbort = false;
  for (var di = 0; di < cfg.abDepths.length && safe.length > 1; di++) {
    var depth = cfg.abDepths[di], alpha = -Infinity, tmp = [];
    abMaxPly = depth + 6;
    for (i = 0; i < safe.length; i++) {
      place(safe[i].c, side);
      var v = -ab(o, depth - 1, -Infinity, -alpha + 600, 0);
      unplace(safe[i].c);
      if (abAbort) break;
      v += safe[i].bonus;
      tmp.push(v); if (v > alpha) alpha = v;
    }
    if (abAbort) break;
    for (i = 0; i < safe.length; i++) safe[i].sc = tmp[i];
    safe.sort(function (x, y) { return y.sc - x.sc; });
    if (safe[0].sc > WINV / 2) break;
  }
  abAbort = false;
  var pick = safe[0].c;
  // 4) 相手の「一手溜めてからの詰み」まで確認（最強のみ）
  var q1threat = null;
  if (cfg.defQ1 && now() < tEnd) {
    var r1 = searchWin(o, true, 1, 8, cfg.q1ThrNodes, rem());
    if (r1 || lastAborted) {
      q1threat = r1;
      var order = [], inPv = {}, seen = {};
      if (r1) r1.pv.forEach(function (x) { inPv[x] = 1; });
      safe.forEach(function (x) { if (inPv[x.c]) { order.push(x.c); seen[x.c] = 1; } });
      safe.forEach(function (x) { if (!seen[x.c]) { order.push(x.c); seen[x.c] = 1; } });
      if (r1) r1.pv.forEach(function (x) { if (!seen[x] && !bd[x]) { order.push(x); seen[x] = 2; } });
      var tested = 0;
      for (i = 0; i < order.length && tested < 7; i++) {
        if (now() > tEnd) break;
        c = order[i]; tested++;
        place(c, side);
        var bad = (seen[c] === 2) ? searchWin(o, true, 0, cfg.thrD, cfg.defNodes >> 1, rem()) : null;
        if (!bad) bad = searchWin(o, true, 1, 8, 150000, rem());
        unplace(c);
        if (!bad) { pick = c; break; }
      }
    }
  }
  return { move: pick, why: (threat || q1threat) ? 'defend' : 'build', threat: threat || q1threat };
}

// ---- 説明モード用アシスト ----
function assist(moves, side) {
  setPosition(moves);
  var r = chooseMove(side, 2, false);
  setPosition(moves);
  r.kind = moveKind(r.move, side - 1);
  r.opening = openingName().split(':')[0];
  r.danger = threatsOf(3 - side);
  r.mine = threatsOf(side);
  return r;
}

// ---- 振り返り ----
function review(moves, playerSide, progress) {
  var p = playerSide - 1, o = 1 - p, out = [], n = moves.length, RD = 10, RN = 60000, RMS = 500, i;
  ttClear(); histD.fill(0); killerA.fill(-1);
  for (i = 0; i < n; i++) {
    var side = (i % 2 === 0) ? 1 : 2, mv = moves[i], it = { ply: i, move: mv, side: side };
    setPosition(moves.slice(0, i));
    it.kind = moveKind(mv, side - 1);
    if (side === playerSide) {
      var wb = searchWin(p, true, 0, RD, RN, RMS);
      place(mv, side);
      var five = false; scan(MAXPLY - 1);
      var ow = searchWin(o, true, 0, RD, RN, RMS), still = null;
      if (wb && !ow) still = (it.kind === 'five') ? { d: 0, pv: [] } : searchWin(p, false, 0, RD, RN, RMS);
      unplace(mv);
      if (ow) {
        it.oppWin = ow;
        if (wb) { it.verdict = 'blunder'; it.best = wb.pv[0]; it.bestWhy = 'win'; it.bestPv = wb.pv; it.bestWinIn = wb.d; }
        else {
          var alt = chooseMove(playerSide, 1, true), ow2 = null;
          if (alt.move !== mv) { place(alt.move, playerSide); ow2 = searchWin(o, true, 0, RD, RN, RMS); unplace(alt.move); }
          if (alt.move !== mv && !ow2) { it.verdict = 'blunder'; it.best = alt.move; it.bestWhy = alt.why; it.bestKind = moveKind(alt.move, p); }
          else it.verdict = 'lost';
        }
      } else if (wb) {
        if (still) { it.verdict = 'good'; it.winIn = still.d; }
        else { it.verdict = 'missed'; it.best = wb.pv[0]; it.bestPv = wb.pv; it.bestWinIn = wb.d; it.bestWhy = 'win'; }
      } else {
        it.verdict = 'ok';
        var sug = chooseMove(playerSide, 1, true);
        if (sug.why === 'book' && i === 2 && sug.move !== mv) { setPosition(moves.slice(0, 3)); if (openingName()) sug = { move: mv, why: 'book' }; setPosition(moves.slice(0, i)); }
        if (sug.move !== mv && sug.why !== 'build') { it.best = sug.move; it.bestWhy = sug.why; it.bestKind = moveKind(sug.move, p); it.soft = true; }
        else if (sug.move !== mv) { it.best = sug.move; it.bestWhy = 'build'; it.bestKind = moveKind(sug.move, p); it.soft = true; }
      }
    }
    out.push(it);
    if (progress) progress(i + 1, n);
  }
  var key = -1, j;
  for (j = n - 1; j >= 0; j--) if (out[j].side === playerSide && out[j].verdict === 'blunder') { key = j; break; }
  if (key < 0) for (j = n - 1; j >= 0; j--) if (out[j].side === playerSide && out[j].verdict === 'missed') { key = j; break; }
  var winStart = -1;
  for (j = n - 1; j >= 0; j--) { if (out[j].side !== playerSide) continue; if (out[j].verdict === 'good') winStart = j; else break; }
  return { items: out, keyMistake: key, winStart: winStart };
}

// ---- 入出力 ----
function handle(msg, post) {
  var r;
  if (msg.cmd === 'move') { setPosition(msg.moves); r = chooseMove(msg.side, msg.level, false); setPosition(msg.moves); r.kind = moveKind(r.move, msg.side - 1); post({ id: msg.id, type: 'move', result: r }); }
  else if (msg.cmd === 'assist') { r = assist(msg.moves, msg.side); post({ id: msg.id, type: 'assist', result: r }); }
  else if (msg.cmd === 'review') { r = review(msg.moves, msg.playerSide, function (a, b) { post({ id: msg.id, type: 'progress', done: a, total: b }); }); post({ id: msg.id, type: 'review', result: r }); }
  else if (msg.cmd === 'kind') { setPosition(msg.moves); post({ id: msg.id, type: 'kind', result: { kind: moveKind(msg.cell, msg.side - 1), danger: threatsOf(3 - msg.side), mine: threatsOf(msg.side) } }); }
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { setPosition: setPosition, searchWin: searchWin, chooseMove: chooseMove, assist: assist, review: review, moveKind: moveKind, threatsOf: threatsOf, place: place, unplace: unplace, BOOK5: BOOK5, ttClear: ttClear, stats: function () { return nodes; }, handle: handle, openingName: openingName };
} else if (typeof self !== 'undefined') {
  self.onmessage = function (e) { handle(e.data, function (m) { self.postMessage(m); }); };
}
