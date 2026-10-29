/* Declared counts and click identities are separate from the planner's grid.
   In particular, junction boxes can sit above the calibrated module grid. */
function markingPlanErrors(banks) {
  if (!Array.isArray(banks) || !banks.length || banks.length > 8) return ['Enter between 1 and 8 banks.'];
  const errors = [];
  banks.forEach((bank, i) => {
    [['msms', 1, 12], ['sscs', 1, 24], ['modules', 2, 48], ['junctionBoxes', 1, 24], ['acdps', 0, 24]].forEach(([key, min, max]) => {
      if (!Number.isInteger(bank[key]) || bank[key] < min || bank[key] > max) errors.push('Bank ' + (i + 1) + ': ' + key + ' must be a whole number from ' + min + ' to ' + max + '.');
    });
  });
  return errors;
}

function markingSteps(banks) {
  if (markingPlanErrors(banks).length) return [];
  const steps = [], acdps = [];
  let ssc = 0, msm = 0, jb = 0, acdp = 0;
  banks.forEach((bank, bi) => {
    const bankNo = bi + 1;
    const add = (kind, id, label, extra) => steps.push(Object.assign({ key: id, kind, label, bank: bankNo }, extra || {}));
    for (let m = 0; m < bank.msms; m++) add('msm', 'MSM-' + (++msm), 'MSM' + msm);
    const jbIds = Array.from({ length: bank.junctionBoxes }, (_, i) => 'JB-' + (jb + i + 1));
    for (let s = 0; s < bank.sscs; s++) {
      const id = 'SSC-' + (++ssc);
      add('ssc', id, 'SSC' + ssc);
      add('jb', id + ':JB', 'junction box for SSC' + ssc, { ssc: id, jbIds, defaultJb: jbIds[s] || '' });
      for (let m = 1; m <= bank.modules; m++) add('module', id + ':M' + m, 'SSC' + ssc + ' · M' + m, { ssc: id, module: m });
    }
    for (let j = bank.sscs; j < bank.junctionBoxes; j++) add('jb', jbIds[j], jbIds[j], { jbIds: [jbIds[j]], defaultJb: jbIds[j] });
    jb += bank.junctionBoxes;
    for (let a = 0; a < bank.acdps; a++) acdps.push({ key: 'ACDP-' + (++acdp), kind: 'acdp', label: 'ACDP' + acdp, bank: bankNo });
  });
  return steps.concat(acdps); // ACDPs are identification only, always last.
}

function markingIssues(plan) {
  if (!plan) return ['Declare the bank and component counts before marking.'];
  const errors = markingPlanErrors(plan.banks);
  if (errors.length) return errors;
  const steps = markingSteps(plan.banks), records = plan.records || [];
  const slots = new Set(), boxes = new Set();
  records.forEach((record, i) => {
    const step = steps[i];
    if (!step || record.key !== step.key) { errors.push('The saved marking order is inconsistent. Undo and mark again.'); return; }
    if (!record.point || !Number.isFinite(record.point.x) || !Number.isFinite(record.point.y)) errors.push(step.label + ' has no valid picture position.');
    if (step.kind === 'jb') {
      if (!step.jbIds.includes(record.jbId)) errors.push('Choose a declared junction box for ' + step.label + '.');
      boxes.add(record.jbId);
    } else {
      if (!/^\d+,\d+$/.test(record.slot || '') || slots.has(record.slot)) errors.push(step.label + ' needs its own grid position.');
      slots.add(record.slot);
    }
  });
  if (records.length < steps.length) errors.push((steps.length - records.length) + ' marking steps remaining. Next: Bank ' + steps[records.length].bank + ' · ' + steps[records.length].label + '.');
  const expectedBoxes = plan.banks.reduce((n, b) => n + b.junctionBoxes, 0);
  if (boxes.size < expectedBoxes) errors.push((expectedBoxes - boxes.size) + ' declared junction boxes still unmarked.');
  return errors;
}

function markingRecord(plan, point, slot, jbId) {
  const steps = markingSteps(plan.banks), records = plan.records || [];
  const step = steps[records.length];
  if (!step) return { error: 'All declared components are marked.' };
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return { error: 'Click a valid position on the picture.' };
  if (step.kind === 'jb') {
    if (!step.jbIds.includes(jbId)) return { error: 'Select the junction box belonging to this SSC before clicking.' };
    const previous = records.find(r => r.jbId === jbId);
    if (previous && Math.hypot(previous.point.x - point.x, previous.point.y - point.y) > 12) return { error: jbId + ' is already marked. Click its existing marker to share it, or select another box.' };
    if (records.some(r => r.jbId && r.jbId !== jbId && Math.hypot(r.point.x - point.x, r.point.y - point.y) < 12)) return { error: 'A different junction box is already marked here. Select its identity to share it.' };
    return { record: { key: step.key, point: previous ? previous.point : point, jbId } };
  }
  if (!/^\d+,\d+$/.test(slot || '')) return { error: 'Click a grid position on the drawing.' };
  if (records.some(r => r.slot === slot)) return { error: 'This position is already marked. Choose another position or undo the last mark.' };
  return { record: { key: step.key, slot, point } };
}

