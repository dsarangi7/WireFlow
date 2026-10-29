/* Four measured offsets describe the ports of identical modules in picture pixels. */
function modulePortsValid(ports) {
  return !!ports && ['commS', 'commN', 'pwrNeg', 'pwrPos'].every(name =>
    ports[name] && Number.isFinite(ports[name].x) && Number.isFinite(ports[name].y));
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
    click: null, calibrating: 0, brush: 'module',
    ports: modulePortsValid(saved.modulePorts) ? saved.modulePorts : null,
    portStep: 0, portRef: null, pendingPorts: {}, zoom: 1,
    devicePorts: JSON.parse(JSON.stringify(saved.devicePorts || {})), deviceStep: 0, deviceSlot: '', pendingDevice: {},
    generated: !!(existingRack && saved.cal && fvCalib(saved.cal).ok && project.config.layout && modulePortsValid(saved.modulePorts)), message: '',
  };
  function render() {
    const oldScroll = el.querySelector('#simple-picture-scroll');
    const scrollLeft = oldScroll ? oldScroll.scrollLeft : 0, scrollTop = oldScroll ? oldScroll.scrollTop : 0;
    const rack = st.rack;
    const cal = st.cal;
    const marked = rack ? rack.cells.filter(cell => cell.kind !== 'empty') : [];
    let svg = '';
    if (cal && cal.ok) {
      const width = cal.imgW, height = cal.imgH;
      const marks = marked.map(cell => {
        const p = fvSlotCenter(cal, cell.c, cell.r);
        const color = cell.kind === 'module' ? '#087f78' : cell.kind === 'ssc' ? '#d65b13' : '#365fb6';
        const label = cell.kind === 'module' ? 'M' : cell.kind.toUpperCase();
        const radius = Math.max(6, Math.min(cal.pitchX, cal.pitchY) * 0.17);
        return `<g pointer-events="none"><circle cx="${p.x}" cy="${p.y}" r="${radius}" fill="${color}" fill-opacity=".88" stroke="white" stroke-width="2"/><text x="${p.x}" y="${p.y + radius * .3}" text-anchor="middle" font-size="${radius * .8}" font-weight="700" fill="white">${label}</text></g>`;
      }).join('');
      const groups = st.generated ? layoutGroups(project) : [];
      const wiring = st.generated ? pictureModuleWiring(groups, cal, st.ports, st.devicePorts) : [];
      const portMarks = st.portRef && st.portStep >= 2 ? Object.entries(st.pendingPorts).map(([name, offset]) =>
        `<circle cx="${st.portRef.x + offset.x}" cy="${st.portRef.y + offset.y}" r="${Math.max(3, Math.min(cal.pitchX, cal.pitchY) * .045)}" fill="${name.startsWith('comm') ? '#00a651' : '#e02020'}" stroke="white" stroke-width="1" pointer-events="none"/>`).join('') : '';
      const deviceMarks = st.deviceStep >= 2 ? Object.entries(st.pendingDevice).map(([name, point]) =>
        `<circle cx="${point.x}" cy="${point.y}" r="${Math.max(3, Math.min(cal.pitchX, cal.pitchY) * .045)}" fill="${name.startsWith('comm') ? '#00a651' : '#e02020'}" stroke="white" stroke-width="1" pointer-events="none"/>`).join('') : '';
      svg = fvSvg(cal, { src: project.underlay.src }, wiring, { width, height, noGrid: true, sscLabels: true }).replace('</svg>', (st.generated ? '' : marks) + portMarks + deviceMarks + '</svg>');
    } else {
      svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${image.naturalWidth} ${image.naturalHeight}"><image width="${image.naturalWidth}" height="${image.naturalHeight}" href="${esc(project.underlay.src)}"/></svg>`;
    }
    const checks = st.generated ? runValidations(project, generateNetlist(project)).concat(layoutValidate(project)) : [];
    const failed = checks.filter(check => check.status !== 'pass');
    el.innerHTML = `
      <div class="page-head slim"><div><h2>Build wiring</h2><p class="muted">Mark the components on your rack drawing, then generate the wiring.</p></div></div>
      <div class="card" style="margin-bottom:16px">
        <h3>1 · Set the rack grid</h3><p class="muted small">Enter the number of evenly spaced grid columns and rows, including empty positions. Enter the actual centre-to-centre distances in millimetres.</p>
        <div class="btn-row">
          <label>Columns <input id="simple-cols" type="number" min="2" max="12" value="${rack ? rack.cols : ''}" style="width:80px"></label>
          <label>Rows <input id="simple-rows" type="number" min="2" max="24" value="${rack ? rack.rows : ''}" style="width:80px"></label>
          <label>Column spacing (mm) <input id="simple-px" type="number" min="50" value="${rack ? rack.pitchX : ''}" style="width:105px"></label>
          <label>Row spacing (mm) <input id="simple-py" type="number" min="50" value="${rack ? rack.pitchY : ''}" style="width:105px"></label>
          <button class="btn btn-ghost" id="simple-grid">Set grid and align</button>
        </div>
        <p class="muted small">${st.calibrating === 1 ? 'Click the centre of the top-left grid position on the picture.' : st.calibrating === 2 ? 'Now click the centre of the bottom-right grid position.' : (cal && cal.ok ? 'Grid aligned. Select a component and click its position on the picture.' : 'After setting the grid, click its top-left and bottom-right position on the picture.')}</p>
      </div>
      <div class="card"><h3>2 · Mark components and ports on the drawing</h3>
        <div class="btn-row">${[['module','Battery module'],['ssc','SSC'],['acdp','ACDP'],['msm','MSM'],['empty','Erase']].map(([key,label]) => `<button class="btn ${st.brush === key ? 'btn-primary' : 'btn-ghost'} btn-sm" data-simple-brush="${key}" ${!cal || !cal.ok ? 'disabled' : ''}>${label}</button>`).join('')}</div>
        <p class="muted small">${rack ? rackModuleCells(rack).length : 0} modules · ${rack ? rackDeviceCells(rack, 'ssc').length : 0} SSCs marked. Click each position once; use Erase to correct a mark.</p>
        <div class="btn-row"><button class="btn btn-ghost btn-sm" id="simple-ports" ${!cal || !cal.ok || !rackModuleCells(rack).length ? 'disabled' : ''}>${st.ports ? 'Mark module ports again' : 'Mark four module ports'}</button>
          <button class="btn btn-ghost btn-sm" id="simple-device-ports" ${!cal || !cal.ok || !rackDeviceCells(rack, 'ssc').length ? 'disabled' : ''}>Mark SSC and junction-box ports</button>
          <label>Picture zoom <select id="simple-zoom"><option value="1" ${st.zoom === 1 ? 'selected' : ''}>100%</option><option value="2" ${st.zoom === 2 ? 'selected' : ''}>200%</option><option value="4" ${st.zoom === 4 ? 'selected' : ''}>400%</option></select></label></div>
        <p class="muted small">${st.deviceStep ? ['','Click the centre of the SSC you are marking.','Click SSC communication S.','Click SSC communication N.','Click SSC power NEG (−).','Click SSC power POS (+).','Click SSC bus B−.','Click SSC bus B+.','Click its junction-box negative (−) terminal.','Click its junction-box positive (+) terminal.'][st.deviceStep] : st.portStep ? ['','Click the centre of a marked battery module.','Click that module’s communication S port (left).','Click that module’s communication N port (right).','Click that module’s power negative (−) port.','Click that module’s power positive (+) port.'][st.portStep] : st.ports ? 'Module ports are set. Mark the SSC and junction-box ports for each SSC.' : 'Mark four ports on one representative module before generating wiring.'}</p>
        <div id="simple-picture-scroll" style="border:1px solid var(--border);border-radius:8px;overflow:auto;max-height:70vh"><div id="simple-picture" style="width:${st.zoom * 100}%;cursor:crosshair">${svg}</div></div>
      </div>
      <div class="card" style="margin-top:16px"><h3>3 · Generate wiring</h3>
        <p class="muted small">${rack ? Object.keys(st.devicePorts).filter(slot => rackIsModule(rack, slot) === false && rackDeviceCells(rack, 'ssc').includes(slot)).length : 0} of ${rack ? rackDeviceCells(rack, 'ssc').length : 0} SSCs have their ports marked. Unmarked SSC and junction-box links are omitted. Check assignments and routes; lines are direct previews, not approved cable routes.</p>
        <div class="btn-row"><button class="btn btn-primary" id="simple-generate" ${!cal || !cal.ok || !modulePortsValid(st.ports) || st.deviceStep || st.portStep ? 'disabled' : ''}>Generate wiring</button>${st.generated ? `<button class="btn btn-ghost" id="simple-svg">Download draft wiring drawing (SVG)</button><button class="btn btn-ghost" id="simple-export">Print draft PDF</button>` : ''}</div>
        <p id="simple-message" role="status">${esc(st.message)}</p>
        ${st.generated ? `<p class="${failed.length ? 'warn' : 'muted'}">${failed.length ? failed.length + ' checks need attention before release.' : 'All ' + checks.length + ' checks pass.'}</p>${failed.length ? '<ul>' + failed.map(check => '<li>' + esc(check.id + ': ' + check.detail) + '</li>').join('') + '</ul>' : ''}` : ''}
      </div>`;
    const newScroll = el.querySelector('#simple-picture-scroll');
    newScroll.scrollLeft = scrollLeft; newScroll.scrollTop = scrollTop;
    el.querySelector('#simple-grid').onclick = () => {
      const cols = Number(el.querySelector('#simple-cols').value), rows = Number(el.querySelector('#simple-rows').value);
      const px = Number(el.querySelector('#simple-px').value), py = Number(el.querySelector('#simple-py').value);
      if (!Number.isInteger(cols) || cols < 2 || cols > 12 || !Number.isInteger(rows) || rows < 2 || rows > 24 || !Number.isFinite(px) || px < 50 || !Number.isFinite(py) || py < 50) { st.message = 'Enter valid grid dimensions and measured spacing.'; render(); return; }
      const cells = [];
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) cells.push({ c, r, kind: 'empty', label: '' });
      st.rack = rackEnsure({ cols, rows, pitchX: px, pitchY: py, cells });
      st.cal = fvCalib({ imgW: image.naturalWidth, imgH: image.naturalHeight, cols, rows });
      st.calibrating = 1; st.click = null; st.generated = false; st.ports = null; st.portStep = 0; st.devicePorts = {}; st.deviceStep = 0; st.message = ''; render();
    };
    el.querySelectorAll('[data-simple-brush]').forEach(button => { button.onclick = () => { st.brush = button.dataset.simpleBrush; st.portStep = 0; st.deviceStep = 0; render(); }; });
    el.querySelector('#simple-zoom').onchange = event => { st.zoom = Number(event.target.value); render(); };
    el.querySelector('#simple-ports').onclick = () => { st.portStep = 1; st.deviceStep = 0; st.pendingPorts = {}; st.ports = null; st.generated = false; st.message = ''; render(); };
    el.querySelector('#simple-device-ports').onclick = () => { st.deviceStep = 1; st.portStep = 0; st.pendingDevice = {}; st.generated = false; st.message = ''; render(); };
    el.querySelector('#simple-picture').onclick = event => {
      const svgEl = event.currentTarget.querySelector('svg'), rect = svgEl.getBoundingClientRect();
      const p = { x: (event.clientX - rect.left) * image.naturalWidth / rect.width, y: (event.clientY - rect.top) * image.naturalHeight / rect.height };
      if (st.calibrating === 1) { st.click = p; st.calibrating = 2; render(); return; }
      if (st.calibrating === 2) {
        if (p.x <= st.click.x || p.y <= st.click.y) { st.message = 'The bottom-right position must be below and to the right of the first point.'; render(); return; }
        Object.assign(st.cal, { x0: st.click.x, y0: st.click.y, pitchX: (p.x - st.click.x) / (st.rack.cols - 1), pitchY: (p.y - st.click.y) / (st.rack.rows - 1), ok: true });
        st.cal.mmPerPx = (st.rack.pitchX / st.cal.pitchX + st.rack.pitchY / st.cal.pitchY) / 2;
        st.calibrating = 0; st.message = ''; render(); return;
      }
      if (!st.cal || !st.cal.ok) return;
      const c = Math.round((p.x - st.cal.x0) / st.cal.pitchX), r = Math.round((p.y - st.cal.y0) / st.cal.pitchY);
      if (st.deviceStep === 1) {
        const id = c + ',' + r;
        if (!rackDeviceCells(st.rack, 'ssc').includes(id)) { st.message = 'Choose the centre of a marked SSC.'; render(); return; }
        st.deviceSlot = id; st.pendingDevice = {}; st.deviceStep = 2; st.message = ''; render(); return;
      }
      if (st.deviceStep >= 2) {
        const name = ['commS', 'commN', 'pwrNeg', 'pwrPos', 'busNeg', 'busPos', 'jbNeg', 'jbPos'][st.deviceStep - 2];
        st.pendingDevice[name] = { x: p.x, y: p.y };
        if (st.deviceStep === 9) { st.devicePorts[st.deviceSlot] = st.pendingDevice; st.deviceStep = 0; st.message = 'SSC and junction-box ports recorded. Repeat for each SSC.'; }
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
        if (st.portStep === 5) { st.ports = st.pendingPorts; st.portStep = 0; st.message = 'Four port centres recorded.'; }
        else st.portStep++;
        render(); return;
      }
      const cell = rackCell(st.rack, c, r);
      if (!cell || Math.abs(p.x - (st.cal.x0 + c * st.cal.pitchX)) > st.cal.pitchX * .5 || Math.abs(p.y - (st.cal.y0 + r * st.cal.pitchY)) > st.cal.pitchY * .5) return;
      if (cell.kind === 'ssc' && st.brush !== 'ssc') delete st.devicePorts[c + ',' + r];
      cell.kind = st.brush; cell.label = rackKind(st.brush).short; st.generated = false; st.message = ''; render();
    };
    el.querySelector('#simple-generate').onclick = async () => {
      if (rackModuleCells(st.rack).length < 2 || !rackDeviceCells(st.rack, 'ssc').length || !modulePortsValid(st.ports)) { st.message = 'Mark at least two battery modules, one SSC, and the four module ports before generating wiring.'; render(); return; }
      const config = JSON.parse(JSON.stringify(project.config || {}));
      config.numbering = { rack: st.rack, cal: st.cal, modulePorts: st.ports, devicePorts: st.devicePorts };
      delete config.layout;
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
    el.querySelector('#simple-svg')?.addEventListener('click', () => {
      const wiring = pictureModuleWiring(layoutGroups(project), st.cal, st.ports, st.devicePorts);
      const svgOut = fvSvg(st.cal, { src: project.underlay.src }, wiring, { noGrid: true, sscLabels: true });
      download((project.name || 'wiring') + '-rack-wiring.svg', svgOut, 'image/svg+xml');
    });
  }
  render();
}
