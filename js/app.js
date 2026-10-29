/* ============================================================
 * WireFlow — application shell
 * Hash router: #/ and #/app dashboard ·
 * #/project/<id> workspace · #/integrations APS settings
 * ============================================================ */

const app = document.getElementById('app');

/* Internal AYK edition: projects and large rack-picture blobs live in the
   browser's IndexedDB. No account, OTP or remote storage is required. */
const LOCAL_DB_NAME = 'ayk-wireflow';
const LOCAL_DB_VERSION = 1;
let localDbPromise = null;

function localDb() {
  if (localDbPromise) return localDbPromise;
  localDbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(LOCAL_DB_NAME, LOCAL_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id', autoIncrement: true });
      if (!db.objectStoreNames.contains('underlays')) db.createObjectStore('underlays', { keyPath: 'projectId' });
      if (!db.objectStoreNames.contains('files')) {
        const files = db.createObjectStore('files', { keyPath: 'id', autoIncrement: true });
        files.createIndex('projectId', 'project_id');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Could not open local project storage.'));
  });
  return localDbPromise;
}

async function localStore(name, mode, work) {
  const db = await localDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(name, mode);
    const store = tx.objectStore(name);
    let result;
    try { result = work(store); } catch (error) { reject(error); return; }
    tx.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
    tx.onerror = () => reject(tx.error || new Error('Local storage transaction failed.'));
    tx.onabort = () => reject(tx.error || new Error('Local storage transaction was cancelled.'));
  });
}

async function localProjects() {
  const rows = await localStore('projects', 'readonly', store => store.getAll());
  return (rows || []).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
}
async function localProject(id) { return localStore('projects', 'readonly', store => store.get(Number(id))); }
async function localPutProject(project) { return localStore('projects', 'readwrite', store => store.put(project)); }
async function localAddProject(project) { return localStore('projects', 'readwrite', store => store.add(project)); }
async function localPutUnderlay(projectId, blob, kind) {
  return localStore('underlays', 'readwrite', store => store.put({ projectId: Number(projectId), blob, kind }));
}
async function localGetUnderlay(projectId) { return localStore('underlays', 'readonly', store => store.get(Number(projectId))); }
async function localAddFile(record) { return localStore('files', 'readwrite', store => store.add(record)); }
async function localProjectFiles(projectId) {
  const db = await localDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('files', 'readonly');
    const req = tx.objectStore('files').index('projectId').getAll(Number(projectId));
    req.onsuccess = () => resolve((req.result || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at))));
    req.onerror = () => reject(req.error);
  });
}

/* The guided workspace is intentionally data-only: every step points at an
   existing expert view and completion is derived from saved project state. */
const FLOW_STEPS = Object.freeze([
  { label: 'Import rack', view: 'Configuration' },
  { label: 'Calibrate', view: 'Numbering' },
  { label: 'Number & chains', view: 'Numbering' },
  { label: 'Wire & validate', view: 'Wire & validate' },
  { label: 'Export PDF', view: 'Export' },
]);

function flowStepCompletion(project) {
  const cfg = (project && project.config) || {};
  const numbering = cfg.numbering || {};
  const cal = numbering.cal || {};
  const layout = cfg.layout || {};
  const hasUnderlay = !!(project && (project.underlay_url || project.underlay));
  const calibrated = hasUnderlay && cal.ok === true;
  const chainsApplied = calibrated && numbering.mode === 'layout' &&
    Array.isArray(numbering.counts) && numbering.counts.length > 0 &&
    Array.isArray(layout.sscs) && layout.sscs.length === numbering.counts.length;
  const wiringShown = chainsApplied && Array.isArray(numbering.order) && numbering.order.length > 1;
  const exported = !!(cfg.flow && cfg.flow.deliveredAt);
  return [hasUnderlay, calibrated, chainsApplied, wiringShown, exported];
}

/** Pure print-page contract. Each page is an SVG and order is significant. */
function buildPrintDocument(parts) {
  const p = parts || {};
  return [
    { title: 'Generated wiring sheet', svg: p.sheetSvg || '' },
    { title: 'Rack front-view wiring', svg: p.frontSvg || '' },
    { title: 'Cable schedule & BOM', svg: p.scheduleSvg || '' },
  ];
}

/** Pure quality verdict used by the guided VSDX import report. */
function vsdxImportVerdict(result) {
  const pages = Array.isArray(result && result.pages) ? result.pages.length : Number(result && result.pages) || 0;
  const foreigns = Array.isArray(result && result.foreigns) ? result.foreigns.length : Number(result && result.foreigns) || 0;
  const picture = result && result.picture;
  if (pages < 1) return { ok: false, reason: 'No pages were found in the Visio drawing.' };
  if (foreigns < 1 || !picture) return { ok: false, reason: 'No embedded rack picture was found in the Visio drawing.' };
  return { ok: true, reason: 'The largest embedded picture is ready to use as the wiring base.' };
}

/* ---------------- utilities ---------------- */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(msg, type = 'info') {
  const w = document.getElementById('toast-wrap');
  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.textContent = msg;
  w.appendChild(el);
  setTimeout(() => el.classList.add('show'), 10);
  setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 4200);
}
function download(name, content, mime = 'text/plain') {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content], { type: mime }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
}
async function unwrap(promise, label) {  const { data, error } = await promise;
  if (error) { toast(`${label}: ${error.message || error.code}`, 'error'); throw error; }
  return data;
}

/* ---------------- Visio file → rack underlay ----------------
 * Lifts the embedded AutoCAD rack picture out of the engineer's .vsdx so the
 * underlay can be imported straight from the Visio file (no AutoCAD round
 * trip, no DWG translation). Used by the Configuration import and available
 * to any tab that needs the real rack picture.
 * @param {File} file The .vsdx chosen by the engineer.
 * @return {{blob: Blob, fit: {x,y,w,h}, pages: number, foreigns: number,
 *   layers: number, picture: Object}} PNG blob + sheet fit + quality facts.
 */
async function underlayFromVsdxFile(file, onStatus) {
  const say = (m) => { if (onStatus) onStatus(m); };
  say('Reading Visio package…');
  const doc = await vsdxOpen(await file.arrayBuffer(), { emfPx: 2400 });
  let best = null;
  let foreigns = 0;
  const layerNames = new Set();
  for (let i = 0; i < doc.pages.length; i++) {
    say('Scanning page ' + (i + 1) + ' of ' + doc.pages.length + '…');
    const r = await doc.renderPage(i, {});
    (doc.pages[i].layers || []).forEach(layer => layerNames.add(layer.name || String(layer.ix)));
    foreigns += (r.foreigns || []).length;
    for (const f of (r.foreigns || [])) {
      /* The renderer carries the decoded picture blob on the foreign record.
         Never fetch its data:/blob: href again. */
      if (!f.blob) continue;
      if (!best || f.w * f.h > best.f.w * best.f.h) best = { f: f, page: doc.pages[i] };
    }
  }
  const verdict = vsdxImportVerdict({ pages: doc.pages.length, foreigns: foreigns, picture: best && best.f });
  if (!verdict.ok) throw new Error(verdict.reason);
  const blob = best.f.blob;
  if (!blob) throw new Error('The rack picture inside the Visio file could not be decoded.');
  /* Same page→sheet mapping as the Diagram tab: 101.6 sheet units per inch,
     0.25 mm per unit, y flipped (page inches are Y-up, the sheet is Y-down). */
  const U = 101.6;
  const fit = {
    x: +(best.f.x * U).toFixed(1),
    y: +((best.page.h - best.f.y - best.f.h) * U).toFixed(1),
    w: +(best.f.w * U).toFixed(1),
    h: +(best.f.h * U).toFixed(1),
  };
  return {
    blob: blob,
    fit: fit,
    pages: doc.pages.length,
    foreigns: foreigns,
    layers: layerNames.size,
    picture: { w: best.f.w, h: best.f.h, bytes: blob.size || 0 },
  };
}

/* Storage gateways can occasionally drop a multipart POST before returning an
   HTTP response (surfacing only "Failed to fetch"). Retry through the SDK's
   signed PUT flow before reporting a transport failure to the engineer. */
async function uploadRackBlob(path, blob, contentType, onStatus) {
  let firstError = null;
  try {
    const direct = await cloud.storage.upload(path, blob, { contentType });
    if (!direct.error) return direct;
    firstError = direct.error;
  } catch (error) {
    firstError = error;
  }
  console.warn('Direct rack upload failed; retrying with a signed upload URL.', firstError);
  if (onStatus) onStatus('Secure upload retry…');
  try {
    const signed = await cloud.storage.createSignedUploadUrl(path, { upsert: true });
    if (signed.error || !signed.data || !signed.data.token) throw signed.error || new Error('No signed upload token was returned.');
    const retried = await cloud.storage.uploadToSignedUrl(path, signed.data.token, blob, { contentType, upsert: true });
    if (retried.error) throw retried.error;
    return retried;
  } catch (retryError) {
    console.error('Signed rack upload retry failed.', retryError);
    const error = new Error('The rack picture was extracted, but the secure upload could not reach project storage. Check your connection and pick the file again.');
    error.cause = retryError || firstError;
    throw error;
  }
}

/* Shared import/upload/save path for the guided workspace and Configuration. */
async function importRackDrawing(file, project, ctx, opts) {
  opts = opts || {};
  const status = typeof opts.onStatus === 'function' ? opts.onStatus : function () {};
  if (/\.dwg$/i.test(file.name)) {
    throw new Error('Binary DWG cannot be read in the browser. Save it as DXF, or choose the Visio VSDX version so WireFlow can extract its embedded rack picture.');
  }
  const isDxf = /\.dxf$/i.test(file.name);
  let fit = opts.fit || { underlay_x: 120, underlay_y: 280, underlay_w: 1000, underlay_h: 640 };
  let blob = file;
  let kind = isDxf ? 'dxf' : 'image';
  let contentType = file.type || 'application/octet-stream';
  let quality = null;
  status('Preparing rack drawing…');
  if (/\.vsdx$/i.test(file.name)) {
    const got = await underlayFromVsdxFile(file, status);
    blob = new Blob([got.blob], { type: 'image/png' });
    contentType = 'image/png';
    kind = 'image';
    fit = {
      underlay_x: got.fit.x, underlay_y: got.fit.y,
      underlay_w: got.fit.w, underlay_h: got.fit.h,
    };
    quality = {
      pages: got.pages, foreigns: got.foreigns, layers: got.layers,
      picture: got.picture, baseSet: false,
    };
    status('Uploading rack picture from the Visio file…');
  }
  status('Saving rack picture on this device…');
  await ctx.saveUnderlayBlob(blob, kind);
  const path = `local-underlay:${project.id}`;
  const ok = await ctx.saveProject({ underlay_url: path, underlay_kind: kind, ...fit });
  if (!ok) throw new Error('Could not save the underlay reference');
  await ctx.loadUnderlay();
  if (quality) quality.baseSet = true;
  return { kind: kind, fit: fit, quality: quality };
}

/* ---------------- router ---------------- */
window.addEventListener('hashchange', route);

async function route() {
  const h = location.hash || '#/';
  if (h.startsWith('#/project/')) { renderProjectPage(+h.split('/')[2]); return; }
  switch (h) {
    case '#/':
    case '#/app': renderDashboard(); return;
    case '#/login': location.replace('#/app'); return;
    case '#/integrations': renderIntegrations(); return;
    default: renderDashboard();
  }
}

/* ================= APP SHELL ================= */
function shell(content, active) {
  app.innerHTML = `
  <div class="shell">
    <aside class="side">
      <a class="logo side-logo" href="#/"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 7h6l2-4 2 12 2-4h6" stroke="#f97316" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="2" y="2" width="20" height="20" rx="5" stroke="#1e3a5f" stroke-width="1.6"/></svg> AYK WireFlow</a>
      <nav class="side-nav">
        <a href="#/app" class="${active === 'dash' ? 'on' : ''}">◫ Projects</a>
      </nav>
      <div class="side-foot">
        <div class="side-user">AYK Energy · Internal</div>
        <div class="muted small">Projects stay on this device.</div>
      </div>
    </aside>
    <main class="main">${content}</main>
  </div>`;
}

/* ================= DASHBOARD ================= */
async function renderDashboard() {
  shell(`<div class="loading">Loading projects…</div>`, 'dash');
  let projects;
  try { projects = await localProjects(); }
  catch (error) { shell(`<div class="empty">Could not open local projects: ${esc(error.message)}</div>`, 'dash'); return; }

  shell(`
    <div class="page-head">
      <div><h1>Projects</h1><p class="muted">Rack configurations, netlists and drawing packages.</p></div>
      <button class="btn btn-primary" id="btn-new">+ New project</button>
    </div>
    ${projects.length === 0 ? `
      <div class="empty">
        <h3>No projects yet</h3>
        <p>Create your first rack configuration — or start from the approved template (2 strings × 24 modules).</p>
        <button class="btn btn-primary" id="btn-new2">+ New project</button>
      </div>` : `
      <div class="proj-grid">
        ${projects.map(p => `
        <a class="proj-card" href="#/project/${p.id}">
          <div class="proj-top"><span class="proj-name">${esc(p.name)}</span><span class="chip ${p.status === 'released' ? 'chip-ok' : ''}">${esc(p.status)}</span></div>
          <div class="proj-meta">${esc(p.vessel || '—')} · ${esc(p.product_family)}</div>
          <div class="proj-meta muted">${esc(p.drawing_no || 'no drawing no.')} rev ${esc(p.revision)} · ${esc(String(p.modules_per_string))} modules/string</div>
          <div class="proj-foot">Updated ${new Date(p.updated_at || p.created_at).toLocaleDateString()}</div>
        </a>`).join('')}
      </div>`}
  `, 'dash');
  (document.getElementById('btn-new') || document.getElementById('btn-new2'))?.addEventListener('click', () => showNewProjectModal());
}

