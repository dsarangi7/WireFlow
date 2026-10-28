/* Front-view wiring UI smoke test (stub DOM) — not part of the test suite. */
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
if (start < 0 || end < 0) throw new Error('tabNumbering bounds');
const scope = new Function(src + '\n' + fs.readFileSync('js/rack.js', 'utf8') + '\n' +
  fs.readFileSync('js/numbering.js', 'utf8') + '\n' + fs.readFileSync('js/sscplan.js', 'utf8') + '\n' + fv + '\n' +
  'const esc = s => String(s ?? ""); const toast = m => console.log("TOAST:", m);\n' +
  app.slice(start, end) + '\nreturn tabNumbering;');
const tabNumbering = scope();

/* stub DOM: render() rebuilds el.innerHTML, so click handlers are captured
   fresh from the last render and state is always read from el.innerHTML */
let fvClick = null;                     /* newest #fv-view click listener */
const saved = [];
const el = {
  innerHTML: '',
  addEventListener() {},
  querySelectorAll: () => [],
  querySelector(s) {
    if (s === '#fv-view') {
      return { addEventListener: (t, h) => { if (t === 'click') fvClick = h; },
        querySelector: () => ({ getBoundingClientRect: () => ({ left: 0, top: 0, width: 920, height: 651 }) }) };
    }
    return wrapped(s);
  },
};
const cache = new Map();
function wrapped(sel) {
  if (!cache.has(sel)) cache.set(sel, { sel, onclick: null, innerHTML: '', style: {}, value: 'fit',
    /* buttons registered via addEventListener surface as onclick (latest wins,
       matching the real DOM where each render replaces the node) */
    addEventListener(t, h) { this.onclick = h; },
    querySelector: () => null, querySelectorAll: () => [], dataset: {}, textContent: '' });
  return cache.get(sel);
}
const fire = (x, y) => fvClick({ clientX: x, clientY: y, currentTarget: el.querySelector('#fv-view') });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const project = { name: 'R1', config: { rules: { modulesPerString: 24, strings: 1 } },
    underlay: { kind: 'image', src: 'data:image/png;base64,STUB', x: 165, y: 300, w: 1414, h: 524 } };
  tabNumbering(el, project, { saveProject: async (cfg) => { saved.push(cfg); return true; }, getNetlist: async () => [] });
  await sleep(40);                      /* natural image size loads async */

  const t = (name, ok) => console.log((ok ? 'PASS' : 'FAIL') + ' ' + name);
  t('fv card rendered', /Wiring on the real rack/.test(el.innerHTML));
  t('uncalibrated chip shown', /grid not calibrated/.test(el.innerHTML));
  t('no wiring before calibration', !el.innerHTML.includes('Red = power chain'));

  /* default rack = 3 cols × 8 rows; image 2400×1700 shown 920×651.
     Slot (c,r) centre in image px = (200 + c*1000, 200 + r*180);
     client = image px × 920/2400 (x), × 651/1700 (y). */
  const client = (px, py) => [px * 920 / 2400, py * 651 / 1700];
  let cc = client(200, 200);            /* first module, slot (0,0) */
  cache.get('#fv-cal').onclick();       /* start calibration */
  await sleep(10);
  fire(cc[0], cc[1]);                   /* calibration click 1 */
  t('step-2 prompt', /centre of the LAST module/.test(el.innerHTML));
  cc = client(2200, 1460);              /* last module, slot (2,7) */
  fire(cc[0], cc[1]);                   /* calibration click 2 */
  t('calibrated', /grid calibrated/.test(el.innerHTML));
  t('wiring drawn', (el.innerHTML.match(/<polyline/g) || []).length > 40);
  t('summary shown', el.innerHTML.includes('Red = power chain'));

  cache.get('#num-custom').onclick();
  await sleep(20);
  cc = client(200, 200);                /* number M1 on the picture */
  fire(cc[0], cc[1]);
  await sleep(20);
  /* renderMode() writes into the #num-mode child node, not el.innerHTML */
  const modeBox = cache.get('#num-mode');
  t('numbered 1 of 24', /Numbered by hand<\/label><span>1 of 24/.test(modeBox.innerHTML));

  cache.get('#num-save').onclick();
  await sleep(20);
  const cfg = saved.find((c) => c.config && c.config.numbering);
  const cal = cfg && cfg.config.numbering.cal;
  t('saved with calibration', !!(cal && cal.ok));
  if (cal) {
    console.log('     pitch', cal.pitchX.toFixed(1), 'x', cal.pitchY.toFixed(1),
      '| mmPerPx', cal.mmPerPx.toFixed(3), '| devices', JSON.stringify(cal.devices));
  }
  process.exit(0);
})().catch((e) => { console.error('FAIL', e); process.exit(1); });
