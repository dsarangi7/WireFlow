/* Non-AI normalized template matching. Pixels are temporary analysis data;
   returned coordinates remain in the original picture coordinate system. */
function aykMatchTerminal(gray, width, height, template, expected, searchX, searchY) {
  const n = 441, mean = template.reduce((s,v)=>s+v,0)/n;
  const centered = template.map(v=>v-mean), energy = centered.reduce((s,v)=>s+v*v,0);
  if (!(energy > 1) || gray.length !== width*height) return null;
  let best = null;
  const peaks = [];
  function test(x,y) {
    if (x<10 || y<10 || x+10>=width || y+10>=height) return;
    let sum=0, sq=0, dot=0, k=0;
    for(let dy=-10;dy<=10;dy++) for(let dx=-10;dx<=10;dx++) {
      const v=gray[(y+dy)*width+x+dx]; sum+=v; sq+=v*v; dot+=v*centered[k++];
    }
    const variance=sq-sum*sum/n;
    const score=variance>1 ? dot/Math.sqrt(energy*variance) : 0;
    if(!best || score>best.score) best={x,y,score};
    return {x,y,score};
  }
  const cx=Math.round(expected.x),cy=Math.round(expected.y);
  for(let y=cy-searchY;y<=cy+searchY;y+=3) for(let x=cx-searchX;x<=cx+searchX;x+=3) {
    const candidate=test(x,y);
    if(candidate) peaks.push(candidate);
  }
  peaks.sort((a,b)=>b.score-a.score);
  const refined=[];
  for(const p of peaks) {
    if(refined.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<4)) continue;
    refined.push(p);
    for(let y=p.y-2;y<=p.y+2;y++) for(let x=p.x-2;x<=p.x+2;x++) test(x,y);
    if(refined.length===8) break;
  }
  return best && best.score>=.82 ? best : null;
}

function aykDetectComponentPorts(gray,width,height,scale,kind,anchor) {
  const definition=AYK_PORT_TEMPLATES[kind];
  if(!definition || !(scale>0) || !anchor || !Number.isFinite(anchor.x) || !Number.isFinite(anchor.y)) return null;
  const keys={S:'commS',N:'commN',negative:'pwrNeg',positive:'pwrPos','string+':'pwrPos','string-':'pwrNeg','bus+':'busPos','bus-':'busNeg'};
  const points={}, missing=[];
  for(const port of definition.ports) {
    const expected={x:anchor.x*scale+(port.x-definition.anchor.x)*3,y:anchor.y*scale+(port.y-definition.anchor.y)*3};
    let match=null;
    for(const variant of [...(port.variants || [port.gray]), ...(port.svgVariants || [])]) {
      const found=aykMatchTerminal(gray,width,height,variant,expected,12,45);
      if(found && (!match || found.score>match.score)) match=found;
    }
    const key=keys[port.name];
    if(match) points[key]={x:match.x/scale,y:match.y/scale,score:match.score}; else missing.push(key);
  }
  const values=Object.values(points);
  if(values.some((a,i)=>values.some((b,j)=>i<j && Math.hypot(a.x-b.x,a.y-b.y)*scale<8))) return {points:{},missing:definition.ports.map(p=>keys[p.name])};
  return {points,missing};
}

/* Promote only a complete set after an explicit engineer review action.
   No shared-offset fallback is allowed for missing detected terminals. */
function aykReviewedPortMap(moduleSlots, groups, candidates) {
  const errors=[],modulePortPoints={},devicePorts={};
  const valid=p=>p && Number.isFinite(p.x) && Number.isFinite(p.y);
  if(!Array.isArray(moduleSlots) || !moduleSlots.length || !Array.isArray(groups) || !groups.length || !candidates || typeof candidates!=='object') return {errors:['Complete component markings and run port detection first.']};
  function read(id,keys) {
    const result={};
    for(const key of keys) {
      const p=candidates[id] && candidates[id][key];
      if(!valid(p)) errors.push(id+': '+key+' is unresolved.');
      else result[key]={x:p.x,y:p.y};
    }
    return result;
  }
  for(const slot of moduleSlots) modulePortPoints[slot]=read(slot,['commS','commN','pwrNeg','pwrPos']);
  for(const group of groups) {
    const ports=read(group.id,['commS','commN','pwrPos','busPos','busNeg','pwrNeg']);
    const jb=read(group.jb,['pwrPos','pwrNeg']);
    if(!group.slot || !group.id || !group.jb) errors.push('SSC or junction-box association is unresolved.');
    else devicePorts[group.slot]={...ports,jbPos:jb.pwrPos,jbNeg:jb.pwrNeg};
  }
  return errors.length ? {errors} : {errors:[],modulePortPoints,devicePorts};
}