function showNewProjectModal() {
  const modal = document.createElement('div');
  modal.className = 'modal-back';
  modal.innerHTML = `
  <div class="modal">
    <h3>New project</h3>
    <div class="field"><label>Project name *</label><input id="np-name" placeholder="Racks 9–16 battery bank"></div>
    <div class="field"><label>Vessel</label><input id="np-vessel" placeholder="MV Example"></div>
    <div class="field"><label>Drawing number</label><input id="np-dwg" placeholder="DWG-0000"></div>
    <div class="field"><label>Product family</label><select id="np-fam"><option>Pisces+</option><option>Orion</option><option>OrionAN+</option><option>Aries</option></select></div>
    <div class="field"><label>Modules per string</label><input id="np-mods" type="number" value="24" min="2" max="60"></div>
    <label class="check"><input type="checkbox" id="np-sample" checked> Preload standard 2-string configuration with approved rules</label>
    <div class="modal-actions"><button class="btn btn-ghost" id="np-cancel">Cancel</button><button class="btn btn-primary" id="np-create">Create</button></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('#np-cancel').onclick = () => modal.remove();
  modal.querySelector('#np-create').onclick = async () => {
    const name = modal.querySelector('#np-name').value.trim();
    if (!name) { toast('Project name is required.', 'error'); return; }
    const sample = modal.querySelector('#np-sample').checked;
    const rules = sample ? { ...DEFAULT_RULES, modulesPerString: +modal.querySelector('#np-mods').value || 24,
      overTopSpans: [
        { fromRack: 1, toRack: 2, network: 'comm', spanMm: 951 },
        { fromRack: 1, toRack: 2, network: 'power', spanMm: 951 },
        { fromRack: 2, toRack: 3, network: 'comm', spanMm: 1900 },
        { fromRack: 2, toRack: 3, network: 'power', spanMm: 1900 },
      ] } : { ...DEFAULT_RULES };
    const project = {
      name,
      vessel: modal.querySelector('#np-vessel').value.trim(),
      drawing_no: modal.querySelector('#np-dwg').value.trim(),
      product_family: modal.querySelector('#np-fam').value,
      modules_per_string: +modal.querySelector('#np-mods').value || 24,
      config: { rules, exceptions: [], spans: rules.overTopSpans || [] },
      status: 'draft', revision: 'A',
      created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    };
    project.id = await localAddProject(project);
    modal.remove();
    toast('Project created.');
    location.hash = `#/project/${project.id}`;
  };
}

/* ================= PROJECT WORKSPACE ================= */
async function renderProjectPage(id) {
  shell(`<div class="loading">Loading project…</div>`, 'dash');
  let project;
  try { project = await localProject(id); } catch (error) {}
  if (!project) {
    shell(`<div class="empty"><h3>Project not found</h3><p>This project is not stored in this browser.</p><a class="btn btn-primary" href="#/app">Back to projects</a></div>`, 'dash'); return;
  }
  const cfg = project.config || { rules: { ...DEFAULT_RULES }, exceptions: [], spans: [] };
  let netlist = null, validations = null;

  const tabs = ['Configuration', 'Numbering', 'Netlist', 'Exceptions', 'Validation', 'Schedule & BOM', 'Diagram', 'Drawings (DWG)', 'Wire & validate', 'Export'];
  shell(`
    <div class="proj-head">
      <a class="back" href="#/app">← Projects</a>
      <div class="proj-title-row">
        <h1 id="p-name">${esc(project.name)}</h1>
        <span class="chip ${project.status === 'released' ? 'chip-ok' : ''}" id="p-status">${esc(project.status)}</span>
      </div>
      <p class="muted">${esc(project.vessel || '')} ${project.drawing_no ? '· ' + esc(project.drawing_no) + ' rev ' + esc(project.revision) : ''} · ${esc(project.product_family)}</p>
    </div>
    <div id="workspace-home"></div>
    <details class="advanced" id="advanced">
      <summary>Advanced</summary>
      <p class="muted small">All expert tools remain available here.</p>
      <div class="tabs" id="tabs">${tabs.map((t, i) => `<button class="tab" data-i="${i}">${t}</button>`).join('')}</div>
    </details>
    <div id="tab-body" hidden></div>
  `, 'dash');

  const body = document.getElementById('tab-body');
  const home = document.getElementById('workspace-home');
  const views = [tabConfig, tabSimpleWiring, tabNetlist, tabExceptions, tabValidation, tabSchedule, tabDiagram, tabDrawings, tabWireValidate, tabExport];

  async function saveProject(patch) {
    try {
      Object.assign(project, patch, { updated_at: new Date().toISOString() });
      await localPutProject(project);
      return true;
    } catch (error) { toast('Save failed: ' + error.message, 'error'); return false; }
  }
  async function saveUnderlayBlob(blob, kind) {
    await localPutUnderlay(id, blob, kind);
  }

  async function switchTab(i) {
    home.hidden = true;
    body.hidden = false;
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', +t.dataset.i === i));
    body.innerHTML = `<div class="loading">…</div>`;
    await views[i](body, project, { saveProject, saveUnderlayBlob, getNetlist, getValidations, loadUnderlay, switchTab });
  }
  function stepIndex(step) { return tabs.indexOf(step.view); }
  async function renderWorkspace() {
    body.hidden = true;
    home.hidden = false;
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('on'));
    const complete = flowStepCompletion(project);
    const current = complete.findIndex(done => !done);
    const currentStep = current < 0 ? FLOW_STEPS.length - 1 : current;
    const guidance = [
      'No rack drawing yet — import a VSDX, DXF, PNG, JPG or SVG to begin.',
      'The rack is ready — calibrate the first and last module positions next.',
      'Calibration is complete — number the modules and apply one chain per SSC.',
      'Chains are ready — review wiring totals and resolve every failed validation.',
      'No delivered package yet — export the A3 PDF, then mark the project delivered.',
    ];
    home.innerHTML = `
      <section class="workspace-hero" aria-labelledby="workspace-title">
        <div class="workspace-kicker">AYK wiring workspace</div>
        <h2 id="workspace-title">${esc(project.name)}</h2>
        <p class="workspace-sub">Import the rack drawing, mark its components and generate the wiring.</p>
        <div class="workspace-actions">
          <button class="btn btn-primary btn-lg" id="workspace-import">Import rack drawing</button>
          <button class="btn btn-ghost" id="workspace-continue" ${!project.underlay_url ? 'disabled' : ''}>Open wiring workspace</button>
        </div>
        <input type="file" id="workspace-file" accept=".dxf,.png,.jpg,.jpeg,.svg,.vsdx" hidden>
        <p class="muted small">VSDX, DXF, PNG, JPG and SVG are supported.</p>
        <div id="workspace-import-result" aria-live="polite"></div>
        <details class="import-advanced">
          <summary>Advanced import options</summary>
          <p class="muted small">Adjust fit, alignment or remove the current drawing in Configuration.</p>
          <button class="text-link" id="workspace-config">Open Configuration →</button>
        </details>
      </section>`;
    home.querySelectorAll('[data-flow]').forEach(button => {
      button.onclick = () => switchTab(stepIndex(FLOW_STEPS[+button.dataset.flow]));
    });
    const picker = home.querySelector('#workspace-file');
    const result = home.querySelector('#workspace-import-result');
    home.querySelector('#workspace-import').onclick = () => picker.click();
    home.querySelector('#workspace-config').onclick = () => switchTab(stepIndex(FLOW_STEPS[0]));
    picker.onchange = async () => {
      const file = picker.files[0];
      if (!file) return;
      const importButton = home.querySelector('#workspace-import');
      importButton.disabled = true;
      result.innerHTML = `<div class="import-progress"><span class="import-spinner"></span><span id="workspace-import-status">Reading ${esc(file.name)}…</span></div>`;
      const status = result.querySelector('#workspace-import-status');
      try {
        const imported = await importRackDrawing(file, project, { saveProject, saveUnderlayBlob, loadUnderlay }, {
          onStatus: message => { status.textContent = message; },
        });
        let report = '';
        if (imported.quality) {
          const q = imported.quality;
          const verdict = vsdxImportVerdict(q);
          const size = q.picture ? `${Number(q.picture.w).toFixed(2)} × ${Number(q.picture.h).toFixed(2)} in` : '—';
          report = `<div class="import-report ${verdict.ok ? 'ok' : 'error'}">
            <div class="import-report-icon">${verdict.ok ? '✓' : '!'}</div>
            <div><strong>Visio import quality</strong><p>${esc(verdict.reason)}</p>
              <dl><div><dt>Pages found</dt><dd>${q.pages}</dd></div><div><dt>Embedded picture</dt><dd>${q.picture ? 'Yes · ' + size : 'No'}</dd></div><div><dt>Layers</dt><dd>${q.layers}</dd></div><div><dt>Wiring base</dt><dd>${q.baseSet ? 'Set to largest picture' : 'Not set'}</dd></div></dl>
            </div>
          </div>`;
        }
        result.innerHTML = report || `<div class="import-report ok"><div class="import-report-icon">✓</div><div><strong>Rack drawing imported</strong><p>The drawing is set as the wiring base.</p></div></div>`;
        toast('Rack drawing imported — continue with calibration.');
        await switchTab(stepIndex(FLOW_STEPS[1]));
        if (report) body.insertAdjacentHTML('afterbegin', report);
      } catch (error) {
        console.error('Guided rack import failed', error);
        result.innerHTML = `<div class="import-report error">
          <div class="import-report-icon">!</div>
          <div><strong>We could not import this drawing</strong><p>${esc(error && error.message ? error.message : 'The file could not be read. Check that it is a supported rack drawing and try again.')}</p>
          <button class="btn btn-ghost btn-sm" id="workspace-repick">Pick another file</button></div>
        </div>`;
        result.querySelector('#workspace-repick').onclick = () => picker.click();
      } finally {
        importButton.disabled = false;
        picker.value = '';
      }
    };
    home.querySelector('#workspace-continue').onclick = () => switchTab(stepIndex(FLOW_STEPS[1]));
  }
  async function getNetlist(force) {
    if (!netlist || force) netlist = generateNetlist(project);
    return netlist;
  }
  async function getValidations(force) {
    if (!validations || force) validations = runValidations(project, await getNetlist(force));
    return validations;
  }

  /* Fetch the imported rack drawing and prepare it for the renderers. */
  async function loadUnderlay() {
    project.underlay = null;
    if (!project.underlay_url) return;
    try {
      const saved = await localGetUnderlay(id);
      if (!saved || !saved.blob) return;
      const kind = saved.kind || project.underlay_kind || 'image';
      const fit = {
        x: project.underlay_x ?? 120, y: project.underlay_y ?? 280,
        w: project.underlay_w ?? 1000, h: project.underlay_h ?? 640,
      };
      if (kind === 'dxf') {
        const parsed = rackParseDxf(await saved.blob.text());
        project.underlay = { kind: 'dxf', prims: rackFitDxf(parsed, fit) };
      } else {
        const src = await new Promise((ok, fail) => {
          const fr = new FileReader();
          fr.onload = () => ok(fr.result); fr.onerror = fail;
          fr.readAsDataURL(saved.blob);
        });
        project.underlay = { kind: 'image', src, ...fit };
      }
    } catch (e) { /* sheet renders without the underlay */ }
  }

  document.getElementById('tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab'); if (b) switchTab(+b.dataset.i);
  });
  await loadUnderlay();
  await renderWorkspace();
}

