/* ============================================================
 * WireFlow — application shell
 * Hash router: #/ and #/app dashboard ·
 * #/project/<id> workspace · #/cad/<id> CAD rack view ·
 * #/integrations APS settings
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

const SITE_TITLE = document.title;
async function route() {
  const h = location.hash || '';
  /* The public product page lives in index.html (static, crawlable). Only
     "#/<something>" routes belong to the app; "#features" etc. are page anchors. */
  const isApp = h.startsWith('#/') && h !== '#/';
  const landing = document.getElementById('landing');
  if (landing) landing.hidden = isApp;
  app.hidden = !isApp;
  if (!isApp) {
    document.title = SITE_TITLE;
    if (h === '' || h === '#/') window.scrollTo(0, 0);
    return;
  }
  document.title = 'WireFlow';
  if (h.startsWith('#/project/')) { renderProjectPage(+h.split('/')[2]); return; }
  if (h.startsWith('#/cad/')) { renderCadPage(+h.split('/')[2]); return; }
  if (h.startsWith('#/sheet/')) { renderSheetPage(+h.split('/')[2]); return; }
  switch (h) {
    case '#/app': renderDashboard(); return;
    case '#/example': openExampleRack().catch(e => { shell(`<div class="empty"><h3>Could not open the example</h3><p>${esc(e.message)}</p><a class="btn btn-primary" href="#/app">Back</a></div>`, 'dash'); }); return;
    case '#/login': location.replace('#/app'); return;
    case '#/integrations': renderIntegrations(); return;
    default: renderDashboard();
  }
}

/* ================= APP SHELL ================= */
function shell(content, active) {
  app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="topbar-in">
        <a class="tb-brand" href="#/app" aria-label="WireFlow drawings">
          <span class="brand-logo"><img src="assets/ayk-energy-logo.png" width="28" height="28" alt=""></span>
          <span>WireFlow</span>
        </a>
        <nav class="tb-nav" aria-label="App">
          <a href="#/app" class="${active === 'dash' ? 'on' : ''}">Drawings</a>
          <a href="#/">Product</a>
        </nav>
        <span class="tb-note"><span class="tb-dot" aria-hidden="true"></span>Drawings stay on this device</span>
      </div>
    </header>
    <main class="main">${content}</main>
  </div>`;
}

/* ================= DASHBOARD ================= */
async function renderDashboard() {
  shell(`<div class="loading">Loading projects…</div>`, 'dash');
  let projects;
  try { projects = await localProjects(); }
  catch (error) { shell(`<div class="empty">Could not open local projects: ${esc(error.message)}</div>`, 'dash'); return; }

  const cadProjects = projects.filter(p => p.underlay_kind === 'cad');
  const legacy = projects.filter(p => p.underlay_kind !== 'cad');
  const when = p => new Date(p.updated_at || p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const cadCard = p => {
    const comps = (p.config && p.config.cad && p.config.cad.components) || [];
    const n = k => comps.filter(c => c.kind === k).length;
    const named = comps.filter(c => c.kind === 'ssc' || c.kind === 'acdp' || c.kind === 'msm');
    const status = !comps.length ? ['Parts not taught yet', 'idle']
      : named.length && named.every(c => c.labelConfirmed) ? ['Rack confirmed', 'ok'] : ['Needs confirmation', 'warn'];
    const stats = [['modules', n('module')], ['SSCs', n('ssc')], ['JBs', n('jb')], ['ACDPs', n('acdp')], ['MSMs', n('msm')]].filter(x => x[1]);
    return `<a class="d-card" href="#/cad/${p.id}">
      <div class="d-card-top"><span class="d-file" aria-hidden="true">DXF</span>
        <div class="d-card-title"><b>${esc(p.name)}</b><small>Updated ${esc(when(p))}</small></div></div>
      <div class="d-stats">${stats.length ? stats.map(x => `<span><b>${x[1]}</b> ${x[0]}</span>`).join('') : '<span class="muted">Open the drawing and teach one module to start.</span>'}</div>
      <div class="d-status d-status-${status[1]}"><span class="d-dot"></span>${status[0]}</div>
    </a>`;
  };
  shell(`
    <div class="dash">
      <div class="dash-head">
        <div>
          <h1>Rack drawings</h1>
          <p>Import an AutoCAD rack drawing, teach each part once and confirm the rack.</p>
        </div>
        <div class="dash-actions">
          <a class="btn-site btn-site-ghost" href="#/example">Open the example rack</a>
          <button class="btn-site btn-site-ghost" id="studio-open-session">Open saved session</button>
          <button class="btn-site btn-site-primary" id="studio-import-button">Import DXF</button>
        </div>
      </div>

      <section class="drop" id="dash-drop" aria-labelledby="drop-title">
        <div class="drop-icon" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M12 15V4m0 0L8 8m4-4 4 4" stroke="#00a8ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="#9aabc6" stroke-width="1.8" stroke-linecap="round"/></svg>
        </div>
        <h2 id="drop-title">Drop an AutoCAD rack drawing here</h2>
        <p>ASCII DXF in millimetres &middot; <button class="link-btn" id="drop-browse">browse files</button></p>
        <p class="drop-hint">Have a DWG? Convert it with <code>tools/dwg-to-dxf.ps1</code> (uses your AutoCAD) or AutoCAD <i>Save As &rarr; DXF</i>.</p>
        <p id="studio-import-status" class="drop-status" role="status"></p>
        <input id="studio-import-file" type="file" accept=".dxf,.svg,image/svg+xml" hidden>
        <input id="studio-session-file" type="file" accept=".json,application/json" hidden>
      </section>

      <ol class="dash-steps" aria-label="Workflow">
        <li><b>1</b><span>Import DXF</span></li>
        <li><b>2</b><span>Teach each part once</span></li>
        <li><b>3</b><span>Confirm SSCs, ACDPs, MSM and modules per SSC</span></li>
        <li><b>4</b><span>Generate wiring and download the PDF sheet</span></li>
      </ol>

      <section class="dash-list" aria-labelledby="list-title">
        <div class="dash-list-head"><h2 id="list-title">Your drawings</h2><span>${cadProjects.length} drawing${cadProjects.length === 1 ? '' : 's'}</span></div>
        ${cadProjects.length ? `<div class="d-grid">${cadProjects.map(cadCard).join('')}</div>`
          : `<div class="d-empty"><b>No drawings yet</b><span>Import a DXF above to start, or <a href="#/example">open the example rack</a> (60 modules, parts already taught) to try every step.</span></div>`}
      </section>

      <details class="dash-legacy">
        <summary>Legacy picture projects (${legacy.length})</summary>
        <p class="muted small">The earlier picture-based workspace. New racks should use DXF drawings above.</p>
        <div class="dash-legacy-actions"><button class="btn-site btn-site-ghost" id="btn-new">New legacy project</button></div>
        ${legacy.length ? `<div class="d-grid">${legacy.map(p => `
          <a class="d-card" href="#/project/${p.id}">
            <div class="d-card-top"><span class="d-file d-file-old" aria-hidden="true">IMG</span>
              <div class="d-card-title"><b>${esc(p.name)}</b><small>Updated ${esc(when(p))}</small></div></div>
            <div class="d-stats"><span>${esc(p.status || 'draft')}</span>${p.drawing_no ? `<span>${esc(p.drawing_no)} rev ${esc(p.revision || '')}</span>` : ''}</div>
          </a>`).join('')}</div>` : ''}
      </details>
    </div>
  `, 'dash');
  const studioFile = document.getElementById('studio-import-file');
  const studioStatus = document.getElementById('studio-import-status');
  document.getElementById('studio-import-button').onclick = () => studioFile.click();
  document.getElementById('drop-browse').onclick = () => studioFile.click();
  const sessionFile = document.getElementById('studio-session-file');
  document.getElementById('studio-open-session').onclick = () => sessionFile.click();
  sessionFile.onchange = async () => {
    const file = sessionFile.files[0];
    if (!file) return;
    studioStatus.textContent = 'Opening session…';
    try {
      const saved = JSON.parse(await file.text());
      validateStudioSession(saved);
      const svg = validateStudioSvg(saved.svg);
      const project = { ...saved.project, config: saved.project.config, status: 'draft', updated_at: new Date().toISOString() };
      if (project.config.flow) { project.config.flow = { ...project.config.flow }; delete project.config.flow.deliveredAt; }
      delete project.id; delete project.underlay; delete project.underlay_url;
      project.id = await localAddProject(project);
      await localPutUnderlay(project.id, new Blob([svg], { type: 'image/svg+xml' }), 'image');
      project.underlay_kind = 'image'; project.underlay_url = `local-underlay:${project.id}`;
      await localPutProject(project);
      sessionStorage.setItem('wireflow-open-workspace', String(project.id));
      location.hash = `#/project/${project.id}`;
    } catch (error) { console.error('Session import failed', error); studioStatus.textContent = error.message || 'Could not open this session.'; }
    finally { sessionFile.value = ''; }
  };
  async function openStudioDrawing(file) {
    if (!file) return;
    studioStatus.textContent = 'Checking drawing…';
    try {
      if (/\.dwg$/i.test(file.name)) throw new Error('DWG cannot be read in the browser. Convert it with tools/dwg-to-dxf.ps1 or AutoCAD Save As DXF, then import the .dxf.');
      if (/\.dxf$/i.test(file.name)) { await openStudioCad(file); return; }
      if (!/\.svg$/i.test(file.name)) throw new Error('Choose a DXF or SVG drawing.');
      const svg = validateStudioSvg(await file.text());
      const now = new Date().toISOString();
      const project = { name: file.name.replace(/\.svg$/i, '') || 'Drawing', vessel: '', drawing_no: '',
        product_family: '', modules_per_string: 0, config: { rules: { ...DEFAULT_RULES }, exceptions: [], spans: [] },
        status: 'draft', revision: 'A', created_at: now, updated_at: now };
      project.id = await localAddProject(project);
      await localPutUnderlay(project.id, new Blob([svg], { type: 'image/svg+xml' }), 'image');
      Object.assign(project, { underlay_url: `local-underlay:${project.id}`, underlay_kind: 'image', underlay_x: 120, underlay_y: 280, underlay_w: 1000, underlay_h: 640 });
      await localPutProject(project);
      sessionStorage.setItem('wireflow-open-workspace', String(project.id));
      location.hash = `#/project/${project.id}`;
    } catch (error) {
      console.error('Drawing import failed', error);
      studioStatus.textContent = error.message || 'Could not import this drawing.';
    } finally { studioFile.value = ''; }
  }
  async function openStudioCad(file) {
    studioStatus.textContent = 'Reading DXF…';
    const text = await file.text();
    const model = cadParseDxf(text);             /* throws a readable error for DWG / binary / empty */
    if (!model.entities.length) throw new Error('The DXF has no model-space geometry.');
    const now = new Date().toISOString();
    const project = { name: file.name.replace(/\.dxf$/i, '') || 'Rack', vessel: '', drawing_no: '',
      product_family: '', modules_per_string: 0, config: { rules: { ...DEFAULT_RULES }, exceptions: [], spans: [] },
      status: 'draft', revision: 'A', created_at: now, updated_at: now, underlay_kind: 'cad', cad_file: file.name };
    project.id = await localAddProject(project);
    await localPutUnderlay(project.id, new Blob([text], { type: 'application/dxf' }), 'cad');
    project.underlay_url = `local-underlay:${project.id}`;
    await localPutProject(project);
    location.hash = `#/cad/${project.id}`;
  }
  studioFile.onchange = () => openStudioDrawing(studioFile.files[0]);
  const dropArea = document.getElementById('dash-drop');
  dropArea.ondragover = event => { event.preventDefault(); dropArea.classList.add('drop-over'); };
  dropArea.ondragleave = () => dropArea.classList.remove('drop-over');
  dropArea.ondrop = event => {
    event.preventDefault(); dropArea.classList.remove('drop-over');
    if (event.dataTransfer.files.length !== 1) { studioStatus.textContent = 'Drop one drawing at a time.'; return; }
    openStudioDrawing(event.dataTransfer.files[0]);
  };
  document.getElementById('btn-new')?.addEventListener('click', () => showNewProjectModal());
}

