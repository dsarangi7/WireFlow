/* Debug: trace the click→px conversion. */
const fs = require('fs');
global.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
global.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); }
  toDataURL() { return 'data:image/png;base64,STUB'; } };
global.Image = class { set src(v) { setTimeout(() => { this.naturalWidth = 2400; this.naturalHeight = 1700; this.onload(); }, 0); } };
process.on('unhandledRejection', (e) => { console.error('UNHANDLED', e); process.exit(1); });

const src = fs.readFileSync('js/engine.js', 'utf8');
const app = fs.readFileSync('js/app.js', 'utf8');
const fv = fs.readFileSync('js/frontview.js', 'utf8');
const start = app.indexOf('function tabNumbering(el, project, ctx) {');
const end = app.indexOf('/* ---- Tab 3: Netlist ---- */');
const scope = new Function(src + '\n' + fs.readFileSync('js/rack.js', 'utf8') + '\n' +
  fs.readFileSync('js/numbering.js', 'utf8') + '\n' + fv + '\n' +
  'const esc = s => String(s ?? ""); const toast = m => console.log("TOAST:", m);\n' +
  app.slice(start, end) + '\nreturn tabNumbering;');
const tabNumbering = scope();

let fvClick = null;
const el = {
  innerHTML: '', addEventListener() {}, querySelectorAll: () => [],
  querySelector(s) {
    if (s === '#fv-view') {
      return { addEventListener: (t, h) => { if (t === 'click') fvClick = h; },
        querySelector: () => ({ getBoundingClientRect: () => { console.log('  rect requested'); return { left: 0, top: 0, width: 920, height: 651 }; } }) };
    }
    return wrapped(s);
  },
};
const cache = new Map();
function wrapped(sel) {
  if (!cache.has(sel)) cache.set(sel, { sel, onclick: null, innerHTML: '', style: {}, value: 'fit',
    addEventListener(t, h) { this.onclick = h; },
    querySelector: () => null, querySelectorAll: () => [], dataset: {}, textContent: '' });
  return cache.get(sel);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const project = { name: 'R1', config: { rules: { modulesPerString: 24, strings: 1 } },
    underlay: { kind: 'image', src: 'data:image/png;base64,STUB', x: 165, y: 300, w: 1414, h: 524 } };
  tabNumbering(el, project, { saveProject: async (cfg) => { savedPush(cfg); return true; }, getNetlist: async () => [] });
  await sleep(40);
  const savedRows = [];
  function savedPush(c) { savedRows.push(c); }
  console.log('fvClick captured:', typeof fvClick);
  cache.get('#fv-cal').onclick();
  await sleep(10);
  console.log('--- fire 1 (client 46, 49.8) ---');
  fvClick({ clientX: 46, clientY: 49.8, currentTarget: el.querySelector('#fv-view') });
  await sleep(10);
  console.log('--- fire 2 (client 828, 533.6) ---');
  fvClick({ clientX: 828, clientY: 533.6, currentTarget: el.querySelector('#fv-view') });
  await sleep(10);
  const m = el.innerHTML.match(/pitch ([\d.]+)×([\d.]+) px · ([\d.]+) mm\/px/);
  console.log('status:', m && m[0]);
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