/* ---- Tab 1: Configuration ---- */
function tabConfig(el, project, ctx) {
  const r = { ...DEFAULT_RULES, ...(project.config?.rules || {}) };
  el.innerHTML = `
  <div class="card-grid">
    <div class="card">
      <h3>Project</h3>
      <div class="field"><label>Vessel</label><input id="c-vessel" value="${esc(project.vessel || '')}"></div>
      <div class="field"><label>Drawing number</label><input id="c-dwg" value="${esc(project.drawing_no || '')}"></div>
      <div class="field"><label>Revision</label><input id="c-rev" value="${esc(project.revision || 'A')}"></div>
      <div class="field"><label>Product family</label><select id="c-fam">${['Pisces+', 'Orion', 'OrionAN+', 'Aries'].map(f => `<option ${f === project.product_family ? 'selected' : ''}>${f}</option>`).join('')}</select></div>
    </div>
    <div class="card">
      <h3>Approved jumper lengths (mm)</h3>
      ${[['powerJumper', 'R07 · Standard short power jumper'], ['commJumper', 'R08 · Standard short communication jumper'], ['longPower', 'R09 · Longer local power jumper'], ['longComm', 'R10 · Longer local communication jumper'], ['m2sPowerLen', 'M2S power harness'], ['m2sCommLen', 'M2S communication harness'], ['busPowerLen', 'SSC-to-JB bus power cable']].map(([k, label]) =>
        `<div class="field inline"><label>${label}</label><input type="number" data-rule="${k}" value="${r[k]}"></div>`).join('')}
    </div>
    <div class="card">
      <h3>Cable specification</h3>
      <div class="field inline"><label>Power cable spec / gauge</label><input type="text" data-rule="powerGauge" data-type="str" value="${esc(r.powerGauge || '')}"></div>
      <div class="field inline"><label>Communication cable spec / gauge</label><input type="text" data-rule="commGauge" data-type="str" value="${esc(r.commGauge || '')}"></div>
    </div>
    <div class="card">
      <h3>Rack drawing (underlay)</h3>
      <p class="muted small">Import your own rack drawing and AYK WireFlow draws the wiring over it. Supports the engineer's <b>.vsdx</b> (the embedded AutoCAD rack picture is lifted out automatically), DXF (AutoCAD "Save as DXF"), PNG, JPG and SVG. Binary DWG cannot be read in the browser — see the note when you pick one.</p>
      <div class="field inline"><label>Status</label><span class="muted" id="u-status">${project.underlay_url ? esc('Imported: ' + (project.underlay_kind || 'image')) : 'No rack drawing imported'}</span></div>
      <input type="file" id="u-file" accept=".dxf,.png,.jpg,.jpeg,.svg,.vsdx" style="display:none">
      <div class="btn-row">
        <button class="btn btn-ghost" id="u-pick">Import rack drawing…</button>
        <button class="btn btn-ghost" id="u-align">Align to module grid</button>
        <button class="btn btn-ghost" id="u-remove" ${project.underlay_url ? '' : 'disabled'}>Remove</button>
      </div>
      <div class="field inline"><label>Fit X (sheet units)</label><input type="number" id="u-x" value="${project.underlay_x ?? 120}"></div>
      <div class="field inline"><label>Fit Y</label><input type="number" id="u-y" value="${project.underlay_y ?? 280}"></div>
      <div class="field inline"><label>Fit width</label><input type="number" id="u-w" value="${project.underlay_w ?? 1000}"></div>
      <div class="field inline"><label>Fit height</label><input type="number" id="u-h" value="${project.underlay_h ?? 640}"></div>
      <button class="btn btn-ghost" id="u-apply">Apply alignment</button>
    </div>
    <div class="card">
      <h3>Length rules</h3>
      <div class="field inline"><label>R12 · Power deduction (mm)</label><input type="number" data-rule="powerDeduction" value="${r.powerDeduction}"></div>
      <label class="check"><input type="checkbox" data-rule="applyDeductionToComm" ${r.applyDeductionToComm ? 'checked' : ''}> Apply deduction to communication as well</label>
      <div class="field inline"><label>Cross-rack installation allowance (mm)</label><input type="number" data-rule="crossRackAllowance" value="${r.crossRackAllowance}"></div>
      <div class="field inline"><label>Rounding step (0 = exact mm)</label><input type="number" data-rule="roundingStep" value="${r.roundingStep}"></div>
      <div class="field inline"><label>Modules per string</label><input type="number" min="2" data-rule="modulesPerString" value="${r.modulesPerString}"></div>
      <div class="field inline"><label>Strings</label><input type="number" min="1" data-rule="strings" value="${r.strings}"></div>
    </div>
  </div>
  <div class="actions"><button class="btn btn-primary" id="c-save">Save configuration</button><span class="muted" id="c-saved"></span></div>`;

  el.querySelector('#c-save').onclick = async () => {
    const rules = { ...r };
    el.querySelectorAll('[data-rule]').forEach(inp => {
      const k = inp.dataset.rule;
      rules[k] = inp.type === 'checkbox' ? inp.checked
        : inp.dataset.type === 'str' ? inp.value.trim()
        : +inp.value;
    });
    // Guard the release gate: an empty configuration can never produce a drawing.
    rules.strings = Math.max(1, Math.round(rules.strings) || 1);
    rules.modulesPerString = Math.max(2, Math.round(rules.modulesPerString) || 2);
    const ok = await ctx.saveProject({
      vessel: el.querySelector('#c-vessel').value.trim(),
      drawing_no: el.querySelector('#c-dwg').value.trim(),
      revision: el.querySelector('#c-rev').value.trim(),
      product_family: el.querySelector('#c-fam').value,
      modules_per_string: rules.modulesPerString,
      config: { ...(project.config || {}), rules },
    });
    if (ok) { toast('Configuration saved. Regenerate the netlist to apply.'); el.querySelector('#c-saved').textContent = 'Saved ✓'; }
  };

  /* ---- rack underlay handlers ---- */
  const uFile = el.querySelector('#u-file');
  const uStatus = el.querySelector('#u-status');
  const fitFromInputs = () => ({
    underlay_x: Math.round(+el.querySelector('#u-x').value) || 120,
    underlay_y: Math.round(+el.querySelector('#u-y').value) || 280,
    underlay_w: Math.max(50, Math.round(+el.querySelector('#u-w').value)) || 1000,
    underlay_h: Math.max(50, Math.round(+el.querySelector('#u-h').value)) || 640,
  });
  const afterUnderlayChange = async msg => {
    await ctx.loadUnderlay();
    uStatus.textContent = project.underlay_url ? `Imported: ${project.underlay_kind || 'image'}` : 'No rack drawing imported';
    toast(msg + ' Open the Diagram tab to see it under the wiring.');
  };
  el.querySelector('#u-pick').onclick = () => uFile.click();
  uFile.addEventListener('change', async () => {
    const file = uFile.files[0]; if (!file) return;
    try {
      await importRackDrawing(file, project, ctx, {
        fit: fitFromInputs(),
        onStatus: message => { uStatus.textContent = message; },
      });
      el.querySelector('#u-remove').disabled = false;
      await afterUnderlayChange('Rack drawing imported.');
    } catch (e) {
      console.error('Advanced rack import failed', e);
      uStatus.textContent = '';
      toast(e.message, 'error');
    } finally { uFile.value = ''; }
  });
  el.querySelector('#u-align').onclick = async () => {
    const conns = await ctx.getNetlist(false);
    const fit = rackDefaultFit(buildSheetLayout(project, conns));
    el.querySelector('#u-x').value = fit.x; el.querySelector('#u-y').value = fit.y;
    el.querySelector('#u-w').value = fit.w; el.querySelector('#u-h').value = fit.h;
    const ok = await ctx.saveProject({ underlay_x: fit.x, underlay_y: fit.y, underlay_w: fit.w, underlay_h: fit.h });
    if (ok) await afterUnderlayChange('Underlay aligned to the module grid.');
  };
  el.querySelector('#u-apply').onclick = async () => {
    const ok = await ctx.saveProject(fitFromInputs());
    if (ok) await afterUnderlayChange('Alignment applied.');
  };
  el.querySelector('#u-remove').onclick = async () => {
    const ok = await ctx.saveProject({ underlay_url: null, underlay_kind: null });
    if (ok) {
      project.underlay = null;
      uStatus.textContent = 'No rack drawing imported';
      el.querySelector('#u-remove').disabled = true;
      toast('Rack drawing removed.');
    }
  };
}

