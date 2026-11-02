const fs = require('fs'), path = require('path');
const imp = require('../js/vsdx-import.js');
const [geometryPath, picturePath, outputPath] = process.argv.slice(2);
if (!geometryPath || !picturePath || !outputPath || [geometryPath,picturePath].some(p => path.resolve(p) === path.resolve(outputPath))) throw new Error('Usage: node reference-overlay.js SHAPES.json RACK.png OUTPUT.svg; all paths must be distinct.');
const shapes = JSON.parse(fs.readFileSync(geometryPath,'utf8'));
const image = fs.readFileSync(picturePath);
if (image.length < 24 || image.toString('hex',0,8) !== '89504e470d0a1a0a' || image.readUInt32BE(16) !== 1155 || image.readUInt32BE(20) !== 428) throw new Error('Expected the 1155x428 extracted reference rack PNG.');
const x=1.617195811466863,y=5.361483135485282,w=13.92472787730751,h=5.1592174425;
let paths='', count=0, ellipses=0, circularFallbacks=0;
for (const shape of shapes) {
  const c=shape.cells, angle=Number(c.Angle||0)*180/Math.PI, px=Number(c.PinX||0),py=Number(c.PinY||0), lx=Number(c.LocPinX||0),ly=Number(c.LocPinY||0);
  const fx=c.FlipX==='1'?-1:1, fy=c.FlipY==='1'?-1:1;
  for(const section of shape.sections){
    if(section.children.some(r=>r.attrs.T==='ArcTo')) circularFallbacks++;
    const d=imp.geomPath(section,Number(c.Width||0),Number(c.Height||0)); if(!d) continue;
    if(d.includes(' A ')) ellipses++;
    paths+=`<g transform="translate(${px} ${py}) rotate(${angle}) scale(${fx} ${fy}) translate(${-lx} ${-ly})"><path d="${d}" fill="none" stroke="${c.LineColor}" stroke-width="0.012"/></g>`; count++;
  }
}
const svg=`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1155 428"><image width="1155" height="428" href="data:image/png;base64,${image.toString('base64')}"/><g transform="translate(0 428) scale(${1155/w} ${-428/h}) translate(${-x} ${-y})">${paths}</g><rect width="1155" height="25" fill="white" opacity=".95"/><text x="577" y="18" text-anchor="middle" font-size="15" fill="#a00000">REFERENCE-DERIVED COMPARISON ONLY — NOT WIREFLOW OUTPUT — DO NOT BUILD</text></svg>`;
fs.writeFileSync(outputPath,svg);
console.log('paths',count,'elliptic arcs',ellipses,'circular-arc sections approximated',circularFallbacks);
