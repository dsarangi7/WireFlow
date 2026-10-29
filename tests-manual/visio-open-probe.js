/* Generate a small draft using the rack image from a previously exported VSDX.
   Usage: node tests-manual/visio-open-probe.js input.vsdx output.vsdx */
'use strict';
const fs = require('fs');
const path = require('path');
const input = process.argv[2], output = process.argv[3];
if (!input || !output || fs.existsSync(output)) throw new Error('Provide an existing source and a new output path.');
const bytes = fs.readFileSync(input);
let offset = 0, picture = null;
while (offset + 30 <= bytes.length && bytes.readUInt32LE(offset) === 0x04034b50) {
  const method = bytes.readUInt16LE(offset + 8), size = bytes.readUInt32LE(offset + 18);
  const nameLength = bytes.readUInt16LE(offset + 26), extraLength = bytes.readUInt16LE(offset + 28);
  const name = bytes.toString('utf8', offset + 30, offset + 30 + nameLength);
  const start = offset + 30 + nameLength + extraLength;
  if (name === 'visio/media/image2.png' && method === 0) picture = bytes.subarray(start, start + size);
  offset = start + size;
}
if (!picture) throw new Error('No stored PNG rack picture was found.');
const root = path.resolve(__dirname, '..');
const names = ['engine.js', 'zip.js', 'rack.js', 'numbering.js', 'frontview.js', 'sscplan.js', 'vsdx.js', 'simple-wiring.js'];
const source = names.map(name => fs.readFileSync(path.join(root, 'js', name), 'utf8')).join('\n');
const api = new Function(source + '\nreturn { vsdxExport, pictureVisioModel, DEFAULT_RULES, generateNetlist };')();
const project = { name: 'Visio compatibility test', underlay: { kind: 'image', src: 'data:image/png;base64,' + picture.toString('base64') }, config: { rules: api.DEFAULT_RULES } };
const cal = { ok: true, imgW: 2400, imgH: 900 };
const segments = [
  { kind: 'power', pts: [{ x: 300, y: 200 }, { x: 320, y: 300 }] },
  { kind: 'comm', pts: [{ x: 200, y: 200 }, { x: 220, y: 300 }] },
];
const model = api.pictureVisioModel(project, cal, segments);
const full = process.argv[4] === '--full';
if (full) Object.assign(project.underlay, model.underlay);
const result = full ? api.vsdxExport(api.generateNetlist(project), project) : api.vsdxExport([], project, model);
fs.writeFileSync(output, result, { flag: 'wx' });
console.log('Generated ' + output);