/* ---- Tab 2: Numbering (physical M1..MN order on the rack) ---- */
function tabNumbering(el, project, ctx) {
  const rules = { ...DEFAULT_RULES, ...(project.config?.rules || {}) };
  const saved = (project.config && project.config.numbering) || null;
  const st = {
    rack: rackEnsure(saved && saved.rack ? saved.rack : defaultRack(rules.modulesPerString)),
    mode: (saved && saved.mode) === 'custom' ? 'custom' : 'auto',
    planId: (saved && saved.planId) || '',
    planTitle: (saved && saved.planTitle) || '',
    brush: 'module',
    plans: null,
    cal: fvCalib(saved && saved.cal),
    calStep: 0, calClick: null, showWiring: true,
  };
  st.order = (saved && Array.isArray(saved.order) && saved.order.length)
    ? saved.order.filter(id => rackIsModule(st.rack, id))
    : rackModuleCells(st.rack);
  if (!st.order.length) st.order = rackModuleCells(st.rack);
  const required = Math.max(1, Math.round(rules.modulesPerString || 24)) * Math.max(1, Math.round(rules.strings || 1));

  /* ---- variable layout state: one chain per SSC ---- */
  const savedLay = (project.config && project.config.layout) || null;
  st.layoutMode = savedLay && savedLay.mode === 'manual' ? 'manual' : 'auto';
  st.sscBrush = '';
  st.layoutTouched = false;
  st.sscs = []; st.assignment = {};
  function initLayout() {
    const lay0 = layoutEnsure({ config: { rules: rules, numbering: saved || null, layout: savedLay } });
    st.sscs = lay0.sscs;
    st.assignment = lay0.assignment;
  }
  initLayout();
  function fakeProj() {
    return { config: {
      rules: rules,
      numbering: Object.assign({}, (project.config && project.config.numbering) || {}, { rack: st.rack }),
      layout: { version: 1, mode: st.layoutMode, sscs: st.sscs, assignment: st.assignment },
    } };
  }
  const groupsNow = () => layoutGroups(fakeProj(), {});

  const fmtM = mm => (mm / 1000).toFixed(1) + ' m';
  const metricLine = m =>
    `Cable to buy <b>${fmtM(m.bomMm)}</b> · physical span ${fmtM(m.geomMm)} · ` +
    `<b>${m.longHops}</b> long jumper${m.longHops === 1 ? '' : 's'} of ${m.hops} hops · longest ${m.maxHopMm} mm` +
    (m.overflow ? ` · <span class="warn">${m.overflow} needs engineering release</span>` : ' · all approved harnesses');

  /* Interactive rack: one rect per slot, numbered in the current order. */
  function gridSvg() {
    const rack = st.rack;
    const cw = Math.max(54, Math.min(130, 760 / rack.cols));
    const ch = Math.max(34, Math.min(78, 520 / rack.rows));
    const w = rack.cols * cw, h = rack.rows * ch;
    const rank = new Map();
    st.order.forEach((id, i) => rank.set(id, i + 1));
    /* SSC chain colours on the rack grid — the engineer sees which module
       belongs to which SSC while assigning */
    const gcolor = new Map();
    try {
      groupsNow().forEach((g, i) => g.order.forEach(id => gcolor.set(id, SSC_PALETTE[i % SSC_PALETTE.length])));
    } catch (e) { /* grid stays neutral */ }
    let s = '<svg class="rack-grid" viewBox="0 0 ' + w + ' ' + h +
      '" xmlns="http://www.w3.org/2000/svg" font-family="Helvetica, Arial, sans-serif">';
    const pts = st.order.map(id => { const c = slotCell(id); return [(c.c + 0.5) * cw, (c.r + 0.5) * ch]; });
    if (pts.length > 1) {
      s += '<polyline points="' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join(' ') +
        '" fill="none" stroke="#f97316" stroke-width="2" stroke-linejoin="round"/>';
    }
    const font = Math.min(15, ch * 0.34);
    for (let i = 0; i < rack.cells.length; i++) {
      const cell = rack.cells[i];
      const x = cell.c * cw + 2, y = cell.r * ch + 2, bw = cw - 4, bh = ch - 4;
      s += '<rect data-slot="' + cell.c + ',' + cell.r + '" x="' + x.toFixed(1) + '" y="' + y.toFixed(1) +
        '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="3" fill="' + rackKind(cell.kind).color +
        '" stroke="' + (gcolor.get(slotKey(cell.c, cell.r)) || '#94a3b8') + '" stroke-width="' + (gcolor.has(slotKey(cell.c, cell.r)) ? 2 : 1) + '"/>';
      const n = rank.get(slotKey(cell.c, cell.r));
      const label = n ? String(n) : (cell.kind === 'module' ? '' : (cell.label || rackKind(cell.kind).short));
      if (label) {
        s += '<text x="' + (x + bw / 2).toFixed(1) + '" y="' + (y + bh / 2 + font * 0.36).toFixed(1) +
          '" text-anchor="middle" style="font-size:' + font.toFixed(1) + 'px;font-weight:700" fill="' +
          (n ? '#0f172a' : '#334155') + '" pointer-events="none">' + esc(label) + '</text>';
      }
    }
    return s + '</svg>';
  }

  function planRows() {
    if (!st.plans) return '';
    return st.plans.map((p, i) => `
      <div class="num-plan ${i === 0 ? 'best' : ''}">
        <div>${numberingPreviewSVG(st.rack, p.order, { width: 150, height: 110 })}</div>
        <div>
          <div style="font-weight:700;color:#0f172a">${esc(p.title)} ${i === 0 ? '<span class="chip chip-ok">recommended</span>' : ''}</div>
          <div class="muted small">${esc(p.note)}</div>
          <div class="plan-metrics">${metricLine(p.metrics)}</div>
        </div>
        <div><button class="btn ${i === 0 ? 'btn-primary' : 'btn-ghost'} btn-sm" data-use="${i}">Use this</button></div>
      </div>`).join('');
  }

  /* ---- front view: the real rack picture with wiring on top ---- */
  const fvReady = () => !!(project.underlay && project.underlay.kind === 'image' && project.underlay.src);
  function fvInner() {
    if (!fvReady()) {
      return `<p class="muted small">Import the rack drawing first — Configuration tab (DXF/PNG), or open the engineer's .vsdx in the Diagram tab and press <b>Use as wiring base</b>. The red/green wiring is then drawn straight over your real rack here.</p>`;
    }
    const cal = st.cal;
    const status = cal.ok
      ? `<span class="chip chip-ok">grid calibrated</span> <span class="muted small">pitch ${cal.pitchX.toFixed(0)}×${cal.pitchY.toFixed(0)} px · ${cal.mmPerPx.toFixed(2)} mm/px</span>`
      : (st.calStep === 1 ? '<span class="chip chip-warn">click the centre of the FIRST module (M1)</span>'
        : st.calStep === 2 ? '<span class="chip chip-warn">now click the centre of the LAST module</span>'
        : '<span class="chip chip-warn">grid not calibrated</span>');
    const segs = cal.ok && st.showWiring ? fvWiring(st.order, cal) : [];
    const sum = fvSummary(segs);
    return `
    <div class="btn-row">
      <button class="btn btn-ghost btn-sm" id="fv-cal">${cal.ok ? 'Recalibrate grid' : 'Calibrate grid (2 clicks)'}</button>
      ${cal.ok ? `<button class="btn btn-ghost btn-sm" id="fv-wire">${st.showWiring ? 'Hide wiring' : 'Show wiring'}</button>` : ''}
      <button class="btn btn-ghost btn-sm" id="fv-rot" title="Only if the source picture itself came in upside down — stores the turned picture as the base, as-is otherwise">Rotate base picture 180°</button>
      <span id="fv-status">${status}</span>
    </div>
    <div id="fv-view" style="margin-top:10px;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">${fvSvg(cal, { src: project.underlay.src }, segs, { width: 920, noGrid: !cal.ok })}</div>
    ${cal.ok && st.showWiring ? `<p class="muted small">Red = power chain (${(sum.powerMm / 1000).toFixed(1)} m) · green = communication (${(sum.commMm / 1000).toFixed(1)} m) · longest hop ${Math.round(sum.maxHopMm)} mm. Lengths come from the picture scale — enter the real column/row pitch in section 1.</p>` : ''}
    <p class="muted small">${cal.ok
      ? (st.mode === 'custom'
        ? 'Click a module on the picture to number it, click it again to remove it. With a device brush selected the click places the SSC / ACDP / MSM / JB anchor where it really sits.'
        : 'Clicks place the selected device anchor. Switch to Custom to point the numbering on the picture itself.')
      : 'Calibration: click the centre of the first numbered module, then the centre of the last one — grid, scale and wiring follow automatically.'}</p>`;
  }

  function renderMode() {
    const box = el.querySelector('#num-mode');
    if (!box) return;
    if (st.mode === 'auto') {
      if (!st.plans) st.plans = numberingPlans(st.rack, rules, { limit: 6 });
      box.innerHTML = `
        <div class="btn-row"><button class="btn btn-ghost" id="num-gen">Re-score options</button>
          <span class="muted small">Every pattern is scored with the approved harness catalogue: the cheapest one that can be built from released parts is on top, then the shortest cable.</span></div>
        <div id="num-plans" style="margin-top:12px">${planRows()}</div>`;
      el.querySelector('#num-gen').onclick = () => { st.plans = numberingPlans(st.rack, rules, { limit: 6 }); renderMode(); };
      box.querySelectorAll('[data-use]').forEach(b => {
        b.onclick = () => {
          const p = st.plans[+b.dataset.use];
          if (!p) return;
          st.order = p.order.slice();
          st.planId = p.id;
          st.planTitle = p.title;
          render();
          toast('Numbering set — press Save numbering to apply it.');
        };
      });
      return;
    }
    box.innerHTML = `
      <p class="muted small">Click the module slots on the rack in the order the chain must run. The first click is M1 (next to the SSC), the next is M2, and so on. Click a numbered slot again to take it out.</p>
      <div class="btn-row">
        <button class="btn btn-ghost btn-sm" id="num-undo">Undo last</button>
        <button class="btn btn-ghost btn-sm" id="num-clear">Clear</button>
        <button class="btn btn-ghost btn-sm" id="num-fill-near">Auto-fill rest (nearest)</button>
        <button class="btn btn-ghost btn-sm" id="num-fill-serp">Auto-fill rest (serpentine)</button>
      </div>
      <div class="field inline" style="margin-top:10px"><label>Numbered by hand</label><span>${st.order.length} of ${required}</span></div>
      <p class="muted small mono" style="word-break:break-all">${st.order.length
        ? st.order.map((id, i) => 'M' + (i + 1) + ' ' + esc(id)).join(' · ')
        : 'Nothing numbered yet — click the rack above.'}</p>`;
    el.querySelector('#num-undo').onclick = () => { st.order = st.order.slice(0, -1); render(); };
    el.querySelector('#num-clear').onclick = () => { st.order = []; render(); };
    el.querySelector('#num-fill-near').onclick = () => { st.order = numberingAutoFill(st.rack, st.order, 'nearest'); render(); };
    el.querySelector('#num-fill-serp').onclick = () => { st.order = numberingAutoFill(st.rack, st.order, 'serpentine'); render(); };
  }

  /* ---- variable layout cards ---- */
  function sscCard() {
    const groups = groupsNow();
    const t = layoutTotals(groups);
    const rows = groups.map((g, i) => {
      const c = SSC_PALETTE[i % SSC_PALETTE.length];
      return `<tr>
        <td><span class="ssc-dot" style="background:${c}"></span>${esc(g.label)}</td>
        <td class="mono">${esc(g.slot)}</td>
        <td>${g.modules.length} of ${g.capacity}${g.modules.length > g.capacity ? ' <span class="warn">over</span>' : ''}</td>
        <td>${fmtM(g.metrics.bomMm)}</td>
        <td>${g.metrics.longHops} of ${g.metrics.hops}</td>
        <td>${g.metrics.overflow ? `<span class="warn">${g.metrics.overflow} need release</span>` : '<span class="chip chip-ok">approved parts</span>'}</td>
        <td class="muted small">${esc(g.planTitle || 'hand-pointed chain')}</td>
      </tr>`;
    }).join('');
    return `
    <p class="muted small">Every rack is different: the number of SSCs, how many modules each SSC controls and the module arrangement all follow the rack layout diagram. WireFlow plans each SSC's chain independently — shortest cable first, scored against the approved harness catalogue — and the general diagram shows every chain on the real rack.</p>
    <table class="ssc-table">
      <thead><tr><th>SSC</th><th>Slot</th><th>Modules</th><th>Cable to buy</th><th>Long jumpers</th><th>Harnesses</th><th>Chain plan</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No SSC on the rack — paint an SSC slot in section 2.</td></tr>'}</tbody>
    </table>
    <p class="muted small" style="margin-top:8px">Total: ${t.sscs} SSC chain(s) · ${t.modules} modules · <b>${fmtM(t.bomMm)}</b> of cable · ${t.longHops} long jumper(s)${t.overflow ? ` · <span class="warn">${t.overflow} hop(s) need an engineering release</span>` : ' · everything buildable from approved parts'}</p>
    <div class="btn-row" style="margin-top:8px">
      <button class="btn btn-ghost btn-sm" id="ssc-auto">Auto — nearest cable</button>
      <button class="btn btn-ghost btn-sm" id="ssc-cols">Split by columns</button>
      <button class="btn btn-ghost btn-sm" id="ssc-rowsB">Split by rows</button>
      <button class="btn btn-ghost btn-sm" id="ssc-reopt">Re-optimise chains</button>
      <button class="btn btn-ghost btn-sm" id="ssc-hand">${st.layoutMode === 'manual' ? 'Hand mode ON' : 'Hand mode'}</button>
    </div>
    <div class="field inline" style="margin-top:8px"><label>Assign by hand</label>
      <select id="ssc-pick" style="max-width:220px">
        <option value="">— pick an SSC, then click modules —</option>
        ${st.sscs.map((s, i) => `<option value="${esc(s.id)}" ${st.sscBrush === s.id ? 'selected' : ''}>${esc(s.label)} (slot ${esc(s.slot)})</option>`).join('')}
      </select>
      <button class="btn btn-ghost btn-sm" id="ssc-clear-order">Clear hand chain</button>
    </div>`;
  }

  function genCard() {
    const groups = groupsNow();
    const legend = groups.map((g, i) => {
      const c = SSC_PALETTE[i % SSC_PALETTE.length];
      const per = st._genSummary && st._genSummary[i];
      return `<div class="gen-legend-item">
        <span class="ssc-dot" style="background:${c}"></span>
        <b>${esc(g.label)}</b> · ${g.order.length} modules${per ? ` · red ${(per.powerMm / 1000).toFixed(1)} m · green ${(per.commMm / 1000).toFixed(1)} m · longest hop ${Math.round(per.maxHopMm)} mm` : ''}
      </div>`;
    }).join('');
    if (fvReady() && st.cal.ok) {
      const segs = st.showWiring ? layoutFrontView(groups, st.cal, {}) : [];
      st._genSummary = layoutFrontViewSummary(segs, groups);
      return `<div id="gen-view" style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">${fvSvg(st.cal, { src: project.underlay.src }, segs, { width: 920, sscLabels: true })}</div>
        <div class="gen-legend" style="margin-top:8px">${legend}</div>
        <p class="muted small">The general diagram: every SSC's own chain on the real rack — power red, communication green, module numbers colour-coded per SSC. Each chain starts and ends at its own SSC.</p>`;
    }
    return `<div class="num-plans">${groups.map((g, i) => `
      <div class="num-plan">
        <div>${numberingPreviewSVG(st.rack, g.order, { width: 150, height: 110 })}</div>
        <div>
          <div style="font-weight:700;color:${SSC_PALETTE[i % SSC_PALETTE.length]}">${esc(g.label)} — ${g.order.length} modules</div>
          <div class="plan-metrics">${metricLine(g.metrics)}</div>
          <div class="muted small">Calibrate the grid on the rack picture (below) to draw this chain on the real rack.</div>
        </div>
      </div>`).join('')}</div>`;
  }

  function render() {
    st.cal.cols = st.rack.cols; st.cal.rows = st.rack.rows;
    if (st.cal.ok && st.cal.pitchX > 0) {
      st.cal.mmPerPx = (st.rack.pitchX / st.cal.pitchX + st.rack.pitchY / st.cal.pitchY) / 2;
    }
    const m = numberMetrics(st.rack, rules, st.order);
    const dev = k => rackDeviceCells(st.rack, k).join(', ') || '—';
    el.innerHTML = `
    <div class="page-head slim">
      <div><h2>Physical module numbering</h2>
        <p class="muted">M1…M${required} is a property of the rack, not of the schematic: the chain starts and ends next to the SSC and has to skip the ACDP, MSM and junction-box slots. Set it once — the netlist, the cable schedule and the drawing all follow it.</p></div>
    </div>
    <div class="card" style="margin-bottom:16px">
      <h3>0 · Variable layout — one chain per SSC</h3>
      ${sscCard()}
      <div class="actions" style="margin-top:10px"><button class="btn btn-primary" id="ssc-apply">Apply chains to the project (netlist · schedule · general diagram)</button><span class="muted" id="ssc-saved"></span></div>
    </div>
    <div class="card-grid">
      <div class="card">
        <h3>1 · Rack layout</h3>
        <div class="field inline"><label>Columns</label><input type="number" id="n-cols" value="${st.rack.cols}"></div>
        <div class="field inline"><label>Rows</label><input type="number" id="n-rows" value="${st.rack.rows}"></div>
        <div class="field inline"><label>Column pitch (mm)</label><input type="number" id="n-px" value="${st.rack.pitchX}"></div>
        <div class="field inline"><label>Row pitch (mm)</label><input type="number" id="n-py" value="${st.rack.pitchY}"></div>
        <div class="field inline"><label>Module width (mm)</label><input type="number" id="n-mw" value="${st.rack.moduleW}"></div>
        <div class="field inline"><label>Module height (mm)</label><input type="number" id="n-mh" value="${st.rack.moduleH}"></div>
        <div class="field inline"><label>Terminal inset from bottom (mm)</label><input type="number" id="n-inset" value="${st.rack.termInsetY}"></div>
        <button class="btn btn-ghost" id="num-apply-rack">Apply layout</button>
        <p class="muted small">The pitch is only used to estimate physical spans and to rank the options — the scheduled lengths still come from the approved harness catalogue.</p>
      </div>
      <div class="card">
        <h3>2 · Device slots</h3>
        <p class="muted small">Pick a device, then click a cell on the rack. SSC anchors the chain (M1 and M${required} sit next to it); ACDP, MSM and JB are skipped by the numbering.</p>
        <div class="brush-row" id="num-brush">
          ${RACK_CELL_KINDS.map(k => `<button class="brush ${k.key === st.brush ? 'on' : ''}" data-brush="${k.key}">${esc(k.label)}</button>`).join('')}
        </div>
        <div class="field inline"><label>Module slots</label><span>${rackModuleCells(st.rack).length} of ${required}</span></div>
        <div class="field inline"><label>SSC</label><span class="mono">${dev('ssc')}</span></div>
        <div class="field inline"><label>ACDP</label><span class="mono">${dev('acdp')}</span></div>
        <div class="field inline"><label>MSM</label><span class="mono">${dev('msm')}</span></div>
        <div class="field inline"><label>Junction box</label><span class="mono">${dev('jb')}</span></div>
        <button class="btn btn-ghost" id="num-reset">Reset to default rack</button>
      </div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Rack front view</h3>
      <div id="num-grid">${gridSvg()}</div>
      <p class="muted small">${st.mode === 'custom'
        ? 'Custom mode: click a module to number it, click it again to remove it.'
        : 'Auto mode: clicks paint the selected device. Switch to Custom to point the numbering yourself.'}</p>
      <p class="muted small">${project.underlay_url
        ? 'Rack drawing imported — after saving, M1…M' + required + ' are drawn onto it (use the fit rectangle in Configuration to align them).'
        : 'No rack drawing imported yet — import it in the Configuration tab and the numbering will be drawn straight onto it.'}</p>
    </div>
    <div class="card" style="margin-top:16px" id="fv-card">
      <h3>Wiring on the real rack</h3>
      ${fvInner()}
    </div>
    <div class="card" style="margin-top:16px" id="gen-card">
      <h3>General diagram — every SSC chain on the real rack</h3>
      ${genCard()}
    </div>
    <div class="card" style="margin-top:16px">
      <h3>3 · Numbering</h3>
      <div class="btn-row">
        <button class="btn ${st.mode === 'auto' ? 'btn-primary' : 'btn-ghost'}" id="num-auto">Automatic — shortest cable</button>
        <button class="btn ${st.mode === 'custom' ? 'btn-primary' : 'btn-ghost'}" id="num-custom">Custom — I point the order</button>
      </div>
      <div id="num-mode" style="margin-top:14px"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Current numbering</h3>
      <div class="field inline"><label>Numbered</label><span>${m.moduleCount} of ${m.required}${m.unnumbered ? ` <span class="warn">(${m.unnumbered} unnumbered)</span>` : ''}</span></div>
      <div>${metricLine(m)}</div>
      ${st.planTitle ? `<p class="muted small">Plan: ${esc(st.planTitle)}</p>` : ''}
    </div>
    <div class="actions"><button class="btn btn-primary" id="num-save">Save numbering</button><span class="muted" id="num-saved"></span></div>`;

    el.querySelector('#num-auto').onclick = () => { st.mode = 'auto'; render(); };
    el.querySelector('#num-custom').onclick = () => {
      /* Entering custom mode with a machine-made order would make the first
         click *remove* a module instead of starting the sequence — clear the
         untouched default so the engineer really numbers from scratch. */
      if (st.order.join('|') === rackModuleCells(st.rack).join('|')) st.order = [];
      st.mode = 'custom';
      render();
    };
    el.querySelector('#num-apply-rack').onclick = () => {
      const v = id => +el.querySelector(id).value;
      st.rack = rackEnsure({
        ...st.rack,
        cols: v('#n-cols'), rows: v('#n-rows'),
        pitchX: v('#n-px'), pitchY: v('#n-py'),
        moduleW: v('#n-mw'), moduleH: v('#n-mh'), termInsetY: v('#n-inset'),
      });
      st.order = st.order.filter(id => rackIsModule(st.rack, id));
      if (!st.order.length) st.order = rackModuleCells(st.rack);
      st.plans = null;
      initLayout();
      render();
      toast('Rack layout applied.');
    };
    el.querySelector('#num-reset').onclick = () => {
      st.rack = defaultRack(rules.modulesPerString);
      st.order = rackModuleCells(st.rack);
      st.plans = null;
      initLayout();
      render();
      toast('Rack reset to the default 3-column layout.');
    };
    el.querySelectorAll('[data-brush]').forEach(b => {
      b.onclick = () => { st.brush = b.dataset.brush; render(); };
    });
    el.querySelector('#num-grid').addEventListener('click', e => {
      const t = e.target.closest('[data-slot]');
      if (!t) return;
      const id = t.dataset.slot;
      /* hand-assigning modules to an SSC chain has priority over painting */
      if (st.sscBrush) { assignSsc(id); return; }
      if (st.mode === 'custom') {
        if (!rackIsModule(st.rack, id)) { toast('That slot is not a battery module — paint it as a module first.', 'error'); return; }
        st.order = numberingToggle(st.order, id);
        render();
        return;
      }
      const c = slotCell(id);
      const rec = rackCell(st.rack, c.c, c.r);
      if (!rec) return;
      rec.kind = st.brush;
      rec.label = rackKind(st.brush).short;
      st.order = st.order.filter(x => x !== id);
      if (st.brush === 'module') st.order.push(id);
      st.plans = null;
      render();
    });
    /* ---- front view handlers ---- */
    el.querySelector('#fv-cal')?.addEventListener('click', () => { st.calStep = 1; st.calClick = null; render(); });
    el.querySelector('#fv-wire')?.addEventListener('click', () => { st.showWiring = !st.showWiring; render(); });
    el.querySelector('#fv-rot')?.addEventListener('click', async () => {
      try {
        const stEl = el.querySelector('#fv-status');
        if (stEl) stEl.innerHTML = '<span class="chip chip-warn">rotating picture…</span>';
        const img = new Image();
        img.crossOrigin = 'anonymous';
        /* fetch to a blob URL first — a cross-origin signed URL would taint
           the canvas and make toBlob throw */
        let srcUrl = project.underlay.src;
        try {
          const resp = await fetch(srcUrl);
          if (resp.ok) srcUrl = URL.createObjectURL(await resp.blob());
        } catch (e2) { /* keep the original src */ }
        await new Promise((res, rej) => { img.onload = res; img.onerror = () => rej(new Error('picture did not load')); img.src = srcUrl; });
        const cv = document.createElement('canvas');
        cv.width = img.naturalWidth || img.width || 1; cv.height = img.naturalHeight || img.height || 1;
        const cx = cv.getContext('2d');
        cx.translate(cv.width / 2, cv.height / 2); cx.rotate(Math.PI);
        cx.drawImage(img, -cv.width / 2, -cv.height / 2);
        const blob = await new Promise((res, rej) => cv.toBlob((b) => b ? res(b) : rej(new Error('could not encode PNG')), 'image/png'));
        await ctx.saveUnderlayBlob(blob, 'image');
        const path = `local-underlay:${project.id}`;
        const fit = {
          underlay_x: project.underlay_x, underlay_y: project.underlay_y,
          underlay_w: project.underlay_w, underlay_h: project.underlay_h,
        };
        await ctx.saveProject({ underlay_url: path, underlay_kind: 'image', ...fit });
        project.underlay_url = path; project.underlay_kind = 'image';
        project.underlay = { kind: 'image', src: URL.createObjectURL(blob), ...fit };
        /* the old calibration points at the un-rotated pixels — start over */
        st.cal = fvCalib({ imgW: cv.width, imgH: cv.height });
        st.calStep = 0; st.calClick = null;
        render();
        toast('Base picture turned 180° — recalibrate the grid on it, then the wiring follows.');
      } catch (e) { toast('Rotate failed: ' + e.message, 'error'); render(); }
    });
    el.querySelector('#fv-view')?.addEventListener('click', (e) => {
      const svg = e.currentTarget.querySelector('svg');
      if (!svg) return;
      const rect = svg.getBoundingClientRect();
      const px = (e.clientX - rect.left) * st.cal.imgW / Math.max(1, rect.width);
      const py = (e.clientY - rect.top) * st.cal.imgH / Math.max(1, rect.height);
      const pt = { x: px, y: py };
      if (st.calStep === 1) { st.calClick = pt; st.calStep = 2; render(); return; }
      if (st.calStep === 2) {
        const c1 = st.calClick || pt;
        const dc = Math.max(1, st.cal.cols - 1), dr = Math.max(1, st.cal.rows - 1);
        st.cal.x0 = c1.x; st.cal.y0 = c1.y;
        st.cal.pitchX = Math.max(2, (px - c1.x) / dc);
        st.cal.pitchY = Math.max(2, (py - c1.y) / dr);
        st.cal.mmPerPx = (st.rack.pitchX / st.cal.pitchX + st.rack.pitchY / st.cal.pitchY) / 2;
        st.cal.ok = true; st.calStep = 0;
        render();
        toast('Grid calibrated on the rack picture — wiring is now drawn over it.');
        return;
      }
      if (!st.cal.ok) return;
      const c = Math.round((px - st.cal.x0) / st.cal.pitchX);
      const r = Math.round((py - st.cal.y0) / st.cal.pitchY);
      if (c < 0 || r < 0 || c >= st.cal.cols || r >= st.cal.rows) return;
      const ctr = fvSlotCenter(st.cal, c, r);
      if (Math.abs(px - ctr.x) > st.cal.pitchX * 0.55 || Math.abs(py - ctr.y) > st.cal.pitchY * 0.55) return;
      const id = c + ',' + r;
      if (st.sscBrush) { assignSsc(id); return; }
      if (st.mode === 'custom') {
        if (!rackIsModule(st.rack, id)) { toast('That slot is not a battery module — paint it as a module first.', 'error'); return; }
        st.order = numberingToggle(st.order, id);
        render();
        return;
      }
      if (st.brush !== 'module') { st.cal.devices[st.brush] = pt; render(); }
    });
    /* ---- variable layout handlers ---- */
    function assignSsc(id) {
      if (!rackIsModule(st.rack, id)) { toast('Pick a battery module slot for ' + st.sscBrush + '.', 'error'); return; }
      st.assignment[id] = st.sscBrush;
      const s = st.sscs.find(x => x.id === st.sscBrush);
      if (s) {
        const at = s.order.indexOf(id);
        if (at >= 0) s.order.splice(at, 1); else s.order.push(id);
      }
      st.layoutTouched = true;
      render();
    }
    const reassign = (how) => {
      st.assignment = layoutAssign(fakeProj(), how);
      st.sscs.forEach(s => { s.order = []; });
      st.layoutTouched = true;
      render();
      toast('Modules shared out over the SSCs (' + how + ') — press "Apply chains" to make it the project layout.');
    };
    el.querySelector('#ssc-auto').onclick = () => reassign('nearest');
    el.querySelector('#ssc-cols').onclick = () => reassign('column');
    el.querySelector('#ssc-rowsB').onclick = () => reassign('row');
    el.querySelector('#ssc-reopt').onclick = () => {
      st.layoutMode = 'auto';
      st.sscs.forEach(s => { s.order = []; });
      st.layoutTouched = true;
      render();
      toast('Chains re-optimised for shortest cable from each SSC.');
    };
    el.querySelector('#ssc-hand').onclick = () => {
      st.layoutMode = st.layoutMode === 'manual' ? 'auto' : 'manual';
      if (st.layoutMode === 'manual') st.sscs.forEach(s => { s.order = []; });
      st.layoutTouched = true;
      render();
      toast(st.layoutMode === 'manual'
        ? 'Hand mode: pick an SSC below, then click its modules in chain order (M1 first).'
        : 'Back to automatic — the shortest chains are computed for you.');
    };
    el.querySelector('#ssc-pick').onchange = (e) => { st.sscBrush = e.target.value; render(); };
    el.querySelector('#ssc-clear-order').onclick = () => {
      st.sscs.forEach(s => { s.order = []; });
      st.layoutTouched = true;
      render();
    };
    el.querySelector('#ssc-apply').onclick = async () => {
      const groups = groupsNow();
      if (!groups.length) { toast('No SSC on the rack layout — paint an SSC slot first.', 'error'); return; }
      layoutApply(project, groups);
      const ok = await ctx.saveProject({ config: project.config });
      if (!ok) return;
      await ctx.getNetlist(true);
      el.querySelector('#ssc-saved').textContent =
        `Applied — ${groups.length} chain(s), ${groups.reduce((a, g) => a + g.order.length, 0)} modules ✓`;
      toast('Variable layout applied: strings, netlist, schedule, validations and the drawings now follow the per-SSC chains.');
    };
    el.querySelector('#num-save').onclick = async () => {
      const m2 = numberMetrics(st.rack, rules, st.order);
      const num = {
        mode: st.mode,
        planId: st.mode === 'auto' ? st.planId : '',
        planTitle: st.mode === 'auto' ? st.planTitle : '',
        rack: st.rack,
        order: st.order,
        cal: st.cal,
        savedAt: new Date().toISOString(),
      };
      const ok = await ctx.saveProject({ config: { ...(project.config || {}), numbering: num } });
      if (!ok) return;
      await ctx.getNetlist(true);
      el.querySelector('#num-saved').textContent =
        `Saved — ${m2.moduleCount} modules · ${m2.longHops} long jumpers ✓`;
      toast('Numbering saved. The netlist now carries the physical hop lengths.');
    };
    renderMode();
  }

  /* The picture's natural size must be known before the first draw. */
  (async () => {
    if (fvReady() && Number.isFinite(st.cal.imgW) && st.cal.imgW === 1000 && st.cal.imgH === 700) {
      const im = new Image();
      await new Promise((res) => { im.onload = res; im.onerror = res; im.src = project.underlay.src; });
      if (im.naturalWidth) { st.cal.imgW = im.naturalWidth; st.cal.imgH = im.naturalHeight; }
    }
    render();
  })();
}