function markingLayout(plan) {
  const issues = markingIssues(plan);
  if (issues.length) throw new Error(issues.join(' '));
  const steps = markingSteps(plan.banks), records = plan.records;
  const layout = { version: 1, mode: 'manual', sscs: [], assignment: {} };
  steps.forEach((step, i) => {
    const record = records[i];
    if (step.kind === 'ssc') layout.sscs.push({ id: step.key, label: step.label, slot: record.slot, order: [] });
    if (step.ssc) {
      const group = layout.sscs.find(s => s.id === step.ssc);
      if (step.kind === 'jb') group.jb = record.jbId;
      if (step.kind === 'module') { group.order.push(record.slot); layout.assignment[record.slot] = step.ssc; }
    }
  });
  layout.sscs.forEach(s => { s.capacity = s.order.length; });
  return layout;
}

function pictureDeviceLabels(plan, cal) {
  if (!plan || !cal || !cal.ok) return [];
  const steps = markingSteps(plan.banks), seen = new Set();
  return (plan.records || []).flatMap((record, i) => {
    const step = steps[i];
    if (!step || step.kind === 'module' || !record.point) return [];
    const label = record.jbId || step.label;
    if (seen.has(label)) return [];
    seen.add(label);
    return [{ label, point: record.point }];
  });
}

function pictureDeviceLabelsSvg(plan, cal) {
  const size = Math.max(9, Math.min(cal.pitchX, cal.pitchY) * .19);
  return pictureDeviceLabels(plan, cal).map(item => `<text x="${item.point.x}" y="${item.point.y}" text-anchor="middle" font-size="${size}" font-weight="700" fill="#203954" stroke="white" stroke-width="2" paint-order="stroke" pointer-events="none">${item.label}</text>`).join('');
}

/* Four measured offsets describe the ports of identical modules in picture pixels. */
function modulePortsValid(ports) {
  return !!ports && ['commS', 'commN', 'pwrNeg', 'pwrPos'].every(name =>
    ports[name] && Number.isFinite(ports[name].x) && Number.isFinite(ports[name].y));
}

function portMarkingPrompt(portStep, deviceStep) {
  const moduleSteps = [
    'Click the centre of a marked battery module.',
    'Click the communication S port on that module.',
    'Click the communication N port on that module.',
    'Click the power NEGATIVE (−) port on that module.',
    'Click the power POSITIVE (+) port on that module.',
  ];
  const deviceSteps = [
    'Click the centre of the SSC you are marking.',
    'Click the SSC communication S port.',
    'Click the SSC communication N port.',
    'Click the SSC power NEGATIVE (−) port.',
    'Click the SSC power POSITIVE (+) port.',
    'Click the SSC bus B− port.',
    'Click the SSC bus B+ port.',
    'Click the junction-box NEGATIVE (−) terminal.',
    'Click the junction-box POSITIVE (+) terminal.',
  ];
  if (deviceStep >= 1 && deviceStep <= deviceSteps.length) return { title: 'SSC AND JUNCTION BOX', current: deviceStep, total: deviceSteps.length, instruction: deviceSteps[deviceStep - 1] };
  if (portStep >= 1 && portStep <= moduleSteps.length) return { title: 'BATTERY MODULE', current: portStep, total: moduleSteps.length, instruction: moduleSteps[portStep - 1] };
  return null;
}

/* Render only connections whose physical terminal locations were marked.
   Use the same S→N, −→+ and bus-polarity ordering as the wiring engine. */
function pictureModuleWiring(groups, cal, ports, devicePorts) {
  if (!cal || !cal.ok || !modulePortsValid(ports)) return [];
  const segments = [];
  (groups || []).forEach((group, gi) => {
    const slots = group.order.map(slotCell);
    const tag = { group: gi, groupLabel: group.label, groupColor: SSC_PALETTE[gi % SSC_PALETTE.length] };
    const at = (slot, port) => {
      const centre = fvSlotCenter(cal, slot.c, slot.r);
      return { x: centre.x + ports[port].x, y: centre.y + ports[port].y };
    };
    slots.forEach((slot, i) => {
      const centre = fvSlotCenter(cal, slot.c, slot.r);
      segments.push({ ...tag, kind: 'label', pts: [centre], m: i + 1, lenMm: 0 });
      if (!i) return;
      const previous = slots[i - 1];
      [['power', 'pwrNeg', 'pwrPos'], ['comm', 'commS', 'commN']].forEach(([kind, from, to]) => {
        const a = at(previous, from), b = at(slot, to);
        segments.push({ ...tag, kind, pts: [a, b], lenMm: fvDist(a, b) * cal.mmPerPx });
      });
    });
    const d = devicePorts && devicePorts[group.slot];
    const names = ['commS', 'commN', 'pwrNeg', 'pwrPos', 'busNeg', 'busPos', 'jbNeg', 'jbPos'];
    if (slots.length && d && names.every(name => d[name] && Number.isFinite(d[name].x) && Number.isFinite(d[name].y))) {
      const connections = [
        ['sscp', d.pwrPos, at(slots[0], 'pwrPos')],
        ['sscp', d.pwrNeg, at(slots[slots.length - 1], 'pwrNeg')],
        ['sscc', d.commS, at(slots[0], 'commN')],
        ['sscc', d.commN, at(slots[slots.length - 1], 'commS')],
        ['sscp', d.busPos, d.jbPos],
        ['sscp', d.busNeg, d.jbNeg],
      ];
      connections.forEach(([kind, a, b]) => segments.push({ ...tag, kind, pts: [a, b], lenMm: fvDist(a, b) * cal.mmPerPx }));
    }
  });
  return segments;
}

