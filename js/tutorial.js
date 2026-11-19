/* WireFlow home page: scroll tutorial.
   A small rack is taught, confirmed, numbered and wired, one step per scroll
   position. Everything is drawn here in SVG; the steps mirror the real app
   (Box one example, Save all, Confirm, Pair 1, Number modules by clicking,
   Open the wiring sheet). */
(function () {
  'use strict';
  const NS = 'http://www.w3.org/2000/svg';
  const OY = 56;
  const COLX = [70, 250, 430, 610], W = 140, H = 80;
  const ROWY = [130, 226, 322, 418].map(y => y + OY);
  const C = { module: '#38bdf8', ssc: '#f97316', jb: '#a78bfa', msm: '#f472b6', power: '#ef4444', comm: '#22c55e', bus: '#f87171' };

  /* the rack: SSC1 top-left, SSC2 top-right, junction boxes above them, MSM between */
  const parts = [];
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    const kind = (r === 0 && (c === 0 || c === 3)) ? 'ssc' : 'module';
    parts.push({ id: kind === 'ssc' ? (c === 0 ? 'SSC1' : 'SSC2') : `m${c}${r}`, kind, c, r, x: COLX[c], y: ROWY[r], w: W, h: H });
  }
  parts.push({ id: 'JB1', kind: 'jb', x: 70, y: 122, w: 140, h: 40 });
  parts.push({ id: 'JB2', kind: 'jb', x: 610, y: 122, w: 140, h: 40 });
  parts.push({ id: 'MSM1', kind: 'msm', x: 340, y: 114, w: 140, h: 52 });
  const byId = Object.fromEntries(parts.map(p => [p.id, p]));

  /* terminals, left to right (AYK conventions) */
  const MOD_T = { S: 18, N: 40, '-': 100, '+': 122 };
  const SSC_T = { S: 18, N: 40, 'S+': 58, 'B+': 82, 'B-': 104, 'S-': 126 };
  const JB_T = [24, 56, 88, 120];
  function term(p, name) {
    const off = (p.kind === 'ssc' ? SSC_T : MOD_T)[name];
    return { x: p.x + off, y: p.y + 14 };
  }

  /* the engineer's order for each SSC */
  const ORDERS = {
    SSC1: ['m10', 'm11', 'm12', 'm13', 'm03', 'm02', 'm01'],
    SSC2: ['m31', 'm32', 'm33', 'm23', 'm22', 'm21', 'm20']
  };

  /* cable shapes: short jumps in a column, a slight C between side-by-side parts */
  function cable(a, b) {
    if (Math.abs(a.y - b.y) < 1) {
      const sag = Math.min(46, 18 + Math.abs(b.x - a.x) * 0.12);
      return `M${a.x} ${a.y}C${a.x} ${a.y + sag} ${b.x} ${b.y + sag} ${b.x} ${b.y}`;
    }
    const dy = b.y - a.y;
    return `M${a.x} ${a.y}C${a.x} ${a.y + dy * 0.45} ${b.x} ${b.y - dy * 0.45} ${b.x} ${b.y}`;
  }
  function busCable(a, b) {
    return `M${a.x} ${a.y}C${a.x} ${a.y - 18} ${b.x} ${b.y + 18} ${b.x} ${b.y}`;
  }
  function strings() {
    const out = [];
    for (const ssc of ['SSC1', 'SSC2']) {
      const s = byId[ssc], mods = ORDERS[ssc].map(id => byId[id]);
      const power = [], comm = [];
      power.push(cable(term(s, 'S-'), term(mods[0], '-')));
      comm.push(cable(term(s, 'N'), term(mods[0], 'S')));
      for (let k = 0; k + 1 < mods.length; k++) {
        power.push(cable(term(mods[k], '+'), term(mods[k + 1], '-')));
        comm.push(cable(term(mods[k], 'N'), term(mods[k + 1], 'S')));
      }
      power.push(cable(term(mods[mods.length - 1], '+'), term(s, 'S+')));
      comm.push(cable(term(mods[mods.length - 1], 'N'), term(s, 'S')));
      const jb = byId[ssc === 'SSC1' ? 'JB1' : 'JB2'];
      const bus = [
        busCable(term(s, 'B+'), { x: jb.x + JB_T[0], y: jb.y + jb.h }),
        busCable(term(s, 'B-'), { x: jb.x + JB_T[1], y: jb.y + jb.h })
      ];
      out.push({ ssc, power, comm, bus });
    }
    return out;
  }

  /* ---------- building the picture ---------- */
  function el(tag, attrs, parent) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function rectPath(x, y, w, h) { return `M${x} ${y}H${x + w}V${y + h}H${x}Z`; }
  function txt(parent, x, y, s, attrs) {
    const t = el('text', Object.assign({ x, y }, attrs || {}), parent);
    t.textContent = s;
    return t;
  }

  function build(stage) {
    const svg = el('svg', { viewBox: '0 0 820 616', class: 'tut-svg', role: 'img', 'aria-label': 'A small battery rack being taught, numbered and wired in WireFlow' });
    stage.prepend(svg);
    const q = {};

    /* toolbar, like the side panel buttons in the app */
    const bar = el('g', { class: 'tut-bar' }, svg);
    el('rect', { x: 8, y: 8, width: 804, height: 42, rx: 10, class: 'tut-bar-bg' }, bar);
    const labels = [['teach', 'Box one example'], ['save', 'Save all'], ['confirm', 'Confirm'], ['pair', 'Pair 1 (left + −)'], ['number', 'Number modules'], ['sheet', 'Wiring sheet →']];
    let bx = 18;
    q.btn = {};
    for (const [k, s] of labels) {
      const w = Math.round(s.length * 7.1 + 24);
      const g = el('g', { class: 'tut-btn', 'data-k': k }, bar);
      el('rect', { x: bx, y: 15, width: w, height: 28, rx: 7 }, g);
      txt(g, bx + w / 2, 33.5, s, { 'text-anchor': 'middle' });
      q.btn[k] = { g, x: bx + w / 2, y: 29 };
      bx += w + 8;
    }

    /* the drawing: rack frame and every part, as plain CAD lines */
    const draw = el('g', { class: 'tut-draw' }, svg);
    const line = d => el('path', { d, pathLength: 1 }, draw);
    line(rectPath(40, 102, 14, 470));
    line(rectPath(766, 102, 14, 470));
    line('M54 108H766M54 566H766');
    for (let y = 120; y < 560; y += 48) {
      el('circle', { cx: 47, cy: y, r: 2.6, class: 'tut-hole' }, draw);
      el('circle', { cx: 773, cy: y, r: 2.6, class: 'tut-hole' }, draw);
    }
    for (const p of parts) {
      line(rectPath(p.x, p.y, p.w, p.h));
      if (p.kind === 'module') {
        line(`M${p.x + 8} ${p.y + 28}H${p.x + p.w - 8}`);
        line(rectPath(p.x + 50, p.y + 42, 40, 24));
      } else if (p.kind === 'ssc') {
        line(rectPath(p.x + 8, p.y + 4, p.w - 16, 20));
        line(rectPath(p.x + 14, p.y + 38, 56, 30));
      } else if (p.kind === 'msm') {
        line(rectPath(p.x + 14, p.y + 10, 70, 32));   /* the screen */
        el('rect', { x: p.x + 16, y: p.y + 12, width: 66, height: 28, class: 'tut-screen' }, draw);
      }
      const ts = p.kind === 'module' ? Object.values(MOD_T) : p.kind === 'ssc' ? Object.values(SSC_T) : p.kind === 'jb' ? JB_T : [];
      for (const o of ts) {
        const ty = p.kind === 'jb' ? p.y + p.h - 8 : p.y + 14;
        el('circle', { cx: p.x + o, cy: ty, r: 4.2, class: 'tut-term' }, draw);
      }
    }

    /* highlights for recognised parts */
    const hl = el('g', { class: 'tut-hl' }, svg);
    q.hl = {};
    for (const p of parts) {
      q.hl[p.id] = el('rect', { x: p.x - 3, y: p.y - 3, width: p.w + 6, height: p.h + 6, rx: 6, class: `tut-hlr k-${p.kind}`, style: `--c:${C[p.kind]}` }, hl);
    }

    /* wiring */
    const wires = el('g', { class: 'tut-wires' }, svg);
    const flow = el('g', { class: 'tut-flow' }, svg);
    q.wires = [];
    const st = strings();
    st.forEach((s, si) => {
      const add = (d, kind, k) => {
        const p = el('path', { d, pathLength: 1, class: `tut-wire w-${kind}`, style: `--d:${(k * 0.16 + (kind === 'comm' ? 0.08 : 0) + (kind === 'bus' ? 1.5 : 0)).toFixed(2)}s` }, wires);
        q.wires.push(p);
        if (kind === 'power') el('path', { d, pathLength: 1, class: 'tut-pulse', style: `--d:${(k * 0.12 + si * 0.3).toFixed(2)}s` }, flow);
      };
      s.power.forEach((d, k) => add(d, 'power', k));
      s.comm.forEach((d, k) => add(d, 'comm', k));
      s.bus.forEach((d, k) => add(d, 'bus', k));
    });
    q.cableCount = q.wires.length;

    /* JB pair glow (Pair 1, left + −) */
    q.pair = el('g', { class: 'tut-pair' }, svg);
    for (const id of ['JB1', 'JB2']) {
      const jb = byId[id];
      el('rect', { x: jb.x + JB_T[0] - 10, y: jb.y + jb.h - 18, width: JB_T[1] - JB_T[0] + 20, height: 20, rx: 6 }, q.pair);
      ['+', '−', '+', '−'].forEach((s, i) => txt(q.pair, jb.x + JB_T[i], jb.y + 16, s, { 'text-anchor': 'middle', class: i < 2 ? 'on' : '' }));
    }

    /* labels */
    const lab = el('g', { class: 'tut-labels' }, svg);
    q.plates = {};
    for (const p of parts) {
      if (p.kind === 'module') continue;
      const g = el('g', { class: 'tut-plate', style: `--c:${C[p.kind]}` }, lab);
      const px = p.x + p.w / 2, py = p.kind === 'ssc' ? p.y + p.h - 14 : p.kind === 'jb' ? p.y - 8 : p.y - 6;
      el('rect', { x: px - 30, y: py - 15, width: 60, height: 21, rx: 5 }, g);
      txt(g, px, py + 0.5, p.id, { 'text-anchor': 'middle' });
      q.plates[p.id] = g;
    }
    q.nums = {};
    for (const ssc of ['SSC1', 'SSC2']) {
      ORDERS[ssc].forEach((id, k) => {
        const p = byId[id];
        const g = el('g', { class: 'tut-num' }, lab);
        el('rect', { x: p.x + p.w / 2 - 34, y: p.y + 38, width: 68, height: 30, rx: 7 }, g);
        txt(g, p.x + p.w / 2, p.y + 59, `S${ssc[3]}-M${k + 1}`, { 'text-anchor': 'middle' });
        q.nums[id] = g;
      });
    }
    /* terminal names shown while teaching */
    q.tags = el('g', { class: 'tut-tags' }, svg);

    /* teaching box and the pointer */
    q.box = el('rect', { class: 'tut-box', x: 0, y: 0, width: 0, height: 0, rx: 4 }, svg);
    q.ripple = el('circle', { class: 'tut-ripple', cx: -50, cy: -50, r: 4 }, svg);
    q.cursor = el('g', { class: 'tut-cursor', transform: 'translate(760 300)' }, svg);
    el('path', { d: 'M0 0L0 22L6 16.5L10.5 26L14.5 24.2L10.2 15L18 15Z' }, q.cursor);
    q.cur = { x: 760, y: 300 };

    /* status line, like the app's messages */
    const sb = el('g', { class: 'tut-status' }, svg);
    el('rect', { x: 8, y: 578, width: 804, height: 32, rx: 9 }, sb);
    q.dot = el('circle', { cx: 26, cy: 594, r: 5 }, sb);
    q.status = txt(sb, 40, 599, '', {});
    q.svg = svg;
    return q;
  }

  /* ---------- the player ---------- */
  function setup(root) {
    const stage = root.querySelector('.tut-stage');
    const steps = [...root.querySelectorAll('.tut-step')];
    const progress = root.querySelector('.tut-progress i');
    const replay = root.querySelector('.tut-replay');
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const q = build(stage);
    const svg = q.svg;
    let token = 0, current = -1;

    class Stop extends Error {}
    const wait = (ms, t) => new Promise((res, rej) => setTimeout(() => (t === token ? res() : rej(new Stop())), ms));
    const ease = x => x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
    function tween(ms, t, fn) {
      return new Promise((res, rej) => {
        const t0 = performance.now();
        const tick = now => {
          if (t !== token) return rej(new Stop());
          const k = Math.min(1, (now - t0) / ms);
          fn(ease(k));
          if (k < 1) requestAnimationFrame(tick); else res();
        };
        requestAnimationFrame(tick);
      });
    }
    function placeCursor(x, y) {
      q.cur = { x, y };
      q.cursor.setAttribute('transform', `translate(${x} ${y})`);
    }
    async function move(x, y, t, ms) {
      const a = Object.assign({}, q.cur);
      const d = Math.hypot(x - a.x, y - a.y);
      await tween(ms || Math.max(260, Math.min(900, d * 1.5)), t, k => placeCursor(a.x + (x - a.x) * k, a.y + (y - a.y) * k));
    }
    async function click(t) {
      q.cursor.classList.add('down');
      q.ripple.setAttribute('cx', q.cur.x); q.ripple.setAttribute('cy', q.cur.y);
      q.ripple.classList.remove('go'); void q.ripple.getBBox(); q.ripple.classList.add('go');
      await wait(140, t);
      q.cursor.classList.remove('down');
      await wait(120, t);
    }
    function say(s, tone) {
      q.status.textContent = s;
      q.dot.setAttribute('class', tone || '');
    }
    const btn = (k, on) => q.btn[k].g.classList.toggle('on', on);
    const btnDone = (k, on) => q.btn[k].g.classList.toggle('done', on);
    function showBox(x, y, w, h) {
      q.box.setAttribute('x', x); q.box.setAttribute('y', y);
      q.box.setAttribute('width', Math.max(0, w)); q.box.setAttribute('height', Math.max(0, h));
    }
    async function drag(p, t) {
      const x0 = p.x - 10, y0 = p.y - 10, x1 = p.x + p.w + 10, y1 = p.y + p.h + 10;
      await move(x0, y0, t);
      q.cursor.classList.add('down');
      q.box.classList.add('on');
      await tween(700, t, k => { const x = x0 + (x1 - x0) * k, y = y0 + (y1 - y0) * k; placeCursor(x, y); showBox(x0, y0, x - x0, y - y0); });
      q.cursor.classList.remove('down');
      await wait(200, t);
    }
    function tag(x, y, s, cls) {
      const g = el('g', { class: 'tut-tag ' + (cls || '') }, q.tags);
      el('rect', { x: x - 13, y: y - 34, width: 26, height: 20, rx: 5 }, g);
      txt(g, x, y - 19.5, s, { 'text-anchor': 'middle' });
    }
    function found(kind, on, stagger) {
      parts.filter(p => p.kind === kind).forEach((p, i) => {
        q.hl[p.id].style.transitionDelay = stagger ? `${i * 60}ms` : '0ms';
        q.hl[p.id].classList.toggle('on', on);
      });
    }
    async function teachPart(p, names, t, kindLabel, count) {
      btn('teach', true);
      say(`Drag a box around one ${kindLabel}.`);
      await move(q.btn.teach.x, q.btn.teach.y, t);
      await click(t);
      await drag(p, t);
      if (names.length) {
        say(`Now click its terminals, left to right: ${names.join(', ').replace(/-/g, '−')}.`);
        const offs = p.kind === 'ssc' ? SSC_T : MOD_T;
        for (let i = 0; i < names.length; i++) {
          const n = names[i];
          const x = p.kind === 'jb' ? p.x + JB_T[i] : p.x + offs[n];
          const y = p.kind === 'jb' ? p.y + p.h - 8 : p.y + 14;
          await move(x, y, t, 300);
          await click(t);
          tag(x, p.kind === 'jb' ? y + 40 : y, n.replace('-', '−'), p.kind === 'jb' ? 'below' : '');
        }
      }
      say(`Found ${count} ${kindLabel}${count > 1 ? 's' : ''}. Save all, or keep only the boxed one.`);
      btn('save', true);
      await move(q.btn.save.x, q.btn.save.y, t);
      await click(t);
      btn('save', false); btn('teach', false);
      q.box.classList.remove('on');
      found(p.kind, true, true);
      await wait(500, t);
      q.tags.textContent = '';
    }

    /* end state of each step, applied instantly when jumping ahead */
    const finals = [
      () => { svg.classList.add('drawn'); say('rack-112.dxf · 5,143.6 × 1,906.0 mm · 14 modules on the drawing'); },
      () => { found('module', true); },
      () => { found('ssc', true); found('jb', true); found('msm', true); },
      () => { svg.classList.add('named'); btnDone('confirm', true); say('SSC1 · 7 modules ✓   SSC2 · 7 modules ✓   Confirmed.', 'ok'); },
      () => { q.pair.classList.add('on'); btnDone('pair', true); },
      () => { ORDERS.SSC1.concat(ORDERS.SSC2.slice(0, 6)).forEach(id => { q.nums[id].classList.add('on'); q.hl[id].classList.add('picked'); }); },
      () => { q.nums.m20.classList.add('on'); q.hl.m20.classList.add('picked'); svg.classList.add('wired'); btnDone('number', true); say(`Wiring drawn: ${q.cableCount} cables, no power crossings.`, 'ok'); }
    ];
    const plays = [
      async t => {
        say('Opening rack-112.dxf …');
        await move(410, 330, t, 500);
        svg.classList.add('drawn');
        await wait(1500, t);
        finals[0]();
      },
      async t => { await teachPart(byId.m01, ['S', 'N', '-', '+'], t, 'battery module', 14); say('14 battery modules recognised.', 'ok'); },
      async t => {
        await teachPart(byId.SSC1, [], t, 'SSC', 2);
        await teachPart(byId.JB1, ['+', '-', '+', '-'], t, 'junction box', 2);
        await teachPart(byId.MSM1, [], t, 'MSM', 1);
        say('2 SSCs, 2 junction boxes and 1 MSM recognised.', 'ok');
      },
      async t => {
        svg.classList.add('named');
        say('Check the names and enter the modules per SSC: SSC1 · 7, SSC2 · 7');
        await move(250, 330, t);
        await wait(900, t);
        btn('confirm', true);
        await move(q.btn.confirm.x, q.btn.confirm.y, t);
        await click(t);
        btn('confirm', false);
        finals[3]();
      },
      async t => {
        say('Junction box connectors: Pair 1 (left + −), used on every junction box.');
        btn('pair', true);
        await move(q.btn.pair.x, q.btn.pair.y, t);
        await click(t);
        btn('pair', false);
        q.pair.classList.add('on'); btnDone('pair', true);
        await move(byId.JB1.x + 40, byId.JB1.y + 26, t);
        await wait(700, t);
        await move(byId.JB2.x + 40, byId.JB2.y + 26, t);
      },
      async t => {
        btn('number', true);
        await move(q.btn.number.x, q.btn.number.y, t);
        await click(t);
        btn('number', false);
        for (const ssc of ['SSC1', 'SSC2']) {
          const list = ssc === 'SSC2' ? ORDERS[ssc].slice(0, 6) : ORDERS[ssc];
          for (let k = 0; k < list.length; k++) {
            say(`${ssc}: click module ${k + 1} of 7${k === 0 ? ' (the one wired to S− and N)' : ''}.`);
            const p = byId[list[k]];
            await move(p.x + p.w / 2 + 18, p.y + p.h / 2 + 8, t, ssc === 'SSC1' ? 420 : 300);
            await click(t);
            q.nums[p.id].classList.add('on'); q.hl[p.id].classList.add('picked');
          }
        }
        say('SSC2: click module 7 of 7 — the last one.');
      },
      async t => {
        say('SSC2: click module 7 of 7 — the last one.');
        const p = byId.m20;
        await move(p.x + p.w / 2 + 18, p.y + p.h / 2 + 8, t);
        await click(t);
        q.nums.m20.classList.add('on'); q.hl.m20.classList.add('picked');
        say('Drawing the wiring along the rack …');
        svg.classList.add('wired');
        await move(790, 330, t, 700);
        await wait(2600, t);
        finals[6]();
        btn('sheet', true);
        await move(q.btn.sheet.x, q.btn.sheet.y + 4, t, 900);
      }
    ];

    function reset() {
      svg.classList.add('instant');
      svg.classList.remove('drawn', 'named', 'wired');
      q.pair.classList.remove('on');
      for (const k in q.btn) { btn(k, false); btnDone(k, false); }
      for (const id in q.hl) { q.hl[id].classList.remove('on', 'picked'); q.hl[id].style.transitionDelay = '0ms'; }
      for (const id in q.nums) q.nums[id].classList.remove('on');
      q.tags.textContent = '';
      q.box.classList.remove('on');
      q.cursor.classList.remove('down');
      say('');
    }
    async function go(i) {
      const t = ++token;
      current = i;
      steps.forEach((s, k) => s.classList.toggle('is-active', k === i));
      if (progress) progress.style.width = `${((i + 1) / steps.length) * 100}%`;
      reset();
      for (let k = 0; k < i; k++) finals[k]();
      void svg.getBBox();
      requestAnimationFrame(() => svg.classList.remove('instant'));
      if (reduced) { finals[i](); return; }
      try { await plays[i](t); } catch (e) { if (!(e instanceof Stop)) throw e; }
    }
    replay.onclick = () => go(Math.max(0, current));
    steps.forEach((s, k) => s.addEventListener('click', () => { if (k !== current) go(k); }));

    /* the step whose top has passed the reading line is the active one */
    let pending = false;
    function pick() {
      pending = false;
      if (root.offsetParent === null) return;
      const stageBox = stage.getBoundingClientRect();
      const stacked = window.innerWidth < 900;
      const line = stacked ? stageBox.bottom + (window.innerHeight - stageBox.bottom) * 0.45 : window.innerHeight * 0.55;
      let i = 0;
      steps.forEach((s, k) => { if (s.getBoundingClientRect().top < line) i = k; });
      const rb = root.getBoundingClientRect();
      if (rb.bottom < 0 || rb.top > window.innerHeight) return;   /* off screen: keep still */
      if (i !== current) go(i);
    }
    const onScroll = () => { if (!pending) { pending = true; requestAnimationFrame(pick); } };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('hashchange', () => setTimeout(onScroll, 60));
    onScroll();
  }

  function start() {
    const root = document.getElementById('tutorial');
    if (root) setup(root);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