/* ---- Tab 3: Netlist ---- */
async function tabNetlist(el, project, ctx) {
  const conns = await ctx.getNetlist(true);
  el.innerHTML = `
  <div class="page-head slim">
    <div><h2>Generated netlist</h2><p class="muted">${conns.length} connections · deterministic from rules R02–R11.</p></div>
    <div class="btn-row">
      <button class="btn btn-ghost" id="n-csv">Export CSV</button>
      <button class="btn btn-ghost" id="n-json">Export JSON spec</button>
      <button class="btn btn-ghost" id="n-dxf">Export DXF</button>
      <button class="btn btn-ghost" id="n-scr">AutoCAD script (.scr)</button>
      <button class="btn btn-primary" id="n-vsdx">Export Visio (.vsdx)</button>
    </div>
  </div>
  <div class="table-wrap"><table class="data">
    <thead><tr><th>#</th><th>Network</th><th>Class</th><th>From</th><th>To</th><th>Harness</th><th>Routed</th><th>Mfg</th><th>Exception</th></tr></thead>
    <tbody>
    ${conns.map(c => `<tr>
      <td>${c.seq}</td>
      <td><span class="net ${c.network}">${c.network}</span></td>
      <td>${esc(c.cls)}</td><td class="mono">${esc(c.from)}</td><td class="mono">${esc(c.to)}</td>
      <td class="mono ${c.harness ? '' : 'warn'}">${esc(c.harness || 'UNRELEASED')}</td>
      <td>${c.routedLen} mm</td><td>${c.length} mm</td>
      <td class="muted">${esc(c.exception || '')}${c.approvalRef ? ' ✓' : ''}</td>
    </tr>`).join('')}
    </tbody>
  </table></div>`;

  el.querySelector('#n-csv').onclick = () => download(`${project.name || 'cable'}-schedule.csv`, scheduleCSV(conns, project), 'text/csv');
  el.querySelector('#n-json').onclick = () => download(`${project.name || 'wiring'}-spec.json`, specJson(conns, project), 'application/json');
  el.querySelector('#n-dxf').onclick = () => download(`${project.name || 'wiring'}.dxf`, dxfExport(conns, project), 'application/dxf');
  el.querySelector('#n-scr').onclick = () => download(`${project.name || 'wiring'}.scr`, scrExport(conns, project), 'text/plain');
  el.querySelector('#n-vsdx').onclick = () => download(`${project.name || 'wiring'}.vsdx`, vsdxExport(conns, project), 'application/vnd.ms-visio.drawing.main+xml');
}

