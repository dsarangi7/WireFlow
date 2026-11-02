/* Fixture-only end-to-end diagnostic for the supplied 111.vsdx rack image.
 * Usage: node tests-manual/reference-module-diagnostic.js INPUT.png OUTPUT.svg
 * INPUT must be the 1155x428 raster extracted from that specific source.
 * The fixture positions and group orders are approximate observations, not
 * detected terminals or approved electrical connections. SSC/JB links omitted.
 */
'use strict';
const fs = require('fs');
const path = require('path');
const [input, output] = process.argv.slice(2);
if (!input || !output || path.resolve(input) === path.resolve(output)) throw new Error('Provide distinct input PNG and output SVG paths.');
const png = fs.readFileSync(input);
if (png.length < 24 || png.toString('hex', 0, 8) !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== 1155 || png.readUInt32BE(20) !== 428) throw new Error('Expected the 1155x428 extracted reference rack PNG.');
const root = path.resolve(__dirname, '..');
const src = fs.readFileSync(path.join(root,'js/frontview.js'),'utf8') + '\n' + fs.readFileSync(path.join(root,'js/simple-wiring.js'),'utf8');
const factory = new Function('slotCell','SSC_PALETTE',src+'\nreturn {pictureModuleWiring,fvSvg};');
const api = factory(s => {const [c,r]=s.split(',').map(Number); return {c,r};}, ['#345678']);
const cal = {ok:true,imgW:1155,imgH:428,x0:90,y0:67,pitchX:106.45,pitchY:44.35,cols:10,rows:8,mmPerPx:1};
const ports = {commS:{x:-31,y:0},commN:{x:-20,y:0},pwrNeg:{x:26,y:0},pwrPos:{x:36,y:0}};
const groups = Array.from({length:5},(_,i)=>({label:'S'+(5-i),order:[...Array.from({length:4},(_,r)=>(2*i+1)+','+(r+4)),...Array.from({length:8},(_,r)=>(2*i)+','+(7-r))]}));
const wires = api.pictureModuleWiring(groups,cal,ports);
let svg = api.fvSvg(cal,{src:'data:image/png;base64,'+png.toString('base64')},wires,{noGrid:true,sscLabels:true});
svg = svg.replace('</svg>','<rect x="0" y="0" width="1155" height="25" fill="white" opacity="0.9"/><text x="578" y="18" text-anchor="middle" fill="#a00000" font-size="15">INCOMPLETE DIAGNOSTIC — NO SSC/JUNCTION BOX CONNECTIONS — DO NOT BUILD</text></svg>');
fs.writeFileSync(output,svg);
console.log('Module labels:',wires.filter(w=>w.kind==='label').length,'module links:',wires.filter(w=>w.kind!=='label').length);
