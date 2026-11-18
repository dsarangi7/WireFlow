/* Builds the "example rack" shipped with the app (rack 111):
 *   assets/examples/rack-111.dxf.gz      the AutoCAD drawing, gzipped
 *   assets/examples/rack-111-parts.json  taught parts + confirmed labels
 * Parts are taught exactly as an engineer does it in the app: one box per
 * part type and the terminals clicked left to right (AYK conventions).
 *
 * Run from the repo root:
 *   node tools/make-example.js prototype-output/cad-check/rack-111.dxf
 */
'use strict';
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const ROOT = path.resolve(__dirname, '..');
const C = new Function(fs.readFileSync(path.join(ROOT, 'js', 'cad.js'), 'utf8') +
  '\nreturn { cadParseDxf, cadFlatten, cadFeatures, cadFeatureIndex, cadTeachSignature, cadRefineSignature, cadFindMatches, cadRecognise, cadProposeNumbers };')();

const src = process.argv[2];
if (!src || !fs.existsSync(src)) { console.error('usage: node tools/make-example.js <rack-111.dxf>'); process.exit(1); }
const text = fs.readFileSync(src, 'utf8');
const flat = C.cadFlatten(C.cadParseDxf(text));
const index = C.cadFeatureIndex(C.cadFeatures(flat), 1);

/* one example of each part on rack 111 (drawing mm) and its terminals, left to right */
const TEACH = [
  { kind: 'module', name: 'Battery module', box: [2830.3, 430.62, 3230.75, 630.84],
    terms: [['comm-S', 2869.83, 490.61], ['comm-N', 2929.83, 490.61], ['power-', 3144.83, 490.61], ['power+', 3194.83, 490.61]], expect: 60 },
  { kind: 'ssc', name: 'SSC', box: [3362.81, 1096.87, 3700.96, 1492.87],
    terms: [['S', 3417.08, 1151.91], ['N', 3462.08, 1151.91], ['S+', 3501.58, 1151.91], ['B+', 3548.08, 1151.91], ['B-', 3594.58, 1151.91], ['S-', 3641.08, 1151.91]], expect: 5 },
  { kind: 'jb', name: 'Junction box', box: [3321, 1903, 3743, 2008.5],
    terms: [['P1+', 3424.8343, 1945.1642], ['P1-', 3494.8343, 1945.1642], ['P2+', 3564.8343, 1945.1642], ['P2-', 3634.8343, 1945.1642]], expect: 5 },
  { kind: 'acdp', name: 'ACDP', box: [4291.96, 1493.67, 4761.37, 1671.65], terms: [], expect: 2 },
  { kind: 'msm', name: 'MSM', box: [7299.83, 1610.93, 7729.2, 1900.14], terms: [], expect: 1 },
];
const signatures = TEACH.map(t => {
  let sig = C.cadTeachSignature(index, { x0: t.box[0], y0: t.box[1], x1: t.box[2], y1: t.box[3] }, { kind: t.kind, name: t.name });
  sig = C.cadRefineSignature(index, sig);
  sig.id = t.kind + '-example';
  sig.terminals = t.terms.map(([role, x, y]) => ({ role: role, dx: +(x - sig.x0).toFixed(4), dy: +(y - sig.y0).toFixed(4) }));
  const n = C.cadFindMatches(index, sig).length;
  if (n !== t.expect) throw new Error(`${t.kind}: found ${n}, expected ${t.expect}`);
  return sig;
});
const comps = C.cadRecognise(index, signatures);
const nums = C.cadProposeNumbers(comps);
const labels = {};
const prefix = { ssc: 'SSC', acdp: 'ACDP', msm: 'MSM' };
for (const c of comps) {
  if (!prefix[c.kind]) continue;
  const key = c.kind + '@' + Math.round(c.x0) + ',' + Math.round(c.y0);
  labels[key] = Object.assign({ label: prefix[c.kind] + nums.get(c), confirmed: true }, c.kind === 'ssc' ? { modules: 12 } : {});
}
const out = path.join(ROOT, 'assets', 'examples');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'rack-111.dxf.gz'), zlib.gzipSync(Buffer.from(text, 'utf8'), { level: 9 }));
fs.writeFileSync(path.join(out, 'rack-111-parts.json'), JSON.stringify({
  format: 'wireflow-example', version: 1, name: 'Example rack 111', file: 'rack-111.dxf',
  note: 'Parts taught once (box + terminals left to right); SSC1/ACDP1 closest to the MSM; 12 modules per SSC.',
  signatures: signatures, labels: labels,
}));
const by = {}; comps.forEach(c => { by[c.kind] = (by[c.kind] || 0) + 1; });
console.log('example written:', JSON.stringify(by), Object.keys(labels).length, 'labels');