/* ---- Tab 4: Exceptions ---- */
function tabExceptions(el, project, ctx) {
  const cfg = project.config || {};
  const exs = cfg.exceptions || [];
  const spans = cfg.spans || [];
  el.innerHTML = `
  <div class="card-grid">
    <div class="card">
      <h3>Exception connections</h3>
      <p class="muted small">In-rack gaps, column transitions, cross-rack transitions and remote SSCs must be declared explicitly (spec §6) and carry an approval reference (V12).</p>
      <div id="ex-list">${exs.length ? exs.map((x, i) => exceptionRow(x, i)).join('') : `<p class="muted">No exceptions declared.</p>`}</div>
      <div class="actions"><button class="btn btn-ghost" id="ex-add">+ Add exception</button></div>
    </div>
    <div class="card">
      <h3>Over-top span catalogue</h3>
      <p class="muted small">Approved horizontal spans between adjacent rack pairs (spec §5.2), per network.</p>
      <div id="sp-list">${spans.length ? spans.map((x, i) => spanRow(x, i)).join('') : `<p class="muted">No rack-pair spans recorded.</p>`}</div>
      <div class="actions"><button class="btn btn-ghost" id="sp-add">+ Add rack pair</button></div>
    </div>
  </div>
  <div class="actions"><button class="btn btn-primary" id="ex-save">Save & regenerate netlist</button></div>`;

  function exceptionRow(x, i) {
    return `<div class="ex-row" data-i="${i}">
      <select data-f="type"><option value="gap" ${x.type === 'gap' ? 'selected' : ''}>In-rack gap</option><option value="column" ${x.type === 'column' ? 'selected' : ''}>Column transition</option><option value="crossrack" ${x.type === 'crossrack' ? 'selected' : ''}>Cross-rack transition</option><option value="remote-ssc" ${x.type === 'remote-ssc' ? 'selected' : ''}>Remote SSC</option></select>
      <input type="number" data-f="string" placeholder="string (0=all)" value="${x.string ?? 0}" style="max-width:110px">
      <input type="number" data-f="m1" placeholder="module A" value="${x.between?.[0] ?? ''}" style="max-width:90px">
      <input type="number" data-f="m2" placeholder="module B" value="${x.between?.[1] ?? ''}" style="max-width:90px">
      <input data-f="from" placeholder="from e.g. S1:M12:S" value="${esc(x.from || '')}">
      <input data-f="to" placeholder="to e.g. S1:M13:N" value="${esc(x.to || '')}">
      <select data-f="network"><option value="power" ${x.network === 'power' ? 'selected' : ''}>power</option><option value="comm" ${x.network === 'comm' ? 'selected' : ''}>comm</option></select>
      <input type="number" data-f="sourceLen" placeholder="src mm" value="${x.sourceLen ?? ''}" style="max-width:90px">
      <input type="number" data-f="destLen" placeholder="dest mm" value="${x.destLen ?? ''}" style="max-width:90px">
      <input type="number" data-f="fromRack" placeholder="rack A" value="${x.fromRack ?? ''}" style="max-width:80px">
      <input type="number" data-f="toRack" placeholder="rack B" value="${x.toRack ?? ''}" style="max-width:80px">
      <input data-f="approvalRef" placeholder="approval ref" value="${esc(x.approvalRef || '')}" class="${x.approvalRef ? '' : 'warn'}">
      <button class="icon-btn ex-del" title="Remove">✕</button>
    </div>`;
  }
  function spanRow(x, i) {
    return `<div class="ex-row" data-i="${i}">
      <input type="number" data-f="fromRack" placeholder="rack A" value="${x.fromRack ?? ''}" style="max-width:90px">
      <span>→</span>
      <input type="number" data-f="toRack" placeholder="rack B" value="${x.toRack ?? ''}" style="max-width:90px">
      <select data-f="network"><option value="" ${!x.network ? 'selected' : ''}>both</option><option value="power" ${x.network === 'power' ? 'selected' : ''}>power</option><option value="comm" ${x.network === 'comm' ? 'selected' : ''}>comm</option></select>
      <input type="number" data-f="spanMm" placeholder="span mm" value="${x.spanMm ?? ''}">
      <button class="icon-btn sp-del" title="Remove">✕</button>
    </div>`;
  }

  const readRows = (wrapSel, delCls) => {
    const rows = [];
    el.querySelectorAll(`${wrapSel} .ex-row`).forEach(row => {
      const o = {};
      row.querySelectorAll('[data-f]').forEach(inp => {
        const f = inp.dataset.f;
        o[f] = inp.type === 'number' ? (inp.value === '' ? null : +inp.value) : inp.value;
      });
      if (o.m1 && o.m2) o.between = [+o.m1, +o.m2];
      if (!row.querySelector(`.${delCls}`)) rows.push(o);
    });
    return rows;
  };

  el.querySelector('#ex-add').onclick = () => {
    const list = el.querySelector('#ex-list');
    if (list.querySelector('p.muted')) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', exceptionRow({ type: 'gap', network: 'power', string: 0 }, list.children.length));
    list.querySelectorAll('.ex-del').forEach(b => b.onclick = e => e.target.closest('.ex-row').remove());
  };
  el.querySelector('#sp-add').onclick = () => {
    const list = el.querySelector('#sp-list');
    if (list.querySelector('p.muted')) list.innerHTML = '';
    list.insertAdjacentHTML('beforeend', spanRow({ fromRack: 1, toRack: 2, spanMm: 951 }, list.children.length));
    list.querySelectorAll('.sp-del').forEach(b => b.onclick = e => e.target.closest('.ex-row').remove());
  };
  el.querySelectorAll('.ex-del').forEach(b => b.onclick = e => e.target.closest('.ex-row').remove());
  el.querySelectorAll('.sp-del').forEach(b => b.onclick = e => e.target.closest('.ex-row').remove());

  el.querySelector('#ex-save').onclick = async () => {
    const exceptions = readRows('#ex-list', 'ex-del').map(o => ({
      type: o.type, string: o.string ?? 0, between: o.between || [o.m1, o.m2],
      from: o.from, to: o.to, network: o.network,
      sourceLen: o.sourceLen, destLen: o.destLen, fromRack: o.fromRack, toRack: o.toRack,
      approvalRef: o.approvalRef || null,
    })).filter(o => o.type === 'crossrack' || (o.between && o.between[0] && o.between[1]) || o.from);
    const spans = readRows('#sp-list', 'sp-del').filter(o => o.fromRack && o.toRack && o.spanMm);
    const ok = await ctx.saveProject({ config: { ...(project.config || {}), exceptions, spans } });
    if (ok) toast('Saved. Netlist regenerated with new exceptions.');
  };
}

/* ---- Tab 5: Validation ---- */
async function tabValidation(el, project, ctx) {
  const results = await ctx.getValidations(true);
  const fails = results.filter(r => r.status === 'fail').length;
  el.innerHTML = `
  <div class="page-head slim">
    <div><h2>Mandatory validation gate</h2><p class="muted">${fails === 0 ? 'All checks passed — output may be released.' : `${fails} check(s) failed — release is blocked until resolved.`}</p></div>
    <span class="gate ${fails === 0 ? 'gate-ok' : 'gate-block'}">${fails === 0 ? 'RELEASE ALLOWED' : 'RELEASE BLOCKED'}</span>
  </div>
  <div class="val-list">
  ${results.map(v => `
    <div class="val-row ${v.status}">
      <div class="val-id">${esc(v.id)}</div>
      <div class="val-body"><div class="val-label">${esc(v.label)}</div><div class="val-detail">${esc(v.detail)}</div></div>
      <div class="val-status">${v.status === 'pass' ? '✓' : '✕'}</div>
    </div>`).join('')}
  </div>`;
}

/* ---- Tab 6: Schedule & BOM ---- */
async function tabSchedule(el, project, ctx) {
  const conns = await ctx.getNetlist();
  const sched = buildSchedule(conns);
  el.innerHTML = `
  <div class="page-head slim">
    <div><h2>Cable schedule & BOM</h2><p class="muted">${sched.length} line items · ${sched.reduce((t, r) => t + r.qty, 0)} cables total.</p></div>
    <div class="btn-row">
      <button class="btn btn-ghost" id="s-csv">Export CSV</button>
      <button class="btn btn-ghost" id="s-dxf">Export DXF</button>
      <button class="btn btn-primary" id="s-vsdx">Export Visio (.vsdx)</button>
    </div>
  </div>
  <div class="table-wrap"><table class="data">
    <thead><tr><th>Cable ID</th><th>Network</th><th>Class</th><th>From → To</th><th>Harness P/N</th><th>Cable spec</th><th>Mfg length</th><th>Qty</th></tr></thead>
    <tbody>${sched.map((r, i) => `<tr>
      <td class="mono">C-${String(i + 1).padStart(3, '0')}</td>
      <td><span class="net ${r.network}">${r.network}</span></td><td>${esc(r.cls)}</td>
      <td class="mono">${esc(r.from)} → ${esc(r.to)}</td>
      <td class="mono ${r.harness.startsWith('—') ? 'warn' : ''}">${esc(r.harness)}</td>
      <td class="mono">${esc(r.gauge || '')}</td>
      <td>${r.length} mm</td><td>${r.qty}</td></tr>`).join('')}
    </tbody>
  </table></div>`;
  el.querySelector('#s-csv').onclick = () => download(`${project.name || 'cable'}-BOM.csv`, scheduleCSV(conns, project), 'text/csv');
  el.querySelector('#s-dxf').onclick = () => download(`${project.name || 'wiring'}.dxf`, dxfExport(conns, project), 'application/dxf');
  el.querySelector('#s-vsdx').onclick = () => download(`${project.name || 'wiring'}.vsdx`, vsdxExport(conns, project), 'application/vnd.ms-visio.drawing.main+xml');
}

/* ---- Tab 7: Diagram ---- */
async function tabDiagram(el, project, ctx) {
  const conns = await ctx.getNetlist();
  el.innerHTML = `
  <div class="page-head slim">
    <div><h2>Wiring diagram preview</h2><p class="muted">Schematic preview of the generated power & communication routing for string 1. Power and communication run on separated rails (R01).</p></div>
  </div>

  <div class="card" id="vsdx-card">
    <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
      <h3 style="margin:0">Your Visio drawing</h3>
      <input type="file" id="vsdx-file" accept=".vsdx" style="display:none">
      <button class="btn btn-primary btn-sm" id="btn-vsdx-open">Open Visio file…</button>
      <span id="vsdx-saved"></span>
      <span class="muted small" id="vsdx-status"></span>
    </div>
    <p class="muted small" style="margin:6px 0 0">Open the engineer's own .vsdx and it is drawn here exactly as Visio shows it — frame, title block, the AutoCAD rack picture and all pages. Nothing is uploaded to render it.</p>
    <div id="vsdx-pages" class="btn-row" style="margin:10px 0 4px"></div>
    <div id="vsdx-layers" class="btn-row" style="margin:0 0 8px"></div>
    <div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">
      <label class="muted small">Zoom</label>
      <select id="vsdx-zoom" class="input" style="width:auto;padding:4px 8px">
        <option value="fit" selected>Fit width</option>
        <option value="0.5">50%</option>
        <option value="1">100%</option>
        <option value="1.5">150%</option>
        <option value="2">200%</option>
      </select>
      <button class="btn btn-ghost btn-sm" id="btn-vsdx-save" style="display:none">Save file to project</button>
      <button class="btn btn-ghost btn-sm" id="btn-vsdx-base" style="display:none" title="Use the embedded AutoCAD rack picture as the base for numbering and wiring">Use as wiring base</button>
    </div>
    <div id="vsdx-view" style="overflow:auto;max-height:80vh;background:#eef1f6;border-radius:8px;padding:6px"></div>
  </div>

  <div class="diagram-wrap" style="margin-top:16px">${renderDiagramSVG(project, conns)}</div>`;

  const st = { doc: null, page: 0, layersOn: null, file: null, savedRow: null };
  const $ = (s) => el.querySelector(s);

  /* ---- offer a previously saved .vsdx ---- */
  try {
    const saved = await localProjectFiles(project.id);
    const row = (saved || []).find((f) => /\.vsdx$/i.test(f.filename || ''));
    if (row) {
      st.savedRow = row;
      const wrap = $('#vsdx-saved');
      wrap.innerHTML = `<button class="btn btn-ghost btn-sm">Load saved: ${esc(row.filename)}</button>`;
      wrap.firstChild.onclick = async () => {
        try {
          $('#vsdx-status').textContent = 'Opening saved file…';
          await openBuffer(await row.blob.arrayBuffer(), row.filename);
        } catch (e) {
          $('#vsdx-status').textContent = '';
          toast('Could not load the saved Visio file (' + (e && e.message ? e.message : 'network error') +
            '). Open the .vsdx from your disk with "Open Visio file…" instead.', 'error');
        }
      };
    }
  } catch (e) { /* file list unavailable — ignore */ }

  $('#btn-vsdx-open').onclick = () => $('#vsdx-file').click();
  $('#vsdx-file').addEventListener('change', async () => {
    const file = $('#vsdx-file').files[0];
    if (file) await openBuffer(await file.arrayBuffer(), file.name, file);
  });

  async function openBuffer(buf, name, file) {
    const status = $('#vsdx-status');
    try {
      status.textContent = 'Reading package…';
      st.doc = await vsdxOpen(buf, { emfPx: 2400 });
      st.page = 0; st.layersOn = null; st.file = file || null;
      status.textContent = `${name} — ${st.doc.pages.length} page${st.doc.pages.length > 1 ? 's' : ''}, ${(buf.byteLength / 1024 / 1024).toFixed(1)} MB`;
      $('#btn-vsdx-save').style.display = file ? '' : 'none';
      renderTabs();
      await render();
    } catch (e) {
      status.textContent = '';
      toast('Could not open ' + name + ': ' + e.message, 'error');
    }
  }

  function renderTabs() {
    $('#vsdx-pages').innerHTML = st.doc.pages.map((p, i) =>
      `<button class="btn ${i === st.page ? 'btn-primary' : 'btn-ghost'} btn-sm" data-page="${i}">${esc(p.name)}</button>`).join('');
    el.querySelectorAll('[data-page]').forEach((b) => b.onclick = async () => {
      st.page = +b.dataset.page; st.layersOn = null; renderTabs(); await render();
    });
    const layers = st.doc.pages[st.page].layers;
    $('#vsdx-layers').innerHTML = layers.length
      ? `<span class="muted small">Layers:</span>` + layers.map((l) => {
          const label = typeof vsdxLayerLabel === 'function' ? vsdxLayerLabel(l.name) : l.name;
          const tip = label !== l.name ? ` title="${escAttr(l.name)} (original layer name in the file)"` : '';
          return `<label class="check"${tip}><input type="checkbox" data-layer="${l.ix}" checked> ${esc(label)}</label>`;
        }).join('')
      : '';
    el.querySelectorAll('[data-layer]').forEach((c) => c.onchange = () => {
      const boxes = [...el.querySelectorAll('[data-layer]')];
      const allOn = boxes.every((b) => b.checked);
      st.layersOn = allOn ? null : new Set(boxes.filter((b) => b.checked).map((b) => +b.dataset.layer));
      render();
    });
  }

  async function render() {
    const t0 = performance.now();
    const r = await st.doc.renderPage(st.page, { layersOn: st.layersOn });
    st.lastRender = r;
    const view = $('#vsdx-view');
    view.innerHTML = r.svg;
    const zoom = $('#vsdx-zoom').value;
    const svg = view.querySelector('svg');
    if (svg) {
      if (zoom === 'fit') { svg.style.width = '100%'; svg.style.height = 'auto'; }
      else { svg.style.width = Math.round(r.page.w * 96 * parseFloat(zoom)) + 'px'; svg.style.height = 'auto'; }
    }
    $('#btn-vsdx-base').style.display = (r.foreigns && r.foreigns.length) ? '' : 'none';
    $('#vsdx-status').textContent = `${st.doc.pages[st.page].name}: ${r.stats.shapes} shapes, ${r.stats.texts} labels`
      + (r.stats.foreign ? `, ${r.stats.foreign} embedded picture${r.stats.foreign > 1 ? 's' : ''}` : '')
      + ` · ${Math.round(performance.now() - t0)} ms`;
  }

  /* Take the largest embedded picture (the AutoCAD rack) out of the Visio
   * page and make it the project underlay, at the same position on the
   * A3 sheet: the sheet is 16.535 × 11.69 in and carries 101.6 units per
   * inch (0.25 mm per unit), y flipped. */
  $('#btn-vsdx-base').onclick = async () => {
    const r = st.lastRender;
    if (!r || !r.foreigns || !r.foreigns.length) return;
    const status = $('#vsdx-status');
    try {
      status.textContent = 'Preparing wiring base…';
      const f = r.foreigns.reduce((a, b) => (a.w * a.h >= b.w * b.h ? a : b));
      /* The picture blob travels with the render record — no fetch needed.
         A fetch on the data:/blob: href is exactly what fails with
         "Failed to fetch" in some browsers, so it is only a fallback. */
      let blob = f.blob || null;
      if (!blob) {
        try { blob = await (await fetch(f.href)).blob(); }
        catch (e1) { blob = vsdxHrefToBlob(f.href); }
      }
      if (!blob) throw new Error('The embedded rack picture could not be read from this page — re-open the .vsdx from disk and try again.');
      await ctx.saveUnderlayBlob(blob, 'image');
      const path = `local-underlay:${project.id}`;
      const U = 101.6;
      const page = st.doc.pages[st.page];
      const ok = await ctx.saveProject({
        underlay_url: path, underlay_kind: 'image',
        underlay_x: +(f.x * U).toFixed(1),
        underlay_y: +((page.h - f.y - f.h) * U).toFixed(1),
        underlay_w: +(f.w * U).toFixed(1),
        underlay_h: +(f.h * U).toFixed(1),
      });
      if (!ok) throw new Error('Save failed');
      await ctx.loadUnderlay();
      status.textContent = 'Wiring base set ✓';
      toast('Rack picture is now the wiring base — open the Numbering tab to calibrate the grid on it.');
    } catch (e) {
      status.textContent = '';
      toast(e.message || 'Could not use the picture as wiring base', 'error');
    }
  };

  $('#vsdx-zoom').onchange = () => { if (st.doc) render(); };
  $('#btn-vsdx-save').onclick = async () => {
    if (!st.file) return;
    const status = $('#vsdx-status');
    try {
      status.textContent = 'Saving on this device…';
      await localAddFile({
        project_id: project.id, filename: st.file.name, blob: st.file,
        size_bytes: st.file.size, aps_status: 'stored', created_at: new Date().toISOString(),
      });
      status.textContent += ' · saved ✓';
      toast('Visio file saved to the project.');
      $('#btn-vsdx-save').style.display = 'none';
    } catch (e) { toast(e.message || 'Save failed', 'error'); status.textContent = status.textContent.replace(/ · saved ✓$/, ''); }
  };
}