/* Create a draft A3 picture sheet for the existing Visio package writer.
   The picture and wires share the same aspect-preserving transform. */
function pictureVisioModel(project, cal, segments) {
  if (!cal || !cal.ok || !(cal.imgW > 0) || !(cal.imgH > 0) || !project.underlay || !/^data:image\/(png|jpeg|jpg|svg\+xml);base64,/i.test(project.underlay.src || '')) {
    throw new Error('An imported PNG, JPG or SVG rack picture and calibrated grid are required.');
  }
  const scale = Math.min(1510 / cal.imgW, 740 / cal.imgH);
  const rect = { x: 85 + (1510 - cal.imgW * scale) / 2, y: 145 + (740 - cal.imgH * scale) / 2, w: cal.imgW * scale, h: cal.imgH * scale };
  const primitives = [
    { type: 'rect', layer: 'FRAME', x: 40, y: 40, w: 1600, h: 1108, width: 1.5, fill: 'none' },
    { type: 'text', layer: 'TEXT', x: 80, y: 88, size: 25, bold: true, text: 'Wiring Diagram - ' + (project.name || 'Rack') },
    { type: 'text', layer: 'TEXT', x: 80, y: 118, size: 16, bold: true, text: 'DRAFT - verify terminals, assignments and routes' },
    { type: 'rect', layer: 'TITLE', x: 1078, y: 990, w: 560, h: 156, width: 1.2, fill: 'none' },
    { type: 'text', layer: 'TEXT', x: 1092, y: 1013, size: 13, bold: true, text: 'AYK POWER LTD.' },
    { type: 'text', layer: 'TEXT', x: 1092, y: 1046, size: 12, text: 'DRAWING: ' + (project.name || 'Rack') },
    { type: 'text', layer: 'TEXT', x: 1092, y: 1076, size: 12, text: 'NUMBER: ' + (project.drawing_no || 'Not specified') + '   REV: ' + (project.revision || 'A') },
    { type: 'text', layer: 'TEXT', x: 1092, y: 1110, size: 12, text: 'DRAFT - ENGINEERING REVIEW REQUIRED' },
  ];
  pictureDeviceLabels(project.config && project.config.numbering && project.config.numbering.marking, cal).forEach(item => {
    primitives.push({ type: 'text', layer: 'NUMBER', x: rect.x + item.point.x * scale, y: rect.y + item.point.y * scale, size: 12, anchor: 'middle', bold: true, text: item.label });
  });
  for (const segment of segments || []) {
    if (segment.kind === 'label') {
      const p = segment.pts[0];
      primitives.push({ type: 'text', layer: 'NUMBER', x: rect.x + p.x * scale, y: rect.y + p.y * scale, size: 12, anchor: 'middle', bold: true, text: (segment.groupLabel || '') + '-M' + segment.m });
      continue;
    }
    const layer = segment.kind === 'power' || segment.kind === 'sscp' ? 'POWER' : 'COMM';
    for (let i = 1; i < segment.pts.length; i++) {
      const a = segment.pts[i - 1], b = segment.pts[i];
      primitives.push({ type: 'line', layer, x1: rect.x + a.x * scale, y1: rect.y + a.y * scale, x2: rect.x + b.x * scale, y2: rect.y + b.y * scale, width: 1.2 });
    }
  }
  return { primitives, underlay: { kind: 'image', src: project.underlay.src, ...rect }, draftPicture: true };
}

