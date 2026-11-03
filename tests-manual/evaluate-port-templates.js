/* Evaluate source-image detections against earlier measured port candidates.
 * These candidates are comparison data, not electrical approval.
 * node tests-manual/evaluate-port-templates.js GRAY.bin WIDTH HEIGHT MODULES.json DEVICES.json REPORT.json */
const fs=require('fs'),path=require('path');
const [grayPath,w,h,modulePath,devicePath,output]=process.argv.slice(2);
if(!output || fs.existsSync(output)) throw new Error('Provide inputs and a new report path.');
const root=path.resolve(__dirname,'..');
const detect=new Function(fs.readFileSync(path.join(root,'js/port-templates.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'js/port-detection.js'),'utf8')+'\nreturn aykDetectComponentPorts;')();
const gray=fs.readFileSync(grayPath),width=Number(w),height=Number(h);
if(gray.length!==width*height)throw new Error('Grayscale buffer dimensions do not agree.');
const modules=JSON.parse(fs.readFileSync(modulePath,'utf8')).modules;
const devices=JSON.parse(fs.readFileSync(devicePath,'utf8'));
const key={S:'commS',N:'commN',negative:'pwrNeg',positive:'pwrPos','string+':'pwrPos','string-':'pwrNeg','bus+':'busPos','bus-':'busNeg'};
const report={comparison:'earlier measured candidates, not approved ground truth',threshold:.82,coordinates:'1155 x 428 rack source, Y down',sets:[]};
for(const [kind,entities] of [['module',modules],['ssc',devices.ssc],['jb',devices.junction_boxes]]){
 const stats={kind,components:0,complete:0,expected:0,found:0,moreThan3Pixels:0,maxDifferencePixels:0,unresolved:[]};
 for(let i=0;i<entities.length;i++){
  if(kind==='module'?i%7===0:i<2)continue; // omit template-source components
  const e=entities[i],anchor=kind==='module'?{x:e.face_x+42,y:e.face_y+15}:kind==='ssc'?{x:e.x+37,y:e.y+29.5}:{x:e.x+39,y:e.y+10};
  const r=detect(gray,width,height,3,kind,anchor);stats.components++;stats.expected+=e.ports.length;
  if(!r.missing.length)stats.complete++;
  for(const p of e.ports){const q=r.points[key[p.name]];
   if(!q){stats.unresolved.push({component:i,port:p.name});continue;}
   stats.found++;const distance=Math.hypot(q.x-p.point.x,q.y-p.point.y);
   stats.maxDifferencePixels=Math.max(stats.maxDifferencePixels,distance);
   if(distance>3)stats.moreThan3Pixels++;
  }
 }
 report.sets.push(stats);
}
fs.writeFileSync(output,JSON.stringify(report,null,2));
console.log(JSON.stringify(report.sets.map(({unresolved,...summary})=>summary),null,2));
