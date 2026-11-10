'use strict';
(function () {
  const COLS = 'ABCDEFGHIJKLMNO';
  const $ = s => document.querySelector(s);
  const nm = c => COLS[c % 15] + (Math.floor(c / 15) + 1);
  const cellOf = s => (parseInt(s.slice(1), 10) - 1) * 15 + COLS.indexOf(s[0]);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const LEVELS = ['普通', '強い', '最強'];
  const LEVEL_DESC = [
    '普通：目の前の四や三は止めますが、四三のような両取りは先読みしません。必勝形の練習相手に。',
    '強い：四と三の連続攻めを数手先まで読んで、攻めも受けもします。',
    '最強：連続攻めを十数手先まで読み切り、一手溜めてからの詰みも探します。1手に数秒考えることがあります。'
  ];
  const SIDE = ['', '黒', '白'];
  const KIND = { five: '五連', open4: '両端の空いた四', '44': '四四', '43': '四三', four: '四', '33': '三三', three: '三', quiet: '' };
  const KINDWHY = {
    three: '三を作ります。白は止めないと次に「両端の空いた四」になって負けるので、受けるしかありません。こうして先手を取り続けます。',
    four: '四を作ります。白は1点で止めるしかないので、次も自分の好きな所に打てます。',
    '43': '四三です。白が四を止めても、三が「両端の空いた四」になって勝ちが決まります。',
    '33': '三三です。2本の三を同時には止められません。',
    '44': '四四です。2本の四を同時には止められません。',
    open4: '両端の空いた四。どちらを止められても反対側で五連です。',
    quiet: '力を溜める手です。次に三や四を連続で打てるよう、縦・横・斜めの線が交わる点に石を置きます。'
  };
  const OPPKIND = {
    five: '五連が完成。',
    open4: '両端の空いた四。次に必ず五連になります。',
    '44': '四四。2本の四は同時に止められません。',
    '43': '四三。四を止めても、三が両端の空いた四になります。',
    four: '四。五連になる1点をすぐ止める必要があります。',
    '33': '三三。2本の三は同時に止められません。',
    three: '三。放置すると次に両端の空いた四になるので、止めるか、こちらが四で攻め続ける必要があります。',
    quiet: '力を溜める手（攻めの準備、または受け）。'
  };
  const CPUWHY = { book: '定石どおり', five: '五連', block5: 'あなたの四を止めた', win: '詰みを読んで攻めてきた', defend: 'あなたの攻め筋を先に消した', build: '形を整えた', attack: '攻めてきた', lost: '受けが難しく、粘りの一手' };

  // お手本（探索で確認済みの手順）
  const DEMO = {
    moves: 'H8 H9 I9 H7 G7 F6 J10 K11 I8 G8 I10 I11 H10 G10 J8 G11 I7 I6 L10 K10 K9 H6 M11'.split(' ').map(cellOf),
    notes: [
      '初手は天元（中央）。どの方向にも伸ばせる一番強い場所です。',
      '白が真上に付けてきました。',
      '斜めに打って「花月」。黒2子が斜めに並び、縦・横・斜めへ同時に発展できる黒必勝の形です。',
      '白は反対側から挟む受け（白の受け方の一例）。',
      '三（G7-H8-I9）。放置すれば両端の空いた四になるので、白は止めるしかありません。',
      '白は端を止めます。',
      '四（G7-H8-I9-J10）。白はK11で止める一手。四は必ず受けさせられるので、打ちたい場所に先手で石を置けます。',
      '強制の受け。',
      'ここが要の「溜めの一手」。I8は縦・横・斜めの交点で、次に三を何本も作れます。白がどこに受けても足りないことを探索で確認済みです。',
      '白が最も長く粘れる受け。',
      '三（I8-I9-I10）。',
      '止める。',
      '三（H10-I10-J10）。三を打つたびに白は受けるだけになり、黒石だけが増えていきます。',
      '止める。',
      '三（斜めの H10-I9-J8）。',
      '止める。',
      '四（I7-I8-I9-I10）。白はI6で止めるしかありません。',
      '強制の受け。',
      '四三。横の H10-I10-J10-(K10)-L10 が四で、同時に斜めの I7-J8-(K9)-L10 にも効いています。',
      '四を止める（強制）。',
      '斜め I7-J8-K9-L10 が両端の空いた四に。H6とM11の両方は止められません。',
      '片方しか止められない。',
      '五連で黒の勝ち。初手から23手、黒は一度も守りに回っていません。'
    ]
  };

  // ---- 保存 ----
  const KEY = 'gomoku-trainer-v1';
  const store = {
    data: { stats: {}, games: [] },
    load() { try { const d = JSON.parse(localStorage.getItem(KEY)); if (d && d.stats && Array.isArray(d.games)) this.data = d; } catch (e) { /* 保存なし */ } },
    save() { try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch (e) { /* 保存不可の環境 */ } }
  };

  // ---- エンジン ----
  const engineSrc = document.getElementById('engine-src').textContent;
  let worker = null, mainEngine = null, reqId = 0, pending = {};
  function dispatch(m) {
    const p = pending[m.id]; if (!p) return;
    if (m.type === 'progress') { if (p.onProgress) p.onProgress(m.done, m.total); return; }
    delete pending[m.id]; p.res(m.result);
  }
  function startWorker() {
    pending = {};
    if (worker) { try { worker.terminate(); } catch (e) { /* 無視 */ } worker = null; }
    try {
      worker = new Worker(URL.createObjectURL(new Blob([engineSrc], { type: 'text/javascript' })));
      worker.onmessage = e => dispatch(e.data);
      worker.onerror = () => { worker = null; };
    } catch (e) { worker = null; }
    if (!worker && !mainEngine) mainEngine = new Function('module', 'self', engineSrc + '\nreturn module.exports;')({ exports: {} }, undefined);
  }
  function ask(msg, onProgress) {
    return new Promise(res => {
      msg.id = ++reqId; pending[msg.id] = { res, onProgress };
      if (worker) worker.postMessage(msg);
      else setTimeout(() => mainEngine.handle(msg, dispatch), 30);
    });
  }

  // ---- 状態 ----
  const S = {
    mode: 'play', gameMode: 'play', moves: [], playerSide: 1, level: 1, over: false, winner: 0, winLine: null, busy: false, resigned: false, token: 0,
    review: null, viewPly: 0, ghost: null,
    learnSub: 'assist', learnLevel: 1, assist: null, assistLoading: false, assistOn: true, feedback: '', demoStep: 0, lastCpu: null, tipsOpen: true, confirmReset: false
  };
  const me = () => (S.gameMode === 'learn' ? 1 : S.playerSide);
  const lvl = () => (S.gameMode === 'learn' ? S.learnLevel : S.level);
  const turnSide = () => (S.moves.length % 2 === 0 ? 1 : 2);
  const inDemo = () => S.mode === 'learn' && S.learnSub === 'demo';

  function findFive(moves) {
    const n = moves.length; if (!n) return null;
    const last = moves[n - 1], set = new Set();
    for (let i = (n - 1) % 2; i < n; i += 2) set.add(moves[i]);
    const x = last % 15, y = Math.floor(last / 15);
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const line = [last];
      for (let s = 1; s < 15; s++) { const xx = x + dx * s, yy = y + dy * s; if (xx < 0 || xx > 14 || yy < 0 || yy > 14 || !set.has(yy * 15 + xx)) break; line.push(yy * 15 + xx); }
      for (let s = 1; s < 15; s++) { const xx = x - dx * s, yy = y - dy * s; if (xx < 0 || xx > 14 || yy < 0 || yy > 14 || !set.has(yy * 15 + xx)) break; line.unshift(yy * 15 + xx); }
      if (line.length >= 5) return line;
    }
    return null;
  }

  // ---- 進行 ----
  function cancelEngine() { S.token++; S.assistLoading = false; startWorker(); }
  function newGame(mode) {
    cancelEngine();
    Object.assign(S, { gameMode: mode, moves: [], over: false, winner: 0, winLine: null, busy: false, resigned: false, review: null, ghost: null, assist: null, feedback: '', lastCpu: null });
    render(); step();
  }
  function step() {
    if (S.over) return;
    if (turnSide() === me()) { if (S.gameMode === 'learn' && S.assistOn) requestAssist(); render(); }
    else cpuTurn();
  }
  async function cpuTurn() {
    S.busy = true; render();
    const tok = S.token, t0 = Date.now();
    const r = await ask({ cmd: 'move', moves: S.moves.slice(), side: 3 - me(), level: lvl() });
    if (tok !== S.token) return;
    const wait = 450 - (Date.now() - t0); if (wait > 0) await sleep(wait);
    if (tok !== S.token) return;
    S.busy = false; S.lastCpu = r; play(r.move);
  }
  function play(c) {
    S.moves.push(c); S.assist = null;
    const line = findFive(S.moves);
    if (line) return finish(S.moves.length % 2 === 1 ? 1 : 2, line);
    if (S.moves.length >= 225) return finish(0, null);
    step();
  }
  function finish(winner, line) {
    Object.assign(S, { over: true, winner, winLine: line, busy: false, assist: null });
    if (S.gameMode === 'play') recordGame(winner === 0 ? 'd' : (winner === me() ? 'w' : 'l'));
    render();
  }
  function recordGame(result) {
    const d = store.data, k = S.level;
    d.stats[k] = d.stats[k] || { w: 0, l: 0, d: 0 };
    d.stats[k][result]++;
    d.games.unshift({ t: Date.now(), level: S.level, side: S.playerSide, result, resigned: S.resigned, moves: S.moves.slice() });
    if (d.games.length > 50) d.games.length = 50;
    store.save();
  }
  function onCell(c) {
    if (S.mode === 'records' || S.review || inDemo()) return;
    if (S.over || S.busy || turnSide() !== me() || S.moves.includes(c)) return;
    if (S.gameMode === 'learn') {
      S.feedback = feedbackFor(c);
      if (S.assistLoading) cancelEngine();
    }
    play(c);
  }
  function feedbackFor(c) {
    const a = S.assist;
    if (!a || !S.assistOn) return '';
    const you = `${S.moves.length + 1}手目 黒${nm(c)}`;
    if (a.move === c) return `<span class="tag good">◎</span> ${you}：おすすめどおりです。`;
    if (a.why === 'five' || a.why === 'win') return `<span class="tag warn">△</span> ${you}：勝ち筋を外しました。おすすめは ${nm(a.move)} でした。「待った」でやり直せます。`;
    if (a.why === 'block5' || a.why === 'defend') return `<span class="tag bad">✕</span> ${you}：危険です。おすすめは白の攻めを止める ${nm(a.move)} でした。「待った」でやり直せます。`;
    return `<span class="tag plain">○</span> ${you}：おすすめは ${nm(a.move)} でした（この手でも続けられます）。`;
  }
  async function requestAssist() {
    const tok = S.token, n0 = S.moves.length;
    S.assistLoading = true; S.assist = null;
    const r = await ask({ cmd: 'assist', moves: S.moves.slice(), side: me() });
    if (tok !== S.token || S.moves.length !== n0) return;
    S.assistLoading = false; S.assist = r; render();
  }
  function undo() {
    if (!S.moves.length) return;
    cancelEngine();
    Object.assign(S, { over: false, winner: 0, winLine: null, busy: false, feedback: '', assist: null });
    do { S.moves.pop(); } while (S.moves.length && turnSide() !== me());
    render(); step();
  }
  async function startReview(moves, playerSide, result) {
    cancelEngine();
    S.review = { loading: true, done: 0, total: moves.length, moves, playerSide, result };
    S.mode = 'play'; S.ghost = null; render();
    const tok = S.token;
    const r = await ask({ cmd: 'review', moves, playerSide }, (a, b) => {
      if (tok !== S.token || !S.review) return;
      S.review.done = a; const el = $('#rvbar'); if (el) el.style.width = Math.round(a / b * 100) + '%';
    });
    if (tok !== S.token || !S.review) return;
    Object.assign(S.review, { loading: false, items: r.items, key: r.keyMistake, winStart: r.winStart });
    S.viewPly = r.keyMistake >= 0 ? r.keyMistake : moves.length - 1;
    render();
  }
  function setMode(m) {
    if (m === 'records') { S.mode = m; S.confirmReset = false; render(); return; }
    if (m === 'play' && S.review) { S.mode = m; render(); return; }
    S.mode = m;
    if (m !== S.gameMode || S.review) { S.review = null; newGame(m); } else render();
  }

  // ---- 盤の描画 ----
  const svg = $('#board'), M = 44, CS = 38, VB = 620;
  const px = c => M + (c % 15) * CS, py = c => M + (14 - Math.floor(c / 15)) * CS;
  function stoneSvg(c, col, n, ghost) {
    const x = px(c), y = py(c), fill = col === 1 ? '#1d1c1a' : '#f8f6f0', tx = col === 1 ? '#f4f2ec' : '#22201c';
    return `<g opacity="${ghost ? 0.55 : 1}"><circle cx="${x}" cy="${y}" r="17" fill="${fill}" stroke="${col === 1 ? '#000' : '#8d8a80'}" stroke-width="1"${ghost ? ' stroke-dasharray="4 3"' : ''}/>` +
      (n ? `<text x="${x}" y="${y + 4.5}" text-anchor="middle" font-size="${n > 99 ? 11 : 13}" font-weight="600" fill="${tx}">${n}</text>` : '') + '</g>';
  }
  function currentView() {
    const v = { stones: [], marks: [], ghosts: [], lines: [], last: -1 };
    const put = (moves, n) => { for (let i = 0; i < n; i++) v.stones.push({ c: moves[i], col: i % 2 + 1, n: i + 1 }); };
    if (S.review && !S.review.loading && S.mode === 'play') {
      const R = S.review, it = R.items[S.viewPly];
      if (S.ghost === 'best' && it.best != null) {
        put(R.moves, S.viewPly);
        const line = (it.bestPv && it.bestPv.length) ? it.bestPv : [it.best];
        line.slice(0, 11).forEach((c, i) => v.ghosts.push({ c, col: i % 2 === 0 ? it.side : 3 - it.side, n: i + 1 }));
      } else if (S.ghost === 'opp' && it.oppWin) {
        put(R.moves, S.viewPly + 1); v.last = it.move;
        it.oppWin.pv.slice(0, 11).forEach((c, i) => v.ghosts.push({ c, col: i % 2 === 0 ? 3 - it.side : it.side, n: i + 1 }));
      } else {
        put(R.moves, S.viewPly + 1); v.last = it.move;
        if (it.side === R.playerSide && it.best != null) v.marks.push({ c: it.best, t: 'rec' });
        if (S.viewPly === R.moves.length - 1) { const l = findFive(R.moves); if (l) v.lines.push([l[0], l[l.length - 1]]); }
      }
    } else if (inDemo()) {
      put(DEMO.moves, S.demoStep);
      if (S.demoStep > 0) v.last = DEMO.moves[S.demoStep - 1];
      if (S.demoStep === DEMO.moves.length) { const l = findFive(DEMO.moves); if (l) v.lines.push([l[0], l[l.length - 1]]); }
    } else {
      put(S.moves, S.moves.length);
      if (S.moves.length) v.last = S.moves[S.moves.length - 1];
      if (S.winLine) v.lines.push([S.winLine[0], S.winLine[S.winLine.length - 1]]);
      const a = S.assist;
      if (S.mode === 'learn' && S.assistOn && a && !S.over && !S.busy && turnSide() === me()) {
        v.marks.push({ c: a.move, t: 'rec' });
        (a.danger.five || []).forEach(c => { if (c !== a.move) v.marks.push({ c, t: 'x' }); });
        (a.danger.dbl || []).forEach(c => { if (c !== a.move) v.marks.push({ c, t: 'x' }); });
      }
    }
    return v;
  }
  function drawBoard() {
    const v = currentView();
    let h = `<rect x="6" y="6" width="${VB - 12}" height="${VB - 12}" rx="10" fill="#e6c88f"/>`;
    for (let i = 0; i < 15; i++) {
      const p = M + i * CS;
      h += `<line x1="${M}" y1="${p}" x2="${M + 14 * CS}" y2="${p}" stroke="#6a5327" stroke-width="1"/><line x1="${p}" y1="${M}" x2="${p}" y2="${M + 14 * CS}" stroke="#6a5327" stroke-width="1"/>`;
      h += `<text class="co" x="${p}" y="${VB - 13}">${COLS[i]}</text><text class="co" x="22" y="${M + (14 - i) * CS + 4.5}">${i + 1}</text>`;
    }
    for (const s of [[3, 3], [3, 11], [11, 3], [11, 11], [7, 7]]) h += `<circle cx="${M + s[0] * CS}" cy="${M + s[1] * CS}" r="3.5" fill="#6a5327"/>`;
    v.lines.forEach(L => { h += `<line x1="${px(L[0])}" y1="${py(L[0])}" x2="${px(L[1])}" y2="${py(L[1])}" stroke="#d2452f" stroke-width="40" stroke-linecap="round" opacity=".32"/>`; });
    v.stones.forEach(s => { h += stoneSvg(s.c, s.col, s.n, false); });
    v.ghosts.forEach(s => { h += stoneSvg(s.c, s.col, s.n, true); });
    if (v.last >= 0) h += `<circle cx="${px(v.last)}" cy="${py(v.last)}" r="20" fill="none" stroke="#d2452f" stroke-width="2.5"/>`;
    v.marks.forEach(m => {
      const x = px(m.c), y = py(m.c);
      if (m.t === 'rec') h += `<circle cx="${x}" cy="${y}" r="15" fill="#d9f0e2" stroke="#17794a" stroke-width="2.5"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="14" font-weight="700" fill="#0f5132">推</text>`;
      else h += `<text x="${x}" y="${y + 8}" text-anchor="middle" font-size="24" font-weight="700" fill="#b3261e">×</text>`;
    });
    h += '<circle id="hov" r="16" cx="-60" cy="-60" opacity=".4" pointer-events="none"/>';
    svg.innerHTML = h;
  }
  function cellFromEvent(e) {
    const r = svg.getBoundingClientRect();
    const x = (e.clientX - r.left) * VB / r.width, y = (e.clientY - r.top) * VB / r.height;
    const i = Math.round((x - M) / CS), j = Math.round((y - M) / CS);
    if (i < 0 || i > 14 || j < 0 || j > 14) return -1;
    return (14 - j) * 15 + i;
  }
  const canClick = () => S.mode !== 'records' && !S.review && !inDemo() && !S.over && !S.busy && turnSide() === me();
  svg.addEventListener('click', e => { const c = cellFromEvent(e); if (c >= 0) onCell(c); });
  svg.addEventListener('mousemove', e => {
    const hov = $('#hov'); if (!hov) return;
    const c = cellFromEvent(e);
    if (c < 0 || !canClick() || S.moves.includes(c)) { hov.setAttribute('cx', -60); return; }
    hov.setAttribute('cx', px(c)); hov.setAttribute('cy', py(c)); hov.setAttribute('fill', me() === 1 ? '#1d1c1a' : '#f8f6f0');
  });
  svg.addEventListener('mouseleave', () => { const hov = $('#hov'); if (hov) hov.setAttribute('cx', -60); });

  // ---- 文章 ----
  function pvText(pv, firstSide, max) {
    max = max || 9; const out = [];
    for (let i = 0; i < pv.length && i < max; i++) out.push(SIDE[i % 2 === 0 ? firstSide : 3 - firstSide] + nm(pv[i]));
    return out.join(' → ') + (pv.length > max ? ' …' : '');
  }
  function explainAssist(a) {
    const n = S.moves.length, k = a.kind, parts = [];
    if (a.why === 'book') {
      if (n === 0) parts.push('初手は天元（盤の中央）。どの方向にも伸ばせて、盤端に邪魔されない一番強い場所です。');
      else if (n === 2) {
        const dx = Math.abs(S.moves[1] % 15 - S.moves[0] % 15), dy = Math.abs(Math.floor(S.moves[1] / 15) - Math.floor(S.moves[0] / 15));
        parts.push(dx + dy === 1
          ? '白が縦横に付けてきたので、白石の隣で黒同士が斜めに並ぶ点へ。「花月」と呼ばれる黒必勝の形です。斜めの2子は縦・横・斜めへ同時に発展できます。'
          : '白が斜めに付けてきたので、反対側の斜めへ。「浦月」と呼ばれる黒必勝の形です。黒2子が斜めに並び、白石に邪魔されない方向へ伸ばせます。');
      } else parts.push('定石の一手。白のこの受けに対して黒が勝ち切れることを、探索で確認してある手です。');
    } else if (a.why === 'five') parts.push('五連が完成します。勝ちです。');
    else if (a.why === 'block5') parts.push(a.lost ? '白の四が2か所あり、両方は止められません。' : '白の四を止めます。ここを止めないと次に五連で負けるので、何よりも優先です。');
    else if (a.why === 'win') {
      parts.push(`詰みがあります。あと${a.winIn}手で勝ち。`);
      parts.push(KINDWHY[k] || '');
      if (a.pv && a.pv.length > 1) parts.push('読み筋：' + pvText(a.pv, me()));
    } else if (a.why === 'defend') {
      parts.push('白に勝ち筋があるので、先に受けます。攻める前に「白の四・三はないか」を必ず確認するのが負けないコツです。');
      if (a.threat && a.threat.pv && a.threat.pv.length) parts.push('放置すると：' + pvText(a.threat.pv, 3 - me()) + `（${a.threat.d}手で負け）`);
      if (k && k !== 'quiet') parts.push(`受けながら${KIND[k]}にもなる、攻防を兼ねた手です。`);
    } else if (a.why === 'lost') parts.push('正確に攻められると厳しい局面です。最も長く粘れる手を示しています。');
    else parts.push(KINDWHY[k] || KINDWHY.quiet);
    return parts.filter(Boolean).map(p => `<p>${p}</p>`).join('');
  }
  function reviewSummary(R) {
    const you = SIDE[R.playerSide];
    if (R.result === 'l') {
      if (R.key >= 0) {
        const it = R.items[R.key];
        return `<span class="tag bad">敗因</span> ${R.key + 1}手目の${you}${nm(it.move)}。` +
          (it.verdict === 'missed' ? '勝ち筋があったのに逃しています。' : `この手のあと、相手に${it.oppWin ? it.oppWin.d + '手で決まる' : ''}連続攻めが成立しました。`) +
          '下のコメントで、代わりにどう打てばよかったかを確認できます。';
      }
      return '読み切れる範囲では、決定的な1手は見つかりませんでした。序盤から少しずつ押されています。各手の「エンジンの第一候補」と見比べてみてください。';
    }
    if (R.result === 'w') {
      const miss = R.items.filter(x => x.side === R.playerSide && (x.verdict === 'missed' || x.verdict === 'blunder')).length;
      return `<span class="tag good">勝ち</span> ` + (R.winStart >= 0 ? `${R.winStart + 1}手目から詰み筋に入っていました。` : '') + (miss ? `途中、もっと早い勝ちや危ない手が${miss}回ありました（一覧の色付きの手）。` : '読み切れる範囲でミスはありません。');
    }
    return '引き分けです。';
  }
  function reviewComment(R, it) {
    const k = KIND[it.kind], opp = SIDE[3 - it.side];
    let h = `<p><b>${it.ply + 1}手目 ${SIDE[it.side]}${nm(it.move)}</b>${k ? `（${k}）` : ''}</p>`;
    if (it.side !== R.playerSide) return h + `<p>相手の手：${OPPKIND[it.kind]}</p>`;
    const bk = it.bestKind && KIND[it.bestKind] ? `（${KIND[it.bestKind]}）` : '';
    if (it.verdict === 'blunder') {
      h += `<p><span class="tag bad">✕ 敗着</span> この手のあと、${opp}に勝ち筋ができました。</p><p>${opp}の勝ち筋：${pvText(it.oppWin.pv, 3 - it.side)}（${it.oppWin.d}手で決まる）</p>`;
      if (it.bestWhy === 'win') h += `<p>代わりに <b>${nm(it.best)}</b> なら、あなたが${it.bestWinIn}手で勝っていました：${pvText(it.bestPv, it.side)}</p>`;
      else if (it.bestWhy === 'block5') h += `<p>代わりに <b>${nm(it.best)}</b> で相手の四を止める必要がありました。</p>`;
      else h += `<p>代わりに <b>${nm(it.best)}</b>${bk} なら、相手のこの勝ち筋は成立しませんでした。</p>`;
    } else if (it.verdict === 'missed') {
      h += `<p><span class="tag warn">△ 勝ち逃し</span> ここは <b>${nm(it.best)}</b> から${it.bestWinIn}手で勝ちでした。</p><p>読み筋：${pvText(it.bestPv, it.side)}</p>`;
    } else if (it.verdict === 'lost') {
      h += `<p><span class="tag plain">受けなし</span> すでに、どこに打っても相手の勝ち筋が残る局面です（原因はこれより前の手）。</p>` + (it.oppWin ? `<p>${opp}の勝ち筋：${pvText(it.oppWin.pv, 3 - it.side)}</p>` : '');
    } else if (it.verdict === 'good') {
      h += `<p><span class="tag good">◎ 好手</span> ${it.kind === 'five' ? '五連で勝ち。' : `勝ち筋を保っています（あと${it.winIn}手）。`}</p>`;
    } else {
      h += `<p><span class="tag plain">○</span> 問題のない手です。` + (it.best != null ? `エンジンの第一候補は <b>${nm(it.best)}</b>${bk} でした。` : 'エンジンの第一候補と同じ手です。') + '</p>';
    }
    return h;
  }
  const MARK = { blunder: '✕', missed: '△', good: '◎', lost: '…', ok: '' };

  // ---- 右側パネル ----
  const seg = (act, items, cur) => `<div class="seg">${items.map((t, i) => `<button data-act="${act}" data-arg="${t[0]}" class="${cur === t[0] ? 'on' : ''}">${t[1]}</button>`).join('')}</div>`;
  const levelSeg = (act, cur) => seg(act, LEVELS.map((n, i) => [i, n]), cur);
  function resultCard() {
    const win = S.winner === me();
    const t = S.winner === 0 ? '引き分け' : win ? 'あなたの勝ち' : (S.resigned ? '投了（負け）' : 'CPUの勝ち');
    const sub = S.winner === 0 ? '盤が埋まりました。' : win ? `${S.moves.length}手で五連を作りました。` : 'どの手が敗因だったか、1手ずつ確認できます。';
    return `<div class="card"><h2>${t}</h2><p class="sub">${sub}</p><div class="row"><button class="primary" data-act="review">この対局を振り返る</button><button data-act="new">もう一局</button></div></div>`;
  }
  function statLine(k) {
    const s = store.data.stats[k] || { w: 0, l: 0, d: 0 }, n = s.w + s.l + s.d;
    return `${s.w}勝 ${s.l}敗 ${s.d}分` + (n ? `（勝率 ${Math.round(s.w / n * 100)}%）` : '');
  }
  function panelPlay() {
    if (S.review) return panelReview();
    let h = `<div class="card"><h2>対戦モード</h2>
      <div class="row"><label>CPUの強さ</label>${levelSeg('level', S.level)}</div>
      <div class="row"><label>あなたの手番</label>${seg('side', [[1, '先手（黒）'], [2, '後手（白）']], S.playerSide)}</div>
      <div class="row"><button class="primary" data-act="new">新しい対局</button><button data-act="resign"${S.over || S.moves.length < 2 ? ' disabled' : ''}>投了</button></div>
      <p class="sub">${LEVEL_DESC[S.level]}</p></div>`;
    if (S.over && S.gameMode === 'play') h += resultCard();
    h += `<div class="card"><h2>戦績（${LEVELS[S.level]}）</h2><p>${statLine(S.level)}</p><p class="sub">決着がついた対局と投了だけを記録します。途中でやめた対局は数えません。</p></div>`;
    return h;
  }
  function panelReview() {
    const R = S.review;
    if (R.loading) return `<div class="card"><h2>振り返りを作成中</h2><p class="sub">1手ずつ読み直して、ミスと代わりの手を調べています。</p><div class="bar"><i id="rvbar" style="width:${Math.round(R.done / R.total * 100)}%"></i></div></div>`;
    const it = R.items[S.viewPly], n = R.moves.length;
    let h = `<div class="card"><h2>振り返り</h2><p>${reviewSummary(R)}</p></div><div class="card">
      <div class="navb"><button data-act="rv" data-arg="first" aria-label="最初へ">⏮</button><button data-act="rv" data-arg="prev">◀ 前</button><span>${S.viewPly + 1} / ${n} 手目</span><button data-act="rv" data-arg="next">次 ▶</button><button data-act="rv" data-arg="last" aria-label="最後へ">⏭</button></div>
      <div class="cmt">${reviewComment(R, it)}</div><div class="row">`;
    if (S.ghost) h += '<button data-act="ghost" data-arg="">実際の局面に戻す</button>';
    else {
      if (it.side === R.playerSide && it.best != null) h += `<button data-act="ghost" data-arg="best">${it.bestPv && it.bestPv.length > 1 ? 'おすすめの手順を盤に出す' : 'おすすめ手を盤に出す'}</button>`;
      if (it.oppWin) h += '<button data-act="ghost" data-arg="opp">相手の勝ち筋を盤に出す</button>';
    }
    h += '</div><ol class="kifu">' + R.items.map(x => {
      const mine = x.side === R.playerSide, v = mine ? x.verdict : '';
      return `<li data-act="rv" data-arg="${x.ply}" class="${x.ply === S.viewPly ? 'cur ' : ''}m-${v}"><span>${x.ply + 1} ${SIDE[x.side]}${nm(x.move)}</span><b>${mine ? (MARK[v] || '') : ''}</b></li>`;
    }).join('') + '</ol><p class="sub">✕ 敗着　△ 勝ち逃し　◎ 好手　… 受けなし。← → キーでも移動できます。</p><div class="row"><button data-act="rv-close">振り返りを閉じる</button></div></div>';
    return h;
  }
  function tipsCard() {
    let h = `<div class="card"><h2 data-act="tips" style="cursor:pointer">必勝法の要点（黒番） ${S.tipsOpen ? '▾' : '▸'}</h2>`;
    if (S.tipsOpen) h += `<ol class="steps">
      <li><b>初手は天元</b>（盤の中央）。</li>
      <li><b>3手目で斜めに並べる</b>。白が縦横に付けたら「花月」、斜めに付けたら「浦月」。</li>
      <li><b>三と四で先手を取り続ける</b>。白が受けている間に、2方向以上に効く点へ石を集めます。</li>
      <li><b>両取りで決める</b>。四三・三三・四四のどれかができたら勝ち（制限なしなので全部打てます）。</li>
      <li><b>攻める前に白の四・三を確認</b>。白の四は最優先で止め、白の三は止めるか四で攻め続けます。</li>
    </ol><p class="sub">五目並べ（制限なし）は、最善を尽くせば先手の黒が必ず勝つことが計算機で証明されています。ただし手順は膨大なので、実戦では上の型で攻めを組み立てます。アシストは定石と詰み読みで最善と思われる手を示し、詰みが見えたときは「あと◯手で勝ち」と表示します。</p>`;
    return h + '</div>';
  }
  function panelLearn() {
    let h = `<div class="card">${seg('lsub', [['assist', 'アシスト対局'], ['demo', 'お手本再生']], S.learnSub)}`;
    if (S.learnSub === 'demo') {
      const st = S.demoStep, n = DEMO.moves.length;
      h += `<p class="sub" style="margin-top:10px">花月から白が挟んで受けた場合の勝ち切り。白のどの応手にも黒が勝てることを、探索プログラムで確認した手順です（白の応手は石の周囲2路以内を全て調査）。</p>
        <div class="navb"><button data-act="demo" data-arg="first" aria-label="最初へ">⏮</button><button data-act="demo" data-arg="prev">◀ 前</button><span>${st} / ${n} 手</span><button data-act="demo" data-arg="next">次 ▶</button><button data-act="demo" data-arg="last" aria-label="最後へ">⏭</button></div>
        <div class="cmt">${st === 0 ? '<p>「次 ▶」で1手ずつ進みます（← → キーでも動きます）。</p>' : `<p><b>${st}手目 ${SIDE[(st - 1) % 2 + 1]}${nm(DEMO.moves[st - 1])}</b></p><p>${DEMO.notes[st - 1]}</p>`}</div></div>`;
      return h + tipsCard();
    }
    h += `<div class="row" style="margin-top:10px"><label>白（CPU）の強さ</label>${levelSeg('llevel', S.learnLevel)}</div>
      <div class="row"><button class="primary" data-act="new">最初から</button><button data-act="undo"${S.moves.length ? '' : ' disabled'}>待った</button><button data-act="assist-toggle">${S.assistOn ? 'アシストを隠す' : 'アシストを出す'}</button></div></div>`;
    h += '<div class="card"><h2>アシスト</h2>';
    if (S.feedback) h += `<p>${S.feedback}</p>`;
    if (S.lastCpu && S.moves.length && !S.over && turnSide() === me()) {
      const lk = KIND[S.lastCpu.kind];
      h += `<p class="sub">白の直前の手 ${nm(S.moves[S.moves.length - 1])}：${CPUWHY[S.lastCpu.why] || ''}${lk ? `（白の${lk}）` : ''}</p>`;
    }
    if (S.over) h += `<p><b>${S.winner === 1 ? '黒の勝ち。' : S.winner === 2 ? '白の勝ち。「待った」で戻ってやり直せます。' : '引き分け。'}</b></p>`;
    else if (S.busy) h += '<p class="sub">白が考えています…</p>';
    else if (!S.assistOn) h += '<p class="sub">アシストは隠しています。自分で考えてから「アシストを出す」で答え合わせができます。</p>';
    else if (S.assist) {
      const a = S.assist, k = KIND[a.kind];
      h += `<div class="cmt"><p><b>おすすめ：${nm(a.move)}</b>${k ? `（${k}）` : ''}　盤上の「推」</p>${explainAssist(a)}</div>`;
      if ((a.danger.five || []).length + (a.danger.dbl || []).length) h += '<p class="sub">盤上の赤い × は白の急所（白に打たれると五連・止まらない四になる点）です。</p>';
    } else h += '<p class="sub">おすすめの手を読んでいます…</p>';
    return h + '</div>' + tipsCard();
  }
  function panelRecords() {
    const d = store.data;
    let h = '<div class="card"><h2>戦績</h2><table><tr><th>強さ</th><th>対局</th><th>勝</th><th>負</th><th>分</th><th>勝率</th></tr>';
    LEVELS.forEach((n, i) => {
      const s = d.stats[i] || { w: 0, l: 0, d: 0 }, t = s.w + s.l + s.d;
      h += `<tr><td>${n}</td><td>${t}</td><td>${s.w}</td><td>${s.l}</td><td>${s.d}</td><td>${t ? Math.round(s.w / t * 100) + '%' : '—'}</td></tr>`;
    });
    let streak = 0; for (const g of d.games) { if (g.result === 'w') streak++; else break; }
    h += `</table><p class="sub">現在の連勝：${streak}　／　戦績はこのブラウザに保存されます。</p></div>`;
    h += '<div class="card"><h2>最近の対局</h2>';
    if (!d.games.length) h += '<p class="sub">まだ対局がありません。「対戦」で1局打つとここに並びます。</p>';
    else h += '<div class="glist">' + d.games.map((g, i) => {
      const dt = new Date(g.t), ds = `${dt.getMonth() + 1}/${dt.getDate()} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}`;
      const res = g.result === 'w' ? '<span class="tag good">勝ち</span>' : g.result === 'l' ? '<span class="tag bad">負け</span>' : '<span class="tag plain">引分</span>';
      return `<div class="g">${res}<span>${ds}　${LEVELS[g.level]}・${g.side === 1 ? '先手' : '後手'}・${g.moves.length}手</span><button data-act="rec-review" data-arg="${i}">振り返る</button></div>`;
    }).join('') + '</div>';
    h += '</div><div class="card">' + (S.confirmReset
      ? '<p>戦績と対局履歴をすべて消します。元に戻せません。</p><div class="row"><button data-act="rec-reset-yes">消去する</button><button data-act="rec-reset-no">やめる</button></div>'
      : '<button data-act="rec-reset">戦績をリセット</button>') + '</div>';
    return h;
  }
  function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.mode === S.mode));
    drawBoard();
    $('#side').innerHTML = S.mode === 'play' ? panelPlay() : S.mode === 'learn' ? panelLearn() : panelRecords();
    const st = $('#status'); let t = '', cls = '';
    if (S.mode === 'records') t = '過去の対局は「振り返る」で1手ずつ確認できます。';
    else if (S.review) t = S.review.loading ? '振り返りを作成中…' : (S.ghost === 'best' ? 'おすすめの手順を点線の石で表示中' : S.ghost === 'opp' ? '相手の勝ち筋を点線の石で表示中' : `${S.viewPly + 1}手目までの局面`);
    else if (inDemo()) t = 'お手本を再生中';
    else if (S.over) { if (S.winner === 0) t = '引き分け'; else if (S.winner === me()) { t = 'あなたの勝ち'; cls = 'win'; } else { t = S.resigned ? '投了しました' : 'CPUの勝ち'; cls = 'lose'; } }
    else if (S.busy) t = `CPU（${SIDE[3 - me()]}・${LEVELS[lvl()]}）が考えています…`;
    else t = `あなたの番です（${SIDE[me()]}）`;
    st.textContent = t; st.className = cls;
  }

  // ---- 操作 ----
  function rvGo(arg) {
    const R = S.review; if (!R || R.loading) return;
    const n = R.moves.length; let p = S.viewPly;
    if (arg === 'first') p = 0; else if (arg === 'last') p = n - 1; else if (arg === 'prev') p--; else if (arg === 'next') p++; else p = +arg;
    S.viewPly = Math.max(0, Math.min(n - 1, p)); S.ghost = null; render();
    const cur = document.querySelector('.kifu li.cur'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest' });
  }
  function demoGo(arg) {
    const n = DEMO.moves.length; let p = S.demoStep;
    if (arg === 'first') p = 0; else if (arg === 'last') p = n; else if (arg === 'prev') p--; else p++;
    S.demoStep = Math.max(0, Math.min(n, p)); render();
  }
  function act(a, arg) {
    switch (a) {
      case 'level': S.level = +arg; newGame('play'); break;
      case 'side': S.playerSide = +arg; newGame('play'); break;
      case 'new': newGame(S.mode === 'learn' ? 'learn' : 'play'); break;
      case 'resign': if (!S.over && S.gameMode === 'play') { cancelEngine(); S.resigned = true; finish(3 - me(), null); } break;
      case 'review': startReview(S.moves.slice(), S.playerSide, S.winner === 0 ? 'd' : S.winner === S.playerSide ? 'w' : 'l'); break;
      case 'rv': rvGo(arg); break;
      case 'ghost': S.ghost = arg || null; render(); break;
      case 'rv-close': cancelEngine(); S.review = null; S.ghost = null; render(); break;
      case 'tips': S.tipsOpen = !S.tipsOpen; render(); break;
      case 'lsub': S.learnSub = arg; render(); if (arg === 'assist' && !S.over && !S.busy && !S.assist && !S.assistLoading && turnSide() === me()) step(); break;
      case 'llevel': S.learnLevel = +arg; newGame('learn'); break;
      case 'undo': undo(); break;
      case 'assist-toggle': S.assistOn = !S.assistOn; render(); if (S.assistOn && !S.assist && !S.over && !S.busy && turnSide() === me()) requestAssist(); break;
      case 'demo': demoGo(arg); break;
      case 'rec-review': { const g = store.data.games[+arg]; if (g) startReview(g.moves.slice(), g.side, g.result); break; }
      case 'rec-reset': S.confirmReset = true; render(); break;
      case 'rec-reset-no': S.confirmReset = false; render(); break;
      case 'rec-reset-yes': store.data = { stats: {}, games: [] }; store.save(); S.confirmReset = false; render(); break;
    }
  }
  $('#side').addEventListener('click', e => { const b = e.target.closest('[data-act]'); if (b && !b.disabled) act(b.dataset.act, b.dataset.arg); });
  $('#tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) setMode(b.dataset.mode); });
  document.addEventListener('keydown', e => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const dir = e.key === 'ArrowLeft' ? 'prev' : 'next';
    if (S.mode === 'play' && S.review && !S.review.loading) { rvGo(dir); e.preventDefault(); }
    else if (inDemo()) { demoGo(dir); e.preventDefault(); }
  });

  store.load();
  startWorker();
  newGame('play');
  window.__gomoku = { S, act, onCell, store, nm, cellOf };
})();
