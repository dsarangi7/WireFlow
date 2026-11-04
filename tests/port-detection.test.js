const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const api=new Function(fs.readFileSync(path.join(root,'js/port-templates.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'js/port-detection.js'),'utf8')+'\nreturn {aykDetectComponentPorts,aykReviewedPortMap,templates:AYK_PORT_TEMPLATES};')();
const gray=new Uint8Array(500*500).fill(255),anchor={x:70,y:70},definition=api.templates.module;
let result=api.aykDetectComponentPorts(gray,500,500,3,'module',anchor);
assert.strictEqual(result.missing.length,4,'blank drawing must not invent ports');
for(const p of definition.ports){
  const x=Math.round(anchor.x*3+(p.x-definition.anchor.x)*3),y=Math.round(anchor.y*3+(p.y-definition.anchor.y)*3);
  for(let dy=-10;dy<=10;dy++)for(let dx=-10;dx<=10;dx++)gray[(y+dy)*500+x+dx]=p.gray[(dy+10)*21+dx+10];
}
result=api.aykDetectComponentPorts(gray,500,500,3,'module',anchor);
assert.strictEqual(result.missing.length,0,'recognizes four separate reference shapes');
assert.strictEqual(Object.keys(result.points).length,4);
assert.strictEqual(api.aykDetectComponentPorts(gray,500,500,0,'module',anchor),null);
console.log('Port template tests passed (blank, known shapes, coordinate scale, invalid scale).');
const point=(x)=>({x,y:10,score:.99});
const candidates={
 '0,0':{commS:point(1),commN:point(2),pwrNeg:point(3),pwrPos:point(4)},
 'SSC-7':{commS:point(10),commN:point(11),pwrPos:point(12),busPos:point(13),busNeg:point(14),pwrNeg:point(15)},
 'JB-1':{pwrPos:point(20),pwrNeg:point(21)}
};
const groups=[{id:'SSC-7',slot:'1,0',jb:'JB-1'}];
const accepted=api.aykReviewedPortMap(['0,0'],groups,candidates);
assert.deepStrictEqual(accepted.errors,[]);
assert.deepStrictEqual(accepted.devicePorts['1,0'].jbPos,{x:20,y:10});
candidates['0,0'].pwrNeg.x=99;
assert.strictEqual(accepted.modulePortPoints['0,0'].pwrNeg.x,3,'accepted coordinates are copied');
delete candidates['JB-1'].pwrNeg;
const incomplete=api.aykReviewedPortMap(['0,0'],groups,candidates);
assert(incomplete.errors.some(e=>e.includes('JB-1')));
assert(!incomplete.devicePorts,'incomplete detections cannot be promoted');
assert(api.aykReviewedPortMap([],groups,candidates).errors.length);
console.log('Reviewed candidate mapping tests passed (identity, copy, missing-terminal gate).');
