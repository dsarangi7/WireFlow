/* Exercise the GENERAL production router on the reference fixture.
 * Fixture grouping/terminal loading is reused; explicit sample routes are discarded.
 * Usage: node tests-manual/evaluate-general-routing.js RACK.png MODULES.json DEVICES.json RACK_OUT.svg SHEET_OUT.svg
 * Uses candidate positions from the INPUT image plus sample-specific grouping and
 * visually inferred lane heuristics. It never reads the finished reference.
 * Output is explicitly unapproved and must not be used to build a rack.
 */
'use strict';
const fs = require('fs'), path = require('path');
const args = process.argv.slice(2);
if (args.length !== 5 || new Set(args.map(x => path.resolve(x))).size !== 5) throw new Error('Provide five distinct input/output paths.');
const [pngPath, modulePath, devicePath, rackOutput, sheetOutput] = args;
if(fs.existsSync(rackOutput) || fs.existsSync(sheetOutput)) throw Error('Choose new output paths; originals are never overwritten.');
const png = fs.readFileSync(pngPath);
if (png.length < 24 || png.toString('hex', 0, 8) !== '89504e470d0a1a0a' || png.readUInt32BE(16) !== 1155 || png.readUInt32BE(20) !== 428) throw new Error('Expected the fixture-specific rack PNG.');
const modules = JSON.parse(fs.readFileSync(modulePath, 'utf8')).modules;
const detections = JSON.parse(fs.readFileSync(devicePath, 'utf8'));
if (!Array.isArray(modules) || modules.length !== 60 || detections.ssc.length !== 5 || detections.junction_boxes.length !== 5) throw new Error('This sample requires 60 module candidates, 5 SSCs and 5 junction-box panels.');
const getPoint = (entity, name) => {
  const port = entity.ports.find(p => p.name === name), p = port && port.point;
  if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1155 || p.y < 0 || p.y > 428) throw new Error('Missing or invalid candidate: ' + name);
  return { x: p.x, y: p.y };
};
const xs=modules.map(m=>m.face_x), ys=modules.map(m=>m.face_y);
if (![...xs,...ys].every(Number.isFinite)) throw new Error('Invalid module-face coordinates.');
const xMin=Math.min(...xs), xMax=Math.max(...xs), yMin=Math.min(...ys), yMax=Math.max(...ys);
const pitchX=(xMax-xMin)/9, pitchY=(yMax-yMin)/7;
if (!(pitchX > 50 && pitchY > 20)) throw new Error('Unexpected candidate grid.');
const slotSet=new Set(), modulePortPoints={};
for (const m of modules) {
  const c=Math.round((m.face_x-xMin)/pitchX), r=Math.round((m.face_y-yMin)/pitchY), k=c+','+r;
  if(c<0||c>9||r<0||r>7||slotSet.has(k)) throw new Error('Ambiguous candidate grid position.');
  slotSet.add(k);
  modulePortPoints[k]={commS:getPoint(m,'S'),commN:getPoint(m,'N'),pwrNeg:getPoint(m,'negative'),pwrPos:getPoint(m,'positive')};
}
for(let i=0;i<5;i++) {
  const expected=[...Array.from({length:8},(_,r)=>(2*i)+','+r), ...Array.from({length:4},(_,r)=>(2*i+1)+','+(r+4))];
  if (!expected.every(k=>slotSet.has(k))) throw new Error('The fixture-specific 8+4 module grouping did not match the image.');
}
const means={commS:0,commN:0,pwrNeg:0,pwrPos:0}; let yMean=0;
for(const m of modules){
  const points=[getPoint(m,'S'),getPoint(m,'N'),getPoint(m,'negative'),getPoint(m,'positive')];
  ['commS','commN','pwrNeg','pwrPos'].forEach((key,i)=>{means[key]+=points[i].x-(m.face_x+42);yMean+=points[i].y-(m.face_y+29);});
}
const ports={}; for(const key of Object.keys(means)) ports[key]={x:means[key]/modules.length,y:yMean/(modules.length*4)};
const cal={ok:true,imgW:1155,imgH:428,x0:xMin+42,y0:yMin+29,pitchX,pitchY,cols:10,rows:8,mmPerPx:1};
const ssc=[...detections.ssc].sort((a,b)=>a.x-b.x), jb=[...detections.junction_boxes].sort((a,b)=>a.x-b.x);
const devices={},groups=[];
function arcPoints(start,control,end){const p=[];for(let i=1;i<8;i++){const t=i/8,u=1-t;p.push({x:u*u*start.x+2*u*t*control.x+t*t*end.x,y:u*u*start.y+2*u*t*control.y+t*t*end.y});}return p;}
for(let i=0;i<5;i++){
  if (Math.abs(ssc[i].x-jb[i].x)>15) throw new Error('Ambiguous SSC/JB visual alignment; no pairing inferred.');
  const slot='fixture-'+i, dev=ssc[i], box=jb[i];
  const d={commS:getPoint(dev,'S'),commN:getPoint(dev,'N'),pwrPos:getPoint(dev,'string+'),pwrNeg:getPoint(dev,'string-'),busPos:getPoint(dev,'bus+'),busNeg:getPoint(dev,'bus-'),jbPos:getPoint(box,'positive'),jbNeg:getPoint(box,'negative')};
  d.draftRoutes={};
  for(const positive of [true,false]){
    const key=positive?'busPos':'busNeg', start=d[key], end=positive?d.jbPos:d.jbNeg;
    const railX=box.x+(positive?90.3:94.9), lowY=start.y-(positive?23.8:20.2), topY=end.y+55;
    const top={x:railX,y:topY}; d.draftRoutes[key]=[{x:railX,y:lowY},top,...arcPoints(top,{x:railX,y:end.y},end)];
  }
  // Sample-informed comm rail geometry, subject to engineering review.
  const topModule=modules.find(m=>Math.round((m.face_x-xMin)/pitchX)===2*i && Math.round((m.face_y-yMin)/pitchY)===0);
  const terminal=getPoint(topModule,'S'), railX=topModule.face_x+98;
  d.draftRoutes.commN=[{x:railX,y:d.commN.y-16},{x:railX,y:terminal.y+4},{x:terminal.x+70,y:terminal.y-11},{x:terminal.x+10,y:terminal.y-11}];
  // Fixture-only lane and bends measured from the reference drawing, pending
  // engineering review of the actual cable route and clearance.
  d.draftRoutes.stringPos=[{x:railX-3,y:d.pwrPos.y-25},{x:railX-3,y:getPoint(topModule,'positive').y+11.5}];
  devices[slot]=d;
  groups.push({slot,label:'S'+(5-i),order:[...Array.from({length:4},(_,r)=>(2*i+1)+','+(r+4)),...Array.from({length:8},(_,r)=>(2*i)+','+(7-r))]});
}
const root=path.resolve(__dirname,'..');
const source=fs.readFileSync(path.join(root,'js/frontview.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'js/simple-wiring.js'),'utf8');
const helpers=new Function(fs.readFileSync(path.join(root,'js/engine.js'),'utf8')+'\nreturn {sheetSvgPrimitive,sheetEsc};')();
const api=new Function('slotCell','SSC_PALETTE','sheetSvgPrimitive','sheetEsc',source+'\nreturn {pictureModuleWiring,pictureSheetSvg,pictureDeviceLabelsSvg,pictureWiringSvg,markingSteps,fvSvg,pictureSuggestBottomCurves,picturePowerCrossings};')(s=>{const [c,r]=s.split(',').map(Number);return {c,r};},['#f9c499','#7f7f7f','#fee599','#7e649e','#4bacc6'],helpers.sheetSvgPrimitive,helpers.sheetEsc);

for(const d of Object.values(devices)){delete d.draftRoutes;delete d.draftCurveRoutes;}
let wires=api.pictureModuleWiring(groups,cal,ports,devices,modulePortPoints);
const bottom=api.pictureSuggestBottomCurves(groups,wires,{});
if(bottom) wires=api.pictureModuleWiring(groups,cal,ports,devices,modulePortPoints,null,bottom.routes);
const audit=api.picturePowerCrossings(wires);
fs.writeFileSync(rackOutput,api.pictureWiringSvg(cal,{src:'data:image/png;base64,'+png.toString('base64')},wires,{noGrid:true}));
fs.writeFileSync(sheetOutput,JSON.stringify({connections:wires.filter(w=>w.kind!=='label').length,unrouted:wires.filter(w=>w.kind!=='label' && w.pts.length<2).map(w=>({group:w.group,kind:w.kind,key:w.routeKey})),powerAudit:audit},null,2));
console.log(fs.readFileSync(sheetOutput,'utf8'));

