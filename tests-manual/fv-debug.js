/* Debug: dump the fv card HTML after initial render. */
const fs = require('fs');
global.Path2D = class { moveTo() {} lineTo() {} closePath() {} };
global.OffscreenCanvas = class { constructor(w, h) { this.width = w; this.height = h; }
  getContext() { return new Proxy({}, { get: () => () => {}, set: () => true }); }
  toDataURL() { return 'data:image/png;base64,STUB'; } };
global.Image = class { set src(v) { setTimeout(() => { this.naturalWidth = 2400; this.naturalHeight = 1700; this.onload(); }, 0); } };
process.on('unhandledRejection', (e) => console.error('UNHANDLED', e));

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

const el = { innerHTML: '', addEventListener() {}, querySelector: () => null, querySelectorAll: () => [] };
const project = { name: 'R1', config: { rules: { modulesPerString: 24, strings: 1 } },
  underlay: { kind: 'image', src: 'data:image/png;base64,STUB', x: 165, y: 300, w: 1414, h: 524 } };
tabNumbering(el, project, { saveProject: async () => true, getNetlist: async () => [] });
setTimeout(() => {
  const i = el.innerHTML.indexOf('Wiring on the real rack');
  if (i < 0) { console.log('CARD MISSING. html len', el.innerHTML.length, el.innerHTML.slice(0, 300)); process.exit(1); }
  console.log(el.innerHTML.slice(i, i + 700).replace(/<svg[\s\S]*$/, '[SVG...]'));
  process.exit(0);
}, 60);
