const fs=require('fs'),path=require('path'),assert=require('assert');
const root=path.resolve(__dirname,'..');
const api=new Function(fs.readFileSync(path.join(root,'js/port-templates.js'),'utf8')+'\n'+fs.readFileSync(path.join(root,'js/port-detection.js'),'utf8')+'\nreturn {aykDetectComponentPorts,templates:AYK_PORT_TEMPLATES};')();
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