/* ---- Guided step 4: live wiring and validation summary ------------------- */
async function tabWireValidate(el, project, ctx) {
  const numbering = (project.config && project.config.numbering) || {};
  const rules = { ...DEFAULT_RULES, ...((project.config && project.config.rules) || {}) };
  const groups = layoutGroups(project);
  const totals = layoutTotals(groups);
  const required = Array.isArray(numbering.counts) && numbering.counts.length
    ? numbering.counts.reduce((sum, count) => sum + count, 0)
    : Math.max(1, rules.strings || 1) * Math.max(1, rules.modulesPerString || 1);
  const numbered = Array.isArray(numbering.order) ? numbering.order.length : 0;
  const engineChecks = (await ctx.getValidations()).map(row => ({
    id: row.id, label: row.label, pass: row.status === 'pass', detail: row.detail,
  }));
  const layoutChecks = layoutValidate(project);
  const checks = engineChecks.concat(layoutChecks.map(row => ({
    id: row.id, label: row.label, pass: row.status === 'pass', detail: row.detail,
  })));
  const cal = fvCalib(numbering.cal);
  const canDraw = !!(cal.ok && project.underlay && project.underlay.kind === 'image' && project.underlay.src);
  const segs = canDraw ? layoutFrontView(groups, cal, {}) : [];
  const perSsc = layoutFrontViewSummary(segs, groups);
  const passed = checks.filter(check => check.pass).length;
  const failed = checks.length - passed;
  const emptyGuidance = !project.underlay_url
    ? 'No rack drawing imported — return to step 1 and import the rack first.'
    : !cal.ok
      ? 'The rack is not calibrated — open the wiring view and complete the two calibration clicks.'
      : !groups.length
        ? 'No SSC chains applied — return to Numbering and apply the chains to the project.'
        : failed
          ? `${failed} validation check(s) need attention before export.`
          : 'Wiring and validations are complete — continue to Export PDF.';
  el.innerHTML = `
    <div class="wire-summary">
      <div><div class="workspace-kicker">Step 4</div><h2>Wire & validate</h2>
        <p class="muted">A live release summary from the saved rack numbering, SSC chains and engineering rules.</p></div>
      <div class="flow-empty ${failed ? 'danger' : passed === checks.length ? 'success' : ''}"><span>${failed ? '!' : '✓'}</span><p>${esc(emptyGuidance)}</p></div>
      <div class="summary-grid">
        <div class="summary-card"><span>Modules numbered</span><strong>${numbered}/${required}</strong><small>${numbered === required ? 'Complete' : required - numbered + ' remaining'}</small></div>
        <div class="summary-card"><span>SSC chains</span><strong>${totals.sscs}</strong><small>${(totals.bomMm / 1000).toFixed(1)} m cable total</small></div>
        <div class="summary-card"><span>Validation gate</span><strong>${passed}/${checks.length}</strong><small>${passed === checks.length ? 'All checks pass' : checks.length - passed + ' need attention'}</small></div>
      </div>
      <div class="card">
        <h3>Chains by SSC</h3>
        <div class="chain-summary-list">${groups.map((group, i) => {
          const live = perSsc[i];
          return `<div class="chain-summary-row"><span class="ssc-dot" style="background:${SSC_PALETTE[i % SSC_PALETTE.length]}"></span><b>${esc(group.label)}</b><span>${group.order.length} modules</span><span>${(group.metrics.bomMm / 1000).toFixed(1)} m BOM</span><span>${live ? 'red ' + (live.powerMm / 1000).toFixed(1) + ' m · green ' + (live.commMm / 1000).toFixed(1) + ' m' : 'Calibrate to measure front-view wiring'}</span></div>`;
        }).join('') || '<p class="muted">No applied SSC chains yet.</p>'}</div>
      </div>
      <div class="card">
        <h3>Engineering checks</h3>
        <div class="validation-chips">${checks.map(check => `<span class="validation-chip ${check.pass ? 'pass' : 'fail'}" title="${esc(check.detail || '')}">${esc(check.id)} · ${check.pass ? 'Pass' : 'Fail'}</span>`).join('')}</div>
      </div>
      <div class="workspace-actions"><button class="btn btn-primary btn-lg" id="wv-open">Open wiring view</button></div>
    </div>`;
  el.querySelector('#wv-open').onclick = async () => {
    await ctx.switchTab(1);
    document.getElementById('fv-card')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
}

function schedulePrintSvg(conns) {
  const grouped = new Map();
  for (const row of buildSchedule(conns || [])) {
    const key = [row.harness, row.network, row.gauge, row.length].join('|');
    if (!grouped.has(key)) grouped.set(key, { ...row, qty: 0 });
    grouped.get(key).qty += row.qty;
  }
  const rows = [...grouped.values()];
  const W = 1680, H = 1188, x = [70, 430, 650, 1000, 1260, 1450];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" font-family="Inter, Arial, sans-serif"><rect width="${W}" height="${H}" fill="#fff"/>`;
  svg += '<text x="70" y="92" font-size="38" font-weight="700" fill="#18212f">Cable schedule &amp; BOM</text>';
  const heads = ['Harness / part number', 'Network', 'Cable specification', 'Length (mm)', 'Quantity'];
  heads.forEach((head, i) => { svg += `<text x="${x[i]}" y="160" font-size="18" font-weight="700" fill="#687386">${esc(head)}</text>`; });
  svg += '<line x1="70" y1="178" x2="1610" y2="178" stroke="#cfd5dd" stroke-width="2"/>';
  rows.slice(0, 24).forEach((row, index) => {
    const y = 218 + index * 37;
    const vals = [row.harness, row.network, row.gauge || '—', row.length, row.qty];
    vals.forEach((value, i) => { svg += `<text x="${x[i]}" y="${y}" font-size="17" fill="#18212f">${esc(value)}</text>`; });
    svg += `<line x1="70" y1="${y + 12}" x2="1610" y2="${y + 12}" stroke="#edf0f3"/>`;
  });
  const qty = rows.reduce((sum, row) => sum + row.qty, 0);
  svg += `<text x="70" y="1125" font-size="20" font-weight="700" fill="#18212f">${rows.length} BOM line(s) · ${qty} cable(s)</text></svg>`;
  return svg;
}

function projectPrintPages(project, conns) {
  const numbering = (project.config && project.config.numbering) || {};
  const cal = fvCalib(numbering.cal);
  const groups = layoutGroups(project);
  const canDraw = !!(cal.ok && project.underlay && project.underlay.kind === 'image' && project.underlay.src);
  const frontSvg = canDraw && modulePortsValid(numbering.modulePorts)
    ? fvSvg(cal, { src: project.underlay.src }, pictureModuleWiring(groups, cal, numbering.modulePorts, numbering.devicePorts), { noGrid: true, sscLabels: true })
    : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1680 1188"><rect width="1680" height="1188" fill="#fff"/><text x="840" y="594" text-anchor="middle" font-family="Arial" font-size="28" fill="#687386">Front-view wiring is unavailable until the rack picture is calibrated.</text></svg>';
  return buildPrintDocument({
    sheetSvg: renderDiagramSVG(project, conns),
    frontSvg: frontSvg,
    scheduleSvg: schedulePrintSvg(conns),
  });
}

function printDocumentHtml(project, pages, dateLabel) {
  return (pages || []).map((page, index) => `<section class="print-page">
    <header><strong>AYK WireFlow</strong><span>${esc(project.name || 'Wiring project')}</span><span>${esc(dateLabel)}</span></header>
    <h1>${esc(page.title)}</h1><div class="print-svg">${page.svg}</div>
    <footer class="print-title-block">
      <div class="print-title-brand"><img src="data:image/png;base64,${VSDX_LOGO_B64}" alt="AYK logo"><strong>AYK POWER LTD.</strong></div>
      <div><small>Drawing</small><span>${esc(project.name || 'Wiring project')}</span></div>
      <div><small>Drawing number · revision</small><span>${esc(project.drawing_no || 'Not specified')} · ${esc(project.revision || 'A')}</span></div>
      <div><small>Date · sheet</small><span>${esc(dateLabel)} · ${index + 1} / ${pages.length}</span></div>
    </footer>
  </section>`).join('');
}

/* ---- Guided export screen -------------------------------------------------
   Uses the existing deterministic exporters. Browser print is the PDF path so
   the drawing remains the same artifact already shown in Diagram. */
async function tabExport(el, project, ctx) {
  const conns = await ctx.getNetlist();
  const numbering = (project.config && project.config.numbering) || {};
  if (modulePortsValid(numbering.modulePorts)) {
    const page = projectPrintPages(project, conns)[1];
    page.title = 'DRAFT — verify all terminals and cable routes';
    const dateLabel = new Date().toLocaleDateString('en-GB');
    el.innerHTML = `<div class="export-screen"><h2>Print draft wiring</h2>
      <p class="muted">Only marked SSC and junction-box terminals are shown. Lines are direct previews, not approved cable routes. Verify every connection and route before use.</p>
      <button class="btn btn-primary" id="module-draft-print">Print or save draft PDF</button>
      <div class="diagram-wrap export-preview">${page.svg}</div></div>
      <div id="print-document" class="print-document" aria-hidden="true">${printDocumentHtml(project, [page], dateLabel)}</div>`;
    el.querySelector('#module-draft-print').onclick = () => window.print();
    return;
  }
  const checks = (await ctx.getValidations()).concat(layoutValidate(project));
  const failed = checks.filter(x => x.status !== 'pass');
  const flow = (project.config && project.config.flow) || {};
  const delivered = !!flow.deliveredAt;
  const pages = projectPrintPages(project, conns);
  const dateLabel = new Date().toLocaleDateString('en-GB', { year: 'numeric', month: 'short', day: '2-digit' });
  el.innerHTML = `
    <div class="export-screen">
      <div>
        <div class="workspace-kicker">Final step</div>
        <h2>${delivered ? 'Project delivered' : 'Export wiring package'}</h2>
        <p class="muted">${delivered ? 'The final wiring package has been marked as delivered.' : 'Print the complete three-page A3 deliverable, then confirm delivery.'}</p>
      </div>
      ${delivered ? `<div class="delivery-complete"><div class="delivery-check">✓</div><div><strong>Delivery complete</strong><p>Marked delivered ${esc(new Date(flow.deliveredAt).toLocaleString())}.</p></div></div>` : ''}
      <div class="export-status ${failed.length ? 'blocked' : 'ready'}">
        <strong>${failed.length ? 'Release blocked' : 'Ready to export'}</strong>
        <span>${failed.length ? failed.length + ' validation check(s) need attention.' : 'All ' + checks.length + ' validation checks pass.'}</span>
      </div>
      ${failed.length ? `<div class="flow-empty danger"><span>!</span><p>Resolve the failed validation checks before creating the delivery PDF.</p></div>` : (!delivered ? `<div class="flow-empty"><span>→</span><p>No delivered package yet — export the PDF, then mark the project delivered.</p></div>` : '')}
      <div class="workspace-actions">
        <button class="btn btn-primary btn-lg" id="e-pdf" ${failed.length ? 'disabled' : ''}>Export PDF</button>
        <button class="btn btn-ghost" id="e-deliver" ${delivered ? 'disabled' : 'hidden'}>Mark project delivered</button>
      </div>
      <details class="other-formats"><summary>Other formats</summary><div class="btn-row">
        <button class="btn btn-ghost" id="e-vsdx">Visio (.vsdx)</button><button class="btn btn-ghost" id="e-dxf">DXF</button>
        <button class="btn btn-ghost" id="e-scr">AutoCAD script</button><button class="btn btn-ghost" id="e-csv">Cable schedule CSV</button>
      </div></details>
      <div class="diagram-wrap export-preview">${pages[0].svg}</div>
    </div>
    <div id="print-document" class="print-document" aria-hidden="true">${printDocumentHtml(project, pages, dateLabel)}</div>`;
  el.querySelector('#e-pdf').onclick = () => {
    window.print();
    el.querySelector('#e-deliver').hidden = false;
  };
  el.querySelector('#e-deliver').onclick = async () => {
    const nextFlow = { ...flow, printedAt: new Date().toISOString(), deliveredAt: new Date().toISOString() };
    const ok = await ctx.saveProject({ config: { ...(project.config || {}), flow: nextFlow } });
    if (!ok) return;
    toast('Project marked delivered.');
    await tabExport(el, project, ctx);
  };
  el.querySelector('#e-vsdx').onclick = () => download(`${project.name || 'wiring'}.vsdx`, vsdxExport(conns, project), 'application/vnd.ms-visio.drawing.main+xml');
  el.querySelector('#e-dxf').onclick = () => download(`${project.name || 'wiring'}.dxf`, dxfExport(conns, project), 'application/dxf');
  el.querySelector('#e-scr').onclick = () => download(`${project.name || 'wiring'}.scr`, scrExport(conns, project), 'text/plain');
  el.querySelector('#e-csv').onclick = () => download(`${project.name || 'wiring'}-schedule.csv`, scheduleCSV(conns, project), 'text/csv');
}

/* ---- Tab 8: Drawings (DWG + Autodesk) ---- */
async function tabDrawings(el, project, ctx) {
  el.innerHTML = `<div class="empty"><h3>Autodesk APS is not connected</h3>
    <p>This internal browser edition keeps project data on this device. Use the Diagram, DXF, SCR and VSDX export tools without a cloud account.</p>
    <a class="btn btn-ghost" href="#/integrations">About optional APS integration</a></div>`;
  return;
  el.innerHTML = `<div class="loading">Loading drawing files…</div>`;
  const { data: files, error } = await cloud.database.from('project_files').select('*').eq('project_id', project.id).order('created_at', { ascending: false });
  const { data: integRows } = await cloud.database.from('integrations').select('*').eq('owner_id', session.user.id).maybeSingle();
  const integ = integRows;
  const connected = !!(integ && integ.client_id && integ.client_secret);

  el.innerHTML = `
  <div class="page-head slim">
    <div><h2>Drawing files & Autodesk pipeline</h2>
    <p class="muted">Upload reference DWGs, translate them on Autodesk Model Derivative and inspect in the embedded viewer.</p></div>
    <span class="chip ${connected ? 'chip-ok' : 'chip-warn'}">${connected ? 'APS connected' : 'APS not connected'}</span>
  </div>
  ${connected ? '' : `<div class="banner">Connect your Autodesk Platform Services credentials to enable translation and viewing. <a href="#/integrations">Open Autodesk APS settings →</a></div>`}

  <div class="upload-row">
    <input type="file" id="dwg-file" accept=".dwg,.dxf,.rvt,.ipt" style="display:none">
    <button class="btn btn-primary" id="btn-upload" ${connected ? '' : 'disabled title="Connect APS first"'}>Upload DWG</button>
    <div class="muted" id="up-status"></div>
  </div>

  <div class="table-wrap">${files && files.length ? `<table class="data">
    <thead><tr><th>File</th><th>Size</th><th>APS URN</th><th>Status</th><th></th></tr></thead>
    <tbody>${files.map(f => `<tr>
      <td class="mono">${esc(f.filename)}</td>
      <td>${f.size_bytes ? (f.size_bytes / 1024 / 1024).toFixed(2) + ' MB' : '—'}</td>
      <td class="mono small">${f.aps_urn ? esc(f.aps_urn.slice(0, 46)) + '…' : '—'}</td>
      <td><span class="chip ${f.aps_status === 'translated' ? 'chip-ok' : ''}">${esc(f.aps_status)}</span></td>
      <td class="btn-row">
        ${f.aps_urn && connected ? `<button class="btn btn-ghost btn-sm" data-view="${f.id}">View</button>` : ''}
        <button class="btn btn-ghost btn-sm" data-dl="${f.id}">Download</button>
        <button class="icon-btn" data-del="${f.id}">✕</button>
      </td></tr>`).join('')}
    </tbody></table>` : `<div class="empty-inline">No drawing files uploaded yet.</div>`}
  </div>
  <div id="viewer-holder" class="viewer-holder" style="display:none"><div id="aps-viewer"></div></div>`;

  if (error) toast('Could not load files: ' + error.message, 'error');

  const fileInput = el.querySelector('#dwg-file');
  el.querySelector('#btn-upload')?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', async () => {
    const file = fileInput.files[0]; if (!file) return;
    const status = el.querySelector('#up-status');
    try {
      if (!session) throw new Error('Sign in required');
      const path = cloud.storage.userPath(session.user.id, `dwg/${Date.now()}_${file.name}`);
      status.textContent = 'Uploading to secure storage…';
      const up = await cloud.storage.upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (up.error) throw up.error;
      const row = { project_id: project.id, filename: file.name, storage_path: path, size_bytes: file.size, aps_status: 'uploaded', owner_name: currentUser?.name || null };
      let urn = null, token = null;
      if (connected) {
        const res = await apsUploadAndTranslate(integ, file, p => status.textContent = `Uploading to Autodesk… ${p}%`, s => status.textContent = s);
        urn = res.urn; token = res.accessToken;
        row.aps_urn = urn;
      }
      const ins = await unwrap(cloud.database.from('project_files').insert(row).select(), 'Save file record');
      status.textContent = connected ? 'Translation submitted — processing…' : 'Uploaded.';
      if (urn && token) {
        await apsWaitForTranslation(token, urn, s => status.textContent = s);
        await cloud.database.from('project_files').update({ aps_status: 'translated' }).eq('id', ins[0].id);
        status.textContent = 'Translated ✓';
        toast('DWG translated — opening viewer.');
        openViewer(ins[0], integ);
      } else toast('File uploaded.');
      rerender();
    } catch (e) {
      status.textContent = '';
      toast(e.message || 'Upload failed', 'error');
    }
  });

  async function openViewer(f, integ) {
    const holder = el.querySelector('#viewer-holder');
    holder.style.display = '';
    holder.scrollIntoView({ behavior: 'smooth' });
    const tok = await apsGetToken(integ);
    await showInViewer('aps-viewer', tok.access_token, urnBase64(f.aps_urn));
  }

  el.querySelectorAll('[data-view]').forEach(b => b.onclick = async () => {
    const f = files.find(x => x.id === +b.dataset.view);
    if (!f?.aps_urn) return;
    try { await openViewer(f, integ); } catch (e) { toast(e.message, 'error'); }
  });
  el.querySelectorAll('[data-dl]').forEach(b => b.onclick = async () => {
    const f = files.find(x => x.id === +b.dataset.dl);
    const { data, error } = await cloud.storage.createSignedUrl(f.storage_path, 600);
    if (error) { toast('Signed URL failed: ' + error.message, 'error'); return; }
    const a = document.createElement('a'); a.href = data.url || data; a.download = f.filename; a.click();
  });
  el.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const f = files.find(x => x.id === +b.dataset.del);
    if (!confirm(`Delete ${f.filename}? The stored file will be removed.`)) return;
    await cloud.storage.remove([f.storage_path]);
    await cloud.database.from('project_files').delete().eq('id', f.id);
    toast('Deleted.'); rerender();
  });

  async function rerender() { await tabDrawings(el, project, ctx); }
}