/* Picture-first rack input for the existing deterministic wiring engine. */
async function tabSimpleWiring(el, project, ctx) {
  if (!project.underlay || project.underlay.kind !== 'image' || !project.underlay.src) {
    el.innerHTML = '<div class="card"><h2>Import a rack drawing</h2><p>Choose a VSDX, PNG, JPG or SVG rack picture before marking its components.</p><a class="btn btn-primary" href="#/project/' + project.id + '">Back to import</a></div>';
    return;
  }
  const image = new Image();
  await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error('Could not open the rack picture.')); image.src = project.underlay.src; });
  const saved = (project.config && project.config.numbering) || {};
  const existingRack = saved.rack && saved.mode === 'layout' ? rackEnsure(saved.rack) : null;
  const st = {
    rack: existingRack,
    cal: existingRack ? fvCalib(saved.cal) : null,
    click: null, calibrating: 0,
    ports: modulePortsValid(saved.modulePorts) ? saved.modulePorts : null,
    portStep: 0, portRef: null, pendingPorts: {}, previousPorts: null, zoom: 1,
    devicePorts: JSON.parse(JSON.stringify(saved.devicePorts || {})), deviceStep: 0, deviceSlot: '', pendingDevice: {},
    plan: saved.marking ? JSON.parse(JSON.stringify(saved.marking)) : null,
    banks: saved.marking ? JSON.parse(JSON.stringify(saved.marking.banks)) : [{ msms: 1, sscs: 5, modules: 12, junctionBoxes: 5, acdps: 2 }],
    saving: false, saveFailed: false,
    generated: !!(existingRack && saved.cal && fvCalib(saved.cal).ok && project.config.layout && modulePortsValid(saved.modulePorts)), message: '',
  };
  function rebuildMarks() {
    st.rack.cells.forEach(cell => { cell.kind = 'empty'; cell.label = ''; });
    const steps = markingSteps(st.plan.banks);
    st.plan.records.forEach((record, i) => {
      if (!record.slot) return;
      const slot = slotCell(record.slot), cell = rackCell(st.rack, slot.c, slot.r);
      if (cell) { cell.kind = steps[i].kind; cell.label = steps[i].label; }
    });
  }
  async function persist() {
    st.saving = true; render();
    const config = JSON.parse(JSON.stringify(project.config || {}));
    config.numbering = Object.assign({}, config.numbering, { mode: 'layout', rack: st.rack, cal: st.cal, marking: st.plan, modulePorts: st.ports, devicePorts: st.devicePorts });
    delete config.layout;
    st.saveFailed = !await ctx.saveProject({ config });
    st.saving = false;
    if (st.saveFailed) st.message = 'Could not save these markings. Retry saving before continuing or leaving this page.';
    render();
  }
  function render() {
    const oldScroll = el.querySelector('#simple-picture-scroll');
    const scrollLeft = oldScroll ? oldScroll.scrollLeft : 0, scrollTop = oldScroll ? oldScroll.scrollTop : 0;
    const rack = st.rack;
    const cal = st.cal;
    const marked = rack ? rack.cells.filter(cell => cell.kind !== 'empty') : [];
    const steps = st.plan ? markingSteps(st.plan.banks) : [];
    const records = st.plan ? st.plan.records : [];
    const next = steps[records.length];
    const issues = markingIssues(st.plan);
    let svg = '';
    if (cal && cal.ok) {
      const width = cal.imgW, height = cal.imgH;
      const marks = marked.map(cell => {
        const p = fvSlotCenter(cal, cell.c, cell.r);
        const color = cell.kind === 'module' ? '#087f78' : cell.kind === 'ssc' ? '#d65b13' : '#365fb6';
        const label = cell.label || (cell.kind === 'module' ? 'M' : cell.kind.toUpperCase());
        const radius = Math.max(6, Math.min(cal.pitchX, cal.pitchY) * 0.17);
        return `<g pointer-events="none"><circle cx="${p.x}" cy="${p.y}" r="${radius * .4}" fill="${color}" stroke="white" stroke-width="2"/><text x="${p.x + radius * .5}" y="${p.y - radius * .5}" font-size="${radius * .9}" font-weight="700" fill="${color}" stroke="white" stroke-width="2" paint-order="stroke">${esc(label)}</text></g>`;
      }).join('') + records.filter(record => record.jbId).map(record => `<g pointer-events="none"><circle cx="${record.point.x}" cy="${record.point.y}" r="7" fill="#365fb6"/><text x="${record.point.x + 10}" y="${record.point.y}" font-size="13" fill="#203954">${esc(record.jbId)}</text></g>`).join('');
      const groups = st.generated ? layoutGroups(project) : [];
      const wiring = st.generated ? pictureModuleWiring(groups, cal, st.ports, st.devicePorts) : [];
      const portMarks = st.portRef && st.portStep >= 2 ? Object.entries(st.pendingPorts).map(([name, offset]) =>
        `<circle cx="${st.portRef.x + offset.x}" cy="${st.portRef.y + offset.y}" r="${Math.max(3, Math.min(cal.pitchX, cal.pitchY) * .045)}" fill="${name.startsWith('comm') ? '#00a651' : '#e02020'}" stroke="white" stroke-width="1" pointer-events="none"/>`).join('') : '';
      const deviceMarks = st.deviceStep >= 2 ? Object.entries(st.pendingDevice).map(([name, point]) =>
        `<circle cx="${point.x}" cy="${point.y}" r="${Math.max(3, Math.min(cal.pitchX, cal.pitchY) * .045)}" fill="${name.startsWith('comm') ? '#00a651' : '#e02020'}" stroke="white" stroke-width="1" pointer-events="none"/>`).join('') : '';
      svg = fvSvg(cal, { src: project.underlay.src }, wiring, { width, height, noGrid: true, sscLabels: true }).replace('</svg>', (st.generated ? pictureDeviceLabelsSvg(st.plan, cal) : marks) + portMarks + deviceMarks + '</svg>');
    } else {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.naturalWidth} ${image.naturalHeight}"><image width="${image.naturalWidth}" height="${image.naturalHeight}" href="${esc(project.underlay.src)}"/></svg>`;
    }
    const checks = st.generated ? runValidations(project, generateNetlist(project)).concat(layoutValidate(project)) : [];
    const failed = checks.filter(check => check.status !== 'pass');
    const prompt = portMarkingPrompt(st.portStep, st.deviceStep);
    if (prompt && st.deviceStep && st.plan && !issues.length) {
      const groups = markingLayout(st.plan).sscs;
      const group = st.deviceStep === 1 ? groups.find(s => !st.devicePorts[s.slot]) : groups.find(s => s.slot === st.deviceSlot);
      if (group) {
        prompt.title = group.label + ' / ' + group.jb;
        prompt.instruction = prompt.instruction.replace('the centre of the SSC you are marking', 'the centre of ' + group.label).replace('the junction-box', group.jb).replace('the SSC', group.label);
      }
    }
    el.innerHTML = `
      <div class="page-head slim"><div><h2>Build wiring</h2><p class="muted">Mark the components on your rack drawing, then generate the wiring.</p></div></div>
      <div class="card marking-counts" style="margin-bottom:16px"><h3>Declare the banks and component counts</h3>
        <p class="muted small">Confirm these counts from the imported drawing. Click order sets the SSC identities and each chain’s M1, M2 and so on. ACDPs are marked last for identification only.</p>
        <div class="btn-row"><label>Banks <input id="marking-bank-count" type="number" min="1" max="8" value="${st.banks.length}" style="width:80px"></label><button class="btn btn-ghost btn-sm" id="marking-banks">Update bank rows</button></div>
        <div class="marking-table"><table><thead><tr><th>Bank</th><th>MSMs</th><th>SSCs</th><th>Modules per SSC</th><th>Junction boxes</th><th>ACDPs</th></tr></thead><tbody>${st.banks.map((bank, i) => `<tr><th>${i + 1}</th>${['msms','sscs','modules','junctionBoxes','acdps'].map(key => `<td><input aria-label="Bank ${i + 1} ${key}" data-bank="${i}" data-count="${key}" type="number" min="${key === 'acdps' ? 0 : key === 'modules' ? 2 : 1}" max="${key === 'modules' ? 48 : key === 'msms' ? 12 : 24}" value="${bank[key]}"></td>`).join('')}</tr>`).join('')}</tbody></table></div>
        <button class="btn btn-ghost" id="marking-start" ${!cal || !cal.ok || st.saving ? 'disabled' : ''}>${st.plan || marked.length ? 'Restart ordered marking (replaces current marks)' : 'Start ordered marking'}</button>
        <p class="muted small">Set and align the grid below first. Edited counts apply when you start again, replacing current component marks and port measurements. Counts and progress are saved on this device.</p>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h3>1 · Set the rack grid</h3><p class="muted small">Enter the number of evenly spaced grid columns and rows, including empty positions. Enter the actual centre-to-centre distances in millimetres.</p>
        <div class="btn-row">
          <label>Columns <input id="simple-cols" type="number" min="2" max="12" value="${rack ? rack.cols : ''}" style="width:80px"></label>
          <label>Rows <input id="simple-rows" type="number" min="2" max="24" value="${rack ? rack.rows : ''}" style="width:80px"></label>
          <label>Column spacing (mm) <input id="simple-px" type="number" min="50" value="${rack ? rack.pitchX : ''}" style="width:105px"></label>
          <label>Row spacing (mm) <input id="simple-py" type="number" min="50" value="${rack ? rack.pitchY : ''}" style="width:105px"></label>
          <button class="btn btn-ghost" id="simple-grid">Set grid and align</button>
        </div>
        <p class="muted small">${st.calibrating === 1 ? 'Click the centre of the top-left grid position on the picture.' : st.calibrating === 2 ? 'Now click the centre of the bottom-right grid position.' : (cal && cal.ok ? 'Grid aligned. Start ordered marking using the declared counts above.' : 'After setting the grid, click its top-left and bottom-right position on the picture.')}</p>
      </div>
      <div class="card"><h3>2 · Mark components and ports on the drawing</h3>
        <p class="muted small">${rack ? rackModuleCells(rack).length : 0} modules · ${rack ? rackDeviceCells(rack, 'ssc').length : 0} SSCs marked. ${st.plan ? records.length + ' / ' + steps.length + ' ordered steps saved.' : 'Declare the counts and start ordered marking above.'}</p>
        ${st.plan ? '<div class="marking-progress">' + st.plan.banks.map((bank, bi) => {
          const mine = steps.slice(0, records.length).map((step, i) => ({ step, record: records[i] })).filter(item => item.step.bank === bi + 1);
          const count = kind => mine.filter(item => item.step.kind === kind).length;
          const boxes = new Set(mine.filter(item => item.record.jbId).map(item => item.record.jbId)).size;
          return `<p><strong>Bank ${bi + 1}</strong> · MSM ${count('msm')}/${bank.msms} · SSC ${count('ssc')}/${bank.sscs} · Modules ${count('module')}/${bank.sscs * bank.modules} · Junction boxes ${boxes}/${bank.junctionBoxes} · ACDP ${count('acdp')}/${bank.acdps}</p>`;
        }).join('') + '</div>' : ''}
        <div class="btn-row"><button class="btn btn-ghost btn-sm" id="marking-undo" ${!records.length || st.saving ? 'disabled' : ''}>Undo last component mark</button>${st.saveFailed ? '<button class="btn btn-ghost" id="marking-retry">Retry saving</button>' : ''}</div>
        <div class="btn-row"><button class="btn btn-ghost btn-sm" id="simple-ports" ${!cal || !cal.ok || !rackModuleCells(rack).length || (st.plan && issues.length) ? 'disabled' : ''}>${st.ports ? 'Mark module ports again' : 'Mark four module ports'}</button>
          <button class="btn btn-ghost btn-sm" id="simple-device-ports" ${!cal || !cal.ok || !rackDeviceCells(rack, 'ssc').length || (st.plan && issues.length) ? 'disabled' : ''}>Mark SSC and junction-box ports</button>
          <label>Picture zoom <select id="simple-zoom"><option value="1" ${st.zoom === 1 ? 'selected' : ''}>100%</option><option value="2" ${st.zoom === 2 ? 'selected' : ''}>200%</option><option value="4" ${st.zoom === 4 ? 'selected' : ''}>400%</option></select></label></div>
        ${prompt ? `<div class="port-instruction" role="status" aria-live="polite"><div class="port-instruction-progress">${prompt.title} · STEP ${prompt.current} OF ${prompt.total}</div><strong>${prompt.instruction}</strong><span>${st.message ? esc(st.message) : prompt.current === 1 ? 'Select the marked component on the drawing below.' : 'Click the port centre on the drawing below.'}</span><button class="btn btn-ghost btn-sm" id="simple-cancel-ports">Cancel marking</button></div>` : next ? `<div class="port-instruction" role="status" aria-live="polite"><div class="port-instruction-progress">BANK ${next.bank} · COMPONENT ${records.length + 1} OF ${steps.length}</div><strong>Click ${esc(next.label)} on the drawing.</strong><span>${st.message ? esc(st.message) : next.kind === 'module' ? 'Click this module in chain order. This click determines its number and SSC assignment.' : next.kind === 'acdp' ? 'Identification only. No ACDP wiring will be generated.' : 'Click the component centre.'}</span>${next.kind === 'jb' ? `<label>Junction box <select id="marking-jb"><option value="">Choose a junction box</option>${next.jbIds.map(id => `<option value="${id}" ${next.defaultJb === id ? 'selected' : ''}>${id}${records.some(r => r.jbId === id) ? ' (already marked; share)' : ''}</option>`).join('')}</select></label>` : ''}</div>` : `<p class="muted small">${st.plan ? 'Component marking complete. Mark the module ports, then each SSC and its junction-box terminals.' : 'Start ordered marking to receive one command at a time.'}</p>`}
        ${issues.length ? '<ul class="marking-warnings">' + issues.map(issue => '<li>' + esc(issue) + '</li>').join('') + '</ul>' : ''}
        <div id="simple-picture-scroll" style="border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:70vh"><div id="simple-picture" style="width:${st.zoom * 100}%;cursor:crosshair">${svg}</div></div>
      </div>
      <div class="card" style="margin-top:16px"><h3>3 · Generate wiring</h3>
        <p class="muted small">${rack ? Object.keys(st.devicePorts).filter(slot => rackIsModule(rack, slot) === false && rackDeviceCells(rack, 'ssc').includes(slot)).length : 0} of ${rack ? rackDeviceCells(rack, 'ssc').length : 0} SSCs have their ports marked. Unmarked SSC and junction-box links are omitted. Check assignments and routes; lines are direct previews, not approved cable routes.</p>
        <div class="btn-row"><button class="btn btn-primary" id="simple-generate" ${!cal || !cal.ok || !modulePortsValid(st.ports) || st.deviceStep || st.portStep || issues.length || st.saving || st.saveFailed ? 'disabled' : ''}>Generate wiring</button>${st.generated ? `<button class="btn btn-ghost" id="simple-visio">Download editable draft (Visio)</button><button class="btn btn-ghost" id="simple-svg">Download draft wiring drawing (SVG)</button><button class="btn btn-ghost" id="simple-export">Print draft PDF</button>` : ''}</div>
        ${st.generated ? '<p class="muted small">You can change markings here and generate again. Visio edits are separate and do not update this saved project.</p>' : ''}
        <p id="simple-message" role="status">${esc(st.message)}</p>
        ${st.generated ? `<p class="${failed.length ? 'warn' : 'muted'}">${failed.length ? failed.length + ' checks need attention before release.' : 'All ' + checks.length + ' checks pass.'}</p>${failed.length ? '<ul>' + failed.map(check => '<li>' + esc(check.id + ': ' + check.detail) + '</li>').join('') + '</ul>' : ''}` : ''}
      </div>`;
    const newScroll = el.querySelector('#simple-picture-scroll');
    newScroll.scrollLeft = scrollLeft; newScroll.scrollTop = scrollTop;
    el.querySelectorAll('[data-count]').forEach(input => { input.oninput = () => { st.banks[Number(input.dataset.bank)][input.dataset.count] = Number(input.value); }; });
    el.querySelector('#marking-banks').onclick = () => {
      const count = Number(el.querySelector('#marking-bank-count').value);
      if (!Number.isInteger(count) || count < 1 || count > 8) { st.message = 'Enter between 1 and 8 banks.'; render(); return; }
      st.banks = Array.from({ length: count }, (_, i) => st.banks[i] || { msms: 1, sscs: 5, modules: 12, junctionBoxes: 5, acdps: 2 }); render();
    };
    el.querySelector('#marking-start').onclick = async () => {
      const errors = markingPlanErrors(st.banks);
      if (errors.length) { st.message = errors.join(' '); render(); return; }
      const needed = markingSteps(st.banks).filter(step => step.kind !== 'jb').length;
      if (needed > st.rack.cols * st.rack.rows) { st.message = 'The declared components need ' + needed + ' grid positions, but this grid has only ' + (st.rack.cols * st.rack.rows) + '. Increase the grid before marking.'; render(); return; }
      st.plan = { version: 1, banks: JSON.parse(JSON.stringify(st.banks)), records: [] };
      rebuildMarks(); st.ports = null; st.devicePorts = {}; st.portStep = 0; st.deviceStep = 0; st.generated = false; st.message = '';
      await persist();
    };
    el.querySelector('#marking-undo').onclick = async () => {
      st.plan.records.pop(); rebuildMarks(); st.generated = false; st.portStep = 0; st.deviceStep = 0;
      st.devicePorts = {}; st.message = 'Last component mark removed. Repeat the highlighted step. SSC ports must be marked again after changing components.'; await persist();
    };
    el.querySelector('#marking-retry')?.addEventListener('click', persist);
    el.querySelector('#simple-grid').onclick = () => {
      const cols = Number(el.querySelector('#simple-cols').value), rows = Number(el.querySelector('#simple-rows').value);
      const px = Number(el.querySelector('#simple-px').value), py = Number(el.querySelector('#simple-py').value);
      if (!Number.isInteger(cols) || cols < 2 || cols > 12 || !Number.isInteger(rows) || rows < 2 || rows > 24 || !Number.isFinite(px) || px < 50 || !Number.isFinite(py) || py < 50) { st.message = 'Enter valid grid dimensions and measured spacing.'; render(); return; }
      const cells = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ c, r, kind: 'empty', label: '' });
      st.rack = rackEnsure({ cols, rows, pitchX: px, pitchY: py, cells });
      st.cal = fvCalib({ imgW: image.naturalWidth, imgH: image.naturalHeight, cols, rows });
      st.plan = null; st.calibrating = 1; st.click = null; st.generated = false; st.ports = null; st.portStep = 0; st.devicePorts = {}; st.deviceStep = 0; st.message = ''; render();
    };
    el.querySelector('#simple-zoom').onchange = event => { st.zoom = Number(event.target.value); render(); };
    el.querySelector('#simple-ports').onclick = () => { if (!st.portStep) st.previousPorts = st.ports; st.portStep = 1; st.deviceStep = 0; st.pendingPorts = {}; st.ports = null; st.generated = false; st.message = ''; render(); };
    el.querySelector('#simple-device-ports').onclick = () => { if (st.portStep) st.ports = st.previousPorts; st.deviceStep = 1; st.portStep = 0; st.pendingDevice = {}; st.generated = false; st.message = ''; render(); };
    el.querySelector('#simple-cancel-ports')?.addEventListener('click', () => { if (st.portStep) st.ports = st.previousPorts; st.portStep = 0; st.deviceStep = 0; st.message = 'Port marking cancelled.'; render(); });
    el.querySelector('#simple-picture').onclick = async event => {
      if (st.saving || st.saveFailed) return;
      const svgEl = event.currentTarget.querySelector('svg'), rect = svgEl.getBoundingClientRect();
      const p = { x: (event.clientX - rect.left) * image.naturalWidth / rect.width, y: (event.clientY - rect.top) * image.naturalHeight / rect.height };
      if (st.calibrating === 1) { st.click = p; st.calibrating = 2; render(); return; }
      if (st.calibrating === 2) {
        if (p.x <= st.click.x || p.y <= st.click.y) { st.message = 'The bottom-right position must be below and to the right of the first point.'; render(); return; }
        Object.assign(st.cal, { x0: st.click.x, y0: st.click.y, pitchX: (p.x - st.click.x) / (st.rack.cols - 1), pitchY: (p.y - st.click.y) / (st.rack.rows - 1), ok: true });
        st.cal.mmPerPx = (st.rack.pitchX / st.cal.pitchX + st.rack.pitchY / st.cal.pitchY) / 2;
        st.calibrating = 0; st.message = ''; await persist(); return;
      }
      if (!st.cal || !st.cal.ok) return;
      const c = Math.round((p.x - st.cal.x0) / st.cal.pitchX), r = Math.round((p.y - st.cal.y0) / st.cal.pitchY);
      if (st.deviceStep === 1) {
        const id = c + ',' + r;
        const pendingSsc = st.plan && !markingIssues(st.plan).length ? markingLayout(st.plan).sscs.find(s => !st.devicePorts[s.slot]) : null;
        if (!rackDeviceCells(st.rack, 'ssc').includes(id) || (pendingSsc && id !== pendingSsc.slot)) { st.message = pendingSsc ? 'Choose ' + pendingSsc.label + ' first.' : 'Choose the centre of a marked SSC.'; render(); return; }
        st.deviceSlot = id; st.pendingDevice = {}; st.deviceStep = 2; st.message = ''; render(); return;
      }
      if (st.deviceStep >= 2) {
        const name = ['commS', 'commN', 'pwrNeg', 'pwrPos', 'busNeg', 'busPos', 'jbNeg', 'jbPos'][st.deviceStep - 2];
        st.pendingDevice[name] = { x: p.x, y: p.y };
        st.message = '';
        if (st.deviceStep === 9) { st.devicePorts[st.deviceSlot] = st.pendingDevice; st.deviceStep = 0; st.message = 'SSC and junction-box ports recorded. Repeat for the next SSC.'; await persist(); return; }
        else st.deviceStep++;
        render(); return;
      }
      if (st.portStep === 1) {
        if (!rackIsModule(st.rack, c + ',' + r)) { st.message = 'Choose the centre of a marked module.'; render(); return; }
        st.portRef = fvSlotCenter(st.cal, c, r); st.portStep = 2; st.message = ''; render(); return;
      }
      if (st.portStep >= 2) {
        if (Math.abs(p.x - st.portRef.x) > st.cal.pitchX * .6 || Math.abs(p.y - st.portRef.y) > st.cal.pitchY * .6) { st.message = 'Click a port on the selected reference module.'; render(); return; }
        const name = ['commS', 'commN', 'pwrNeg', 'pwrPos'][st.portStep - 2];
        st.pendingPorts[name] = { x: p.x - st.portRef.x, y: p.y - st.portRef.y };
        st.message = '';
        if (st.portStep === 5) { st.ports = st.pendingPorts; st.portStep = 0; st.message = 'Four port centres recorded.'; await persist(); return; }
        else st.portStep++;
        render(); return;
      }
      if (!st.plan || !next) return;
      const cell = rackCell(st.rack, c, r);
      if (next.kind !== 'jb' && !cell) { st.message = 'Click a position inside the calibrated grid.'; render(); return; }
      const result = markingRecord(st.plan, p, c + ',' + r, el.querySelector('#marking-jb')?.value);
      if (result.error) { st.message = result.error; render(); return; }
      st.plan.records.push(result.record); rebuildMarks(); st.generated = false; st.message = ''; await persist();
    };
    el.querySelector('#simple-generate').onclick = async () => {
      const missing = markingIssues(st.plan);
      if (missing.length || !modulePortsValid(st.ports) || st.saveFailed) { st.message = missing.join(' ') || 'Mark the four module ports and save before generating wiring.'; render(); return; }
      const config = JSON.parse(JSON.stringify(project.config || {}));
      config.numbering = { rack: st.rack, cal: st.cal, marking: st.plan, modulePorts: st.ports, devicePorts: st.devicePorts };
      config.layout = markingLayout(st.plan);
      config.rules = Object.assign({}, config.rules, { modulesPerString: Math.max(...st.plan.banks.map(bank => bank.modules)) });
      const candidate = { ...project, config };
      const groups = layoutGroups(candidate);
      layoutApply(candidate, groups);
      const ok = await ctx.saveProject({ config: candidate.config, modules_per_string: candidate.modules_per_string });
      if (!ok) { st.message = 'Could not save the wiring configuration.'; render(); return; }
      await ctx.getNetlist(true);
      await ctx.getValidations(true);
      st.generated = true; st.message = 'Draft generated. Unmarked terminal links are omitted; review all assignments and routes.'; render();
    };
    el.querySelector('#simple-export')?.addEventListener('click', () => ctx.switchTab(9));
    el.querySelector('#simple-visio')?.addEventListener('click', async () => {
      try {
        const wiring = pictureModuleWiring(layoutGroups(project), st.cal, st.ports, st.devicePorts);
        let exportProject = project;
        if (/^data:image\/svg\+xml/i.test(project.underlay.src)) {
          const canvas = document.createElement('canvas');
          canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
          canvas.getContext('2d').drawImage(image, 0, 0);
          exportProject = { ...project, underlay: { ...project.underlay, src: canvas.toDataURL('image/png') } };
        }
        const model = pictureVisioModel(exportProject, st.cal, wiring);
        const conns = await ctx.getNetlist();
        download((project.name || 'wiring') + '-draft.vsdx', vsdxExport(conns, project, model), 'application/vnd.ms-visio.drawing.main+xml');
      } catch (error) { toast('Visio export failed: ' + error.message, 'error'); }
    });
    el.querySelector('#simple-svg')?.addEventListener('click', () => {
      const wiring = pictureModuleWiring(layoutGroups(project), st.cal, st.ports, st.devicePorts);
      const svgOut = fvSvg(st.cal, { src: project.underlay.src }, wiring, { noGrid: true, sscLabels: true }).replace('</svg>', pictureDeviceLabelsSvg(st.plan, st.cal) + '</svg>');
      download((project.name || 'wiring') + '-rack-wiring.svg', svgOut, 'image/svg+xml');
    });
    if (st.saving) el.querySelectorAll('button,input,select').forEach(control => { control.disabled = true; });
  }
  render();
}