function validateStudioSession(saved) {
  if (!saved || saved.format !== 'ayk-wireflow-session' || saved.version !== 1 || typeof saved.svg !== 'string' || !saved.project || typeof saved.project !== 'object' || Array.isArray(saved.project) || !saved.project.config || typeof saved.project.config !== 'object' || Array.isArray(saved.project.config)) throw new Error('This is not a supported WireFlow session.');
  return true;
}

async function saveStudioSession(project) {
  const record = await localGetUnderlay(project.id);
  if (!record || !record.blob || record.blob.type !== 'image/svg+xml') throw new Error('Session export currently supports imported SVG drawings only.');
  const copy = { ...project };
  delete copy.id; delete copy.underlay; delete copy.underlay_url;
  const saved = { format: 'ayk-wireflow-session', version: 1, project: copy, svg: await record.blob.text() };
  download((project.name || 'wiring') + '.wireflow.json', JSON.stringify(saved), 'application/json');
}

/* Reject active or external SVG content at the new import boundary. SVG is
   kept as vector data; unsupported content is reported instead of rewritten. */
function validateStudioSvg(source) {
  if (/<!ENTITY|<\?xml-stylesheet/i.test(source) || /<!DOCTYPE[^>]*\[/i.test(source)) throw new Error('SVG entity declarations are not supported.');
  source = source.replace(/<!DOCTYPE\s+svg\s*(?:(?:PUBLIC\s+"[^"]*"\s+"[^"]*")|(?:SYSTEM\s+"[^"]*"))?\s*>/i, '');
  if (/<!DOCTYPE/i.test(source)) throw new Error('This SVG document declaration is not supported.');
  const doc = new DOMParser().parseFromString(source, 'image/svg+xml');
  if (!doc.documentElement || doc.documentElement.localName !== 'svg' || doc.querySelector('parsererror')) throw new Error('The SVG is malformed or unsupported.');
  for (const node of doc.querySelectorAll('*')) {
    /* Visio supplies an SVG fallback beside its proprietary foreignObject. */
    if (/^foreignObject$/i.test(node.localName)) { node.remove(); continue; }
    if (/^(script|iframe|object|embed|animate|animateMotion|animateTransform|set)$/i.test(node.localName)) throw new Error('The SVG contains unsupported active content.');
    if (node.localName.toLowerCase() === 'style' && /@|\\|\/\*|expression\s*\(|(?:url\s*\(\s*(?!#[\w:.-]+\s*\)))/i.test(node.textContent || '')) throw new Error('The SVG stylesheet contains unsupported content.');
    for (const attr of node.attributes) {
      const name = attr.localName.toLowerCase(), value = attr.value.trim();
      if (attr.namespaceURI === 'http://www.w3.org/XML/1998/namespace' && name === 'base') throw new Error('The SVG contains an unsupported base URL.');
      if (name.startsWith('on') || /(?:@|\\|expression\s*\(|url\s*\(\s*(?!#[\w:.-]+\s*\)))/i.test(value)) throw new Error('The SVG contains unsupported active or external content.');
      if (name === 'href' && !/^#[-\w:.]+$/.test(value) && !/^data:image\/(png|jpeg|gif|webp);base64,[a-z0-9+/=\s]+$/i.test(value)) throw new Error('The SVG refers to an unsupported external resource.');
    }
  }
  return new XMLSerializer().serializeToString(doc.documentElement);
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

/* ================= CAD RACK VIEW =================
 * Native CAD workflow. Phase 1: the imported DXF is shown at its true
 * millimetre geometry (no fitting, no calibration). Phase 2: the engineer
 * teaches each part once (box one example, click its terminals) and every
 * identical copy in the drawing is found automatically. */

const CAD_KINDS = [
  { id: 'module', label: 'Battery module', color: '#38bdf8' },
  /* SSCs are wired AND named: SSC1 is the SSC closest to the MSM; the engineer
     confirms each name and enters how many modules each SSC controls. */
  { id: 'ssc', label: 'SSC', color: '#f97316', named: true, prefix: 'SSC' },
  { id: 'jb', label: 'Junction box', color: '#a78bfa' },
  /* ACDP and MSM are wired at the back of the rack: no terminals, no front
     wiring. They only carry a label (ACDP1, MSM1 ...) that the engineer confirms. */
  { id: 'acdp', label: 'ACDP', color: '#facc15', wired: false, prefix: 'ACDP' },
  { id: 'msm', label: 'MSM', color: '#f472b6', wired: false, prefix: 'MSM' },
];
/** Parts whose names the engineer confirms (SSC, ACDP, MSM). */
function cadNamed(kind) { const k = cadKind(kind); return k.wired === false || !!k.named; }
/** Stable key of a recognised component on one drawing (kind + position). */
function cadCompKey(c) { return c.kind + '@' + Math.round(c.x0) + ',' + Math.round(c.y0); }
/** Label shown for a component: the engineer's label, else the proposal. */
function cadCompLabel(c, labels) {
  const k = cadKind(c.kind);
  if (!cadNamed(c.kind)) return c.id;
  const saved = labels && labels[cadCompKey(c)];
  return saved && saved.label ? saved.label : k.prefix + (c.proposal || c.id.split('-').pop());
}
/* AYK terminal conventions (confirmed by AYK engineering), all LEFT to RIGHT:
   - module: S, N (communication), then power − and +;
   - SSC connector strip: S, N (communication), S+ (string +), B+ (bus +),
     B− (bus −), S− (string −);
   - junction box: + − + −, i.e. two power pairs P1 and P2. A rack uses one
     pair or both, depending on the requirement. */
const CAD_TERMINAL_ROLES = {
  module: ['comm-S', 'comm-N', 'power-', 'power+'],
  ssc: ['S', 'N', 'S+', 'B+', 'B-', 'S-'],
  jb: ['P1+', 'P1-', 'P2+', 'P2-'],
};
const CAD_MODULE_TERMINALS = CAD_TERMINAL_ROLES.module;
const CAD_LIBRARY_KEY = 'wireflow-cad-part-library-v1';

function cadKind(id) { return CAD_KINDS.find(k => k.id === id) || { id: id, label: id, color: '#94a3b8' }; }
/** Communication (S, N) is green, power (anything ending + or −) is red. */
function cadTerminalColor(role) {
  if (/^comm/.test(role) || role === 'S' || role === 'N') return '#22c55e';
  if (/^power/.test(role) || /[+-]$/.test(role)) return '#ef4444';
  return '#22d3ee';
}
/** Parts taught before the conventions were known have terminals named
    T1, T2 …; when the count matches, name them by the convention, left to right. */
function cadNormaliseTerminals(sig) {
  const roles = CAD_TERMINAL_ROLES[sig && sig.kind];
  const t = sig && sig.terminals;
  if (!roles || !Array.isArray(t) || t.length !== roles.length || !t.every(x => /^T\d+$/.test(x.role))) return sig;
  sig.terminals = t.slice().sort((a, b) => a.dx - b.dx).map((x, i) => Object.assign({}, x, { role: roles[i] }));
  return sig;
}

/** Device-local library of taught parts, reused on other racks. */
function cadLibraryLoad() {
  try { const v = JSON.parse(localStorage.getItem(CAD_LIBRARY_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function cadLibrarySave(list) {
  try { localStorage.setItem(CAD_LIBRARY_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}
/** Identity of a taught part, shared by its drawing copy and library copy. */
function cadSigId(sig) {
  return sig.id || [sig.kind, sig.w, sig.h, sig.features.length, sig.features[0] && sig.features[0].key].join('|');
}
/** Library copy of a signature: drop where it was taught (drawing-specific). */
function cadLibraryEntry(sig) {
  const s = Object.assign({}, sig);
  delete s.x0; delete s.y0;
  return s;
}

async function renderCadPage(id) {
  shell('<div class="loading">Opening drawing…</div>', 'dash');
  let project, record;
  try { project = await localProject(id); record = await localGetUnderlay(id); } catch (error) {}
  if (!project || !record || !record.blob) {
    shell('<div class="empty"><h3>Drawing not found</h3><p>This drawing is not stored in this browser.</p><a class="btn btn-primary" href="#/app">Back</a></div>', 'dash'); return;
  }
  let model, flat, index;
  try {
    model = cadParseDxf(await record.blob.text());
    flat = cadFlatten(model);
    index = cadFeatureIndex(cadFeatures(flat), 1);
  } catch (error) {
    shell(`<div class="empty"><h3>Could not read this DXF</h3><p>${esc(error.message)}</p><a class="btn btn-primary" href="#/app">Back</a></div>`, 'dash'); return;
  }
  const sum = cadSummary(model, flat);
  const fmt = v => Number(v).toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  const u = sum.units === 'unitless' ? 'units' : sum.units;
  const extOk = !!(sum.extMin && sum.extMax &&
    Math.abs(sum.bounds.minX - sum.extMin.x) < 0.01 && Math.abs(sum.bounds.minY - sum.extMin.y) < 0.01 &&
    Math.abs(sum.bounds.maxX - sum.extMax.x) < 0.01 && Math.abs(sum.bounds.maxY - sum.extMax.y) < 0.01);
  const counts = Object.keys(sum.counts).sort((a, b) => sum.counts[b] - sum.counts[a])
    .map(k => `<li><span>${esc(k)}</span><b>${sum.counts[k].toLocaleString('en-GB')}</b></li>`).join('');
  const skipped = Object.keys(sum.unsupported).map(k => `${esc(k)} ${sum.unsupported[k]}`).join(', ');

  const cfg = project.config || (project.config = {});
  const cad = cfg.cad || (cfg.cad = { signatures: [], components: [] });
  if (!Array.isArray(cad.signatures)) cad.signatures = [];
  const roleList = () => JSON.stringify(cad.signatures.map(s => (s.terminals || []).map(t => t.role)));
  const rolesBefore = roleList();
  cad.signatures.forEach(cadNormaliseTerminals);
  const renamedTerminals = roleList() !== rolesBefore;
  if (!cad.labels || typeof cad.labels !== 'object') cad.labels = {};
  let components = [];
  let fromLibrary = false;
  /* generated wiring (plain data, saved with the drawing) */
  let wiring = cad.wiring && cad.wiring.plan ? cad.wiring.plan : null;
  let focusKey = null;   /* part highlighted by Show / rename */
  let showWiring = true;

  shell(`
    <div class="cad-page">
      <header class="cad-head">
        <a class="back" href="#/app">← Drawings</a>
        <h1>${esc(project.name)}</h1>
        <span class="chip">DXF · ${esc(u)}</span>
        <div class="cad-tools">
          <button class="btn btn-ghost btn-sm" id="cad-fit" title="Fit drawing (F)">Fit</button>
          <button class="btn btn-ghost btn-sm" id="cad-measure" aria-pressed="false" title="Measure between two points (M); snaps to circle centres">Measure</button>
        </div>
      </header>
      <div class="cad-body">
        <div class="cad-stage" id="cad-stage"><canvas id="cad-canvas" aria-label="Rack drawing at true scale"></canvas>
          <div class="cad-readout" id="cad-readout" aria-live="polite">—</div>
          <div class="cad-prompt" id="cad-prompt" hidden></div>
        </div>
        <div class="wf-split" role="separator" aria-orientation="vertical" aria-label="Drag to resize the side panel" tabindex="0"></div>
        <aside class="cad-info">
          <section class="cad-parts">
            <h3>Parts</h3>
            <div id="cad-found"></div>
            <div class="cad-teach">
              <label for="cad-kind">Teach a part</label>
              <div class="cad-teach-row">
                <select id="cad-kind">${CAD_KINDS.map(k => `<option value="${k.id}">${esc(k.label)}</option>`).join('')}</select>
                <button class="btn btn-primary btn-sm" id="cad-teach">Box one example</button>
              </div>
              <p class="muted small">Drag a box around one complete copy. Every identical copy is then found. Then click its terminals once, left to right: module S, N, −, + · SSC S, N, S+, B+, B−, S− · junction box +, −, +, −.</p>
            </div>
            <div id="cad-labels"></div>
            <div id="cad-wiring"></div>
            <p class="small" id="cad-status" role="status"></p>
            <details class="cad-taught" id="cad-taught">
              <summary>Taught parts</summary>
              <p class="muted small">One pattern per part type. <b>Remove</b> takes it off this drawing; <b>Forget</b> also deletes it from the parts saved on this device. Use them when a part was taught wrongly.</p>
              <div id="cad-sigs"></div>
              <div class="cad-part-actions">
                <button class="btn btn-ghost btn-sm" id="cad-use-library">Use saved parts</button>
              </div>
            </details>
          </section>
          <details class="cad-drawing-info">
            <summary>Drawing</summary>
            <dl>
              <dt>Size</dt><dd>${fmt(sum.width)} × ${fmt(sum.height)} ${esc(u)}</dd>
              <dt>Entities</dt><dd>${sum.entities.toLocaleString('en-GB')}</dd>
              <dt>Layers</dt><dd>${sum.layers}</dd>
              <dt>Blocks</dt><dd>${sum.blocks}</dd>
              <dt>Circles</dt><dd>${sum.circles.toLocaleString('en-GB')}</dd>
              <dt>Text</dt><dd>${sum.texts.toLocaleString('en-GB')}</dd>
            </dl>
            <ul class="cad-counts">${counts}</ul>
            <p class="${sum.skipped ? 'warn' : 'muted'} small">${sum.skipped ? 'Skipped (not supported): ' + skipped : 'Every entity was read.'}</p>
            <p class="small ${extOk ? 'cad-ok' : 'muted'}">${extOk ? '✓ Extents match the AutoCAD header exactly.' : (sum.extMin ? 'Extents differ from the AutoCAD header (the header may be stale).' : 'No AutoCAD extents in the header to compare.')}</p>
          </details>
        </aside>
      </div>
    </div>`, 'dash');

  const $ = s => document.getElementById(s);
  const statusEl = $('cad-status'), promptEl = $('cad-prompt');
  const say = (msg, kind) => { statusEl.textContent = msg || ''; statusEl.className = 'small ' + (kind || ''); };
  const prompt = (msg) => { promptEl.hidden = !msg; promptEl.textContent = msg || ''; };

  wfResizableSide(document.querySelector('.cad-body'));
  /* teaching state: null | {step:'box', kind} | {step:'terminals', kind, box, sig, hits, roles, picked} */
  let teach = null;

  const viewer = cadViewer($('cad-stage'), flat, {
    readout: $('cad-readout'), unit: u,
    fitButton: $('cad-fit'), measureButton: $('cad-measure'),
    overlay: drawOverlay,
    onBox: onBox,
    onPick: onPick,
    onCancel: cancelTeach,
    onClick: (pt, sx, sy) => openRename(pt, sx, sy),
  });

  /* ---- rename on the rack: click an SSC / ACDP / MSM ---- */
  function openRename(pt, sx, sy) {
    closeRename();
    if (teach) return;
    const hit = components.filter(c => cadNamed(c.kind) && pt[0] >= c.x0 && pt[0] <= c.x1 && pt[1] >= c.y0 && pt[1] <= c.y1)
      .sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
    if (!hit) return;
    const k = cadKind(hit.kind), key = cadCompKey(hit), saved = cad.labels[key] || {};
    focusKey = key; viewer.redraw();
    const pop = document.createElement('form');
    pop.className = 'cad-pop'; pop.id = 'cad-pop';
    pop.innerHTML = `<b style="color:${k.color}">${esc(k.label)}</b>
      <label>Name <input name="label" value="${esc(cadCompLabel(hit, cad.labels))}" maxlength="24" autocomplete="off"></label>
      ${hit.kind === 'ssc' ? `<label>Modules <input name="modules" type="number" min="1" step="1" value="${saved.modules || ''}"></label>` : ''}
      <p class="muted small">Using a name another ${esc(k.label)} has swaps the two names.</p>
      <div><button class="btn btn-primary btn-xs" type="submit">Save</button> <button class="btn btn-ghost btn-xs" type="button" data-x>Cancel</button></div>`;
    const stage = $('cad-stage');
    stage.appendChild(pop);
    pop.style.left = Math.min(Math.max(8, sx + 12), stage.clientWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = Math.min(Math.max(8, sy - 20), stage.clientHeight - pop.offsetHeight - 8) + 'px';
    pop.querySelector('input').select();
    pop.querySelector('[data-x]').onclick = closeRename;
    pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeRename(); } });
    pop.onsubmit = async e => {
      e.preventDefault();
      const name = pop.label.value.trim();
      if (!name) { say('The name cannot be empty.', 'warn'); return; }
      const other = components.find(c => c !== hit && cadNamed(c.kind) && cadCompLabel(c, cad.labels) === name);
      if (other && other.kind !== hit.kind) { say(`${name} is already the name of a ${cadKind(other.kind).label}.`, 'warn'); return; }
      const old = cadCompLabel(hit, cad.labels);
      const entry = { label: name, confirmed: false };
      if (hit.kind === 'ssc') {
        const m = pop.modules.value.trim();
        if (m && !/^[1-9][0-9]*$/.test(m)) { say('Modules must be a whole number, 1 or more.', 'warn'); return; }
        if (m) entry.modules = +m; else if (saved.modules) entry.modules = saved.modules;
      }
      if (other) {
        const ok = cadCompKey(other);
        cad.labels[ok] = Object.assign({}, cad.labels[ok] || {}, { label: old, confirmed: false });
      }
      cad.labels[key] = entry;
      closeRename();
      await persist();
      renderFound();
      viewer.redraw();
      say(`${other ? `Swapped: ${name} ↔ ${old}` : `${old} renamed to ${name}`}. Press Confirm in the ${k.label} card when all names are right.`, 'cad-ok');
    };
  }
  function closeRename() { const p = document.getElementById('cad-pop'); if (p) p.remove(); if (focusKey) { focusKey = null; viewer.redraw(); } }

  function drawOverlay(ctx, toScreen, scale) {
    const list = teach && teach.hits ? teach.hits.map(h => Object.assign({ kind: teach.kind, preview: true }, h)) : components;
    for (const c of list) {
      const a = toScreen(c.x0, c.y1), b = toScreen(c.x1, c.y0);
      const col = cadKind(c.kind).color;
      ctx.strokeStyle = col; ctx.lineWidth = c.preview ? 2 : 1.5;
      ctx.setLineDash(c.preview ? [6, 4] : []);
      ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      ctx.setLineDash([]);
      ctx.fillStyle = col + '1f';
      ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      const unwired = cadKind(c.kind).wired === false;
      const named = cadNamed(c.kind);
      if (c.id && (b[0] - a[0] > 46 || named) && !(c.kind === 'module' && wiring && showWiring && !teach)) {
        const saved = cad.labels[cadCompKey(c)];
        const text = cadCompLabel(c, cad.labels) + (named && !(saved && saved.confirmed) ? ' ?' : '');
        if (named && !c.preview) {
          /* SSC / ACDP / MSM names: large, centred, on a dark plate so they stay readable */
          const fs = Math.round(Math.max(14, Math.min(30, 44 * scale)));
          const sub = c.kind === 'ssc' && saved && saved.modules ? saved.modules + ' modules' : '';
          ctx.font = '800 ' + fs + 'px Inter, system-ui, sans-serif';
          const tw = ctx.measureText(text).width;
          ctx.font = '600 ' + Math.round(fs * 0.55) + 'px Inter, system-ui, sans-serif';
          const sw = sub ? ctx.measureText(sub).width : 0;
          const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2 - (unwired ? 0 : (b[1] - a[1]) * 0.12);
          const pw = Math.max(tw, sw) + fs * 0.8, ph = fs * (sub ? 1.75 : 1.25);
          ctx.fillStyle = 'rgba(8,13,29,.82)';
          ctx.beginPath(); ctx.roundRect(cx - pw / 2, cy - ph / 2, pw, ph, 6); ctx.fill();
          ctx.strokeStyle = col; ctx.lineWidth = 1.5; ctx.stroke();
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillStyle = col;
          ctx.font = '800 ' + fs + 'px Inter, system-ui, sans-serif';
          ctx.fillText(text, cx, sub ? cy - fs * 0.32 : cy);
          if (sub) { ctx.fillStyle = '#d6deeb'; ctx.font = '600 ' + Math.round(fs * 0.55) + 'px Inter, system-ui, sans-serif'; ctx.fillText(sub, cx, cy + fs * 0.5); }
          ctx.textAlign = 'start'; ctx.textBaseline = 'alphabetic';
        } else {
          ctx.fillStyle = col;
          ctx.font = '600 12px Inter, system-ui, sans-serif';
          ctx.fillText(text, a[0] + 4, a[1] + 14);
        }
      }
      for (const t of c.terminals || []) {
        const p = toScreen(t.x, t.y);
        ctx.fillStyle = cadTerminalColor(t.role);
        ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(2.5, Math.min(6, 3 * scale)), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (focusKey) {
      const f = components.find(c => cadCompKey(c) === focusKey);
      if (f) {
        const a = toScreen(f.x0, f.y1), b = toScreen(f.x1, f.y0);
        ctx.save(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 4; ctx.setLineDash([]);
        ctx.shadowColor = '#00a8ff'; ctx.shadowBlur = 14;
        ctx.strokeRect(a[0] - 4, a[1] - 4, b[0] - a[0] + 8, b[1] - a[1] + 8); ctx.restore();
      }
    }
    if (!teach && wiring && showWiring) drawWiring(ctx, toScreen, scale);
    if (teach && teach.box) {
      const a = toScreen(teach.box.x0, teach.box.y1), b = toScreen(teach.box.x1, teach.box.y0);
      ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 2;
      ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
      for (const t of teach.picked || []) {
        const p = toScreen(t.x, t.y);
        ctx.strokeStyle = cadTerminalColor(t.role); ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(p[0], p[1], 9, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = '#ffffff'; ctx.font = '600 11px Inter, system-ui, sans-serif';
        ctx.fillText(t.role, p[0] + 11, p[1] - 9);
      }
    }
  }

  /* ---------- wiring (AYK rules, see js/cadwire.js) ---------- */
  function drawWiring(ctx, toScreen, scale) {
    const bad = new Set((wiring.crossings || []).flatMap(x => [x.a, x.b]));
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.strokeStyle = '#facc15'; ctx.lineWidth = 1.6; ctx.setLineDash([8, 5]);
    for (const o of wiring.outline || []) for (const sgm of o.segs) {
      const a = toScreen(sgm[0][0], sgm[0][1]), b = toScreen(sgm[1][0], sgm[1][1]);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.setLineDash([]);
    const w = Math.max(1.4, Math.min(3.2, 5 * scale));
    for (const kind of ['comm', 'power']) for (const c of wiring.cables) {
      if (c.kind !== kind) continue;
      ctx.beginPath();
      c.pts.forEach((pt, i) => { const q = toScreen(pt[0], pt[1]); if (i) ctx.lineTo(q[0], q[1]); else ctx.moveTo(q[0], q[1]); });
      if (bad.has(c.id)) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = w + 4; ctx.stroke(); }
      ctx.strokeStyle = kind === 'power' ? '#ef4444' : '#22c55e'; ctx.lineWidth = w; ctx.stroke();
    }
    const fs = Math.round(Math.max(9, Math.min(22, 34 * scale)));
    ctx.font = '700 ' + fs + 'px Inter, system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const st of wiring.strings) for (const l of st.labels) {
      const q = toScreen(l.x, l.y);
      ctx.lineWidth = 3; ctx.strokeStyle = '#0b1220'; ctx.strokeText(l.text, q[0], q[1]);
      ctx.fillStyle = '#d8b4fe'; ctx.fillText(l.text, q[0], q[1]);
    }
    ctx.restore();
  }

  /* what the wiring depends on; a saved plan is reused only while this is unchanged */
  function wiringInputs() {
    const sscs = components.filter(c => c.kind === 'ssc').map(c => {
      const saved = cad.labels[cadCompKey(c)] || {};
      return { comp: c, name: cadCompLabel(c, cad.labels), count: saved.modules || 0, confirmed: !!saved.confirmed };
    });
    const pair = (cad.wiring && cad.wiring.pair) === 'P2' ? 'P2' : 'P1';
    const key = JSON.stringify([pair, sscs.map(s => [cadCompKey(s.comp), s.name, s.count]),
      components.map(c => cadCompKey(c) + (c.terminals || []).map(t => t.role).join(''))]);
    return { sscs: sscs, pair: pair, key: key };
  }

  function renderWiring() {
    const box = $('cad-wiring');
    if (!box) return;
    const inp = wiringInputs();
    if (!inp.sscs.length) { box.innerHTML = ''; return; }
    if (wiring && wiring.key !== inp.key) wiring = null;
    const ready = inp.sscs.every(s => s.confirmed && s.count >= 1);
    const jbs = components.filter(c => c.kind === 'jb');
    const jbTaught = jbs.length && jbs.every(j => (j.terminals || []).length === 4);
    const todo = [];
    if (!ready) todo.push('Confirm the SSC numbers and module counts above.');
    if (!jbs.length) todo.push('Teach the junction box (the box at the top of each SSC column).');
    else if (!jbTaught) todo.push('Teach the junction box again and click its four connectors left to right (+, −, +, −).');
    const m = v => (v / 1000).toLocaleString('en-GB', { maximumFractionDigits: 1, minimumFractionDigits: 1 }) + ' m';
    const len = pts => pts.reduce((a, p, i) => i ? a + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0, 0);
    let result = '';
    if (wiring) {
      const ok = !wiring.crossings.length;
      const rows = wiring.strings.map(st => {
        const cs = wiring.cables.filter(c => c.ssc === st.name);
        const pw = cs.filter(c => c.kind === 'power'), cm = cs.filter(c => c.kind === 'comm');
        return `<tr><th>${esc(st.name)}</th><td>${st.labels.length}</td><td>${pw.length} · ${m(pw.reduce((a, c) => a + len(c.pts), 0))}</td><td>${cm.length} · ${m(cm.reduce((a, c) => a + len(c.pts), 0))}</td></tr>`;
      }).join('');
      result = `
        <p class="cad-wire-check ${ok ? 'cad-ok' : 'warn'}">${ok ? '✓ No power cables cross anywhere in the rack.' : '✗ ' + wiring.crossings.length + ' power crossing(s), outlined in white.'}</p>
        ${(wiring.warnings || []).filter(w => !/crossing/.test(w)).map(w => `<p class="warn small">${esc(w)}</p>`).join('')}
        <table class="cad-wire-table"><thead><tr><th>SSC</th><th>Modules</th><th>Power</th><th>Comm</th></tr></thead><tbody>${rows}</tbody></table>
        <p class="muted small">Cables · length along the drawn route, without slack. S1-M1 is the module wired to S− and N.</p>
        <label class="cad-wire-show"><input type="checkbox" id="cad-wire-show" ${showWiring ? 'checked' : ''}> Show wiring on the drawing</label>
        <a class="btn btn-primary btn-sm cad-wire-go" href="#/sheet/${project.id}">Open the wiring sheet →</a>
        <p class="muted small">Edit the A3 sheet (title block, power plugs, cable routes, labels) and download it as PDF.</p>`;
    }
    box.innerHTML = `<div class="cad-label-card cad-wire-card">
      <h4><span class="cad-swatch" style="background:#ef4444"></span>Wiring
        <span class="chip ${wiring && !wiring.crossings.length ? 'chip-ok' : 'chip-warn'}">${wiring ? (wiring.crossings.length ? 'Check crossings' : 'Generated') : 'Not generated'}</span></h4>
      <p class="muted small">Power in series S− → M1 → … → S+, communication N → M1 → … → S, bus B+ / B− to the junction box. The tool chooses which modules each SSC wires, and their order, so that no power cables cross.</p>
      ${todo.length ? `<ul class="cad-wire-todo">${todo.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="cad-wire-row">
        <label for="cad-wire-pair">Junction box connectors</label>
        <select id="cad-wire-pair">
          <option value="P1" ${inp.pair === 'P1' ? 'selected' : ''}>Pair 1 (left + −)</option>
          <option value="P2" ${inp.pair === 'P2' ? 'selected' : ''}>Pair 2 (right + −)</option>
        </select>
      </div>
      <p class="muted small">The same pair is used on every junction box.</p>
      <button class="btn btn-primary btn-sm cad-wire-go" id="cad-wire-go" ${todo.length ? 'disabled' : ''}>${wiring ? 'Generate again' : 'Generate wiring'}</button>
      ${result}
    </div>`;
    $('cad-wire-pair').onchange = async e => {
      cad.wiring = Object.assign({}, cad.wiring, { pair: e.target.value });
      delete cad.wiring.plan; wiring = null;
      await persist(); renderWiring(); viewer.redraw();
    };
    $('cad-wire-go').onclick = () => {
      const btn = $('cad-wire-go');
      btn.disabled = true; btn.textContent = 'Working out the wiring…';
      setTimeout(async () => {
        const inp2 = wiringInputs();
        let plan;
        try { plan = cadWirePlan(components, inp2.sscs, { pair: inp2.pair }); } catch (e) { plan = { ok: false, errors: [e.message] }; }
        if (!plan.ok) { say(plan.errors.join(' '), 'warn'); renderWiring(); return; }
        wiring = cadWireSave(plan, inp2.key);
        showWiring = true;
        cad.wiring = { pair: inp2.pair, plan: wiring };
        await persist();
        renderWiring(); viewer.redraw();
        say(plan.crossings.length ? `Wiring generated with ${plan.crossings.length} power crossing(s) to check.` : `Wiring generated: ${plan.cables.length} cables, no power crossings.`, plan.crossings.length ? 'warn' : 'cad-ok');
      }, 30);
    };
    if (wiring) {
      $('cad-wire-show').onchange = e => { showWiring = e.target.checked; viewer.redraw(); };
    }
  }

  function recognise() {
    components = cad.signatures.length ? cadRecognise(index, cad.signatures) : [];
    /* proposed ACDP / MSM numbers: ACDP1 = closest to the MSM */
    const nums = cadProposeNumbers(components);
    components.forEach(c => { if (nums.has(c)) c.proposal = nums.get(c); });
    renderFound();
    viewer.redraw();
  }

  /* Warns when the name ending in 1 is not on the ACDP closest to the MSM. */
  function ruleWarning(kind, list) {
    if ((kind !== 'acdp' && kind !== 'ssc') || !components.some(c => c.kind === 'msm')) return '';
    const first = cadKind(kind).prefix + '1';
    const nearest = list.find(c => c.proposal === 1);
    const one = list.find(c => cadCompLabel(c, cad.labels) === first);
    if (!nearest || !one || one === nearest) return '';
    return `<p class="warn small">${first} is normally the ${cadKind(kind).label} closest to the MSM (now named ${esc(cadCompLabel(nearest, cad.labels))}). Use Show to check before confirming.</p>`;
  }

  /* ACDP / MSM labels: ACDP numbered from the MSM, MSM left to right; the
     engineer confirms every label. */
  function renderLabels() {
    const box = $('cad-labels');
    const kinds = CAD_KINDS.filter(k => cadNamed(k.id) && components.some(c => c.kind === k.id));
    const modulesFound = components.filter(c => c.kind === 'module').length;
    if (!kinds.length) { box.innerHTML = ''; return; }
    box.innerHTML = kinds.map(k => {
      const list = components.filter(c => c.kind === k.id).sort((a, b) => (a.proposal || 0) - (b.proposal || 0));
      const done = list.every(c => cad.labels[cadCompKey(c)] && cad.labels[cadCompKey(c)].confirmed);
      return `<div class="cad-label-card" data-kind="${k.id}">
        <h4><span class="cad-swatch" style="background:${k.color}"></span>${k.id === 'ssc' ? 'SSC numbers and modules' : esc(k.label) + ' labels'}
          <span class="chip ${done ? 'chip-ok' : 'chip-warn'}">${done ? 'Confirmed' : 'Please confirm'}</span></h4>
        <p class="muted small">${k.id === 'ssc'
          ? `${components.some(c => c.kind === 'msm') ? 'SSC1 is the one closest to the MSM, then the next closest. ' : 'Numbered left to right (no MSM on this drawing). '}Enter how many battery modules each SSC controls. ${modulesFound} modules were found on the drawing.`
          : `No wiring (connected at the back of the rack). ${k.id === 'acdp' ? 'ACDP1 is the one closest to the MSM, then the next closest. ' : ''}Check each one on the drawing and confirm its name.`} <b>Tip:</b> click a ${esc(k.label)} on the drawing to rename it.</p>
        ${ruleWarning(k.id, list)}
        ${list.map(c => {
          const saved = cad.labels[cadCompKey(c)] || {};
          return `<div class="cad-label-row">
          <button class="btn btn-ghost btn-xs" data-show="${esc(cadCompKey(c))}" title="Zoom to this ${esc(k.label)}">Show</button>
          <input type="text" maxlength="24" value="${esc(cadCompLabel(c, cad.labels))}" data-key="${esc(cadCompKey(c))}" aria-label="${esc(k.label)} name">
          ${k.id === 'ssc' ? `<input type="number" class="cad-modules" min="1" step="1" inputmode="numeric" placeholder="modules" value="${saved.modules ? esc(String(saved.modules)) : ''}" data-modules="${esc(cadCompKey(c))}" aria-label="Number of modules for ${esc(cadCompLabel(c, cad.labels))}"><span class="muted small">modules</span>` : ''}
        </div>`;
        }).join('')}
        ${k.id === 'ssc' ? `<p class="small muted" data-total>Total entered: <b>${list.reduce((n, c) => n + (+((cad.labels[cadCompKey(c)] || {}).modules) || 0), 0)}</b> of ${modulesFound}</p>` : ''}
        <p class="cad-card-msg" role="alert" hidden></p>
        <button class="btn btn-primary btn-sm" data-confirm="${k.id}">Confirm ${k.id === 'ssc' ? 'SSC numbers and modules' : esc(k.label) + ' labels'}</button>
      </div>`;
    }).join('');
    box.querySelectorAll('[data-show]').forEach(b => b.onclick = () => {
      const c = components.find(x => cadCompKey(x) === b.dataset.show);
      if (!c) return;
      /* zoom to it, highlight it, and open the rename box beside it */
      const w = c.x1 - c.x0, h = c.y1 - c.y0;
      viewer.zoomTo(c.x0 - w * 1.2, c.y0 - h * 1.2, c.x1 + w * 1.2, c.y1 + h * 1.2);
      focusKey = cadCompKey(c);
      viewer.redraw();
      const q = viewer.toScreen(c.x1, (c.y0 + c.y1) / 2);
      openRename([(c.x0 + c.x1) / 2, (c.y0 + c.y1) / 2], q[0], q[1]);
    });
    box.querySelectorAll('input[data-key], input[data-modules]').forEach(inp => inp.oninput = () => {
      const card = inp.closest('.cad-label-card');
      const total = card.querySelector('[data-total] b');
      if (total) total.textContent = [...card.querySelectorAll('input[data-modules]')].reduce((n, i) => n + (+i.value || 0), 0);
      const key = inp.dataset.key || inp.dataset.modules;
      const prev = cad.labels[key];
      if (prev && prev.confirmed) prev.confirmed = false;
      const chip = card.querySelector('.chip');
      chip.className = 'chip chip-warn'; chip.textContent = 'Please confirm';
    });
    box.querySelectorAll('[data-confirm]').forEach(b => b.onclick = async () => {
      const card = b.closest('.cad-label-card');
      const inputs = [...card.querySelectorAll('input[data-key]')];
      const names = inputs.map(i => i.value.trim());
      const others = components.filter(c => cadNamed(c.kind) && c.kind !== card.dataset.kind).map(c => cadCompLabel(c, cad.labels));
      /* why a confirm is refused is shown in the card itself, next to the button */
      const msg = card.querySelector('.cad-card-msg');
      card.querySelectorAll('.cad-bad').forEach(x => x.classList.remove('cad-bad'));
      const refuse = (text, el) => {
        msg.hidden = false; msg.textContent = text;
        if (el) { el.classList.add('cad-bad'); el.focus(); }
        say(text, 'warn');
      };
      msg.hidden = true;
      const empty = names.findIndex(n => !n);
      if (empty >= 0) { refuse('Every label needs a name.' + (inputs.length > 3 ? ` If there are more ${cadKind(card.dataset.kind).label}s here than on the rack, the part was taught wrongly: use Remove in the Parts list and teach it again.` : ''), inputs[empty]); return; }
      const di = names.findIndex((n, i) => names.indexOf(n) !== i || others.includes(n));
      if (di >= 0) { refuse(`The label ${names[di]} is used twice.`, inputs[di]); return; }
      let counts = null;
      if (card.dataset.kind === 'ssc') {
        counts = inputs.map(i => card.querySelector(`input[data-modules="${CSS.escape(i.dataset.key)}"]`).value.trim());
        const bad = counts.findIndex(v => !/^[1-9][0-9]*$/.test(v));
        if (bad >= 0) { refuse(`Enter the number of modules for ${names[bad]} (a whole number, 1 or more).`, card.querySelector(`input[data-modules="${CSS.escape(inputs[bad].dataset.key)}"]`)); return; }
        counts = counts.map(Number);
        const total = counts.reduce((a, b) => a + b, 0);
        if (total !== modulesFound) {
          refuse(`The SSC module counts add up to ${total}, but ${modulesFound} modules were found on the drawing. Check the counts, or teach any missing modules first.`, card.querySelector('input[data-modules]'));
          return;
        }
      }
      inputs.forEach((inp, i) => {
        cad.labels[inp.dataset.key] = counts ? { label: names[i], modules: counts[i], confirmed: true } : { label: names[i], confirmed: true };
      });
      await persist();
      renderFound();
      viewer.redraw();
      say(counts
        ? `SSCs confirmed: ${names.map((n, i) => n + ' ' + counts[i]).join(', ')} modules.`
        : `${cadKind(card.dataset.kind).label} labels confirmed: ${names.join(', ')}.`, 'cad-ok');
    });
  }

  function renderFound() {
    renderLabels();
    renderWiring();
    const by = {};
    components.forEach(c => { by[c.kind] = (by[c.kind] || 0) + 1; });
    const terms = components.reduce((n, c) => n + (c.terminals || []).length, 0);
    $('cad-found').innerHTML = components.length
      ? `<ul class="cad-found-list">${CAD_KINDS.filter(k => by[k.id]).map(k =>
          `<li><span class="cad-swatch" style="background:${k.color}"></span>${esc(k.label)}<b>${by[k.id]}</b><button class="btn btn-ghost btn-xs cad-kind-remove" data-remove-kind="${k.id}" title="Remove ${esc(k.label)} from this drawing so you can teach it again">Remove</button></li>`).join('')}
          <li><span class="cad-swatch cad-swatch-dot"></span>Terminals<b>${terms}</b></li></ul>
          ${fromLibrary ? '<p class="muted small">Found with saved parts. Check every copy on the drawing.</p>' : ''}`
      : '<p class="muted small">No parts taught yet.</p>';
    $('cad-found').querySelectorAll('[data-remove-kind]').forEach(b => b.onclick = async () => {
      const kind = b.dataset.removeKind;
      const before = cad.signatures.length;
      cad.signatures = cad.signatures.filter(s => s.kind !== kind);
      fromLibrary = false;
      recognise();
      await persist();
      say(`${cadKind(kind).label} removed from this drawing (${before - cad.signatures.length} taught pattern${before - cad.signatures.length === 1 ? '' : 's'}). Teach it again with a box around one copy.`);
    });
    $('cad-sigs').innerHTML = cad.signatures.length ? `<ul class="cad-sig-list">${cad.signatures.map((s, i) =>
      `<li><span class="cad-swatch" style="background:${cadKind(s.kind).color}"></span><span>${esc(s.name || cadKind(s.kind).label)}<small>${s.features.length} features · ${s.terminals.length} terminals</small></span>
        <span class="cad-sig-actions">
          <button class="btn btn-ghost btn-xs" data-remove="${i}" title="Remove from this drawing only; keep it saved on this device">Remove</button>
          <button class="btn btn-ghost btn-xs" data-forget="${i}" title="Remove from this drawing AND delete it from this device (use when it was taught wrongly)">Forget</button>
        </span></li>`).join('')}</ul>` : '';
    $('cad-sigs').querySelectorAll('[data-remove]').forEach(b => b.onclick = async () => {
      cad.signatures.splice(+b.dataset.remove, 1);
      fromLibrary = false;
      recognise();
      await persist();
      say('Part removed from this drawing. It stays saved on this device.');
    });
    $('cad-sigs').querySelectorAll('[data-forget]').forEach(b => b.onclick = async () => {
      const gone = cad.signatures.splice(+b.dataset.forget, 1)[0];
      const lib = cadLibraryLoad();
      const keep = lib.filter(x => cadSigId(x) !== cadSigId(gone));
      cadLibrarySave(keep);
      fromLibrary = false;
      recognise();
      await persist();
      say(`Part forgotten on this drawing${keep.length < lib.length ? ' and deleted from this device' : ''}.`);
    });
    $('cad-taught').querySelector('summary').textContent = `Taught parts (${cad.signatures.length}) · remove or forget`;
  }

  async function persist() {
    /* labels belong to recognised components; drop those of parts that are gone */
    const live = new Set(components.map(cadCompKey));
    Object.keys(cad.labels).forEach(k => { if (!live.has(k)) delete cad.labels[k]; });
    cad.components = components.map(c => {
      const unwired = cadKind(c.kind).wired === false;
      const saved = cad.labels[cadCompKey(c)];
      const out = { id: c.id, kind: c.kind, x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, terminals: c.terminals,
        label: cadCompLabel(c, cad.labels), wired: !unwired, labelConfirmed: cadNamed(c.kind) ? !!(saved && saved.confirmed) : true };
      if (c.kind === 'ssc') out.modules = saved && saved.modules ? saved.modules : null;
      return out;
    });
    project.updated_at = new Date().toISOString();
    try { await localPutProject(project); } catch (e) { say('Could not save to this browser: ' + e.message, 'warn'); }
  }

  function cancelTeach() {
    if (!teach) return false;
    teach = null;
    prompt('');
    viewer.setMode('pan');
    teachButton(false);
    viewer.redraw();
    say('Teaching cancelled. Nothing was saved.');
    return true;
  }
  /* while teaching, the teach button becomes Cancel */
  function teachButton(busy) {
    const b = $('cad-teach');
    b.disabled = false;
    b.textContent = busy ? 'Cancel' : 'Box one example';
    b.classList.toggle('btn-primary', !busy);
    b.classList.toggle('btn-ghost', busy);
  }

  $('cad-teach').onclick = () => {
    if (teach) { cancelTeach(); return; }
    const kind = $('cad-kind').value;
    teach = { step: 'box', kind: kind };
    teachButton(true);
    viewer.setMode('box');
    const name = cadKind(kind).label;
    prompt(`Drag a box around ONE complete ${name === name.toUpperCase() ? name : name.toLowerCase()} · Esc cancels`);
    say('');
  };

  function onBox(box) {
    if (!teach || teach.step !== 'box') return;
    let sig;
    try {
      const n = cad.signatures.filter(s => s.kind === teach.kind).length;
      sig = cadTeachSignature(index, box, { kind: teach.kind, name: cadKind(teach.kind).label + (n ? ' ' + String.fromCharCode(65 + n) : '') });
      sig = cadRefineSignature(index, sig);
      sig.id = teach.kind + '-' + Date.now().toString(36);
    } catch (e) { say(e.message, 'warn'); return; }
    const hits = cadFindMatches(index, sig);
    teach.box = box; teach.sig = sig; teach.hits = hits;
    /* copies that overlap parts of another kind mean the box caught a neighbour */
    const overlap = (a, b) => {
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (w <= 0 || h <= 0) return 0;
      return (w * h) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
    };
    const clash = new Map();
    for (const h of hits) for (const c of components) {
      if (c.kind === teach.kind || overlap(h, c) < 0.3) continue;
      clash.set(c.kind, (clash.get(c.kind) || new Set()).add(h));
    }
    const warn = clash.size ? ` · ⚠ ${Math.max(...[...clash.values()].map(v => v.size))} of them overlap ${[...clash.keys()].map(k => cadKind(k).label + 's').join(' and ')}: the box probably caught a neighbouring part. Press Esc and draw a tighter box` : '';
    if (cadKind(teach.kind).wired === false) {
      /* back-wired part: nothing to click, just check the count and save */
      teach.step = 'terminals'; teach.roles = null; teach.picked = []; teach.noTerminals = true;
      viewer.setMode('pan');
      prompt(`Found ${hits.length} ${cadKind(teach.kind).label}. No wiring needed. Press Enter to save · Wrong count? Esc and box again${warn}`);
    } else if (CAD_TERMINAL_ROLES[teach.kind]) {
      teach.step = 'terminals'; teach.roles = CAD_TERMINAL_ROLES[teach.kind].slice(); teach.picked = [];
      viewer.setMode('pick');
      prompt(`Found ${hits.length} copies. Click its ${teach.roles.length} terminals left to right (${teach.roles.join(', ')}). First: ${teach.roles[0]} (inside the white box) · Wrong count? Esc and box again${warn}`);
    } else {
      teach.step = 'terminals'; teach.roles = null; teach.picked = [];
      viewer.setMode('pick');
      prompt(`Found ${hits.length} copies. Click its terminals if needed (T1, T2 …), then press Enter to finish · If a copy is missing, the box probably cut the part or caught a neighbour: press Esc and box again${warn}`);
    }
    if (warn) say('The new part overlaps parts already taught. Press Esc and draw a tighter box around one copy only.', 'warn');
    viewer.redraw();
  }

  function onPick(pt) {
    if (!teach || teach.step !== 'terminals') return;
    const b = teach.box;
    if (pt[0] < b.x0 || pt[0] > b.x1 || pt[1] < b.y0 || pt[1] > b.y1) { say('Click inside the white box: terminals belong to the taught copy.', 'warn'); return; }
    if (!pt[2]) say('No circle under the cursor: the point was taken as clicked. Zoom in to snap to the terminal centre.', 'warn'); else say('');
    const role = teach.roles ? teach.roles[teach.picked.length] : 'T' + (teach.picked.length + 1);
    teach.picked.push({ role: role, x: pt[0], y: pt[1] });
    if (teach.roles && teach.picked.length < teach.roles.length) {
      prompt(`Click terminal: ${teach.roles[teach.picked.length]} · Esc cancels`);
      viewer.redraw();
      return;
    }
    if (teach.roles) finishTeach(); else viewer.redraw();
  }

  async function finishTeach() {
    if (!teach || teach.step !== 'terminals') return;
    const t = teach;
    t.sig.terminals = t.picked.map(p => ({ role: p.role, dx: +(p.x - t.sig.x0).toFixed(4), dy: +(p.y - t.sig.y0).toFixed(4) }));
    /* an earlier pattern of the same kind that finds any of the same copies is replaced
       (it was taught wrongly); one that finds other copies stays (a second variant) */
    const near = (a, b) => Math.min(a.x1, b.x1) > Math.max(a.x0, b.x0) && Math.min(a.y1, b.y1) > Math.max(a.y0, b.y0);
    const replaced = cad.signatures.filter(s => s.kind === t.sig.kind &&
      cadFindMatches(index, s).some(m => t.hits.some(h => near(m, h))));
    cad.signatures = cad.signatures.filter(s => !replaced.includes(s));
    if (replaced.length) {
      const gone = new Set(replaced.map(cadSigId));
      cadLibrarySave(cadLibraryLoad().filter(x => !gone.has(cadSigId(x))));
    }
    cad.signatures.push(t.sig);
    teach = null;
    fromLibrary = false;
    prompt('');
    viewer.setMode('pan');
    teachButton(false);
    recognise();
    await persist();
    const lib = cadLibraryLoad();
    lib.push(cadLibraryEntry(t.sig));
    const saved = cadLibrarySave(lib);
    const n = components.filter(c => c.kind === t.sig.kind).length;
    say(`${cadKind(t.sig.kind).label}: ${n} found${replaced.length ? ' · replaced the earlier ' + cadKind(t.sig.kind).label : ''}${saved ? ' · saved on this device for other racks' : ''}.`, 'cad-ok');
  }
  viewer.onEnter = () => { if (teach && teach.step === 'terminals' && !teach.roles) finishTeach(); };

  $('cad-use-library').onclick = async () => {
    const lib = cadLibraryLoad();
    if (!lib.length) { say('No parts saved on this device yet. Teach one first.', 'warn'); return; }
    cad.signatures = lib.map(s => cadNormaliseTerminals(Object.assign({}, s)));
    fromLibrary = true;
    recognise();
    await persist();
    say(`${lib.length} saved part${lib.length === 1 ? '' : 's'} applied.`);
  };

  /* Open: saved parts for this drawing, else the device library. */
  if (cad.signatures.length) { recognise(); if (renamedTerminals) persist(); }
  else {
    const lib = cadLibraryLoad();
    if (lib.length) {
      cad.signatures = lib.map(s => cadNormaliseTerminals(Object.assign({}, s)));
      fromLibrary = true;
      recognise();
      if (!components.length) { cad.signatures = []; fromLibrary = false; renderFound(); }
      else persist();
    } else renderFound();
  }
}

/** Canvas viewer for flattened CAD geometry: wheel zoom at the cursor, drag to
 *  pan, live coordinates in drawing units, two-point measure that snaps to
 *  circle centres, and teaching modes (box / pick) with an overlay hook. */

/* ============================================================
 * Wiring sheet editor (A3, AYK DWG2396 format) -> PDF
 * The rack is painted on a canvas; the sheet (frame, title block,
 * wiring, labels) is SVG on top so parts of it can be dragged.
 * ============================================================ */
/** Side panel width: drag the bar between the drawing and the panel (kept per browser). */
const WF_SIDE_KEY = 'wireflow-side-panel-width';
function wfResizableSide(body) {
  const bar = body && body.querySelector('.wf-split');
  if (!bar) return;
  const set = w => {
    const max = Math.max(320, body.clientWidth - 320);
    w = Math.max(260, Math.min(max, Math.round(w)));
    body.style.setProperty('--side-w', w + 'px');
    return w;
  };
  try { const saved = +localStorage.getItem(WF_SIDE_KEY); if (saved) set(saved); } catch (e) {}
  let drag = null;
  bar.addEventListener('pointerdown', e => { try { bar.setPointerCapture(e.pointerId); } catch (err) {} drag = true; bar.classList.add('on'); e.preventDefault(); });
  bar.addEventListener('pointermove', e => { if (drag) set(body.getBoundingClientRect().right - e.clientX); });
  const end = () => {
    if (!drag) return;
    drag = null; bar.classList.remove('on');
    try { localStorage.setItem(WF_SIDE_KEY, parseInt(body.style.getPropertyValue('--side-w'), 10)); } catch (e) {}
  };
  bar.addEventListener('pointerup', end); bar.addEventListener('pointercancel', end);
  bar.addEventListener('keydown', e => {
    const now = parseInt(getComputedStyle(body).getPropertyValue('--side-w'), 10) || 340;
    if (e.key === 'ArrowLeft') { set(now + 30); e.preventDefault(); }
    if (e.key === 'ArrowRight') { set(now - 30); e.preventDefault(); }
    try { localStorage.setItem(WF_SIDE_KEY, parseInt(body.style.getPropertyValue('--side-w'), 10)); } catch (err) {}
  });
  bar.addEventListener('dblclick', () => { body.style.removeProperty('--side-w'); try { localStorage.removeItem(WF_SIDE_KEY); } catch (e) {} });
}

const SHEET_PX = 7;   // canvas pixels per sheet millimetre
let sheetLogoCache = null;
async function sheetLogo() {
  if (sheetLogoCache) return sheetLogoCache;
  const img = new Image();
  img.src = 'assets/ayk-logo-sheet.png';
  await img.decode();
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height); x.drawImage(img, 0, 0);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.92));
  sheetLogoCache = { bytes: new Uint8Array(await blob.arrayBuffer()), w: c.width, h: c.height, src: 'assets/ayk-logo-sheet.png' };
  return sheetLogoCache;
}

/** The example rack (AYK rack 111) with its parts taught and labels confirmed,
    opened as a normal drawing so people can try every step. One copy per browser. */
async function openExampleRack() {
  const all = await localProjects();
  const have = all.find(p => p.example === 'rack-111');
  if (have) { location.replace('#/cad/' + have.id); return; }
  shell('<div class="loading">Loading the example rack…</div>', 'dash');
  const [res, parts] = await Promise.all([
    fetch('assets/examples/rack-111.dxf.gz'),
    fetch('assets/examples/rack-111-parts.json').then(r => { if (!r.ok) throw new Error('Example parts not found.'); return r.json(); }),
  ]);
  if (!res.ok) throw new Error('Example drawing not found.');
  const raw = new Uint8Array(await res.arrayBuffer());
  let text;
  if (raw[0] === 0x1f && raw[1] === 0x8b) {
    text = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
  } else text = new TextDecoder().decode(raw);   /* a server already unzipped it */
  const now = new Date().toISOString();
  const project = { name: parts.name || 'Example rack', vessel: '', drawing_no: '', product_family: '', modules_per_string: 0,
    config: { rules: { ...DEFAULT_RULES }, exceptions: [], spans: [], cad: { signatures: parts.signatures, labels: parts.labels, components: [] } },
    status: 'draft', revision: 'A', created_at: now, updated_at: now, underlay_kind: 'cad', cad_file: parts.file || 'example.dxf', example: 'rack-111' };
  project.id = await localAddProject(project);
  await localPutUnderlay(project.id, new Blob([text], { type: 'application/dxf' }), 'cad');
  project.underlay_url = `local-underlay:${project.id}`;
  await localPutProject(project);
  location.replace('#/cad/' + project.id);
}

async function renderSheetPage(id) {
  shell('<div class="loading">Opening the wiring sheet…</div>', 'dash');
  let project, record;
  try { project = await localProject(id); record = await localGetUnderlay(id); } catch (e) {}
  const back = `<a class="btn btn-primary" href="#/cad/${id}">Back to the drawing</a>`;
  if (!project || !record || !record.blob) { shell(`<div class="empty"><h3>Drawing not found</h3>${back}</div>`, 'dash'); return; }
  const cad = (project.config && project.config.cad) || {};
  const wiring = cad.wiring && cad.wiring.plan;
  if (!wiring) { shell(`<div class="empty"><h3>No wiring yet</h3><p>Generate the wiring on the drawing first.</p>${back}</div>`, 'dash'); return; }
  let flat;
  try { flat = cadFlatten(cadParseDxf(await record.blob.text())); } catch (e) { shell(`<div class="empty"><h3>Could not read the drawing</h3><p>${esc(e.message)}</p>${back}</div>`, 'dash'); return; }
  const jbs = (cad.components || []).filter(c => c.kind === 'jb');
  const st = sheetSettings(cad.sheet, project.name);
  const logo = await sheetLogo().catch(() => null);
  const F = st.fields;
  const fieldRow = (key, label) => `<label class="sh-field"><span>${label}</span><input type="text" data-f="${key}" value="${esc(F[key] || '')}" maxlength="60"></label>`;
  const revRows = () => F.revs.map((r, i) => `<tr>${['rev', 'date', 'desn', 'dran', 'chkd', 'states', 'notes'].map(k =>
    `<td><input type="text" data-rev="${i}" data-k="${k}" value="${esc(r[k] || '')}" maxlength="${k === 'notes' ? 24 : 12}" aria-label="${k}"></td>`).join('')}
    <td>${F.revs.length > 1 ? `<button class="btn btn-ghost btn-xs" data-rev-del="${i}" title="Remove this revision row">×</button>` : ''}</td></tr>`).join('');

  shell(`
    <div class="cad-page sh-page">
      <header class="cad-head">
        <a class="back" href="#/cad/${id}">← Drawing</a>
        <h1>${esc(project.name)} · wiring sheet</h1>
        <span class="chip">A3 · PDF</span>
        <div class="cad-tools">
          <button class="btn btn-ghost btn-sm" id="sh-zoom-out" title="Zoom out">−</button>
          <button class="btn btn-ghost btn-sm" id="sh-zoom-fit">Fit</button>
          <button class="btn btn-ghost btn-sm" id="sh-zoom-in" title="Zoom in">+</button>
          <button class="btn btn-primary btn-sm" id="sh-pdf">Download PDF</button>
        </div>
      </header>
      <div class="sh-body">
        <div class="sh-stage" id="sh-stage"><div class="sh-paper" id="sh-paper"><canvas id="sh-rack"></canvas><svg id="sh-svg" viewBox="0 0 ${A3_W} ${A3_H}" xmlns="http://www.w3.org/2000/svg"><g id="sh-g" transform="translate(0 ${A3_H}) scale(1 -1)"></g></svg></div></div>
        <div class="wf-split" role="separator" aria-orientation="vertical" aria-label="Drag to resize the side panel" tabindex="0"></div>
        <aside class="cad-info sh-side">
          <section>
            <h3>On the sheet</h3>
            <label class="cad-wire-show"><input type="checkbox" id="sh-plugs" ${st.plugs ? 'checked' : ''}> Customer power plugs A / B (Note 2) on every junction box</label>
            <label class="sh-field"><span>Scale</span><select id="sh-scale"><option value="auto">Automatic</option>${SHEET_SCALES.map(v => `<option value="${v}" ${String(F.scale) === String(v) ? 'selected' : ''}>1:${v}</option>`).join('')}</select></label>
            <p class="muted small">Drag a cable's middle section, a module label, the plug labels or the grounding-point label to move it. Curved jumps stay as drawn.</p>
            <button class="btn btn-ghost btn-sm" id="sh-reset">Undo all moves</button>
          </section>
          <section>
            <h3>Title block</h3>
            ${fieldRow('docNumber', 'Document Number')}${fieldRow('docType', 'Document Type')}
            ${fieldRow('designNumber', 'Design Number')}${fieldRow('designName', 'Design Name')}
            ${fieldRow('bankSize', 'Bank Size')}${fieldRow('bankWeight', 'Bank Weight')}
            ${fieldRow('sheet', 'Sheet')}
            <h4>Revisions</h4>
            <div class="sh-revs"><table><thead><tr><th>REV.</th><th>DATE</th><th>DESN BY</th><th>DRAN BY</th><th>CHKD BY</th><th>STATES</th><th>NOTES</th><th></th></tr></thead><tbody id="sh-revs">${revRows()}</tbody></table></div>
            <button class="btn btn-ghost btn-sm" id="sh-rev-add">Add revision</button>
          </section>
          <p class="small" id="sh-status" role="status"></p>
        </aside>
      </div>
    </div>`, 'dash');

  const $ = q => document.getElementById(q);
  const say = (m, k) => { $('sh-status').textContent = m || ''; $('sh-status').className = 'small ' + (k || ''); };
  const model = () => ({ flat: flat, bounds: flat.bounds, jbs: jbs, wiring: wiring, settings: st, logo: logo });
  let zoom = 1, P = null, rackKey = '';
  const save = async () => {
    cad.sheet = { fields: Object.assign({}, F, { scaleText: undefined }), plugs: st.plugs, edits: st.edits };
    project.updated_at = new Date().toISOString();
    try { await localPutProject(project); } catch (e) { say('Could not save: ' + e.message, 'warn'); }
  };

  function paintRack() {
    const key = P.scale + '|' + P.X(0) + '|' + P.Y(0);
    if (key === rackKey) return;
    rackKey = key;
    const cv = $('sh-rack');
    cv.width = A3_W * SHEET_PX; cv.height = A3_H * SHEET_PX;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, cv.width, cv.height);
    ctx.strokeStyle = '#374151'; ctx.lineWidth = 0.6;
    const X = x => P.X(x) * SHEET_PX, Y = y => (A3_H - P.Y(y)) * SHEET_PX;
    const path = new Path2D();
    for (const pl of flat.polylines) {
      const a = pl.pts;
      path.moveTo(X(a[0]), Y(a[1]));
      for (let i = 2; i < a.length; i += 2) path.lineTo(X(a[i]), Y(a[i + 1]));
      if (pl.closed) path.closePath();
    }
    for (const c of flat.circles) { path.moveTo(X(c.cx + c.r), Y(c.cy)); path.arc(X(c.cx), Y(c.cy), c.r * P.k * SHEET_PX, 0, Math.PI * 2); }
    ctx.stroke(path);
  }
  function render() {
    const svg = sheetSvgTarget();
    P = sheetDraw(svg, Object.assign(model(), { rack: false, interactive: true, logo: logo ? { src: logo.src, w: logo.w, h: logo.h } : null }));
    $('sh-g').innerHTML = svg.svg();
    paintRack();
  }
  function applyZoom() {
    const stage = $('sh-stage');
    const fit = Math.min((stage.clientWidth - 24) / A3_W, (stage.clientHeight - 24) / A3_H);
    const pxmm = Math.max(0.5, fit * zoom);
    $('sh-paper').style.width = A3_W * pxmm + 'px';
    $('sh-paper').style.height = A3_H * pxmm + 'px';
  }
  render(); applyZoom();
  wfResizableSide(document.querySelector('.sh-body'));
  new ResizeObserver(applyZoom).observe($('sh-stage'));
  $('sh-zoom-in').onclick = () => { zoom = Math.min(6, zoom * 1.4); applyZoom(); };
  $('sh-zoom-out').onclick = () => { zoom = Math.max(0.6, zoom / 1.4); applyZoom(); };
  $('sh-zoom-fit').onclick = () => { zoom = 1; applyZoom(); };

  /* ---- title block and options ---- */
  const side = document.querySelector('.sh-side');
  side.addEventListener('input', e => {
    const t = e.target;
    if (t.dataset.f) F[t.dataset.f] = t.value;
    else if (t.dataset.rev != null) F.revs[+t.dataset.rev][t.dataset.k] = t.value;
    else return;
    render(); save();
  });
  $('sh-plugs').onchange = e => { st.plugs = e.target.checked; render(); save(); };
  $('sh-scale').onchange = e => { F.scale = e.target.value; render(); save(); };
  const bindRevs = () => {
    $('sh-revs').innerHTML = revRows();
    $('sh-revs').querySelectorAll('[data-rev-del]').forEach(b => b.onclick = () => { F.revs.splice(+b.dataset.revDel, 1); bindRevs(); render(); save(); });
  };
  bindRevs();
  $('sh-rev-add').onclick = () => {
    if (F.revs.length >= 4) { say('The title block has room for 4 revision rows.', 'warn'); return; }
    const last = F.revs[F.revs.length - 1] || {};
    F.revs.push({ rev: String((+last.rev || 0) + 1), date: sheetDefaults().revs[0].date, desn: last.desn || '', dran: last.dran || '', chkd: last.chkd || '', states: '', notes: '' });
    bindRevs(); render(); save();
  };
  $('sh-reset').onclick = () => { st.edits = { cables: {}, labels: {}, ground: null, plugLabel: null }; render(); save(); say('All moves undone.'); };

  /* ---- dragging on the sheet ---- */
  const svgEl = $('sh-svg');
  const toSheet = (ev) => {
    const pt = svgEl.createSVGPoint(); pt.x = ev.clientX; pt.y = ev.clientY;
    const q = pt.matrixTransform($('sh-g').getScreenCTM().inverse());
    return [q.x, q.y];
  };
  let drag = null;
  svgEl.addEventListener('pointerdown', ev => {
    const s0 = toSheet(ev);
    const dEl = ev.target.closest('[data-drag]');
    const cEl = ev.target.closest('.sh-cable, .sh-hit');
    if (dEl) {
      const kind = dEl.dataset.drag;
      const lab = kind === 'label' ? wiring.strings.flatMap(s => s.labels).find(l => l.id === dEl.dataset.id) : null;
      drag = { kind: kind, start: s0, el: dEl, id: dEl.dataset.id,
        orig: kind === 'label' ? (st.edits.labels[dEl.dataset.id] || [lab.x, lab.y]).slice()
          : kind === 'plug' ? (st.edits.plugLabel || [-30, -2]).slice() : (st.edits.ground || [0, 0]).slice() };
    } else if (cEl) {
      const cab = wiring.cables.find(c => c.id === cEl.dataset.id);
      if (!cab) return;
      if (cab.curve) { say('Curved jumps between side-by-side modules stay as drawn.'); return; }
      const pts = (st.edits.cables[cab.id] || cab.pts).map(p => p.slice());
      /* nearest middle section (not the first or last stub into a terminal) */
      const d = [(s0[0] - P.X(0)) / P.k, (s0[1] - P.Y(0)) / P.k];
      let best = -1, bd = Infinity;
      for (let i = 1; i < pts.length - 2; i++) {
        const a = pts[i], b = pts[i + 1];
        const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((d[0] - a[0]) * (b[0] - a[0]) + (d[1] - a[1]) * (b[1] - a[1])) / len2));
        const dist = Math.hypot(d[0] - a[0] - t * (b[0] - a[0]), d[1] - a[1] - t * (b[1] - a[1]));
        if (dist < bd) { bd = dist; best = i; }
      }
      if (best < 0) { say('This cable runs straight between two terminals; there is no middle section to move.'); return; }
      const a = pts[best], b = pts[best + 1];
      drag = { kind: 'cable', start: s0, el: cEl, cab: cab, pts: pts, seg: best, horiz: Math.abs(b[1] - a[1]) < Math.abs(b[0] - a[0]), orig: pts.map(p => p.slice()) };
    } else return;
    try { svgEl.setPointerCapture(ev.pointerId); } catch (err) {}
    ev.preventDefault();
  });
  svgEl.addEventListener('pointermove', ev => {
    if (!drag) return;
    const s1 = toSheet(ev);
    const dx = s1[0] - drag.start[0], dy = s1[1] - drag.start[1];
    if (drag.kind === 'cable') {
      const i = drag.seg, o = drag.orig, p = drag.pts;
      if (drag.horiz) { p[i][1] = o[i][1] + dy / P.k; p[i + 1][1] = o[i + 1][1] + dy / P.k; }
      else { p[i][0] = o[i][0] + dx / P.k; p[i + 1][0] = o[i + 1][0] + dx / P.k; }
      const pts = p.map(q => P.X(q[0]).toFixed(3) + ',' + P.Y(q[1]).toFixed(3)).join(' ');
      svgEl.querySelectorAll(`[data-id="${CSS.escape(drag.cab.id)}"]`).forEach(el => el.setAttribute('points', pts));
      drag.moved = true;
    } else {
      /* sheet units, Y up inside the flipped group */
      if (drag.t0 == null) drag.t0 = drag.el.getAttribute('transform') || '';
      drag.el.setAttribute('transform', `translate(${dx} ${dy}) ${drag.t0}`);
      drag.dx = dx; drag.dy = dy; drag.moved = true;
    }
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.moved) return;
    if (d.kind === 'cable') st.edits.cables[d.cab.id] = d.pts.map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]);
    else if (d.kind === 'label') st.edits.labels[d.id] = [d.orig[0] + d.dx / P.k, d.orig[1] + d.dy / P.k];
    else if (d.kind === 'plug') st.edits.plugLabel = [d.orig[0] + d.dx, d.orig[1] + d.dy];
    else if (d.kind === 'ground') st.edits.ground = [d.orig[0] + d.dx, d.orig[1] + d.dy];
    render(); save();
  };
  svgEl.addEventListener('pointerup', end);
  svgEl.addEventListener('pointercancel', end);

  /* ---- PDF ---- */
  $('sh-pdf').onclick = async () => {
    const btn = $('sh-pdf');
    btn.disabled = true; btn.textContent = 'Making the PDF…';
    try {
      const bytes = await sheetPdf(model());
      const name = ((F.docNumber ? F.docNumber + ' ' : '') + (F.designNumber ? F.designNumber + ' ' : '') + 'Wiring Diagram').replace(/[\\/:*?"<>|]+/g, '-');
      download(name + '.pdf', bytes, 'application/pdf');
      say(`PDF ready: ${(bytes.length / 1e6).toFixed(1)} MB, A3, scale 1:${P.scale}.`, 'cad-ok');
    } catch (e) { say('Could not make the PDF: ' + e.message, 'warn'); }
    btn.disabled = false; btn.textContent = 'Download PDF';
  };
}

function cadViewer(stage, flat, opts) {
  const canvas = stage.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const B = flat.bounds;
  const path = new Path2D();
  for (const p of flat.polylines) {
    const a = p.pts;
    path.moveTo(a[0], a[1]);
    for (let i = 2; i < a.length; i += 2) path.lineTo(a[i], a[i + 1]);
    if (p.closed) path.closePath();
  }
  for (const c of flat.circles) { path.moveTo(c.cx + c.r, c.cy); path.arc(c.cx, c.cy, c.r, 0, Math.PI * 2); }
  const view = { s: 1, tx: 0, ty: 0 };   /* screen = (x*s + tx, -y*s + ty), CSS px */
  let W = 0, H = 0, dpr = 1, frame = 0;
  let mode = 'pan';                      /* pan | measure | box | pick */
  let mA = null, mB = null, hover = null, drag = null, band = null;
  let userMoved = false;                 /* keep re-fitting on resize until the user zooms or pans */
  const api = { onEnter: null };
  const toWorld = (sx, sy) => [(sx - view.tx) / view.s, -(sy - view.ty) / view.s];
  const toScreen = (x, y) => [x * view.s + view.tx, -y * view.s + view.ty];
  const fmt = v => v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  function fit() {
    const w = Math.max(1e-9, B.maxX - B.minX), h = Math.max(1e-9, B.maxY - B.minY);
    view.s = Math.min((W - 40) / w, (H - 40) / h);
    view.tx = (W - w * view.s) / 2 - B.minX * view.s;
    view.ty = (H - h * view.s) / 2 + B.maxY * view.s;
    draw();
  }
  function resize() {
    const r = stage.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    const first = !W;
    W = Math.max(200, r.width); H = Math.max(200, r.height);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
    if (first || !userMoved) fit(); else draw();
  }
  function snap(sx, sy) {
    let best = null, bd = 10;
    for (const c of flat.circles) {
      const q = toScreen(c.cx, c.cy);
      const d = Math.hypot(q[0] - sx, q[1] - sy);
      if (d < bd || (best && Math.abs(d - bd) < 0.5 && c.r > best.r)) { bd = d; best = c; }
    }
    return best ? [best.cx, best.cy, best] : null;
  }
  function draw() {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#0b1220'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * view.s, 0, 0, -dpr * view.s, dpr * view.tx, dpr * view.ty);
      ctx.lineWidth = 1 / view.s;
      ctx.strokeStyle = '#d6deeb';
      ctx.stroke(path);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (opts.overlay) opts.overlay(ctx, toScreen, view.s);
      if (hover && hover[2] && mode !== 'box') {
        const q = toScreen(hover[0], hover[1]);
        ctx.strokeStyle = '#00a8ff'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(q[0], q[1], Math.max(4, hover[2].r * view.s + 3), 0, Math.PI * 2); ctx.stroke();
      }
      if (band) {
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1; ctx.setLineDash([5, 4]);
        ctx.strokeRect(band.x, band.y, band.w, band.h); ctx.setLineDash([]);
        ctx.fillStyle = 'rgba(255,255,255,.06)'; ctx.fillRect(band.x, band.y, band.w, band.h);
      }
      if (mA) {
        const a = toScreen(mA[0], mA[1]), b = mB ? toScreen(mB[0], mB[1]) : null;
        ctx.strokeStyle = '#f97316'; ctx.fillStyle = '#f97316'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(a[0], a[1], 3, 0, Math.PI * 2); ctx.fill();
        if (b) {
          ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
          ctx.beginPath(); ctx.arc(b[0], b[1], 3, 0, Math.PI * 2); ctx.fill();
        }
      }
      /* scale bar: a round number of drawing units, roughly 120 px long */
      const target = 120 / view.s, pow = Math.pow(10, Math.floor(Math.log10(target)));
      const len = [1, 2, 5, 10].map(k => k * pow).find(v => v >= target * 0.6) || pow;
      ctx.fillStyle = '#93a4bf'; ctx.strokeStyle = '#93a4bf'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(16, H - 18); ctx.lineTo(16 + len * view.s, H - 18); ctx.stroke();
      ctx.font = '12px Inter, system-ui, sans-serif';
      ctx.fillText(len.toLocaleString('en-GB') + ' ' + opts.unit, 16, H - 26);
    });
  }
  function readout() {
    if (!opts.readout) return;
    const parts = [];
    if (hover) parts.push(`X ${fmt(hover[0])}  Y ${fmt(hover[1])} ${opts.unit}${hover[2] ? `  · circle Ø ${fmt(hover[2].r * 2)}` : ''}`);
    if (mA && mB) {
      const dx = mB[0] - mA[0], dy = mB[1] - mA[1];
      parts.push(`Distance ${fmt(Math.hypot(dx, dy))} ${opts.unit} (ΔX ${fmt(dx)}, ΔY ${fmt(dy)})`);
    } else if (mode === 'measure') parts.push(mA ? 'Click the second point' : 'Measure: click the first point');
    opts.readout.textContent = parts.join('   ·   ') || '—';
  }
  canvas.addEventListener('pointerdown', e => {
    canvas.setPointerCapture(e.pointerId);
    /* middle button always pans, so the drawing can move while teaching */
    drag = { x: e.offsetX, y: e.offsetY, tx: view.tx, ty: view.ty, moved: false, pan: mode !== 'box' || e.button === 1 };
  });
  canvas.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.offsetX - drag.x, dy = e.offsetY - drag.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      if (drag.moved && drag.pan) { view.tx = drag.tx + dx; view.ty = drag.ty + dy; userMoved = true; }
      if (drag.moved && !drag.pan) band = { x: Math.min(drag.x, e.offsetX), y: Math.min(drag.y, e.offsetY), w: Math.abs(dx), h: Math.abs(dy) };
    }
    const w = toWorld(e.offsetX, e.offsetY);
    hover = snap(e.offsetX, e.offsetY) || [w[0], w[1], null];
    draw(); readout();
  });
  canvas.addEventListener('pointerup', e => {
    const d = drag;
    drag = null;
    if (!d) return;
    if (!d.pan && band) {
      const a = toWorld(band.x, band.y + band.h), b = toWorld(band.x + band.w, band.y);
      band = null;
      draw();
      if (opts.onBox) opts.onBox({ x0: a[0], y0: a[1], x1: b[0], y1: b[1] });
      return;
    }
    band = null;
    if (d.moved) return;
    const w = toWorld(e.offsetX, e.offsetY);
    const s = snap(e.offsetX, e.offsetY) || [w[0], w[1], null];
    if (mode === 'measure') {
      if (!mA || mB) { mA = s; mB = null; } else mB = s;
      draw(); readout();
    } else if (mode === 'pick' && opts.onPick) opts.onPick(s);
    else if (mode === 'pan' && opts.onClick) opts.onClick(w, e.offsetX, e.offsetY);
  });
  canvas.addEventListener('wheel', e => {
    e.preventDefault();
    const w = toWorld(e.offsetX, e.offsetY);
    view.s *= Math.exp(-e.deltaY * 0.0015);
    userMoved = true;
    view.tx = e.offsetX - w[0] * view.s;
    view.ty = e.offsetY + w[1] * view.s;
    draw();
  }, { passive: false });
  function setMode(m) {
    mode = m; mA = mB = null; band = null;
    if (opts.measureButton) { opts.measureButton.setAttribute('aria-pressed', String(m === 'measure')); opts.measureButton.classList.toggle('on', m === 'measure'); }
    canvas.style.cursor = m === 'pan' ? 'grab' : 'crosshair';
    draw(); readout();
  }
  if (opts.fitButton) opts.fitButton.onclick = fit;
  if (opts.measureButton) opts.measureButton.onclick = () => setMode(mode === 'measure' ? 'pan' : 'measure');
  const onKey = e => {
    if (!document.body.contains(canvas)) { window.removeEventListener('keydown', onKey); return; }
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === 'f' || e.key === 'F' || e.key === ' ') { e.preventDefault(); fit(); }
    else if ((e.key === 'm' || e.key === 'M') && (mode === 'pan' || mode === 'measure')) setMode(mode === 'measure' ? 'pan' : 'measure');
    else if (e.key === 'Enter' && api.onEnter) api.onEnter();
    else if (e.key === 'Escape') {
      /* always offer the cancel (a back-wired part waits for Enter in pan mode) */
      if (opts.onCancel && opts.onCancel()) return;
      setMode('pan');
    }
  };
  window.addEventListener('keydown', onKey);
  const ro = new ResizeObserver(() => { if (!document.body.contains(canvas)) { ro.disconnect(); return; } resize(); });
  ro.observe(stage);
  canvas.style.cursor = 'grab';
  resize();
  api.fit = fit; api.view = view; api.setMode = setMode; api.redraw = draw; api.toScreen = toScreen;
  canvas.wfToScreen = toScreen; /* for UI tests: drawing mm -> canvas px */
  api.zoomTo = (x0, y0, x1, y1) => {
    userMoved = true;
    const w = Math.max(1e-6, x1 - x0), h = Math.max(1e-6, y1 - y0);
    view.s = Math.min((W - 40) / w, (H - 40) / h);
    view.tx = (W - w * view.s) / 2 - x0 * view.s;
    view.ty = (H - h * view.s) / 2 + y1 * view.s;
    draw();
  };
  return api;
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

  const tabs = ['Configuration', 'Numbering', 'Netlist', 'Exceptions', 'Validation', 'Diagram', 'Drawings (DWG)', 'Wire & validate', 'Export'];
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
  const views = [tabConfig, tabSimpleWiring, tabNetlist, tabExceptions, tabValidation, tabDiagram, tabDrawings, tabWireValidate, tabExport];

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
  if (sessionStorage.getItem('wireflow-open-workspace') === String(id)) {
    sessionStorage.removeItem('wireflow-open-workspace');
    await switchTab(1);
  } else await renderWorkspace();
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
    `Physical span <b>${fmtM(m.geomMm)}</b> · ` +
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
        <td>${fmtM(g.metrics.geomMm)}</td>
        <td>${g.metrics.longHops} of ${g.metrics.hops}</td>
        <td>${g.metrics.overflow ? `<span class="warn">${g.metrics.overflow} need release</span>` : '<span class="chip chip-ok">approved parts</span>'}</td>
        <td class="muted small">${esc(g.planTitle || 'hand-pointed chain')}</td>
      </tr>`;
    }).join('');
    return `
    <p class="muted small">Every rack is different: the number of SSCs, how many modules each SSC controls and the module arrangement all follow the rack layout diagram. WireFlow plans each SSC's chain independently — shortest cable first, scored against the approved harness catalogue — and the general diagram shows every chain on the real rack.</p>
    <table class="ssc-table">
      <thead><tr><th>SSC</th><th>Slot</th><th>Modules</th><th>Physical span</th><th>Long jumpers</th><th>Harnesses</th><th>Chain plan</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="muted">No SSC on the rack — paint an SSC slot in section 2.</td></tr>'}</tbody>
    </table>
    <p class="muted small" style="margin-top:8px">Total: ${t.sscs} SSC chain(s) · ${t.modules} modules · <b>${fmtM(t.geomMm)}</b> physical span · ${t.longHops} long jumper(s)${t.overflow ? ` · <span class="warn">${t.overflow} hop(s) need an engineering release</span>` : ' · everything buildable from approved parts'}</p>
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
        <div class="summary-card"><span>SSC chains</span><strong>${totals.sscs}</strong><small>${(totals.geomMm / 1000).toFixed(1)} m physical span</small></div>
        <div class="summary-card"><span>Validation gate</span><strong>${passed}/${checks.length}</strong><small>${passed === checks.length ? 'All checks pass' : checks.length - passed + ' need attention'}</small></div>
      </div>
      <div class="card">
        <h3>Chains by SSC</h3>
        <div class="chain-summary-list">${groups.map((group, i) => {
          const live = perSsc[i];
          return `<div class="chain-summary-row"><span class="ssc-dot" style="background:${SSC_PALETTE[i % SSC_PALETTE.length]}"></span><b>${esc(group.label)}</b><span>${group.order.length} modules</span><span>${(group.metrics.geomMm / 1000).toFixed(1)} m span</span><span>${live ? 'red ' + (live.powerMm / 1000).toFixed(1) + ' m · green ' + (live.commMm / 1000).toFixed(1) + ' m' : 'Calibrate to measure front-view wiring'}</span></div>`;
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

function projectPrintPages(project, conns) {
  const numbering = (project.config && project.config.numbering) || {};
  const cal = fvCalib(numbering.cal);
  if(numbering.cal?.ok===false)cal.ok=false;
  if(numbering.cal?.trayPaths!==undefined) cal.trayPaths=numbering.cal.trayPaths;
  const groups = layoutGroups(project);
  const canDraw = !!(cal.ok && project.underlay && project.underlay.kind === 'image' && project.underlay.src);
  const moduleSlots = groups.flatMap(group => group.order || []);
  const portMap = numbering.modulePortPoints;
  const moduleReady = portMap === null || portMap === undefined ? modulePortsValid(numbering.modulePorts)
    : !!portMap && typeof portMap === 'object' && !Array.isArray(portMap) && moduleSlots.length > 0 && moduleSlots.every(slot => Object.prototype.hasOwnProperty.call(portMap, slot) && modulePortsValid(portMap[slot]));
  const pictureWires = canDraw && moduleReady && pictureModuleRoutesValid(numbering.moduleDraftRoutes)
    ? pictureModuleWiring(groups, cal, numbering.modulePorts, numbering.devicePorts, numbering.modulePortPoints, numbering.powerConvention, numbering.moduleDraftRoutes) : null;
  const frontSvg = pictureWires
    ? pictureWiringSvg(cal, { src: project.underlay.src }, pictureWires, { noGrid: true, sscLabels: true }).replace('</svg>', pictureDeviceLabelsSvg(numbering.marking, cal, pictureWires) + '</svg>')
    : '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1680 1188"><rect width="1680" height="1188" fill="#fff"/><text x="840" y="594" text-anchor="middle" font-family="Arial" font-size="28" fill="#687386">Front-view wiring is unavailable: check calibration, ports and draft routes.</text></svg>';
  return buildPrintDocument({
    sheetSvg: renderDiagramSVG(project, conns),
    frontSvg: frontSvg,
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