/* ================= INTEGRATIONS (APS) ================= */
async function renderIntegrations() {
  shell(`<div class="page-head"><div><h1>Autodesk APS</h1><p class="muted">Optional advanced integration</p></div></div>
    <div class="empty"><h3>Cloud integration is disabled</h3>
    <p>AYK WireFlow now runs as an internal, account-free browser tool. Projects, rack drawings and saved Visio files stay on this device. DXF, SCR, VSDX and PDF exports remain available from each project.</p>
    <a class="btn btn-primary" href="#/app">Back to projects</a></div>`, 'int');
  return;
  shell(`<div class="loading">…</div>`, 'int');
  const { data: rows } = await cloud.database.from('integrations').select('*').maybeSingle();
  const integ = rows;
  const connected = !!(integ && integ.client_id && integ.client_secret);

  shell(`
    <div class="page-head"><div><h1>Autodesk Platform Services</h1><p class="muted">Connect your own APS app to enable DWG upload, Model Derivative translation and the embedded viewer.</p></div></div>
    <div class="card" style="max-width:640px">
      <h3>APS credentials</h3>
      <p class="muted small">Create an app at <span class="mono">aps.autodesk.com</span> (type: Server-to-Server), then paste the client id and secret. Credentials are stored in your private account table and used only from your browser.</p>
      <div class="field"><label>Client ID</label><input id="aps-id" value="${esc(integ?.client_id || '')}" placeholder="e.g. a1b2c3d4-..."></div>
      <div class="field"><label>Client secret</label><input id="aps-secret" type="password" value="${esc(integ?.client_secret || '')}" placeholder="••••••••"></div>
      <div class="actions">
        <button class="btn btn-primary" id="aps-save">${connected ? 'Update connection' : 'Connect'}</button>
        ${connected ? '<button class="btn btn-ghost" id="aps-test">Test connection</button><button class="btn btn-ghost" id="aps-del">Disconnect</button>' : ''}
        <span id="aps-status" class="muted"></span>
      </div>
    </div>
    <div class="card" style="max-width:640px;margin-top:16px">
      <h3>How the pipeline works</h3>
      <ol class="steps-ol">
        <li><b>Token</b> — two-legged OAuth (client_credentials) against your APS app.</li>
        <li><b>Upload</b> — DWG pushed to an OSS bucket created under your account.</li>
        <li><b>Translate</b> — Model Derivative SVF2 job, polled until complete.</li>
        <li><b>View</b> — drawing rendered in the embedded APS Viewer 7 (2D sheets).</li>
        <li><b>Generate</b> — export DXF / .scr from the netlist for AutoCAD or Design Automation.</li>
      </ol>
    </div>
  `, 'int');

  el.querySelector('#aps-save').onclick = async () => {
    const client_id = el.querySelector('#aps-id').value.trim();
    const client_secret = el.querySelector('#aps-secret').value.trim();
    if (!client_id || !client_secret) { toast('Both fields are required.', 'error'); return; }
    if (integ && integ.id) {
      const { error } = await cloud.database.from('integrations').update({ client_id, client_secret }).eq('id', integ.id);
      if (error) { toast('Save failed: ' + error.message, 'error'); return; }
    } else {
      const { error } = await cloud.database.from('integrations').insert({ provider: 'aps', client_id, client_secret, owner_name: currentUser?.name || null });
      if (error) { toast('Save failed: ' + error.message, 'error'); return; }
    }
    toast('APS credentials saved.'); renderIntegrations();
  };
  el.querySelector('#aps-test')?.addEventListener('click', async () => {
    const st = el.querySelector('#aps-status'); st.textContent = 'Testing…';
    try { const t = await apsGetToken(integ); st.textContent = `✓ Connected (token expires in ${Math.round(t.expires_in / 60)} min)`; }
    catch (e) { st.textContent = '✗ ' + e.message; }
  });
  el.querySelector('#aps-del')?.addEventListener('click', async () => {
    if (!confirm('Disconnect APS and remove stored credentials?')) return;
    await cloud.database.from('integrations').delete().eq('id', integ.id);
    toast('Disconnected.'); renderIntegrations();
  });
}

/* ================= BOOT ================= */
(async function boot() {
  await route();
})();
