/* ============================================================
 * WireFlow — application shell
 * Hash router: #/ product page (the home page; the WireFlow logo goes there) ·
 * #/app the two diagram cards ("Open WireFlow") ·
 * Wiring diagram: #/wiring projects · #/folder/<id> racks of a project ·
 *   #/cad/<id> rack view (teach, confirm, number) · #/sheet/<id> wiring sheet (PDF) ·
 *   #/example the example rack
 * Electrical diagram: #/electrical projects · #/efolder/<id> diagrams of a project ·
 *   #/elec/<id> system setup · #/elecsheets/<id> its sheets: check, edit, export the PDF
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

/* On the company server the same calls go to the server (js/store.js); the browser's own
   store (idb…) stays for this browser's projects, which can be uploaded from the Diagrams page. */
async function localProjects() { return WF.remote ? wfRemoteStore.projects() : idbProjects(); }
async function localProject(id) { return WF.remote ? wfRemoteStore.project(id) : idbProject(id); }
async function localPutProject(project) { return WF.remote ? wfRemoteStore.put(project) : idbPutProject(project); }
async function localDeleteProject(id) { return WF.remote ? wfRemoteStore.remove(id) : idbDeleteProject(id); }
async function localAddProject(project) { return WF.remote ? wfRemoteStore.add(project) : idbAddProject(project); }
async function localPutUnderlay(projectId, blob, kind) { return WF.remote ? wfRemoteStore.putUnderlay(projectId, blob, kind) : idbPutUnderlay(projectId, blob, kind); }
async function localGetUnderlay(projectId) { return WF.remote ? wfRemoteStore.getUnderlay(projectId) : idbGetUnderlay(projectId); }

async function idbProjects() {
  const rows = await localStore('projects', 'readonly', store => store.getAll());
  return (rows || []).sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)));
}
async function idbProject(id) { return localStore('projects', 'readonly', store => store.get(Number(id))); }
async function idbPutProject(project) { return localStore('projects', 'readwrite', store => store.put(project)); }
/** Deletes a project and its stored drawing for good. */
async function idbDeleteProject(id) {
  await localStore('projects', 'readwrite', store => store.delete(Number(id)));
  try { await localStore('underlays', 'readwrite', store => store.delete(Number(id))); } catch (e) {}
}
async function idbAddProject(project) { return localStore('projects', 'readwrite', store => store.add(project)); }
async function idbPutUnderlay(projectId, blob, kind) {
  return localStore('underlays', 'readwrite', store => store.put({ projectId: Number(projectId), blob, kind }));
}
async function idbGetUnderlay(projectId) { return localStore('underlays', 'readonly', store => store.get(Number(projectId))); }

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
  await wfStoreReady;
  if (WF.remote) {
    /* company server: sign in first; other engineers' changes show on every page change */
    if (h.startsWith('#/login')) { if (WF.user) { location.replace(wfNextHash()); return; } renderLogin(); return; }
    if (!WF.user) { location.replace('#/login?next=' + encodeURIComponent(h)); return; }
    await wfRefreshLists();
    if (h === '#/account') { renderAccount(); return; }
  }
  if (h.startsWith('#/cad/')) { renderCadPage(+h.split('/')[2]); return; }
  if (h.startsWith('#/sheet/')) { renderSheetPage(+h.split('/')[2]); return; }
  if (h.startsWith('#/folder/')) { renderDashboard(decodeURIComponent(h.split('/')[2] || '') || undefined); return; }
  if (h.startsWith('#/efolder/')) { renderElecDashboard(decodeURIComponent(h.split('/')[2] || '') || undefined); return; }
  if (h.startsWith('#/elecsheets/')) { renderElecSheetsPage(+h.split('/')[2].split('?')[0]); return; }
  if (h.startsWith('#/elec/')) { renderElecPage(+h.split('/')[2]); return; }
  switch (h) {
    case '#/app': renderHome(); return;
    case '#/wiring': renderDashboard(); return;
    case '#/electrical': renderElecDashboard(); return;
    case '#/example': openExampleRack().catch(e => { shell(`<div class="empty"><h3>Could not open the example</h3><p>${esc(e.message)}</p><a class="btn btn-primary" href="#/app">Back</a></div>`, 'dash'); }); return;
    case '#/login': case '#/account': location.replace('#/app'); return;
    default: renderHome();
  }
}

/* ================= APP SHELL ================= */
function shell(content, active) {
  app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="topbar-in">
        <a class="tb-brand" href="#/" aria-label="WireFlow home page">
          <span class="brand-logo"><img src="assets/ayk-energy-logo.png" width="28" height="28" alt=""></span>
          <span>WireFlow</span>
        </a>
        <nav class="tb-nav" aria-label="App">
          <a href="#/app" class="${active === 'dash' ? 'on' : ''}">Diagrams</a>
          ${WF.remote && WF.user && WF.user.admin ? `<a href="#/account" class="${active === 'account' ? 'on' : ''}">Engineers</a>` : ''}
        </nav>
        ${WF.remote && WF.user
          ? `<span class="tb-note tb-user"><a href="#/account" title="Your account">${esc(WF.user.name)}${WF.user.admin ? ' · admin' : ''}</a><button type="button" class="btn btn-ghost btn-sm" id="tb-signout">Sign out</button></span>`
          : WF.remote ? '' : `<span class="tb-note"><span class="tb-dot" aria-hidden="true"></span>Drawings stay on this device</span>`}
      </div>
    </header>
    <main class="main">${content}</main>
  </div>`;
  const so = document.getElementById('tb-signout');
  if (so) so.onclick = async () => { try { await wfApi('POST', '/api/logout'); } catch (e) {} WF.user = null; location.hash = '#/login'; };
}

/* ================= DASHBOARD ================= */
/* Projects are folders of racks, kept on this device: one per project number. Every rack
   of a project goes in its folder, so what is taught on one rack (parts, tray and pair,
   numbering) is offered first on the next rack of the same project. */
const FOLDERS_KEY = 'wireflow.folders';
function foldersLoad() {
  try { const v = JSON.parse(wfStorage.getItem(FOLDERS_KEY) || '[]'); return Array.isArray(v) ? v.filter(f => f && f.id) : []; } catch (e) { return []; }
}
function foldersSave(list) {
  try { wfStorage.setItem(FOLDERS_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}
function folderLabel(f) { return f ? f.number + (f.name ? ' · ' + f.name : '') : 'Not in a project'; }
/** "Rack N" after the highest rack number already in the folder. */
function nextRackName(racks) {
  const nums = racks.map(r => +((String(r.name).match(/^rack\s*(\d+)$/i) || [])[1] || 0));
  return 'Rack ' + (Math.max(racks.length, ...nums, 0) + 1);
}
/** The project a rack belongs to (null when none, or its folder was removed). */
function rackFolder(p, folders) { return p && p.folder ? (folders || foldersLoad()).find(f => f.id === p.folder) || null : null; }

/**
 * Asks which project a rack belongs to and what it is called (on import, and to rename or
 * move a rack). Resolves {folder (id or null), name} or null when cancelled.
 */
function rackDialog(o) {
  const noun = o.noun || 'Rack';
  const nextName = o.nextName || nextRackName;
  const quick = o.quick || (next => [1, 2, 3, 4, 5, 6].map(n => 'Rack ' + n));
  return new Promise(resolve => {
    const folders = foldersLoad();
    const racksIn = o.racksIn || (() => []);
    const back = document.createElement('div');
    back.className = 'modal-back';
    const opt = f => `<option value="${esc(f.id)}" ${f.id === o.folder ? 'selected' : ''}>${esc(folderLabel(f))}</option>`;
    back.innerHTML = `<form class="modal wf-dialog" novalidate>
      <h3>${esc(o.title)}</h3>
      ${o.fileName ? `<p class="muted small">${esc(o.fileName)}</p>` : ''}
      <div class="field"><label for="rd-folder">Project</label>
        <select id="rd-folder">${folders.map(opt).join('')}
          <option value="__new" ${!folders.length || o.folder === '__new' ? 'selected' : ''}>New project…</option>
          ${o.allowNone ? `<option value="" ${o.folder == null && folders.length ? 'selected' : ''}>Not in a project</option>` : ''}
        </select></div>
      <div class="rd-new" hidden>
        <div class="field"><label for="rd-number">Project number *</label><input id="rd-number" maxlength="40" placeholder="e.g. S10195" autocomplete="off"></div>
        <div class="field"><label for="rd-pname">Project name (optional)</label><input id="rd-pname" maxlength="60" placeholder="e.g. MV Example battery room" autocomplete="off"></div>
      </div>
      <div class="field"><label for="rd-name">${esc(noun)} name *</label><input id="rd-name" maxlength="60" autocomplete="off">
        <div class="rd-chips" aria-label="Quick names"></div>
        <p class="muted small">${esc(o.hint || 'Rack 1, Rack 2 … or your own name.')}</p></div>
      <p class="warn small rd-err" role="alert"></p>
      <div class="modal-actions"><button type="button" class="btn btn-ghost" data-x>Cancel</button><button type="submit" class="btn btn-primary">${esc(o.ok)}</button></div>
    </form>`;
    document.body.appendChild(back);
    const f = back.querySelector('form'), sel = f.querySelector('#rd-folder'), nm = f.querySelector('#rd-name');
    const err = m => { f.querySelector('.rd-err').textContent = m || ''; };
    let typed = !!o.name;
    nm.value = o.name || '';
    const sync = () => {
      const isNew = sel.value === '__new';
      f.querySelector('.rd-new').hidden = !isNew;
      const racks = isNew || !sel.value ? [] : racksIn(sel.value);
      const next = nextName(racks);
      if (!typed) nm.value = next;
      const used = new Set(racks.map(r => String(r.name).toLowerCase()));
      const chips = [next].concat(quick(next).filter(c => c !== next && !used.has(c.toLowerCase()))).slice(0, 4);
      f.querySelector('.rd-chips').innerHTML = chips.map(c => `<button type="button" class="chip-btn" data-chip="${esc(c)}">${esc(c)}</button>`).join('');
      f.querySelectorAll('[data-chip]').forEach(b => b.onclick = () => { nm.value = b.dataset.chip; typed = true; nm.focus(); });
    };
    sel.onchange = sync;
    nm.oninput = () => { typed = true; };
    sync();
    (sel.value === '__new' ? f.querySelector('#rd-number') : nm).focus();
    if (sel.value !== '__new') nm.select();
    const close = v => { back.remove(); document.removeEventListener('keydown', key); resolve(v); };
    const key = e => { if (e.key === 'Escape') close(null); };
    document.addEventListener('keydown', key);
    f.querySelector('[data-x]').onclick = () => close(null);
    f.onsubmit = e => {
      e.preventDefault();
      const name = nm.value.trim();
      if (!name) { err(o.nameNeeded || 'Give the rack a name, for example Rack 1.'); nm.focus(); return; }
      let folder = sel.value || null;
      if (folder === '__new') {
        const number = f.querySelector('#rd-number').value.trim();
        if (!number) { err('Enter the project number.'); f.querySelector('#rd-number').focus(); return; }
        const list = foldersLoad();
        const same = list.find(x => x.number.toLowerCase() === number.toLowerCase());
        if (same) folder = same.id;
        else {
          const nf = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), number: number, name: f.querySelector('#rd-pname').value.trim(), created: new Date().toISOString() };
          list.push(nf);
          if (!foldersSave(list)) { err('Could not save the project on this device (storage is blocked).'); return; }
          folder = nf.id;
        }
      }
      if (folder && racksIn(folder).some(r => r.id !== o.rackId && String(r.name).toLowerCase() === name.toLowerCase())) {
        err(`This project already has a${/^[aeiou]/i.test(noun) ? 'n' : ''} ${noun.toLowerCase()} called "${name}". Choose another name.`); nm.focus(); return;
      }
      close({ folder: folder, name: name });
    };
  });
}

/** Rename or delete a project (deleting only an empty one). Resolves true when changed. */
function folderDialog(folder, rackCount) {
  return new Promise(resolve => {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<form class="modal wf-dialog" novalidate>
      <h3>Project</h3>
      <div class="field"><label for="fd-number">Project number *</label><input id="fd-number" maxlength="40" value="${esc(folder.number)}" autocomplete="off"></div>
      <div class="field"><label for="fd-name">Project name (optional)</label><input id="fd-name" maxlength="60" value="${esc(folder.name || '')}" autocomplete="off"></div>
      <p class="warn small fd-err" role="alert"></p>
      <div class="modal-actions">
        ${rackCount ? '' : '<button type="button" class="btn btn-ghost" data-del style="margin-right:auto">Delete empty project</button>'}
        <button type="button" class="btn btn-ghost" data-x>Cancel</button><button type="submit" class="btn btn-primary">Save</button></div>
    </form>`;
    document.body.appendChild(back);
    const f = back.querySelector('form');
    const close = v => { back.remove(); resolve(v); };
    f.querySelector('[data-x]').onclick = () => close(false);
    const del = f.querySelector('[data-del]');
    if (del) del.onclick = () => { if (!confirm(`Delete the empty project ${folder.number}?`)) return; foldersSave(foldersLoad().filter(x => x.id !== folder.id)); close(true); };
    f.querySelector('#fd-number').focus();
    f.onsubmit = e => {
      e.preventDefault();
      const number = f.querySelector('#fd-number').value.trim();
      if (!number) { f.querySelector('.fd-err').textContent = 'Enter the project number.'; return; }
      const list = foldersLoad();
      if (list.some(x => x.id !== folder.id && x.number.toLowerCase() === number.toLowerCase())) { f.querySelector('.fd-err').textContent = 'Another project already has this number.'; return; }
      const me = list.find(x => x.id === folder.id);
      if (me) { me.number = number; me.name = f.querySelector('#fd-name').value.trim(); foldersSave(list); }
      close(true);
    };
  });
}

/** Dashboard: all projects (folderId undefined), one project's racks, or racks in no project ('none'). */
async function renderDashboard(folderId) {
  shell(`<div class="loading">Loading projects…</div>`, 'dash');
  let projects;
  try { projects = await localProjects(); }
  catch (error) { shell(`<div class="empty">Could not open local projects: ${esc(error.message)}</div>`, 'dash'); return; }

  const folders = foldersLoad();
  const cadProjects = projects.filter(p => p.underlay_kind === 'cad');
  const known = new Set(folders.map(f => f.id));
  const racksIn = id => cadProjects.filter(p => id ? p.folder === id : !(p.folder && known.has(p.folder)))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true }));
  const unfiled = racksIn(null);
  const folder = folderId && folderId !== 'none' ? folders.find(f => f.id === folderId) : null;
  if (folderId && folderId !== 'none' && !folder) { location.replace('#/wiring'); return; }
  const elecIn = id => projects.filter(p => p.underlay_kind === 'elec' && p.folder === id);
  const inside = !!folderId;
  const when = p => new Date(p.updated_at || p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const confirmed = p => {
    const comps = (p.config && p.config.cad && p.config.cad.components) || [];
    const named = comps.filter(c => c.kind === 'ssc' || c.kind === 'acdp' || c.kind === 'msm');
    return comps.length && named.length && named.every(c => c.labelConfirmed);
  };
  const wired = p => !!(p.config && p.config.cad && p.config.cad.wiring && p.config.cad.wiring.plan);
  const cadCard = p => {
    const comps = (p.config && p.config.cad && p.config.cad.components) || [];
    const n = k => comps.filter(c => c.kind === k).length;
    const status = !comps.length ? ['Parts not taught yet', 'idle'] : wired(p) ? ['Wired', 'ok'] : confirmed(p) ? ['Rack confirmed', 'ok'] : ['Needs confirmation', 'warn'];
    const stats = [['modules', n('module')], ['SSCs', n('ssc')], ['JBs', n('jb')], ['ACDPs', n('acdp')], ['MSMs', n('msm')]].filter(x => x[1]);
    return `<div class="d-card-wrap"><a class="d-card" href="#/cad/${p.id}">
      <div class="d-card-top"><span class="d-file" aria-hidden="true">DXF</span>
        <div class="d-card-title"><b>${esc(p.name)}</b><small>${p.cad_file && p.cad_file.replace(/\.dxf$/i, '') !== p.name ? esc(p.cad_file) + ' · ' : ''}Updated ${esc(when(p))}${p.updated_by ? ' by ' + esc(p.updated_by) : ''}</small></div></div>
      <div class="d-stats">${stats.length ? stats.map(x => `<span><b>${x[1]}</b> ${x[0]}</span>`).join('') : '<span class="muted">Open the drawing and teach one module to start.</span>'}</div>
      <div class="d-status d-status-${status[1]}"><span class="d-dot"></span>${status[0]}</div>
    </a><div class="d-card-btns"><button type="button" class="d-card-edit" data-edit="${p.id}" title="Rename this rack or move it to another project" aria-label="Rename or move ${esc(p.name)}">Rename / move</button><button type="button" class="d-card-edit d-card-del" data-del-rack="${p.id}" title="Delete this rack" aria-label="Delete ${esc(p.name)}">Delete</button></div></div>`;
  };
  const folderCard = f => {
    const racks = racksIn(f.id);
    const mods = racks.reduce((n, p) => n + ((p.config && p.config.cad && p.config.cad.components) || []).filter(c => c.kind === 'module').length, 0);
    const last = racks.map(p => p.updated_at || p.created_at).sort().pop() || f.created;
    const nw = racks.filter(wired).length;
    return `<a class="d-card d-folder" href="#/folder/${esc(f.id)}">
      <div class="d-card-top"><span class="d-file d-file-folder" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span>
        <div class="d-card-title"><b>${esc(f.number)}</b><small>${f.name ? esc(f.name) + ' · ' : ''}Updated ${esc(when({ updated_at: last }))}</small></div></div>
      <div class="d-stats"><span><b>${racks.length}</b> rack${racks.length === 1 ? '' : 's'}</span>${mods ? `<span><b>${mods}</b> modules</span>` : ''}${elecIn(f.id).length ? `<span><b>${elecIn(f.id).length}</b> electrical</span>` : ''}</div>
      <div class="d-status d-status-${racks.length && nw === racks.length ? 'ok' : racks.length ? 'warn' : 'idle'}"><span class="d-dot"></span>${racks.length ? `${nw} of ${racks.length} wired` : 'No racks yet'}</div>
    </a>`;
  };
  const shown = inside ? racksIn(folder ? folder.id : null) : [];
  const head = !inside ? `
        <div>
          <a class="dash-crumb" href="#/app">← Diagrams</a>
          <h1>Wiring diagram</h1>
          <p>One folder per project number. Every rack of a project goes in it, and what you teach on one rack is used on the next.</p>
        </div>
        <div class="dash-actions">
          <a class="btn-site btn-site-ghost" href="#/example">Open the example rack</a>
          <button class="btn-site btn-site-ghost" id="dash-new-folder">New project</button>
          <button class="btn-site btn-site-primary" id="studio-import-button">Import DXF</button>
        </div>` : `
        <div>
          <a class="dash-crumb" href="#/wiring">← All projects</a>
          <h1>${folder ? esc(folder.number) : 'Racks not in a project'}</h1>
          <p>${folder ? (folder.name ? esc(folder.name) + ' · ' : '') + `${shown.length} rack${shown.length === 1 ? '' : 's'}. New racks imported here use the parts already taught on this project's racks.` : 'Racks imported before projects existed. Use Rename / move on a rack to put it in a project.'}</p>
        </div>
        <div class="dash-actions">
          ${folder ? '<button class="btn-site btn-site-ghost" id="dash-edit-folder">Rename project</button><button class="btn-site btn-site-ghost btn-site-danger" id="dash-del-folder">Delete project</button>' : ''}
          ${folder ? `<a class="btn-site btn-site-ghost" href="#/efolder/${esc(folder.id)}">Electrical diagrams (${elecIn(folder.id).length})</a>` : ''}
          <button class="btn-site btn-site-primary" id="studio-import-button">Import DXF${folder ? ' into this project' : ''}</button>
        </div>`;
  const list = !inside ? `
      <section class="dash-list" aria-labelledby="list-title">
        <div class="dash-list-head"><h2 id="list-title">Your projects</h2><span>${folders.length} project${folders.length === 1 ? '' : 's'} · ${cadProjects.length} rack${cadProjects.length === 1 ? '' : 's'}</span></div>
        ${folders.length || unfiled.length ? `<div class="d-grid">${folders.slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })).map(folderCard).join('')}
          ${unfiled.length ? `<a class="d-card d-folder d-folder-none" href="#/folder/none">
            <div class="d-card-top"><span class="d-file d-file-old" aria-hidden="true">…</span>
              <div class="d-card-title"><b>Racks not in a project</b><small>Imported before projects · move them into one</small></div></div>
            <div class="d-stats"><span><b>${unfiled.length}</b> rack${unfiled.length === 1 ? '' : 's'}</span></div></a>` : ''}</div>`
          : `<div class="d-empty"><b>No projects yet</b><span>Import a DXF above: you will be asked for the project number and the rack name. Or <a href="#/example">open the example rack</a> to try every step.</span></div>`}
      </section>` : `
      <section class="dash-list" aria-labelledby="list-title">
        <div class="dash-list-head"><h2 id="list-title">Racks</h2><span>${shown.length} rack${shown.length === 1 ? '' : 's'}</span></div>
        ${shown.length ? `<div class="d-grid">${shown.map(cadCard).join('')}</div>`
          : `<div class="d-empty"><b>No racks in this project yet</b><span>Import the first rack's DXF above.</span></div>`}
      </section>`;

  shell(`
    <div class="dash">
      <div class="dash-head">${head}</div>

      <section class="drop" id="dash-drop" aria-labelledby="drop-title">
        <div class="drop-icon" aria-hidden="true">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none"><path d="M12 15V4m0 0L8 8m4-4 4 4" stroke="#00a8ff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" stroke="#9aabc6" stroke-width="1.8" stroke-linecap="round"/></svg>
        </div>
        <h2 id="drop-title">Drop an AutoCAD rack drawing here${folder ? ' to add it to ' + esc(folder.number) : ''}</h2>
        <p>ASCII DXF in millimetres &middot; <button class="link-btn" id="drop-browse">browse files</button></p>
        <p id="studio-import-status" class="drop-status" role="status"></p>
        <input id="studio-import-file" type="file" accept=".dxf" hidden>
      </section>

      ${inside ? '' : `<ol class="dash-steps" aria-label="Workflow">
        <li><b>1</b><span>Import DXF into a project, name the rack</span></li>
        <li><b>2</b><span>Teach each part once (later racks of the project reuse it)</span></li>
        <li><b>3</b><span>Confirm SSCs, ACDPs, MSM and modules per SSC</span></li>
        <li><b>4</b><span>Number the modules, then download the PDF sheet</span></li>
      </ol>`}

      ${list}

    </div>
  `, 'dash');
  const studioFile = document.getElementById('studio-import-file');
  const studioStatus = document.getElementById('studio-import-status');
  document.getElementById('studio-import-button').onclick = () => studioFile.click();
  document.getElementById('drop-browse').onclick = () => studioFile.click();
  const newFolderBtn = document.getElementById('dash-new-folder');
  if (newFolderBtn) newFolderBtn.onclick = async () => {
    const list = foldersLoad();
    const nf = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), number: '', name: '', created: new Date().toISOString() };
    list.push(nf); foldersSave(list);
    const ok = await folderDialog(nf, 0);
    const now = foldersLoad().find(x => x.id === nf.id);
    if (!ok || !now || !now.number) { foldersSave(foldersLoad().filter(x => x.id !== nf.id)); renderDashboard(); return; }
    location.hash = '#/folder/' + nf.id;
  };
  const editFolderBtn = document.getElementById('dash-edit-folder');
  if (editFolderBtn) editFolderBtn.onclick = async () => {
    if (!(await folderDialog(folder, shown.length + elecIn(folder.id).length))) return;
    if (!foldersLoad().some(x => x.id === folder.id)) location.hash = '#/wiring';
    else renderDashboard(folderId);
  };
  /* delete a project: its racks go; its electrical diagrams stay, outside any project */
  const delFolderBtn = document.getElementById('dash-del-folder');
  if (delFolderBtn) delFolderBtn.onclick = async () => {
    const r = racksIn(folder.id), d = elecIn(folder.id);
    const msg = `Delete project ${folder.number}?\n\n` +
      (r.length ? `Its ${r.length} rack${r.length === 1 ? '' : 's'} (${r.map(p => p.name).join(', ')}) will be deleted for good: drawings, taught parts, numbering, wiring and sheets.\n` : 'It has no rack.\n') +
      (d.length ? `Its ${d.length} electrical diagram${d.length === 1 ? '' : 's'} are kept, outside any project.` : '');
    if (!confirm(msg)) return;
    try {
      for (const p of r) await localDeleteProject(p.id);
      for (const p of d) { delete p.folder; p.updated_at = new Date().toISOString(); await localPutProject(p); }
      foldersSave(foldersLoad().filter(x => x.id !== folder.id));
      toast(`Deleted project ${folder.number}.`);
      location.hash = '#/wiring';
    } catch (e) { toast('Could not delete: ' + e.message, 'error'); }
  };
  /* delete one rack */
  document.querySelectorAll('[data-del-rack]').forEach(b => b.onclick = async () => {
    const p = cadProjects.find(x => x.id === +b.dataset.delRack);
    if (!p || !confirm(`Delete the rack "${p.name}"? Its drawing, taught parts, numbering, wiring and sheets are deleted for good.`)) return;
    try { await localDeleteProject(p.id); toast(`Deleted "${p.name}".`); renderDashboard(folderId); }
    catch (e) { toast('Could not delete: ' + e.message, 'error'); }
  });
  /* rename a rack or move it to another project */
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
    const p = cadProjects.find(x => x.id === +b.dataset.edit);
    if (!p) return;
    const got = await rackDialog({ title: 'Rename / move rack', ok: 'Save', folder: p.folder && known.has(p.folder) ? p.folder : null, name: p.name, rackId: p.id, allowNone: true, racksIn: racksIn, fileName: p.cad_file });
    if (!got) return;
    p.name = got.name; p.folder = got.folder || undefined; p.updated_at = new Date().toISOString();
    await localPutProject(p);
    renderDashboard(folderId);
  });
  async function openStudioDrawing(file) {
    if (!file) return;
    studioStatus.textContent = 'Checking drawing…';
    try {
      if (/\.dwg$/i.test(file.name)) throw new Error('DWG cannot be read in the browser. In AutoCAD use Save As DXF, then import the .dxf.');
      if (/\.dxf$/i.test(file.name)) { await openStudioCad(file); return; }
      throw new Error('Choose a DXF drawing (AutoCAD Save As DXF).');
    } catch (error) {
      console.error('Drawing import failed', error);
      studioStatus.textContent = error.message || 'Could not import this drawing.';
    } finally { studioFile.value = ''; }
  }
  /* a DXF: which project, and the rack's name; then open it */
  async function openStudioCad(file) {
    studioStatus.textContent = 'Reading DXF…';
    const text = await file.text();
    const model = cadParseDxf(text);             /* throws a readable error for DWG / binary / empty */
    if (!model.entities.length) throw new Error('The DXF has no model-space geometry.');
    studioStatus.textContent = '';
    const place = await rackDialog({ title: 'Import rack drawing', ok: 'Import', fileName: file.name,
      folder: folder ? folder.id : (foldersLoad()[0] ? (foldersLoad().slice().sort((a, b) => String(b.created).localeCompare(String(a.created)))[0].id) : '__new'),
      racksIn: id => racksIn(id) });
    if (!place) { studioStatus.textContent = 'Import cancelled.'; return; }
    studioStatus.textContent = 'Saving the drawing…';
    const now = new Date().toISOString();
    const cad = { signatures: [], components: [] };
    /* learn from the project: the parts taught, and the pair and tray chosen, on its latest rack */
    const sibling = place.folder ? (await localProjects()).filter(p => p.underlay_kind === 'cad' && p.folder === place.folder && p.config && p.config.cad && (p.config.cad.signatures || []).length)
      .sort((a, b) => String(b.updated_at || b.created_at).localeCompare(String(a.updated_at || a.created_at)))[0] : null;
    if (sibling) {
      const sc = sibling.config.cad;
      cad.signatures = JSON.parse(JSON.stringify(sc.signatures));
      cad.learnedFrom = sibling.name;
      if (sc.wiring && (sc.wiring.pair || sc.wiring.tray)) cad.wiring = { pair: sc.wiring.pair, tray: sc.wiring.tray };
    }
    const project = { name: place.name, folder: place.folder || undefined, config: { cad: cad },
      status: 'draft', created_at: now, updated_at: now, underlay_kind: 'cad', cad_file: file.name };
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
}

/* ================= HOME =================
 * Two templates: the wiring diagram (rack front, from the DXF) and the electrical
 * diagram (the battery system's connection diagram). Both keep their work in the same
 * project folders, so one project number holds its racks and its electrical diagrams. */
async function renderHome() {
  let projects = [];
  try { projects = await localProjects(); } catch (e) { /* counts only */ }
  const folders = foldersLoad();
  const racks = projects.filter(p => p.underlay_kind === 'cad').length;
  const elecs = projects.filter(p => p.underlay_kind === 'elec').length;
  const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
  shell(`
    <div class="dash home">
      <div class="dash-head"><div>
        <h1>What are you drawing?</h1>
        <p>${folders.length ? `${plural(folders.length, 'project')} ${WF.remote ? 'shared on the AYK server' : 'on this device'}. ` : ''}Both diagrams use the same project folders: one per project number.</p>
      </div></div>
      <div id="wf-upload"></div>
      <div class="home-cards">
        <a class="home-card" href="#/wiring">
          <span class="home-ico" aria-hidden="true"><svg width="34" height="34" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="7" height="5" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="3" width="7" height="5" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="3" y="16" width="7" height="5" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="14" y="16" width="7" height="5" rx="1" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 8v8M17.5 8v8M10 5.5h4" stroke="#ef4444" stroke-width="1.6"/><path d="M10 18.5h4" stroke="#22c55e" stroke-width="1.6"/></svg></span>
          <b>Wiring diagram</b>
          <span>The rack front from your AutoCAD DXF: teach the parts, number the modules, and get AYK's A3 wiring sheet (DWG2396 format) as a PDF.</span>
          <small>${plural(racks, 'rack')}</small>
        </a>
        <a class="home-card" href="#/electrical">
          <span class="home-ico home-ico-elec" aria-hidden="true"><svg width="34" height="34" viewBox="0 0 24 24" fill="none"><rect x="2.5" y="4" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="13.5" y="4" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.6"/><rect x="8" y="15" width="8" height="6" rx="1" stroke="currentColor" stroke-width="1.6"/><path d="M6.5 10v2.5h5.5V15M17.5 10v2.5H12" stroke="#a78bfa" stroke-width="1.6"/><path d="M10.5 7h3" stroke="#00a8ff" stroke-width="1.6" stroke-dasharray="1.6 1.4"/></svg></span>
          <b>Electrical diagram</b>
          <span>The battery system's electrical connection diagram (DWG2527 format), drawn from AYK's MSM, SSC and module drawings: banks, harnesses and customer cables.</span>
          <small>${plural(elecs, 'diagram')}</small>
        </a>
      </div>
    </div>`, 'dash');
  if (WF.remote) wfOfferUpload();
}

/* ================= COMPANY SERVER: SIGN IN, ACCOUNTS, UPLOAD ================= */
/** Where to go after signing in (the page asked for, else the diagrams). */
function wfNextHash() {
  const next = decodeURIComponent(location.hash.split('?next=')[1] || '');
  return next.startsWith('#/') && !next.startsWith('#/login') ? next : '#/app';
}

function renderLogin() {
  document.title = 'Sign in · WireFlow';
  shell(`<form class="modal wf-dialog wf-login" novalidate>
      <h3>Sign in to WireFlow</h3>
      <p class="muted small">Use the account the WireFlow admin gave you. Projects here are shared by every AYK engineer.</p>
      <div class="field"><label for="lg-user">Email address</label><input id="lg-user" type="text" inputmode="email" placeholder="name@aykpower.com" autocomplete="username" autocapitalize="none" spellcheck="false"></div>
      <div class="field"><label for="lg-pw">Password</label><input id="lg-pw" type="password" autocomplete="current-password"></div>
      <p class="warn small lg-err" role="alert"></p>
      <div class="modal-actions"><button type="submit" class="btn btn-primary">Sign in</button></div>
    </form>`, 'dash');
  const f = app.querySelector('form');
  wfPasswordEyes(f);
  f.querySelector('#lg-user').focus();
  f.onsubmit = async e => {
    e.preventDefault();
    const err = f.querySelector('.lg-err'); err.textContent = '';
    const btn = f.querySelector('button[type=submit]'); btn.disabled = true;
    try {
      const { data } = await wfApi('POST', '/api/login', { username: f.querySelector('#lg-user').value.trim(), password: f.querySelector('#lg-pw').value });
      WF.user = data.user;
      location.replace(wfNextHash());
    } catch (x) { err.textContent = x.message; btn.disabled = false; f.querySelector('#lg-pw').select(); }
  };
}

async function renderAccount() {
  document.title = 'Account · WireFlow';
  const me = WF.user;
  let users = [];
  if (me.admin) { try { users = (await wfApi('GET', '/api/users')).data; } catch (e) { toast(e.message, 'error'); } }
  const row = u => `<tr class="${u.active ? '' : 'muted'}"><td>${esc(u.name)}</td><td><span class="wf-copy" title="Click to copy" data-copy="${esc(u.username)}">${esc(u.username)}</span></td><td>${u.admin ? 'Admin' : 'Engineer'}${u.active ? '' : ' (locked)'}</td>
    <td>${u.username === me.username ? '<span class="muted small">you</span>' : `<button class="btn btn-ghost btn-xs" data-edit="${esc(u.username)}" data-name="${esc(u.name)}">Edit</button>
      <button class="btn btn-ghost btn-xs" data-reset="${esc(u.username)}">New password</button>
      <button class="btn btn-ghost btn-xs" data-lock="${esc(u.username)}" data-on="${u.active ? 0 : 1}">${u.active ? 'Lock' : 'Unlock'}</button>
      <button class="btn btn-ghost btn-xs wf-del" data-del="${esc(u.username)}" data-name="${esc(u.name)}">Delete</button>`}</td></tr>`;
  const admin = !me.admin ? '' : `
      <div class="modal wf-dialog wf-users"><h3>Engineers (${users.length})</h3>
        <table class="wf-users-t"><thead><tr><th>Name</th><th>Username (email)</th><th>Role</th><th></th></tr></thead><tbody>${users.map(row).join('')}</tbody></table>
        <p class="muted small">Click a username to copy it. A locked engineer cannot sign in until unlocked; a deleted one is gone for good. Their projects stay either way, and the log keeps who changed what.</p>
      </div>
      <form class="modal wf-dialog" id="acc-add" novalidate>
        <h3>Add an engineer</h3>
        <div class="field"><label for="nu-name">Full name</label><input id="nu-name" maxlength="80" autocomplete="off"></div>
        <div class="field"><label for="nu-user">Email address (their username)</label><input id="nu-user" maxlength="80" inputmode="email" placeholder="name@aykpower.com" autocapitalize="none" spellcheck="false" autocomplete="off"></div>
        <div class="field"><label for="nu-pw">First password (at least 8 characters; they can change it)</label><input id="nu-pw" type="password" autocomplete="new-password"></div>
        <label class="small"><input type="checkbox" id="nu-admin"> Admin (can manage engineers)</label>
        <p class="warn small nu-err" role="alert"></p>
        <div class="modal-actions"><button type="submit" class="btn btn-primary">Add engineer</button></div>
      </form>`;
  shell(`<div class="dash">
    <div class="dash-head"><div><h1>${esc(me.name)}</h1><p>Signed in as <b>${esc(me.username)}</b>${me.admin ? ' · admin' : ''}.</p></div></div>
    <section class="wf-acc">${admin}
      <form class="modal wf-dialog" id="acc-pw" novalidate>
        <h3>Change your password</h3>
        <div class="field"><label for="pw-old">Current password</label><input id="pw-old" type="password" autocomplete="current-password"></div>
        <div class="field"><label for="pw-new">New password (at least 8 characters)</label><input id="pw-new" type="password" autocomplete="new-password"></div>
        <div class="field"><label for="pw-new2">New password again</label><input id="pw-new2" type="password" autocomplete="new-password"></div>
        <p class="warn small pw-err" role="alert"></p>
        <div class="modal-actions"><button type="submit" class="btn btn-primary">Change password</button></div>
      </form>
    </section></div>`, 'account');
  const pw = document.getElementById('acc-pw');
  pw.onsubmit = async e => {
    e.preventDefault();
    const err = pw.querySelector('.pw-err'); err.textContent = '';
    const n = pw.querySelector('#pw-new').value;
    if (n !== pw.querySelector('#pw-new2').value) { err.textContent = 'The two new passwords differ.'; return; }
    try { await wfApi('POST', '/api/password', { old: pw.querySelector('#pw-old').value, new: n }); WF.user = null; toast('Password changed. Sign in with the new password.'); location.hash = '#/login'; }
    catch (x) { err.textContent = x.message; }
  };
  const add = document.getElementById('acc-add');
  if (add) add.onsubmit = async e => {
    e.preventDefault();
    const err = add.querySelector('.nu-err'); err.textContent = '';
    try {
      await wfApi('POST', '/api/users', { name: add.querySelector('#nu-name').value.trim(), username: add.querySelector('#nu-user').value.trim().toLowerCase(), password: add.querySelector('#nu-pw').value, admin: add.querySelector('#nu-admin').checked });
      toast('Account added. Give the engineer the username and first password.'); renderAccount();
    } catch (x) { err.textContent = x.message; }
  };
  app.querySelectorAll('[data-reset]').forEach(b => b.onclick = async () => {
    const pass = prompt(`New password for ${b.dataset.reset} (at least 8 characters):`);
    if (!pass) return;
    try { await wfApi('PATCH', '/api/users/' + encodeURIComponent(b.dataset.reset), { password: pass }); toast('Password set. Give it to the engineer.'); }
    catch (x) { toast(x.message, 'error'); }
  });
  app.querySelectorAll('[data-lock]').forEach(b => b.onclick = async () => {
    const on = b.dataset.on === '1';
    if (!on && !confirm(`Lock ${b.dataset.lock}? They are signed out and cannot sign in until unlocked.`)) return;
    try { await wfApi('PATCH', '/api/users/' + encodeURIComponent(b.dataset.lock), { active: on }); renderAccount(); }
    catch (x) { toast(x.message, 'error'); }
  });
  app.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
    const name = prompt('Full name:', b.dataset.name);
    if (name == null) return;
    const email = prompt('Email address (their username):', b.dataset.edit);
    if (email == null) return;
    try {
      await wfApi('PATCH', '/api/users/' + encodeURIComponent(b.dataset.edit), { name: name.trim(), username: email.trim().toLowerCase() });
      toast(email.trim().toLowerCase() !== b.dataset.edit ? 'Saved. They now sign in with ' + email.trim().toLowerCase() + '.' : 'Saved.'); renderAccount();
    } catch (x) { toast(x.message, 'error'); }
  });
  app.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    if (!confirm(`Delete ${b.dataset.name} (${b.dataset.del})? They can no longer sign in, and this cannot be undone. Their projects stay.`)) return;
    try { await wfApi('DELETE', '/api/users/' + encodeURIComponent(b.dataset.del)); toast(`${b.dataset.name} deleted.`); renderAccount(); }
    catch (x) { toast(x.message, 'error'); }
  });
  app.querySelectorAll('[data-copy]').forEach(s => s.onclick = async () => {
    try { await navigator.clipboard.writeText(s.dataset.copy); toast('Copied ' + s.dataset.copy); }
    catch (e) { const r = document.createRange(); r.selectNodeContents(s); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); }
  });
  wfPasswordEyes(app);
}

/** An eye on every password field: one click shows what is typed, the next hides it again. */
function wfPasswordEyes(root) {
  root.querySelectorAll('input[type=password]').forEach(inp => {
    if (inp.parentElement.classList.contains('wf-pw')) return;
    const wrap = document.createElement('span');
    wrap.className = 'wf-pw';
    inp.parentNode.insertBefore(wrap, inp);
    wrap.appendChild(inp);
    const eye = document.createElement('button');
    eye.type = 'button'; eye.className = 'wf-eye'; eye.title = 'Show password'; eye.setAttribute('aria-label', 'Show password');
    const icon = shown => shown
      ? '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c6 0 10 6 10 6a17 17 0 0 1-3.2 3.8M6.2 7.4C3.6 9.2 2 12 2 12s4 6 10 6a9.6 9.6 0 0 0 4.1-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/></svg>'
      : '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M2 12s4-6 10-6 10 6 10 6-4 6-10 6S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
    eye.innerHTML = icon(false);
    eye.onclick = () => {
      const show = inp.type === 'password';
      inp.type = show ? 'text' : 'password';
      eye.innerHTML = icon(show);
      eye.title = show ? 'Hide password' : 'Show password';
      eye.setAttribute('aria-label', eye.title);
      inp.focus();
    };
    wrap.appendChild(eye);
  });
}

/* Projects made before the server (in this browser's own storage) can be copied up once.
   The browser keeps its copy. Rack numbers are new on the server, so the links between
   racks (strings across racks, racks drawn on one sheet) are renumbered. */
const WF_UPLOADED_KEY = 'wireflow.uploaded';
async function wfOfferUpload() {
  const box = document.getElementById('wf-upload');
  if (!box) return;
  let local = [];
  try { if (!localStorage.getItem(WF_UPLOADED_KEY)) local = await idbProjects(); } catch (e) { return; }
  if (!local.length) return;
  const card = inner => `<div class="wf-upload-card">${inner}</div>`;
  box.innerHTML = card(`<b>${local.length} project${local.length === 1 ? ' is' : 's are'} only in this browser.</b>
    <span class="muted small">Copy ${local.length === 1 ? 'it' : 'them'} to the server so every engineer can open ${local.length === 1 ? 'it' : 'them'}. This browser keeps its copy.</span>
    <span><button class="btn btn-primary btn-sm" id="wf-up-go">Copy to the server</button> <button class="btn btn-ghost btn-sm" id="wf-up-no">Don't copy</button></span>`);
  box.querySelector('#wf-up-no').onclick = () => {
    if (!confirm('Hide this for good on this PC? The projects stay only in this browser.')) return;
    try { localStorage.setItem(WF_UPLOADED_KEY, 'skipped ' + new Date().toISOString()); } catch (e) {}
    box.innerHTML = '';
  };
  box.querySelector('#wf-up-go').onclick = async () => {
    box.innerHTML = card('<b>Copying…</b>');
    try {
      const n = await wfUploadLocal(local, msg => { box.innerHTML = card(`<b>${esc(msg)}</b>`); });
      toast(`${n} project${n === 1 ? '' : 's'} copied to the server.`); renderHome();
    } catch (e) { box.innerHTML = card(`<b class="warn">Copying stopped: ${esc(e.message)}</b><span class="muted small">What was copied stays on the server; check it before copying again.</span>`); }
  };
}
async function wfUploadLocal(local, progress) {
  const readLocal = k => { try { const v = JSON.parse(localStorage.getItem(k) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } };
  /* a project folder with the same number on the server is the same project */
  const folders = foldersLoad(), folderMap = {};
  for (const lf of readLocal(FOLDERS_KEY)) {
    const same = folders.find(x => String(x.number).toLowerCase() === String(lf.number).toLowerCase());
    if (same) folderMap[lf.id] = same.id; else { folders.push(lf); folderMap[lf.id] = lf.id; }
  }
  foldersSave(folders);
  const idMap = {}, added = [];
  let i = 0;
  for (const p of local.slice().sort((x, y) => x.id - y.id)) {
    progress(`Copying ${++i} of ${local.length}: ${p.name}…`);
    const copy = JSON.parse(JSON.stringify(p));
    const oldId = copy.id; delete copy.id;
    if (copy.folder) copy.folder = folderMap[copy.folder] || copy.folder;
    const id = await wfRemoteStore.add(copy);
    idMap[oldId] = id; copy.id = id; added.push(copy);
    const u = await idbGetUnderlay(oldId);
    if (u && u.blob) await wfRemoteStore.putUnderlay(id, u.blob, u.kind);
  }
  /* the links between racks carry rack numbers */
  const mapId = v => idMap[v] != null ? idMap[v] : v;
  for (const p of added) {
    const cad = p.config && p.config.cad;
    if (!cad) continue;
    let changed = false;
    for (const r of cad.remoteSscs || []) { r.rack = mapId(r.rack); changed = true; }
    if (cad.sheet && Array.isArray(cad.sheet.racks) && cad.sheet.racks.length) { cad.sheet.racks = cad.sheet.racks.map(mapId); changed = true; }
    if (cad.wiring) { cad.wiring = JSON.parse(JSON.stringify(cad.wiring).replace(/"key":"(\d+):/g, (m, n) => '"key":"' + mapId(+n) + ':')); changed = true; }
    if (changed) await wfRemoteStore.put(p);
  }
  /* taught parts and numberings join the shared lists */
  const merge = (key, extra, idOf) => {
    const list = JSON.parse(wfStorage.getItem(key) || '[]');
    const have = new Set(list.map(idOf));
    for (const x of extra) if (!have.has(idOf(x))) list.push(x);
    wfStorage.setItem(key, JSON.stringify(list));
  };
  merge(CAD_LIBRARY_KEY, readLocal(CAD_LIBRARY_KEY), cadSigId);
  merge(NUMLIB_KEY, readLocal(NUMLIB_KEY).map(e => Object.assign({}, e, { projectId: mapId(e.projectId) })), WF_LISTS[NUMLIB_KEY].id);
  await wfListSaving;
  try { localStorage.setItem(WF_UPLOADED_KEY, new Date().toISOString()); } catch (e) {}
  return added.length;
}

/* ================= ELECTRICAL DIAGRAM: PROJECTS ================= */
/** The SSC / ACDP / MSM names confirmed on the racks of a project. */
function elecPartsOfRacks(racks) {
  const parts = [];
  let unconfirmed = 0;
  for (const r of racks) {
    const cad = (r.config && r.config.cad) || {};
    for (const c of cad.components || []) {
      if (c.kind !== 'ssc' && c.kind !== 'acdp' && c.kind !== 'msm') continue;
      if (!c.labelConfirmed) { unconfirmed++; continue; }
      const saved = (cad.labels || {})[cadCompKey(c)] || {};
      parts.push({ rack: r.name, kind: c.kind, name: cadCompLabel(c, cad.labels), modules: c.kind === 'ssc' && saved.modules >= 1 ? +saved.modules : null });
    }
  }
  return { parts: parts, unconfirmed: unconfirmed };
}

async function renderElecDashboard(folderId) {
  shell(`<div class="loading">Loading projects…</div>`, 'dash');
  let projects;
  try { projects = await localProjects(); }
  catch (error) { shell(`<div class="empty">Could not open local projects: ${esc(error.message)}</div>`, 'dash'); return; }
  const folders = foldersLoad();
  const folder = folderId ? folders.find(f => f.id === folderId) : null;
  if (folderId && !folder) { location.replace('#/electrical'); return; }
  const byName = (a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true });
  const elecIn = id => projects.filter(p => p.underlay_kind === 'elec' && p.folder === id).sort(byName);
  const racksIn = id => projects.filter(p => p.underlay_kind === 'cad' && p.folder === id).sort(byName);
  const when = p => new Date(p.updated_at || p.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
  const folderIcon = '<span class="d-file d-file-folder" aria-hidden="true"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg></span>';
  const folderCard = f => {
    const d = elecIn(f.id), r = racksIn(f.id);
    const done = d.filter(p => p.config && p.config.elec && p.config.elec.confirmed).length;
    return `<a class="d-card d-folder" href="#/efolder/${esc(f.id)}">
      <div class="d-card-top">${folderIcon}
        <div class="d-card-title"><b>${esc(f.number)}</b><small>${f.name ? esc(f.name) + ' · ' : ''}Created ${esc(when({ created_at: f.created }))}</small></div></div>
      <div class="d-stats"><span><b>${d.length}</b> electrical diagram${d.length === 1 ? '' : 's'}</span>${r.length ? `<span><b>${r.length}</b> rack${r.length === 1 ? '' : 's'}</span>` : ''}</div>
      <div class="d-status d-status-${d.length && done === d.length ? 'ok' : d.length ? 'warn' : 'idle'}"><span class="d-dot"></span>${d.length ? `${done} of ${d.length} set up` : 'No electrical diagram yet'}</div>
    </a>`;
  };
  const elecCard = p => {
    const e = (p.config && p.config.elec) || elecNewSetup();
    const sum = elecSummary(e);
    const status = sum.confirmed ? ['Setup confirmed', 'ok'] : sum.banks || sum.sscs ? ['Setup in progress', 'warn'] : ['Not set up yet', 'idle'];
    return `<div class="d-card-wrap"><a class="d-card" href="#/elec/${p.id}">
      <div class="d-card-top"><span class="d-file d-file-elec" aria-hidden="true">EL</span>
        <div class="d-card-title"><b>${esc(p.name)}</b><small>Updated ${esc(when(p))}${p.updated_by ? ' by ' + esc(p.updated_by) : ''}</small></div></div>
      <div class="d-stats"><span><b>${sum.banks}</b> bank${sum.banks === 1 ? '' : 's'}</span><span><b>${sum.sscs}</b> SSC${sum.sscs === 1 ? '' : 's'}</span></div>
      <div class="d-status d-status-${status[1]}"><span class="d-dot"></span>${status[0]}</div>
    </a><div class="d-card-btns"><button type="button" class="d-card-edit" data-edit="${p.id}" aria-label="Rename or move ${esc(p.name)}">Rename / move</button><button type="button" class="d-card-edit d-card-del" data-del="${p.id}" title="Delete this electrical diagram" aria-label="Delete ${esc(p.name)}">Delete</button></div></div>`;
  };
  const nextElecName = list => list.length ? 'Electrical diagram ' + (list.length + 1) : 'Electrical diagram';
  const dialog = (title, ok, extra) => rackDialog(Object.assign({ title: title, ok: ok, noun: 'Diagram', nextName: nextElecName,
    quick: () => ['Electrical diagram', 'Bank 1', 'Bank 1–3'], hint: 'For example "Electrical diagram" or "Bank 1–3".',
    nameNeeded: 'Give the diagram a name, for example Electrical diagram.', racksIn: id => elecIn(id) }, extra));

  const shown = folder ? elecIn(folder.id) : [];
  const sorted = folders.slice().sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
  shell(`
    <div class="dash">
      <div class="dash-head">
        <div>
          <a class="dash-crumb" href="${folder ? '#/electrical' : '#/app'}">← ${folder ? 'All projects' : 'Diagrams'}</a>
          <h1>${folder ? esc(folder.number) : 'Electrical diagram'}</h1>
          <p>${folder ? (folder.name ? esc(folder.name) + ' · ' : '') + `${shown.length} electrical diagram${shown.length === 1 ? '' : 's'}. A new diagram is filled in from the SSC, ACDP and MSM names confirmed on this project's racks.`
            : 'The same project folders as the wiring diagram. Open a project, or create one with its number.'}</p>
        </div>
        <div class="dash-actions">
          ${folder ? '<button class="btn-site btn-site-ghost" id="el-edit-folder">Rename project</button><button class="btn-site btn-site-ghost btn-site-danger" id="el-del-folder">Delete project</button>' : '<button class="btn-site btn-site-ghost" id="el-new-folder">New project</button>'}
          ${folder ? `<a class="btn-site btn-site-ghost" href="#/folder/${esc(folder.id)}">Racks (${racksIn(folder.id).length})</a>` : ''}
          <button class="btn-site btn-site-primary" id="el-new">New electrical diagram${folder ? ' in this project' : ''}</button>
        </div>
      </div>
      ${folder ? '' : `<ol class="dash-steps" aria-label="Workflow">
        <li><b>1</b><span>Create the diagram in its project</span></li>
        <li><b>2</b><span>Set up the banks: MSM, ACDP and SSCs, and the rack of each</span></li>
        <li><b>3</b><span>Choose the customer connections in use</span></li>
        <li><b>4</b><span>Confirm the setup; the sheets are drawn from it</span></li>
      </ol>`}
      <section class="dash-list" aria-labelledby="list-title">
        ${folder ? `<div class="dash-list-head"><h2 id="list-title">Electrical diagrams</h2><span>${shown.length}</span></div>
          ${shown.length ? `<div class="d-grid">${shown.map(elecCard).join('')}</div>` : '<div class="d-empty"><b>No electrical diagram in this project yet</b><span>Use "New electrical diagram" above.</span></div>'}`
        : `<div class="dash-list-head"><h2 id="list-title">Your projects</h2><span>${folders.length} project${folders.length === 1 ? '' : 's'}</span></div>
          ${folders.length ? `<div class="d-grid">${sorted.map(folderCard).join('')}</div>` : '<div class="d-empty"><b>No projects yet</b><span>Create one with "New electrical diagram": you will be asked for the project number.</span></div>'}`}
      </section>
    </div>`, 'dash');

  const nf = document.getElementById('el-new-folder');
  if (nf) nf.onclick = async () => {
    const list = foldersLoad();
    const f = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), number: '', name: '', created: new Date().toISOString() };
    list.push(f); foldersSave(list);
    const ok = await folderDialog(f, 0);
    const now = foldersLoad().find(x => x.id === f.id);
    if (!ok || !now || !now.number) { foldersSave(foldersLoad().filter(x => x.id !== f.id)); renderElecDashboard(); return; }
    location.hash = '#/efolder/' + f.id;
  };
  const ef = document.getElementById('el-edit-folder');
  if (ef) ef.onclick = async () => {
    if (!(await folderDialog(folder, shown.length + racksIn(folder.id).length))) return;
    if (!foldersLoad().some(x => x.id === folder.id)) location.hash = '#/electrical';
    else renderElecDashboard(folderId);
  };
  document.getElementById('el-new').onclick = async () => {
    const latest = foldersLoad().slice().sort((a, b) => String(b.created).localeCompare(String(a.created)))[0];
    const place = await dialog('New electrical diagram', 'Create', { folder: folder ? folder.id : (latest ? latest.id : '__new') });
    if (!place) return;
    const racks = place.folder ? (await localProjects()).filter(p => p.underlay_kind === 'cad' && p.folder === place.folder) : [];
    const found = elecPartsOfRacks(racks);
    const setup = found.parts.length ? elecFromRacks(found.parts, racks.map(r => r.name)) : elecNewSetup();
    if (found.unconfirmed) setup.unconfirmedParts = found.unconfirmed;
    const now = new Date().toISOString();
    const project = { name: place.name, folder: place.folder || undefined, underlay_kind: 'elec', status: 'draft', created_at: now, updated_at: now, config: { elec: setup } };
    project.id = await localAddProject(project);
    location.hash = '#/elec/' + project.id;
  };
  /* delete a project: its electrical diagrams go; its racks stay in the wiring diagram, outside any project */
  const delFolder = document.getElementById('el-del-folder');
  if (delFolder) delFolder.onclick = async () => {
    const d = elecIn(folder.id), r = racksIn(folder.id);
    const msg = `Delete project ${folder.number}?\n\n` +
      (d.length ? `Its ${d.length} electrical diagram${d.length === 1 ? '' : 's'} (${d.map(p => p.name).join(', ')}) will be deleted for good.\n` : 'It has no electrical diagram.\n') +
      (r.length ? `Its ${r.length} rack${r.length === 1 ? '' : 's'} in the wiring diagram are kept, outside any project.` : '');
    if (!confirm(msg)) return;
    try {
      for (const p of d) await localDeleteProject(p.id);
      for (const p of r) { delete p.folder; p.updated_at = new Date().toISOString(); await localPutProject(p); }
      foldersSave(foldersLoad().filter(x => x.id !== folder.id));
      toast(`Deleted project ${folder.number}.`);
      location.hash = '#/electrical';
    } catch (e) { toast('Could not delete: ' + e.message, 'error'); }
  };
  document.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
    const p = shown.find(x => x.id === +b.dataset.del);
    if (!p || !confirm(`Delete the electrical diagram "${p.name}"? Its setup and sheet edits are deleted for good.`)) return;
    try { await localDeleteProject(p.id); toast(`Deleted "${p.name}".`); renderElecDashboard(folderId); }
    catch (e) { toast('Could not delete: ' + e.message, 'error'); }
  });
  document.querySelectorAll('[data-edit]').forEach(b => b.onclick = async () => {
    const p = shown.find(x => x.id === +b.dataset.edit);
    if (!p) return;
    const got = await dialog('Rename / move electrical diagram', 'Save', { folder: p.folder || null, name: p.name, rackId: p.id });
    if (!got || !got.folder) return;
    p.name = got.name; p.folder = got.folder; p.updated_at = new Date().toISOString();
    await localPutProject(p);
    renderElecDashboard(folderId);
  });
}

/* The part library (assets/elec/parts.json, built by tools/make-elec-parts.js). */
let elecPartsCache = null;
function elecPartsLoad() {
  /* no-cache: always check for newer part drawings (port names get corrected) */
  if (!elecPartsCache) elecPartsCache = fetch('assets/elec/parts.json', { cache: 'no-cache' }).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
    .catch(e => { elecPartsCache = null; throw e; });
  return elecPartsCache;
}
/** One part view as an SVG (drawing units, Y up); with labels, every port is marked and named. */
function elecViewSvg(v, cls, labels, partId) {
  const big = Math.max(v.w, v.h), pad = big * (labels ? 0.05 : 0.03), sw = big / 600;
  const fs = big / 52;
  const marks = labels ? (v.ports || []).map(p => {
    const r = p.size / 2 * 1.15, cls2 = p.unused || elecPortBlocked(partId, p.name) ? 'unused' : p.sure ? 'sure' : 'guess';
    return `<g class="el-port el-port-${cls2}"><circle cx="${p.x}" cy="${v.h - p.y}" r="${r.toFixed(3)}"/>
      <text x="${p.x}" y="${(v.h - p.y - p.size * 0.78).toFixed(3)}" font-size="${fs.toFixed(3)}" stroke-width="${(fs * 0.28).toFixed(3)}" text-anchor="middle">${esc(p.name)}${p.sure ? '' : '?'}</text></g>`;
  }).join('') : '';
  return `<svg class="${cls || ''}" viewBox="${-pad} ${-pad} ${v.w + 2 * pad} ${v.h + 2 * pad}" role="img" aria-label="${esc(v.label)}">
    <g transform="translate(0 ${v.h}) scale(1 -1)" fill="none" stroke="currentColor" stroke-width="${sw.toFixed(3)}" stroke-linejoin="round" stroke-linecap="round">
      <path d="${v.d}"/>${v.circles.map(c => `<circle cx="${c[0]}" cy="${c[1]}" r="${c[2]}"/>`).join('')}</g>${marks ? `<g stroke-width="${(sw * 2.2).toFixed(3)}">${marks}</g>` : ''}</svg>`;
}
/** A part view, large, with its port names. */
async function elecShowPart(partId, viewId) {
  const lib = await elecPartsLoad();
  const part = lib.parts.find(p => p.id === partId), v = part && part.views.find(x => x.id === viewId);
  if (!v) return;
  const n = (v.ports || []).filter(p => !p.unused), guess = n.filter(p => !p.sure).length;
  const blocked = n.filter(p => elecPortBlocked(partId, p.name));
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `<div class="modal el-part-modal" role="dialog" aria-label="${esc(v.label)}">
    <div class="el-card-head"><h3>${esc(v.label)}</h3><button class="btn btn-ghost btn-sm" data-x>Close</button></div>
    <p class="muted small">${n.length ? `${n.length} ports. ${guess ? `<b class="el-guess-key">${guess} amber names (with ?)</b> are proposed by position and need confirming${guess < n.length ? '; the rest are certain (pin count, AYK DWG2527 order, or confirmed by AYK)' : ''}.` : 'All names are confirmed.'}` : 'No ports are named on this view: it is only drawn.'}${(v.ports || []).some(p => p.unused) || blocked.length ? ' Grey: not used on the diagram' + (blocked.length ? ' (' + Array.from(new Set(blocked.map(p => elecPortBlockedWhy(partId, p.name)))).map(why => `${blocked.filter(p => elecPortBlockedWhy(partId, p.name) === why).map(p => esc(p.name)).join(', ')}: ${esc(why.replace(/\.$/, ''))}`).join('; ') + ')' : '') + '.' : ''}</p>
    <div class="el-part-big">${elecViewSvg(v, '', true, partId)}</div></div>`;
  document.body.appendChild(back);
  const close = () => { back.remove(); document.removeEventListener('keydown', key); };
  const key = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  back.onclick = e => { if (e.target === back || e.target.closest('[data-x]')) close(); };
}
async function elecPartsInto(el) {
  if (!el) return;
  try {
    if (elecPartsInto.html) { el.innerHTML = elecPartsInto.html; return; }
    const lib = await elecPartsLoad();
    el.innerHTML = elecPartsInto.html = lib.parts.filter(p => ELEC_PARTS.includes(p.id)).flatMap(p => p.views.map(v =>
      `<button type="button" class="el-part" data-part="${esc(p.id)}" data-view="${esc(v.id)}" title="Open with port names">${elecViewSvg(v)}<span>${esc(v.label)}${(v.ports || []).length ? ` · ${(v.ports || []).filter(q => !q.unused).length} ports` : ''}</span></button>`)).join('');
  } catch (e) { el.innerHTML = `<span class="warn small">Could not load the part drawings (${esc(e.message)}).</span>`; return; }
  el.querySelectorAll('[data-part]').forEach(b => b.onclick = () => elecShowPart(b.dataset.part, b.dataset.view));
}

/* ================= ELECTRICAL DIAGRAM: SHEET EDITOR =================
 * Every sheet as it will print, one at a time, before the PDF. The engineer can drag any
 * label, note, tag or connector label; pull a lead's segment sideways (a lead's end segment
 * steps aside, keeping a short stub in its port); change words; delete things and bring
 * them back; add notes, tags and text. Edits are kept per sheet in setup.edits and drawn by
 * the same code that writes the PDF, so the export is exactly what is on screen.
 * Exporting the PDF is the last step, from here. */
function elecSheetInfoOf(setup, folder) {
  const i = setup.sheetInfo = Object.assign({ docNumber: '', rev: '0', drawnBy: '', checkedBy: '', state: 'Issued for Review', note: 'Initial Released' }, setup.sheetInfo || {});
  const d = new Date();
  return Object.assign({}, i, {
    title: `${folder ? folder.number + ' ' : ''}Battery System Electrical Connection Diagram`,
    date: d.getFullYear() + '.' + String(d.getMonth() + 1).padStart(2, '0') + '.' + String(d.getDate()).padStart(2, '0'),
  });
}

async function renderElecSheetsPage(id) {
  shell('<div class="loading">Opening the sheets…</div>', 'dash');
  const project = await localProject(id).catch(() => null);
  const back = `<a class="btn btn-primary" href="#/elec/${id}">Back to the setup</a>`;
  if (!project || project.underlay_kind !== 'elec') { shell(`<div class="empty"><h3>Diagram not found</h3>${back}</div>`, 'dash'); return; }
  const setup = project.config && project.config.elec;
  if (!setup || !setup.confirmed) { shell(`<div class="empty"><h3>Confirm the setup first</h3><p>The sheets are drawn from the confirmed setup.</p>${back}</div>`, 'dash'); return; }
  let lib;
  try { lib = await elecPartsLoad(); } catch (e) { shell(`<div class="empty"><h3>Could not load the part drawings</h3><p>${esc(e.message)}</p>${back}</div>`, 'dash'); return; }
  const folder = rackFolder(project);
  const logo = await sheetLogo().catch(() => null);
  const info = () => Object.assign(elecSheetInfoOf(setup, folder), { logo: logo });
  const sheets = elecSheets(setup);
  const start = Math.max(1, Math.min(sheets.length, +(new URLSearchParams(location.hash.split('?')[1] || '').get('sheet')) || 1));
  let cur = start, sel = null, zoom = 1;
  setup.edits = setup.edits || {};
  const F = setup.sheetInfo || {};
  const field = (k, label, ph) => `<label class="sh-field"><span>${label}</span><input type="text" data-sf="${k}" value="${esc(F[k] || '')}" placeholder="${ph}" maxlength="60"></label>`;

  shell(`
    <div class="cad-page sh-page el-ed">
      <header class="cad-head">
        <a class="back" href="#/elec/${id}">← Setup</a>
        <h1>${esc(project.name)} · sheets</h1>
        <span class="chip">A3 · ${sheets.length} sheets</span>
        <div class="cad-tools">
          <button class="btn btn-ghost btn-sm" id="ed-prev" title="Previous sheet (Left arrow or Page Up)">‹</button>
          <select id="ed-sheet" aria-label="Sheet">${sheets.map(s => `<option value="${s.n}">Sheet ${s.n} · ${esc(s.title)}</option>`).join('')}</select>
          <button class="btn btn-ghost btn-sm" id="ed-next" title="Next sheet (Right arrow or Page Down)">›</button>
          <button class="btn btn-ghost btn-sm" id="ed-undo" title="Undo (Ctrl+Z)" disabled>Undo</button>
          <button class="btn btn-ghost btn-sm" id="sh-zoom-out" title="Zoom out">−</button>
          <button class="btn btn-ghost btn-sm" id="sh-zoom-fit" title="Fit the sheet (key 0). The mouse wheel zooms at the pointer; drag empty paper to move around.">Fit</button>
          <button class="btn btn-ghost btn-sm" id="sh-zoom-in" title="Zoom in">+</button>
          <button class="btn btn-primary btn-sm" id="ed-pdf" title="The last step: every sheet, as you see them here, in one A3 PDF">Export PDF</button>
        </div>
      </header>
      <div class="sh-body">
        <div class="sh-stage" id="sh-stage"><div class="sh-paper" id="sh-paper"><svg id="sh-svg" viewBox="0 0 ${ELEC_A3.w} ${ELEC_A3.h}" xmlns="http://www.w3.org/2000/svg"><g id="sh-g" transform="translate(0 ${ELEC_A3.h}) scale(1 -1)"></g></svg></div></div>
        <div class="wf-split" role="separator" aria-orientation="vertical" aria-label="Drag to resize the side panel" tabindex="0"></div>
        <aside class="cad-info sh-side">
          <section>
            <h3>Check and edit</h3>
            <p class="muted small">This is the sheet exactly as it will print. <b>Drag</b> a label, note or tag to move it · <b>pull a lead</b> sideways to re-route it (pull its first or last part to step it aside) · <b>Box</b> / <b>Line</b> draw dashed boxes and lines (round two inline connectors and point them to one note) · <b>click</b> anything to change its words or delete it (<b>Delete</b> key) · arrow keys nudge (Shift: 5 mm) · <b>Ctrl+Z</b> undoes. Mouse wheel zooms; drag empty paper to move around.</p>
          </section>
          <section id="ed-sel-box">
            <h3>Selected</h3>
            <div id="ed-sel"><p class="muted small">Nothing selected. Click a label, note, tag or lead.</p></div>
          </section>
          <section>
            <h3>Add to this sheet</h3>
            <div class="ed-add">
              <button class="btn btn-ghost btn-sm" data-add="note">Note</button>
              <button class="btn btn-ghost btn-sm" data-add="tag">Tag</button>
              <button class="btn btn-ghost btn-sm" data-add="text">Text</button>
              <button class="btn btn-ghost btn-sm" data-tool="box" title="Drag on the sheet to draw a dashed box (round inline connectors, a group of parts)">Box</button>
              <button class="btn btn-ghost btn-sm" data-tool="line" title="Drag on the sheet to draw a dashed line (from a box to a note). Shift keeps it straight across or down">Line</button>
            </div>
            <p class="muted small" id="ed-tool-hint"></p>
          </section>
          <section>
            <h3>This sheet</h3>
            <div id="ed-hidden"></div>
            <button class="btn btn-ghost btn-sm" id="ed-reset">Undo every edit on this sheet</button>
          </section>
          <section>
            <h3>Title block</h3>
            ${field('docNumber', 'Document no.', 'DWG2527')}${field('rev', 'Rev', '0')}${field('drawnBy', 'Drawn by', 'Name')}
            ${field('checkedBy', 'Checked by', 'Name')}${field('state', 'State', 'Issued for Review')}${field('note', 'Note', 'Initial Released')}
          </section>
          <p class="small" id="sh-status" role="status"></p>
        </aside>
      </div>
    </div>`, 'dash');

  const $ = q => document.getElementById(q);
  const say = (m, k) => { $('sh-status').textContent = m || ''; $('sh-status').className = 'small ' + (k || ''); };
  let saving = Promise.resolve();
  const save = () => {
    project.updated_at = new Date().toISOString();
    const copy = JSON.parse(JSON.stringify(project));
    saving = saving.then(() => localPutProject(copy)).catch(e => say('Could not save: ' + e.message, 'warn'));
  };
  /* undo: the edits and notes as they were before each change */
  const history = [];
  const remember = () => { history.push(JSON.stringify({ edits: setup.edits, notes: setup.notes || {} })); if (history.length > 200) history.shift(); $('ed-undo').disabled = false; };
  const undo = () => {
    const h = history.pop();
    if (!h) return;
    const o = JSON.parse(h); setup.edits = o.edits; setup.notes = o.notes;
    $('ed-undo').disabled = !history.length;
    save(); render(); showSel();
  };
  const sheet = () => sheets.find(s => s.n === cur);
  const key = () => elecSheetKey(sheet());
  const ed = make => { const k = key(); if (!setup.edits[k] && make) setup.edits[k] = {}; return setup.edits[k] || {}; };
  const edPart = (part) => { const e = ed(true); return e[part] = e[part] || (part === 'add' ? [] : {}); };
  const tidy = () => { const e = setup.edits[key()]; if (!e) return; for (const k of Object.keys(e)) if (!Object.keys(e[k]).length) delete e[k]; if (!Object.keys(e).length) delete setup.edits[key()]; };
  const cssId = s => (window.CSS && CSS.escape ? CSS.escape(s) : s.replace(/["\\]/g, '\\/* ================= ELECTRICAL DIAGRAM: SYSTEM SETUP ================='));

  function render() {
    const svg = sheetSvgTarget();
    elecDraw(svg, setup, lib, info(), { only: cur, interactive: true });
    $('sh-g').innerHTML = svg.svg();
    $('ed-sheet').value = String(cur);
    $('ed-prev').disabled = cur <= 1; $('ed-next').disabled = cur >= sheets.length;
    markSel();
    listHidden();
    /* leads crossing each other: with the engineer's edits, against the sheet as drawn */
    const n = crossings(setup.edits), planned = plannedCross[cur] != null ? plannedCross[cur] : (plannedCross[cur] = crossings({}));
    say(n > planned ? `Your edits make leads cross: ${n} crossing${n === 1 ? '' : 's'} on this sheet, ${planned} as drawn.` : n ? `${n} lead crossing${n === 1 ? '' : 's'} on this sheet, as drawn (DWG2527 has it too).` : 'No leads cross on this sheet.', n > planned ? 'warn' : 'cad-ok');
  }
  const plannedCross = {};
  function crossings(edits) {
    const segs = [], keep = setup.edits;
    const rec = { newPage() { return rec; }, rect() { return rec; }, circle() { return rec; }, text() { return rec; }, image() { return rec; },
      line(a, b, c, d, o) { return rec.poly([a, b, c, d], o); },
      poly(p, o) { if (o && o.id && !/^customer:/.test(o.id)) { const q = Array.isArray(p[0]) ? p.flat() : p, r = []; for (let i = 0; i + 3 < q.length; i += 2) r.push(q.slice(i, i + 4)); segs.push(r); } return rec; } };
    setup.edits = edits;
    try { elecDraw(rec, setup, lib, info(), { only: cur }); } finally { setup.edits = keep; }
    const cross = (a, b) => { const v = Math.abs(a[0] - a[2]) < 1e-6, w = Math.abs(b[0] - b[2]) < 1e-6; if (v === w) return false; const [V, Hh] = v ? [a, b] : [b, a];
      const e = 0.01; return V[0] > Math.min(Hh[0], Hh[2]) + e && V[0] < Math.max(Hh[0], Hh[2]) - e && Hh[1] > Math.min(V[1], V[3]) + e && Hh[1] < Math.max(V[1], V[3]) - e; };
    let n = 0;
    for (let i = 0; i < segs.length; i++) for (let j = i + 1; j < segs.length; j++) for (const a of segs[i]) for (const b of segs[j]) if (cross(a, b)) n++;
    return n;
  }
  function markSel() {
    $('sh-g').querySelectorAll('.el-sel').forEach(e => e.classList.remove('el-sel'));
    if (sel) $('sh-g').querySelectorAll(`[data-id="${cssId(sel.id)}"]`).forEach(e => e.classList.add('el-sel'));
  }
  const KIND = { 'added-box': 'Your box', 'added-line': 'Your line', tag: 'Tag', note: 'AYK note', box: 'Label', end: 'Inline connector (lead end)', label: 'Lead label', lead: 'Lead', figure: 'Figure 1', legend: 'Cable legend', group: 'Inline connector', 'added-note': 'Your note', 'added-tag': 'Your tag', 'added-text': 'Your text' };
  const added = id => (ed(false).add || []).find(a => a.id === id);
  const shiftAdded = (a, dx, dy) => { if (a.pts) for (let i = 0; i < a.pts.length; i += 2) { a.pts[i] += dx; a.pts[i + 1] += dy; } else { a.x += dx; a.y += dy; } };
  const r2 = v => Math.round(v * 100) / 100;
  /* drawing tools: drag on the sheet to draw a box or a line */
  let tool = null;
  const setTool = t => {
    tool = tool === t ? null : t;
    document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('btn-primary', b.dataset.tool === tool));
    $('ed-tool-hint').textContent = tool === 'box' ? 'Drag on the sheet to draw the box. Esc to stop.' : tool === 'line' ? 'Drag on the sheet from where the line starts to where it ends (Shift: straight across or down). Esc to stop.' : '';
    svgEl.style.cursor = tool ? 'crosshair' : '';
  };
  const STYLES = [['dashed', 'Dashed'], ['dotted', 'Dotted'], ['solid', 'Solid']];
  const COLOURS = [['#7c3aed', 'Purple'], ['#111827', 'Black'], ['#e11d1d', 'Red'], ['#0ea5e9', 'Blue'], ['#16a34a', 'Green'], ['#f2b600', 'Yellow'], ['#22d3ee', 'Cyan']];
  /* the selected item's panel: its words, delete, put back */
  function showSel() {
    const box = $('ed-sel');
    if (!sel) { box.innerHTML = '<p class="muted small">Nothing selected. Click a label, note, tag or lead.</p>'; return; }
    const e = ed(false), a = added(sel.id);
    const noteId = /^note:/.test(sel.id) ? sel.id.slice(5) : null;
    const text = a ? a.text : noteId ? elecNote(setup, noteId) : sel.text;
    const shape = a && (a.kind === 'box' || a.kind === 'line');
    const wordy = (a && !shape) || noteId || ['tag', 'box', 'label'].includes(sel.kind);
    const moved = (e.move && e.move[sel.id]) || (e.path && e.path[sel.id]) || (e.text && Object.prototype.hasOwnProperty.call(e.text, sel.id));
    box.innerHTML = `<p class="small"><b>${esc(KIND[sel.kind] || sel.kind)}</b>${noteId ? ' <span class="muted">(changes this note on every sheet)</span>' : ''}</p>
      ${shape ? `<div class="ed-shape">
        <label>Style<select id="ed-style">${STYLES.map(([v, l]) => `<option value="${v}" ${(a.style || 'dashed') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label>Colour<select id="ed-colour">${COLOURS.map(([v, l]) => `<option value="${v}" ${(a.color || '#7c3aed') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        ${a.kind === 'box' ? `<label>Width<input id="ed-w" type="number" min="2" step="0.5" value="${a.w}"></label><label>Height<input id="ed-h" type="number" min="2" step="0.5" value="${a.h}"></label>` : ''}
      </div><p class="muted small">${a.kind === 'box' ? 'Drag a corner to resize it, the edge to move it.' : 'Drag an end to move that end, the middle to move the line.'}</p>` : ''}
      ${wordy ? `<textarea id="ed-text" rows="${Math.min(12, Math.max(2, Math.ceil(String(text || '').length / 48)))}">${esc(text || '')}</textarea>` : ''}
      <div class="ed-sel-btns">
        <button class="btn btn-ghost btn-sm" id="ed-del">Delete</button>
        ${!a && moved ? '<button class="btn btn-ghost btn-sm" id="ed-back">Put back as drawn</button>' : ''}
        ${noteId && setup.notes && typeof setup.notes[noteId] === 'string' ? '<button class="btn btn-ghost btn-sm" id="ed-ayk">Back to AYK\'s text</button>' : ''}
      </div>`;
    const ta = $('ed-text');
    if (ta) ta.onchange = () => {
      remember();
      if (a) a.text = ta.value;
      else if (noteId) { setup.notes = setup.notes || {}; const n = ELEC_NOTES.find(x => x.id === noteId); if (n && ta.value === n.text) delete setup.notes[noteId]; else setup.notes[noteId] = ta.value; }
      else if (ta.value === sel.text && !(e.text && sel.id in e.text)) return;
      else edPart('text')[sel.id] = ta.value;
      save(); render();
    };
    if (shape) {
      const upd = f => () => { remember(); f(); save(); render(); };
      $('ed-style').onchange = upd(() => { a.style = $('ed-style').value; });
      $('ed-colour').onchange = upd(() => { a.color = $('ed-colour').value; });
      if ($('ed-w')) {
        $('ed-w').onchange = upd(() => { const v = +$('ed-w').value; if (v >= 2) a.w = r2(v); });
        $('ed-h').onchange = upd(() => { const v = +$('ed-h').value; if (v >= 2) { a.y = r2(a.y + a.h - v); a.h = r2(v); } });
      }
    }
    $('ed-del').onclick = del;
    if ($('ed-back')) $('ed-back').onclick = () => {
      remember();
      const x = ed(false);
      for (const k of ['move', 'path', 'text']) if (x[k]) delete x[k][sel.id];
      tidy(); save(); render(); showSel();
    };
    if ($('ed-ayk')) $('ed-ayk').onclick = () => { remember(); delete setup.notes[noteId]; save(); render(); showSel(); };
  }
  function del() {
    if (!sel) return;
    remember();
    const e = ed(true);
    if (/^add:/.test(sel.id)) e.add = (e.add || []).filter(a => a.id !== sel.id);
    else {
      const h = edPart('hide');
      h[sel.id] = true;
      /* a lead goes with the label at its end */
      const end = sel.kind === 'lead' && $('sh-g').querySelector(`[data-id="${cssId(sel.id)}"][data-end]`);
      if (end && end.dataset.end) { h[end.dataset.end] = true; h[end.dataset.end.replace(/^end:/, 'label:')] = true; }
    }
    tidy(); sel = null; save(); render(); showSel();
  }
  /* deleted items on this sheet, each can come back */
  function listHidden() {
    const h = Object.keys(ed(false).hide || {});
    const name = id => id.replace(/^(tag|box|end|label|note|lead|customer|fan|bus|lp16|inline):/, '').replace(/#\d+$/, '');
    $('ed-hidden').innerHTML = h.length ? `<p class="small">${h.length} deleted:</p><ul class="ed-hidden">${h.map(id => `<li><span>${esc(name(id)).slice(0, 60)}</span><button class="btn btn-ghost btn-xs" data-unhide="${esc(id)}">Bring back</button></li>`).join('')}</ul>` : '<p class="muted small">Nothing deleted on this sheet.</p>';
    $('ed-hidden').querySelectorAll('[data-unhide]').forEach(b => b.onclick = () => { remember(); delete ed(false).hide[b.dataset.unhide]; tidy(); save(); render(); });
  }

  /* ---- zoom and pan (as the wiring sheet) ---- */
  const ZOOM_MAX = 40, W = ELEC_A3.w, H = ELEC_A3.h;
  function applyZoom(at) {
    const stage = $('sh-stage'), paper = $('sh-paper');
    if (!stage) return;
    const fit = Math.min((stage.clientWidth - 24) / W, (stage.clientHeight - 24) / H);
    const pxmm = Math.max(0.5, fit * zoom);
    paper.style.width = W * pxmm + 'px'; paper.style.height = H * pxmm + 'px';
    paper.style.marginTop = Math.max(0, (stage.clientHeight - 24 - H * pxmm) / 2) + 'px';
    if (at) { const pr = paper.getBoundingClientRect(); stage.scrollLeft += (pr.left + at[0] * pxmm) - at[2]; stage.scrollTop += (pr.top + at[1] * pxmm) - at[3]; }
    $('sh-zoom-fit').textContent = zoom === 1 ? 'Fit' : Math.round(zoom * 100) + '%';
  }
  const pxPerMm = () => $('sh-paper').getBoundingClientRect().width / W;
  const sheetAt = (cx, cy) => { const pr = $('sh-paper').getBoundingClientRect(), k = pr.width / W; return [(cx - pr.left) / k, (cy - pr.top) / k, cx, cy]; };
  const stageMid = () => { const r = $('sh-stage').getBoundingClientRect(); return sheetAt(r.left + r.width / 2, r.top + r.height / 2); };
  const zoomTo = (z, at) => { zoom = Math.max(0.6, Math.min(ZOOM_MAX, z)); applyZoom(at || stageMid()); };
  $('sh-zoom-in').onclick = () => zoomTo(zoom * 1.5);
  $('sh-zoom-out').onclick = () => zoomTo(zoom / 1.5);
  $('sh-zoom-fit').onclick = () => { zoom = 1; applyZoom(); $('sh-stage').scrollTo(0, 0); };
  $('sh-stage').addEventListener('wheel', ev => {
    if (ev.shiftKey) return;
    ev.preventDefault();
    const dy = Math.max(-60, Math.min(60, ev.deltaY * (ev.deltaMode === 1 ? 16 : 1)));
    zoomTo(zoom * Math.exp(-dy * 0.004), sheetAt(ev.clientX, ev.clientY));
  }, { passive: false });

  /* ---- sheets ---- */
  const go = n => { if (n < 1 || n > sheets.length || n === cur) return; cur = n; sel = null; showSel(); render(); history.length = history.length; };
  $('ed-sheet').onchange = e => go(+e.target.value);
  $('ed-prev').onclick = () => go(cur - 1);
  $('ed-next').onclick = () => go(cur + 1);
  $('ed-undo').onclick = undo;
  $('ed-reset').onclick = () => {
    if (!setup.edits[key()]) { say('Nothing edited on this sheet.'); return; }
    if (!confirm('Undo every edit on this sheet (moves, routes, words, deletions and added items)?')) return;
    remember(); delete setup.edits[key()]; sel = null; save(); render(); showSel();
  };
  document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
  document.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
    remember();
    const m = stageMid(), x = Math.max(20, Math.min(W - 80, m[0] - 20)), y = Math.max(20, Math.min(H - 20, H - m[1]));
    const kind = b.dataset.add;
    const a = { id: 'add:' + Date.now().toString(36), kind: kind, text: kind === 'note' ? 'New note' : kind === 'tag' ? 'New tag' : 'New text', x: x, y: y, w: 60 };
    edPart('add').push(a);
    save(); sel = { id: a.id, kind: 'added-' + kind, text: a.text }; render(); showSel();
    const ta = $('ed-text'); if (ta) { ta.focus(); ta.select(); }
  });
  document.querySelector('.sh-side').addEventListener('change', e => {
    const t = e.target;
    if (!t.dataset.sf) return;
    setup.sheetInfo = setup.sheetInfo || {};
    setup.sheetInfo[t.dataset.sf] = t.value.trim();
    save(); render();
  });
  $('ed-pdf').onclick = async ev => {
    const btn = ev.currentTarget;
    btn.disabled = true; btn.textContent = 'Building the PDF…';
    try {
      const i = info();
      const bytes = await elecPdf(setup, lib, i);
      download(`${i.docNumber ? i.docNumber + ' ' : ''}${i.title}.pdf`.replace(/[\\/:*?"<>|]+/g, '-'), bytes, 'application/pdf');
      toast(`Exported ${sheets.length} sheets.`);
    } catch (e) {
      console.error('Electrical PDF failed', e);
      toast('Could not build the PDF: ' + e.message, 'error');
    } finally { btn.disabled = false; btn.textContent = 'Export PDF'; }
  };

  /* ---- pointer: select, move items, pull leads, pan ---- */
  const svgEl = $('sh-svg');
  let drag = null;
  const ptsOf = el => el.getAttribute('points').trim().split(/\s+/).map(p => p.split(',').map(Number));
  const setPts = (id, P) => { const s = P.map(p => p[0].toFixed(3) + ',' + p[1].toFixed(3)).join(' '); $('sh-g').querySelectorAll(`polyline[data-id="${cssId(id)}"]`).forEach(e => e.setAttribute('points', s)); };
  /* the lead segment nearest the pointer (sheet mm, y up) */
  const nearestSeg = (P, x, y) => {
    let best = 0, bd = Infinity;
    for (let i = 0; i + 1 < P.length; i++) {
      const [ax, ay] = P[i], [bx, by] = P[i + 1], dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy;
      const t = L ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L)) : 0;
      const d = Math.hypot(ax + t * dx - x, ay + t * dy - y);
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  /* a lead end segment steps aside: a 2 mm stub stays in the port (or at the label) */
  const withStubs = (P, i) => {
    const stub = (from, to) => { const L = Math.hypot(to[0] - from[0], to[1] - from[1]) || 1, s = Math.min(2, L / 3); return [from[0] + (to[0] - from[0]) / L * s, from[1] + (to[1] - from[1]) / L * s]; };
    let Q = P.map(p => p.slice()), k = i;
    if (k === Q.length - 2) { const s = stub(Q[k + 1], Q[k]); Q.splice(k + 1, 0, s.slice(), s.slice()); }
    if (k === 0) { const s = stub(Q[0], Q[1]); Q.splice(1, 0, s.slice(), s.slice()); k = 2; }
    return { Q: Q, k: k };
  };
  const clean = P => {
    const out = [];
    for (const p of P) { const q = out[out.length - 1]; if (!q || Math.hypot(q[0] - p[0], q[1] - p[1]) > 1e-3) out.push(p); }
    for (let i = out.length - 2; i > 0; i--) { const [a, b, c] = [out[i - 1], out[i], out[i + 1]]; if (Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])) < 1e-6) out.splice(i, 1); }
    return out;
  };
  svgEl.addEventListener('pointerdown', ev => {
    if (ev.button !== 0) return;
    const at = sheetAt(ev.clientX, ev.clientY), mx = at[0], my = H - at[1];
    const leadEl = ev.target.closest('polyline[data-id]');
    const item = ev.target.closest('g.el-item');
    const snapP = v => Math.round(v * 2) / 2;
    if (tool) {
      /* draw a box or a line: a dashed preview follows the pointer */
      const pv = document.createElementNS('http://www.w3.org/2000/svg', tool === 'box' ? 'rect' : 'polyline');
      pv.setAttribute('class', 'ed-preview');
      $('sh-g').appendChild(pv);
      drag = { type: 'draw', tool: tool, p0: [snapP(mx), snapP(my)], pv: pv, x0: ev.clientX, y0: ev.clientY, moved: false };
      try { svgEl.setPointerCapture(ev.pointerId); } catch (e) {}
      return;
    }
    const ad = item && added(item.dataset.id);
    if (ad && (ad.kind === 'box' || ad.kind === 'line')) {
      const near = (x, y) => Math.hypot(x - mx, y - my) < Math.max(1.5, 6 / pxPerMm());
      let grip = -1;
      if (ad.kind === 'line') { for (let i = 0; i < ad.pts.length; i += 2) if (near(ad.pts[i], ad.pts[i + 1])) grip = i; }
      else [[ad.x, ad.y], [ad.x + ad.w, ad.y], [ad.x, ad.y + ad.h], [ad.x + ad.w, ad.y + ad.h]].forEach((c, i) => { if (grip < 0 && near(c[0], c[1])) grip = i; });
      if (grip >= 0) {
        sel = { id: ad.id, kind: 'added-' + ad.kind }; markSel(); showSel();
        drag = { type: 'grip', a: ad, grip: grip, start: JSON.parse(JSON.stringify(ad)), x0: ev.clientX, y0: ev.clientY, moved: false };
        try { svgEl.setPointerCapture(ev.pointerId); } catch (e) {}
        return;
      }
    }
    if (leadEl && (leadEl.classList.contains('sh-hit') || leadEl.dataset.kind === 'lead')) {
      const id = leadEl.dataset.id;
      sel = { id: id, kind: 'lead' }; markSel(); showSel();
      const P = ptsOf(leadEl), i = nearestSeg(P, mx, my);
      const { Q, k } = withStubs(P, i);
      const horiz = Math.abs(Q[k][1] - Q[k + 1][1]) < 1e-6;
      drag = { type: 'seg', id: id, Q: Q, k: k, horiz: horiz, x0: ev.clientX, y0: ev.clientY, moved: false };
    } else if (item) {
      const id = item.dataset.id;
      sel = { id: id, kind: item.dataset.kind, text: item.dataset.text }; markSel(); showSel();
      drag = { type: 'item', id: id, x0: ev.clientX, y0: ev.clientY, moved: false };
    } else {
      if (sel) { sel = null; markSel(); showSel(); }
      const st = $('sh-stage');
      drag = { type: 'pan', x0: ev.clientX, y0: ev.clientY, sl: st.scrollLeft, stp: st.scrollTop };
      svgEl.classList.add('sh-panning');
    }
    try { svgEl.setPointerCapture(ev.pointerId); } catch (e) {}
  });
  svgEl.addEventListener('pointermove', ev => {
    if (!drag) return;
    const k = pxPerMm(), dx = (ev.clientX - drag.x0) / k, dy = -(ev.clientY - drag.y0) / k;
    if (drag.type === 'pan') { const st = $('sh-stage'); st.scrollLeft = drag.sl - (ev.clientX - drag.x0); st.scrollTop = drag.stp - (ev.clientY - drag.y0); return; }
    if (!drag.moved && Math.hypot(ev.clientX - drag.x0, ev.clientY - drag.y0) < 3) return;
    drag.moved = true;
    const snap = v => Math.round(v * 2) / 2;
    if (drag.type === 'draw') {
      const at = sheetAt(ev.clientX, ev.clientY);
      let p1 = [snap(at[0]), snap(H - at[1])];
      const [x0, y0] = drag.p0;
      if (drag.tool === 'line' && ev.shiftKey) { if (Math.abs(p1[0] - x0) > Math.abs(p1[1] - y0)) p1[1] = y0; else p1[0] = x0; }
      drag.p1 = p1;
      if (drag.tool === 'box') {
        drag.pv.setAttribute('x', Math.min(x0, p1[0])); drag.pv.setAttribute('y', Math.min(y0, p1[1]));
        drag.pv.setAttribute('width', Math.abs(p1[0] - x0)); drag.pv.setAttribute('height', Math.abs(p1[1] - y0));
      } else drag.pv.setAttribute('points', `${x0},${y0} ${p1[0]},${p1[1]}`);
      return;
    }
    if (drag.type === 'grip') {
      const a = drag.a, s0 = drag.start, ddx = snap(dx), ddy = snap(dy);
      const g = $('sh-g').querySelector(`g.el-item[data-id="${cssId(a.id)}"]`);
      if (a.kind === 'line') {
        a.pts = s0.pts.slice(); a.pts[drag.grip] += ddx; a.pts[drag.grip + 1] += ddy;
        if (ev.shiftKey) { const o = drag.grip ? 0 : 2; if (Math.abs(a.pts[drag.grip] - a.pts[o]) > Math.abs(a.pts[drag.grip + 1] - a.pts[o + 1])) a.pts[drag.grip + 1] = a.pts[o + 1]; else a.pts[drag.grip] = a.pts[o]; }
        if (g) g.querySelectorAll('polyline').forEach(e => e.setAttribute('points', `${a.pts[0]},${a.pts[1]} ${a.pts[2]},${a.pts[3]}`));
      } else {
        const left = drag.grip % 2 === 0, bottom = drag.grip < 2;
        let x0 = s0.x, x1 = s0.x + s0.w, y0 = s0.y, y1 = s0.y + s0.h;
        if (left) x0 += ddx; else x1 += ddx;
        if (bottom) y0 += ddy; else y1 += ddy;
        a.x = Math.min(x0, x1); a.w = Math.max(2, Math.abs(x1 - x0)); a.y = Math.min(y0, y1); a.h = Math.max(2, Math.abs(y1 - y0));
        if (g) g.querySelectorAll('rect').forEach(e => { e.setAttribute('x', a.x); e.setAttribute('y', a.y); e.setAttribute('width', a.w); e.setAttribute('height', a.h); });
      }
      return;
    }
    if (drag.type === 'item') {
      drag.dx = snap(dx); drag.dy = snap(dy);
      $('sh-g').querySelectorAll(`g.el-item[data-id="${cssId(drag.id)}"]`).forEach(g => g.setAttribute('transform', `translate(${drag.dx} ${drag.dy})`));
    } else if (drag.type === 'seg') {
      const Q = drag.Q.map(p => p.slice()), d = drag.horiz ? snap(dy) : snap(dx);
      for (const j of [drag.k, drag.k + 1]) { if (drag.horiz) Q[j][1] += d; else Q[j][0] += d; }
      drag.now = Q;
      setPts(drag.id, Q);
    }
  });
  const end = () => {
    if (!drag) return;
    const d = drag; drag = null;
    svgEl.classList.remove('sh-panning');
    if (d.type === 'draw') {
      d.pv.remove();
      const p1 = d.p1, p0 = d.p0;
      if (!d.moved || !p1 || Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) < 1.5) return;
      remember();
      const id = 'add:' + Date.now().toString(36);
      const shape = d.tool === 'box'
        ? { id: id, kind: 'box', x: Math.min(p0[0], p1[0]), y: Math.min(p0[1], p1[1]), w: Math.max(2, Math.abs(p1[0] - p0[0])), h: Math.max(2, Math.abs(p1[1] - p0[1])), style: 'dashed', color: '#7c3aed' }
        : { id: id, kind: 'line', pts: [p0[0], p0[1], p1[0], p1[1]], style: 'dashed', color: '#7c3aed' };
      edPart('add').push(shape);
      sel = { id: id, kind: 'added-' + shape.kind };
      setTool(tool);                       /* one shape per pick of the tool */
      save(); render(); showSel();
      return;
    }
    if (d.type === 'grip') {
      if (!d.moved) return;
      const now = JSON.parse(JSON.stringify(d.a));
      Object.assign(d.a, d.start);          /* undo keeps the state before the drag */
      remember();
      Object.assign(d.a, now);
      save(); render(); showSel();
      return;
    }
    if (!d.moved || d.type === 'pan') return;
    remember();
    if (d.type === 'item') {
      const a = added(d.id);
      if (a) shiftAdded(a, d.dx, d.dy);
      else {
        const m = edPart('move'), o = m[d.id] || [0, 0];
        m[d.id] = [o[0] + d.dx, o[1] + d.dy];
        /* a lead label moved: a lead that was re-routed by hand keeps meeting it */
        const lead = $('sh-g').querySelector(`polyline[data-end="${cssId(d.id)}"]`);
        const path = lead && ed(false).path && ed(false).path[lead.dataset.id];
        if (path) {
          const n = path.length;
          if (n >= 4 && Math.abs(path[n - 4] - path[n - 2]) < 1e-6) path[n - 4] += d.dx;
          path[n - 2] += d.dx; path[n - 1] += d.dy;
        }
      }
    } else if (d.type === 'seg' && d.now) {
      edPart('path')[d.id] = clean(d.now).flat().map(v => Math.round(v * 1000) / 1000);
    }
    save(); render();
  };
  svgEl.addEventListener('pointerup', end);
  svgEl.addEventListener('pointercancel', end);
  svgEl.addEventListener('dblclick', () => { const ta = $('ed-text'); if (ta) { ta.focus(); ta.select(); } });

  /* ---- keys ---- */
  const keys = ev => {
    if (!$('sh-stage')) { document.removeEventListener('keydown', keys); return; }
    if (/INPUT|TEXTAREA|SELECT/.test((ev.target && ev.target.tagName) || '')) return;
    if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'z') { ev.preventDefault(); undo(); return; }
    if (ev.ctrlKey || ev.metaKey) return;
    if (ev.key === 'Delete' || ev.key === 'Backspace') { if (sel) { ev.preventDefault(); del(); } return; }
    if (ev.key === 'Escape') { if (tool) { setTool(tool); return; } sel = null; markSel(); showSel(); return; }
    if (ev.key === 'PageUp') { ev.preventDefault(); go(cur - 1); return; }
    if (ev.key === 'PageDown') { ev.preventDefault(); go(cur + 1); return; }
    /* left / right arrows change the sheet when nothing is selected (with a selection they move it) */
    if (!sel && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) { ev.preventDefault(); go(cur + (ev.key === 'ArrowLeft' ? -1 : 1)); return; }
    if (ev.key === '+' || ev.key === '=') { zoomTo(zoom * 1.5); return; }
    if (ev.key === '-') { zoomTo(zoom / 1.5); return; }
    if (ev.key === '0') { $('sh-zoom-fit').onclick(); return; }
    const step = ev.shiftKey ? 5 : 0.5;
    const dir = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[ev.key];
    if (dir && sel && sel.kind !== 'lead') {
      ev.preventDefault();
      remember();
      const a = added(sel.id);
      if (a) shiftAdded(a, dir[0], dir[1]);
      else { const m = edPart('move'), o = m[sel.id] || [0, 0]; m[sel.id] = [o[0] + dir[0], o[1] + dir[1]]; }
      save(); render();
    }
  };
  document.addEventListener('keydown', keys);

  render(); applyZoom(); showSel();
  wfResizableSide(document.querySelector('.sh-body'));
  new ResizeObserver(() => applyZoom()).observe($('sh-stage'));
}

/* ================= ELECTRICAL DIAGRAM: SYSTEM SETUP =================
 * What the sheets are drawn from: the banks (one MSM each), each bank's ACDP and SSCs,
 * the rack every part is in, and the customer connections in use. Every answer is the
 * engineer's; names from the racks are only a starting point. Saved on every change. */
async function renderElecPage(id) {
  const project = await localProject(id);
  if (!project || project.underlay_kind !== 'elec') {
    shell('<div class="empty"><h3>Diagram not found</h3><p>This electrical diagram is not stored in this browser.</p><a class="btn btn-primary" href="#/electrical">Back</a></div>', 'dash');
    return;
  }
  project.config = project.config || {};
  const setup = project.config.elec = project.config.elec || elecNewSetup();
  const folder = rackFolder(project);
  const racks = folder ? (await localProjects()).filter(p => p.underlay_kind === 'cad' && p.folder === folder.id) : [];
  /* one ACDP per three SSCs: a field for each the bank needs, plus any extra already named */
  /* the SSCs each ACDP powers are the engineer's choice (default three each, MSM on the first) */
  const acdpRows = b => elecAcdpFeeds(setup, b).map(f => ({ k: f.k, a: f.acdp, f: f, feeds: elecFeedText(f) }));
  const feedChips = b => {
    const all = elecBankSscs(setup, b.id);
    return r => `<span class="el-feeds" role="group" aria-label="What ${esc(r.a.name || 'this ACDP')} powers">${all.map(c =>
      `<button type="button" class="el-chip${r.f.sscs.includes(c) ? ' on' : ''}" data-feed="${r.k}" data-ssc-id="${esc(c.id)}" title="${r.f.sscs.includes(c) ? 'Powered by this ACDP (click to take off)' : 'Click to power from this ACDP'}">${esc(c.name || 'SSC')}</button>`).join('')}<button type="button" class="el-chip el-chip-msm${r.f.msm ? ' on' : ''}" data-feed-msm="${r.k}" title="The ACDP that powers the MSM">MSM</button></span>`;
  };
  const rackNames = () => Array.from(new Set(racks.map(r => r.name).concat(setup.banks.flatMap(b => [b.msm.rack].concat(elecAcdps(b).map(a => a.rack))), setup.sscs.map(c => c.rack)).filter(Boolean)))
    .sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
  let saving = Promise.resolve();
  const save = () => {
    project.updated_at = new Date().toISOString();
    const copy = JSON.parse(JSON.stringify(project));
    saving = saving.then(() => localPutProject(copy)).catch(e => toast('Could not save: ' + e.message, 'error'));
  };
  /* any change after confirming needs a new confirmation */
  const changed = () => { if (setup.confirmed) { setup.confirmed = false; toast('Setup changed: confirm it again before the sheets are drawn.'); } save(); draw(); };

  shell(`
    <div class="dash el-page">
      <div class="dash-head">
        <div>
          <a class="dash-crumb" href="${folder ? '#/efolder/' + esc(folder.id) : '#/electrical'}">← ${folder ? esc(folder.number) : 'Projects'}</a>
          <h1>${esc(project.name)}</h1>
          <p>Electrical connection diagram · system setup</p>
        </div>
        <div class="dash-actions">
          ${racks.length ? '<button class="btn-site btn-site-ghost" id="el-fill">Fill in from the racks</button>' : ''}
        </div>
      </div>
      <div id="el-body"></div>
    </div>
    <datalist id="el-racks"></datalist>`, 'dash');

  const body = document.getElementById('el-body');
  function draw() {
    document.getElementById('el-racks').innerHTML = rackNames().map(r => `<option value="${esc(r)}">`).join('');
    const issues = elecIssues(setup);
    const errors = issues.filter(i => i.level === 'error'), notes = issues.filter(i => i.level === 'note');
    const bankOpts = sel => `<option value="" ${sel ? '' : 'selected'}>Choose…</option>` + setup.banks.map(b => `<option value="${esc(b.id)}" ${b.id === sel ? 'selected' : ''}>${esc(b.name || 'Bank')}</option>`).join('');
    const yesNo = (name, v) => `<span class="el-yn" role="radiogroup">
        <label><input type="radio" name="${name}" value="yes" ${v === true ? 'checked' : ''}> Yes</label>
        <label><input type="radio" name="${name}" value="no" ${v === false ? 'checked' : ''}> No</label></span>`;
    const src = setup.source && setup.source.racks && setup.source.racks.length
      ? `<p class="muted small">Names were read from the confirmed parts on ${esc(setup.source.racks.join(', '))}. Check each one.${setup.unconfirmedParts ? ` ${setup.unconfirmedParts} SSC/ACDP/MSM part${setup.unconfirmedParts === 1 ? ' was' : 's were'} not confirmed on the racks yet and ${setup.unconfirmedParts === 1 ? 'was' : 'were'} left out.` : ''}</p>` : '';
    body.innerHTML = `
      <section class="el-card">
        <div class="el-card-head"><h2>Banks</h2><button class="btn btn-ghost btn-sm" id="el-add-bank">Add bank</button></div>
        <p class="muted small">One bank per MSM; its model (3, 6 or 9 SSCs) sets the ports it has. Same rack = AYK supplies the whole harness; different racks = inline connector, with AYK's side drawn solid and the cable the customer makes dashed.</p>
        ${src}
        ${setup.banks.length ? `<div class="el-table-wrap"><table class="el-table">
          <thead><tr><th>Bank</th><th>MSM</th><th>MSM model</th><th>MSM rack</th><th>ACDPs and their racks <span class="muted">(click what each powers, up to 3 SSCs)</span></th><th>SSCs</th><th></th></tr></thead>
          <tbody>${setup.banks.map(b => `<tr data-bank="${esc(b.id)}">
            <td><input data-f="name" value="${esc(b.name)}" aria-label="Bank name"></td>
            <td><input data-f="msm.name" value="${esc(b.msm.name)}" placeholder="MSM-1" aria-label="MSM name"></td>
            <td><select data-f="msm.model" aria-label="MSM model"><option value="" ${ELEC_MSM_MODELS[b.msm.model] ? '' : 'selected'}>Choose…</option>${Object.keys(ELEC_MSM_MODELS).map(k => `<option value="${k}" ${String(b.msm.model) === k ? 'selected' : ''}>${k} SSCs</option>`).join('')}</select></td>
            <td><input data-f="msm.rack" value="${esc(b.msm.rack)}" list="el-racks" placeholder="Rack 1" aria-label="MSM rack"></td>
            <td><div class="el-acdps">${acdpRows(b).map(r => `<div class="el-acdp">${feedChips(b)(r)}<span class="el-acdp-row"><input data-acdp="${r.k}" data-af="name" value="${esc(r.a.name || '')}" placeholder="ACDP${r.k + 1}" aria-label="ACDP for ${esc(r.feeds)}"><input data-acdp="${r.k}" data-af="rack" value="${esc(r.a.rack || '')}" list="el-racks" placeholder="Rack 1" aria-label="Rack of the ACDP for ${esc(r.feeds)}"></span></div>`).join('')}
              <span class="el-acdp-acts"><button type="button" class="btn btn-ghost btn-xs" data-acdp-add="1">+ ACDP</button>${elecAcdps(b).some(a => Array.isArray(a.sscs)) || Number.isInteger(b.msmAcdp) ? '<button type="button" class="btn btn-ghost btn-xs" data-acdp-reset="1" title="Back to three SSCs per ACDP, MSM on the first">Reset</button>' : ''}</span></div></td>
            <td class="el-num">${elecBankSscs(setup, b.id).length}${ELEC_MSM_MODELS[b.msm.model] ? ' / ' + ELEC_MSM_MODELS[b.msm.model].sscs : ''}</td>
            <td><button class="btn btn-ghost btn-xs" data-del-bank="${esc(b.id)}" title="Remove this bank">×</button></td></tr>`).join('')}</tbody></table></div>`
          : '<div class="d-empty"><b>No banks yet</b><span>Add one bank for each MSM.</span></div>'}
      </section>

      <section class="el-card">
        <div class="el-card-head"><h2>SSCs</h2><button class="btn btn-ghost btn-sm" id="el-add-ssc">Add SSC</button></div>
        ${setup.sscs.length ? `<div class="el-table-wrap"><table class="el-table">
          <thead><tr><th>SSC</th><th>Rack</th><th>Bank</th><th>Cooling fans</th><th>Modules</th><th>Link to MSM</th><th></th></tr></thead>
          <tbody>${setup.sscs.map(c => {
            const b = setup.banks.find(x => x.id === c.bank);
            const k = b ? elecLinkKind(c.rack, b.msm.rack) : 'unknown';
            return `<tr data-ssc="${esc(c.id)}">
            <td><input data-f="name" value="${esc(c.name)}" placeholder="SSC1" aria-label="SSC name"></td>
            <td><input data-f="rack" value="${esc(c.rack)}" list="el-racks" placeholder="Rack 1" aria-label="SSC rack"></td>
            <td><select data-f="bank" aria-label="Bank">${bankOpts(c.bank)}</select></td>
            <td><select data-f="fans" aria-label="Cooling fans"><option value="" ${ELEC_FAN_CHOICES.includes(c.fans) ? '' : 'selected'}>Choose…</option>${ELEC_FAN_CHOICES.map(k => `<option value="${k}" ${c.fans === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
            <td><input data-f="modules" type="number" min="1" max="99" step="1" class="el-count" value="${c.modules || ''}" placeholder="n" aria-label="Battery modules on this SSC" title="Battery modules on this SSC (the last one drawn on its front sheet)"></td>
            <td><span class="el-link el-link-${k}">${k === 'harness' ? 'AYK harness' : k === 'inline' ? 'Inline connector' : '—'}</span></td>
            <td><button class="btn btn-ghost btn-xs" data-del-ssc="${esc(c.id)}" title="Remove this SSC">×</button></td></tr>`;
          }).join('')}</tbody></table></div>`
          : '<div class="d-empty"><b>No SSCs yet</b><span>Add every SSC of the system and choose its bank.</span></div>'}
      </section>

      <section class="el-card">
        <div class="el-card-head"><h2>Customer connections</h2></div>
        <p class="muted small">At the MSM back. Only the ones in use are drawn.</p>
        <p class="muted small">Always drawn: ${ELEC_OPTIONS.filter(o => o.always).map(o => esc(o.label)).join(', ')}.</p>
        <ul class="el-options">${ELEC_OPTIONS.filter(o => !o.always).map(o => `<li><div><b>${esc(o.label)}</b><small>${esc(o.note)}</small></div>${yesNo('opt-' + o.id, setup.options[o.id])}</li>`).join('')}
          <li><div><b>Master valves (fire fighting)</b><small>LP16-7 female to male, 5 × 0.3 mm²</small></div>
            <select id="el-valves" aria-label="Master valves"><option value="" ${[0, 1, 2].includes(setup.valves) ? '' : 'selected'}>Choose…</option>${[0, 1, 2].map(v => `<option value="${v}" ${setup.valves === v ? 'selected' : ''}>${v}</option>`).join('')}</select></li>
          <li><div><b>Junction box</b><small>Drawn on the junction box and SSC front sheets (0.6/1 kV, 95 mm² to the customer)</small></div>
            <select id="el-jb" aria-label="Junction box"><option value="" ${[2, 4].includes(setup.jbModel) ? '' : 'selected'}>Choose…</option>${[2, 4].map(v => `<option value="${v}" ${setup.jbModel === v ? 'selected' : ''}>${v} Bus connectors</option>`).join('')}</select></li>
        </ul>
      </section>

      <section class="el-card el-status">
        <div class="el-card-head"><h2>${setup.confirmed ? 'Setup confirmed' : 'Confirm the setup'}</h2>
          <button class="btn btn-primary btn-sm" id="el-confirm" ${errors.length || setup.confirmed ? 'disabled' : ''}>${setup.confirmed ? 'Confirmed' : 'Confirm setup'}</button></div>
        ${errors.length ? `<p class="small">${errors.length} thing${errors.length === 1 ? '' : 's'} to answer first:</p><ul class="el-issues">${errors.map(i => `<li>${esc(i.text)}</li>`).join('')}</ul>` : setup.confirmed ? '<p class="small cad-ok">Everything is answered and confirmed.</p>' : '<p class="small">Everything is answered. Confirm to lock it in.</p>'}
        ${notes.length ? `<ul class="el-issues el-notes">${notes.map(i => `<li>${esc(i.text)}</li>`).join('')}</ul>` : ''}
        ${setup.banks.length ? (() => { const sh = elecSheets(setup); return `<details class="el-sheets"${setup.confirmed ? ' open' : ''}><summary>This setup gives ${sh.length} sheets, numbered 1 to ${sh.length}</summary>
          <ol>${sh.map(x => `<li><b>Sheet ${x.n} of ${x.of}</b> ${esc(x.title)}</li>`).join('')}</ol></details>`; })() : ''}
        <div class="el-export">
          <div class="el-export-fields">
            <label>Document no.<input data-sf="docNumber" value="${esc(sheetInfo().docNumber)}" placeholder="DWG2527"></label>
            <label>Rev<input data-sf="rev" value="${esc(sheetInfo().rev)}" placeholder="0"></label>
            <label>Drawn by<input data-sf="drawnBy" value="${esc(sheetInfo().drawnBy)}" placeholder="Name"></label>
            <label>Checked by<input data-sf="checkedBy" value="${esc(sheetInfo().checkedBy)}" placeholder="Name"></label>
            <label>State<input data-sf="state" value="${esc(sheetInfo().state)}" placeholder="Issued for Review"></label>
            <label>Note<input data-sf="note" value="${esc(sheetInfo().note)}" placeholder="Initial Released"></label>
          </div>
          ${setup.confirmed ? `<a class="btn btn-primary" id="el-open" href="#/elecsheets/${project.id}">Open the sheets</a>` : '<button class="btn btn-primary" disabled>Open the sheets</button>'}
        </div>
        <p class="muted small">${setup.confirmed ? `Check every sheet as it will print, move or edit anything you need, then export one A3 PDF in AYK's DWG2527 format ("${esc(sheetInfo().title)}") from there.` : 'Confirm the setup to open the sheets.'}</p>
        <details class="el-notes-edit">
          <summary>Notes on the sheets <span class="muted small">(start as AYK's DWG2527 text; edit them for this project)</span></summary>
          ${[[1, 'Sheet 1: MSM back notes'], [2, 'Sheet 2: inline connectors'], ['bank', 'Bank sheets (every MSM, ACDP, SSC and junction box sheet)']].map(([sh, head]) => `
            <h3>${head}</h3>
            ${ELEC_NOTES.filter(n => n.sheet === sh).map(n => {
              const own = setup.notes && typeof setup.notes[n.id] === 'string';
              return `<label class="el-note" data-note-row="${n.id}"><span><b>${esc(n.label)}</b>${own ? ' <em class="muted small">edited</em>' : ''}
                ${own ? `<button type="button" class="btn btn-ghost btn-xs" data-note-reset="${n.id}">Back to AYK's text</button>` : ''}</span>
                <textarea data-note="${n.id}" rows="${Math.min(14, Math.max(2, Math.ceil(elecNote(setup, n.id).length / 110) + (elecNote(setup, n.id).match(/\n/g) || []).length))}" placeholder="${n.text ? '' : 'Leave empty to print nothing'}">${esc(elecNote(setup, n.id))}</textarea></label>`;
            }).join('')}`).join('')}
          <p class="muted small">An empty note is left off the sheets. Editing notes keeps the setup confirmed.</p>
        </details>
      </section>

      <section class="el-card">
        <div class="el-card-head"><h2>Part drawings</h2><span class="muted small">Used on every project</span></div>
        <p class="muted small">From AYK's CAD files (MSM, SSC, junction box, module). The SSC Ext-HVIL port stays unconnected: the junction box HVIL wire is high voltage and the connector is not rated for it.</p>
        <div class="el-parts" id="el-parts"><span class="muted small">Loading the part drawings…</span></div>
      </section>`;
    elecPartsInto(document.getElementById('el-parts'));
    wire();
  }

  /* title block of the exported sheets (kept with the setup) */
  function sheetInfo() { return elecSheetInfoOf(setup, folder); }
  function setPath(obj, path, v) { const k = path.split('.'); let o = obj; while (k.length > 1) o = o[k.shift()]; o[k[0]] = v; }
  function wire() {
    body.querySelectorAll('[data-bank] [data-acdp]').forEach(inp => inp.onchange = () => {
      const b = setup.banks.find(x => x.id === inp.closest('[data-bank]').dataset.bank);
      const list = elecAcdps(b), k = +inp.dataset.acdp;
      while (list.length <= k) list.push({ name: '', rack: '' });
      list[k][inp.dataset.af] = inp.value.trim();
      while (list.length && !list[list.length - 1].name && !list[list.length - 1].rack && !Array.isArray(list[list.length - 1].sscs)) list.pop();
      changed();
    });
    /* what each ACDP powers: the first click turns the default (three each) into the engineer's own list */
    const bankOf = el => setup.banks.find(x => x.id === el.closest('[data-bank]').dataset.bank);
    const ownFeeds = b => {
      const feeds = elecAcdpFeeds(setup, b), list = elecAcdps(b);
      while (list.length < feeds.length) list.push({ name: '', rack: '' });
      feeds.forEach(f => { list[f.k].sscs = f.sscs.map(c => c.id); });
      return list;
    };
    body.querySelectorAll('[data-bank] [data-feed]').forEach(btn => btn.onclick = () => {
      const b = bankOf(btn), list = ownFeeds(b), k = +btn.dataset.feed, id = btn.dataset.sscId;
      const had = list[k].sscs.includes(id);
      list.forEach(a => { a.sscs = a.sscs.filter(x => x !== id); });
      if (!had) list[k].sscs.push(id);
      changed();
    });
    body.querySelectorAll('[data-bank] [data-feed-msm]').forEach(btn => btn.onclick = () => { bankOf(btn).msmAcdp = +btn.dataset.feedMsm; changed(); });
    body.querySelectorAll('[data-bank] [data-acdp-add]').forEach(btn => btn.onclick = () => { ownFeeds(bankOf(btn)).push({ name: '', rack: '', sscs: [] }); changed(); });
    body.querySelectorAll('[data-bank] [data-acdp-reset]').forEach(btn => btn.onclick = () => {
      const b = bankOf(btn); delete b.msmAcdp;
      elecAcdps(b).forEach(a => delete a.sscs);
      while (b.acdps.length && !b.acdps[b.acdps.length - 1].name && !b.acdps[b.acdps.length - 1].rack) b.acdps.pop();
      changed();
    });
    body.querySelectorAll('[data-bank] [data-f]').forEach(inp => inp.onchange = () => {
      const b = setup.banks.find(x => x.id === inp.closest('[data-bank]').dataset.bank);
      setPath(b, inp.dataset.f, inp.dataset.f === 'msm.model' ? (inp.value ? +inp.value : null) : inp.value.trim()); changed();
    });
    body.querySelectorAll('[data-ssc] [data-f]').forEach(inp => inp.onchange = () => {
      const c = setup.sscs.find(x => x.id === inp.closest('[data-ssc]').dataset.ssc);
      const f = inp.dataset.f;
      c[f] = f === 'fans' ? (inp.value ? +inp.value : null) : f === 'modules' ? (+inp.value >= 1 ? Math.round(+inp.value) : null) : inp.value.trim();
      changed();
    });
    body.querySelectorAll('[data-del-bank]').forEach(b => b.onclick = () => {
      const bank = setup.banks.find(x => x.id === b.dataset.delBank);
      const n = elecBankSscs(setup, bank.id).length;
      if (!confirm(`Remove ${bank.name || 'this bank'}?${n ? ` Its ${n} SSC${n === 1 ? '' : 's'} stay in the list without a bank.` : ''}`)) return;
      setup.banks = setup.banks.filter(x => x !== bank);
      setup.sscs.forEach(c => { if (c.bank === bank.id) c.bank = ''; });
      changed();
    });
    body.querySelectorAll('[data-del-ssc]').forEach(b => b.onclick = () => {
      const c = setup.sscs.find(x => x.id === b.dataset.delSsc);
      if (!confirm(`Remove ${c.name || 'this SSC'}?`)) return;
      setup.sscs = setup.sscs.filter(x => x !== c); changed();
    });
    document.getElementById('el-add-bank').onclick = () => {
      const n = setup.banks.length + 1;
      setup.banks.push({ id: 'b' + Date.now().toString(36), name: 'Bank ' + n, msm: { name: '', rack: '', model: null }, acdps: [] });
      changed();
    };
    document.getElementById('el-add-ssc').onclick = () => {
      const nums = setup.sscs.map(c => +((String(c.name).match(/(\d+)\s*$/) || [])[1] || 0));
      const last = setup.sscs[setup.sscs.length - 1];
      setup.sscs.push({ id: 's' + Date.now().toString(36), name: 'SSC' + (Math.max(0, ...nums) + 1), rack: last ? last.rack : '', bank: last ? last.bank : (setup.banks.length === 1 ? setup.banks[0].id : ''), fans: null });
      changed();
    };
    body.querySelectorAll('.el-yn input').forEach(r => r.onchange = () => {
      setup.options[r.name.replace(/^opt-/, '')] = r.value === 'yes'; changed();
    });
    document.getElementById('el-valves').onchange = e => { setup.valves = e.target.value === '' ? null : +e.target.value; changed(); };
    document.getElementById('el-jb').onchange = e => { setup.jbModel = e.target.value === '' ? null : +e.target.value; changed(); };
    body.querySelectorAll('[data-sf]').forEach(inp => inp.onchange = () => {
      sheetInfo();
      setup.sheetInfo[inp.dataset.sf] = inp.value.trim();
      save();                                   /* title block only: the setup stays confirmed */
    });
    /* sheet notes: kept with the setup; the setup stays confirmed */
    body.querySelectorAll('[data-note]').forEach(ta => ta.onchange = () => {
      const n = ELEC_NOTES.find(x => x.id === ta.dataset.note);
      setup.notes = setup.notes || {};
      if (ta.value === n.text) delete setup.notes[n.id]; else setup.notes[n.id] = ta.value;
      save();
      const open = body.querySelector('.el-notes-edit');
      const y = window.scrollY;
      draw();
      const again = body.querySelector('.el-notes-edit');
      if (open && again) again.open = true;
      window.scrollTo(0, y);
    });
    body.querySelectorAll('[data-note-reset]').forEach(btn => btn.onclick = ev => {
      ev.preventDefault();
      if (setup.notes) delete setup.notes[btn.dataset.noteReset];
      save();
      const y = window.scrollY;
      draw();
      const again = body.querySelector('.el-notes-edit');
      if (again) again.open = true;
      window.scrollTo(0, y);
    });
    document.getElementById('el-confirm').onclick = () => {
      if (!elecReady(setup)) return;
      setup.confirmed = true; setup.confirmedAt = new Date().toISOString(); save(); draw();
    };
  }
  const fill = document.getElementById('el-fill');
  if (fill) fill.onclick = () => {
    const found = elecPartsOfRacks(racks);
    if (!found.parts.length) { toast('No confirmed SSC, ACDP or MSM names on this project\'s racks yet.', 'error'); return; }
    if ((setup.banks.length || setup.sscs.length) && !confirm('Replace the banks and SSCs with the names confirmed on the racks? Your answers for the customer connections are kept.')) return;
    const fresh = elecFromRacks(found.parts, racks.map(r => r.name));
    setup.banks = fresh.banks; setup.sscs = fresh.sscs; setup.source = fresh.source;
    setup.unplacedAcdps = fresh.unplacedAcdps; setup.unconfirmedParts = found.unconfirmed || undefined;
    changed();
  };
  draw();
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
  try { const v = JSON.parse(wfStorage.getItem(CAD_LIBRARY_KEY) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; }
}
function cadLibrarySave(list) {
  try { wfStorage.setItem(CAD_LIBRARY_KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
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
  if (!Array.isArray(cad.remoteSscs)) cad.remoteSscs = [];
  /* the project's other racks: an SSC there may drive modules here, or modules there may hang
     on an SSC here (AYK S10176: SSC-1 in Rack 2, its modules in Rack 4, wired over the ceiling) */
  const folderCads = project.folder ? (await localProjects().catch(() => [])).filter(p => p.underlay_kind === 'cad' && p.folder === project.folder && p.id !== project.id) : [];
  const cadOf = p => (p.config && p.config.cad) || {};
  /* the SSCs of the other racks: from their saved parts, else from their SSC labels (keys "ssc@x,y") */
  const otherSscs = () => folderCads.flatMap(p => {
    const k = cadOf(p), comps = (k.components || []).filter(c => c.kind === 'ssc');
    if (comps.length) return comps.map(c => ({ rack: p.id, rackName: p.name, key: cadCompKey(c), name: cadCompLabel(c, k.labels || {}) }));
    return Object.keys(k.labels || {}).filter(key => /^ssc@/.test(key)).map(key => ({ rack: p.id, rackName: p.name, key: key, name: k.labels[key].label || key }));
  }).sort((x, y) => String(x.rackName + ' ' + x.name).localeCompare(String(y.rackName + ' ' + y.name), undefined, { numeric: true }));
  /* an SSC here whose modules another rack of the project wires from it */
  const awayOf = key => { for (const p of folderCads) for (const r of cadOf(p).remoteSscs || []) if (r.rack === project.id && r.ssc === key) return { rackId: p.id, rackName: p.name, side: r.side }; return null; };
  let components = [];
  let fromLibrary = false;
  /* generated wiring (plain data, saved with the drawing) */
  let wiring = cad.wiring && cad.wiring.plan ? cad.wiring.plan : null;
  let focusKey = null;   /* part highlighted by Show / rename */
  let numbering = null;  /* engineer numbers the modules by clicking: {list, i, picked: {sscKey: [moduleIds]}} */
  const wiringHistory = [];
  let showWiring = true;

  shell(`
    <div class="cad-page">
      <header class="cad-head">
        <a class="back" href="${rackFolder(project) ? '#/folder/' + esc(rackFolder(project).id) : '#/wiring'}">← ${rackFolder(project) ? esc(rackFolder(project).number) : 'Projects'}</a>
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
              <div class="cad-teach-actions" id="cad-teach-actions" hidden></div>
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
    onCancel: () => cancelNumbering() || cancelTeach(),
    onClick: (pt, sx, sy) => openRename(pt, sx, sy),
  });

  /* ---- rename on the rack: click an SSC / ACDP / MSM ---- */
  function openRename(pt, sx, sy) {
    closeRename();
    if (teach) return;
    if (numbering) { numberClick(pt); return; }
    const hit = components.filter(c => cadNamed(c.kind) && pt[0] >= c.x0 && pt[0] <= c.x1 && pt[1] >= c.y0 && pt[1] <= c.y1)
      .sort((a, b) => (a.x1 - a.x0) * (a.y1 - a.y0) - (b.x1 - b.x0) * (b.y1 - b.y0))[0];
    if (!hit) {
      const mod = components.find(c => c.kind === 'module' && pt[0] >= c.x0 && pt[0] <= c.x1 && pt[1] >= c.y0 && pt[1] <= c.y1);
      if (mod) openModuleEdit(mod, sx, sy);
      return;
    }
    const k = cadKind(hit.kind), key = cadCompKey(hit), saved = cad.labels[key] || {};
    focusKey = key; viewer.redraw();
    const pop = document.createElement('form');
    pop.className = 'cad-pop'; pop.id = 'cad-pop';
    pop.innerHTML = `<b style="color:${k.color}">${esc(k.label)}</b>
      <label>Name <input name="label" value="${esc(cadCompLabel(hit, cad.labels))}" maxlength="24" autocomplete="off"></label>
      ${hit.kind === 'ssc' ? `<label>Modules <input name="modules" type="number" min="1" step="1" value="${saved.modules || ''}"></label>` : ''}
      <p class="muted small">Using a name another ${esc(k.label)} has swaps the two names.</p>
      <div><button class="btn btn-primary btn-xs" type="submit">Save</button> <button class="btn btn-ghost btn-xs" type="button" data-x>Cancel</button>
        <button class="btn btn-ghost btn-xs cad-pop-del" type="button" data-del title="This is not a ${esc(k.label)}: remove this one copy">Remove this one</button></div>`;
    const stage = $('cad-stage');
    stage.appendChild(pop);
    pop.style.left = Math.min(Math.max(8, sx + 12), stage.clientWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = Math.min(Math.max(8, sy - 20), stage.clientHeight - pop.offsetHeight - 8) + 'px';
    pop.querySelector('input').select();
    pop.querySelector('[data-x]').onclick = closeRename;
    pop.querySelector('[data-del]').onclick = async () => {
      if (hit.manual) cad.manual = (cad.manual || []).filter(m => !(m.kind === hit.kind && m.x0 === hit.x0 && m.y0 === hit.y0));
      else (cad.excluded = cad.excluded || []).push(key);
      delete cad.labels[key];
      closeRename();
      recognise(); await persist();
      say(`One ${k.label} removed (${cadCompLabel(hit, cad.labels)}). Use Remove in the Parts list to take them all off.`, 'cad-ok');
    };
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
  /* ---- renumber a module: S3-M5 -> S3-M2 (or S2-M4) swaps the two modules ---- */
  function currentOrders() {
    const keyOf = new Map(wiringInputs().sscs.map(s => [s.name, s.key]));
    const o = {};
    for (const st of wiring.strings) o[keyOf.get(st.name)] = st.modules.slice();
    return o;
  }
  /* undo: the wiring settings before each change (this session) */
  function rememberWiring() {
    wiringHistory.push(JSON.stringify(cad.wiring || {}));
    if (wiringHistory.length > 30) wiringHistory.shift();
  }
  /* numbering saved by module position (kind@x,y); ids are looked up when it is used, so
     re-teaching a part (which can renumber the ids) does not scramble it. Older projects
     saved ids: those are used as they are. */
  function orderKeys(byId) {
    const key = new Map(components.map(c => [c.id, cadCompKey(c)]));
    const o = {};
    for (const k in byId || {}) o[k] = byId[k].map(id => key.get(id) || id);
    return o;
  }
  function orderIds(saved) {
    if (!saved) return null;
    const id = new Map(components.map(c => [cadCompKey(c), c.id]));
    const o = {};
    for (const k in saved) o[k] = saved[k].map(x => id.get(x) || x);
    return o;
  }
  async function replan(orders, okText) {
    rememberWiring();
    const inp = wiringInputs();
    let plan;
    try { plan = cadWirePlan(inp.comps, inp.sscs, { pair: inp.pair, tray: inp.tray, orders: orders || undefined }); } catch (e) { plan = { ok: false, errors: [e.message] }; }
    if (!plan.ok) { wiringHistory.pop(); say(plan.errors.join(' ') + (orders ? ' Your numbering is kept: fix this and press Draw the wiring again.' : ''), 'warn'); return false; }
    /* the engineer's numbering no longer fits (module counts or parts changed): keep it and
       the wiring as they are rather than drawing another numbering over them */
    if (orders && !plan.custom) {
      wiringHistory.pop();
      say('Your numbering is kept, but it no longer fits the drawing (an SSC module count or a part changed). Put the counts back and press Draw the wiring again, or use Number again.', 'warn');
      return false;
    }
    wiring = cadWireSave(plan, inp.key);
    cad.wiring = Object.assign({}, cad.wiring, { pair: inp.pair, plan: wiring, orders: orders ? orderKeys(orders) : cad.wiring && cad.wiring.orders });
    await persist();
    if (orders && plan.custom) keepNumbering(orders, inp, plan.crossings.length);
    renderWiring(); viewer.redraw();
    say(okText + (plan.crossings.length ? ` ⚠ ${plan.crossings.length} power crossing(s) with this numbering, outlined in white.` : ' No power crossings.'), plan.crossings.length ? 'warn' : 'cad-ok');
    return true;
  }
  /* a finished numbering goes into the library on this device, by rack layout, so it can be
     offered again when a rack of the same layout is opened (any project, any drawing scale) */
  function keepNumbering(orders, inp, crossings) {
    if (inp.sscs.some(s => s.remote || s.away)) return;       /* strings across racks: not a layout of its own */
    try {
      const pf = rackFolder(project);
      const e = numlibEntry(components, inp.sscs, orders, { project: project.name, projectId: project.id, pair: inp.pair, tray: inp.tray, crossings: crossings });
      if (e) { e.folder = pf ? pf.id : null; e.folderLabel = pf ? pf.number : ''; }
      if (e && !numlibStore(numlibAdd(numlibLoad(), e))) console.warn('Numbering library: could not save on this device');
    } catch (err) { console.error('Numbering library', err); }
  }
  /* saved numberings for this rack's layout (not the one already on this drawing) */
  function libraryMatches(inp) {
    let list = [];
    try { list = numlibMatches(numlibLoad(), components); } catch (e) { return []; }
    /* racks of this same project first */
    const myFolder = project.folder || null;
    list = list.filter(e => e.projectId !== project.id || !(cad.wiring && cad.wiring.orders)).sort((a, b) => (b.folder === myFolder && myFolder ? 1 : 0) - (a.folder === myFolder && myFolder ? 1 : 0));
    if (!list.length || !(cad.wiring && cad.wiring.orders)) return list;
    const ids = orderIds(cad.wiring.orders);
    const mine = inp.sscs.some(s => s.remote || s.away) ? null : numlibEntry(components, inp.sscs, ids, { pair: inp.pair, tray: inp.tray });
    return mine ? list.filter(e => !(e.layout === mine.layout && JSON.stringify(e.strings) === JSON.stringify(mine.strings))) : list;
  }
  /* use a saved numbering: its order, junction boxes, pairs and trays; then draw the wiring */
  async function useNumbering(entry) {
    const inp = wiringInputs();
    const counts = {};
    for (const s of inp.sscs) counts[s.comp.id] = s.count;
    const m = numlibApply(entry, components, counts);
    if (m.error) { say(m.error, 'warn'); return; }
    const had = (cad.wiring && cad.wiring.orders) || numberedCount(cad.wiring && cad.wiring.draft);
    if (had && !confirm(`Use the numbering from "${entry.project || 'another rack'}"? It replaces the numbering on this drawing (Undo brings yours back).`)) return;
    rememberWiring();
    const byKey = {}, jbMap = {};
    for (const s of inp.sscs) {
      byKey[s.key] = m.orders[s.comp.id];
      const o = m.sscs[s.comp.id] || {};
      const jb = o.jbId && components.find(c => c.id === o.jbId);
      if (jb || o.pair || o.tray) jbMap[s.key] = { jb: jb ? cadCompKey(jb) : undefined, pair: o.pair || undefined, tray: o.tray || undefined };
    }
    cad.wiring = Object.assign({}, cad.wiring, { pair: m.pair || inp.pair, tray: m.tray || inp.tray || undefined, jbMap: jbMap, orders: orderKeys(byKey) });
    delete cad.wiring.draft; delete cad.wiring.plan; wiring = null;
    await persist();
    const ok = await replan(byKey, `Numbering from "${entry.project || 'a saved rack'}" used; wiring drawn. Check it, and change any module by clicking it.`);
    if (!ok) renderWiring();
    viewer.redraw();
  }

  function openModuleEdit(mod, sx, sy) {
    if (!wiring) { say('Number the modules first (Wiring card: Number modules by clicking); then click a module to change its number.'); return; }
    const st = wiring.strings.find(s => s.modules.includes(mod.id));
    if (!st) return;
    const idx = st.modules.indexOf(mod.id);
    focusKey = cadCompKey(mod); viewer.redraw();
    const pop = document.createElement('form');
    pop.className = 'cad-pop'; pop.id = 'cad-pop';
    pop.innerHTML = `<b style="color:#d8b4fe">Module ${esc(st.tag)}-M${idx + 1}</b>
      <label>SSC <select name="ssc">${wiring.strings.map(s => `<option value="${esc(s.name)}" ${s === st ? 'selected' : ''}>${esc(s.tag)} · ${esc(s.name)}</option>`).join('')}</select></label>
      <label>Number <input name="num" type="number" min="1" step="1" value="${idx + 1}"></label>
      <p class="muted small">The module that has this number swaps with it, so every SSC keeps its count. The wiring is re-drawn in the new order.</p>
      <div><button class="btn btn-primary btn-xs" type="submit">Save</button> <button class="btn btn-ghost btn-xs" type="button" data-x>Cancel</button></div>`;
    const stage = $('cad-stage');
    stage.appendChild(pop);
    pop.style.left = Math.min(Math.max(8, sx + 12), stage.clientWidth - pop.offsetWidth - 8) + 'px';
    pop.style.top = Math.min(Math.max(8, sy - 20), stage.clientHeight - pop.offsetHeight - 8) + 'px';
    pop.num.select();
    pop.querySelector('[data-x]').onclick = closeRename;
    pop.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); closeRename(); } });
    pop.onsubmit = async e => {
      e.preventDefault();
      const dst = wiring.strings.find(s => s.name === pop.ssc.value);
      const n = +pop.num.value;
      if (!dst || !(n >= 1 && n <= dst.modules.length && Number.isInteger(n))) { say(`${dst ? dst.tag : 'This SSC'} has modules 1 to ${dst ? dst.modules.length : '?'}.`, 'warn'); return; }
      if (dst === st && n === idx + 1) { closeRename(); return; }
      const orders = currentOrders();
      const keyOf = new Map(wiringInputs().sscs.map(s => [s.name, s.key]));
      const a = orders[keyOf.get(st.name)], b = orders[keyOf.get(dst.name)];
      const from = `${st.tag}-M${idx + 1}`, to = `${dst.tag}-M${n}`;
      [a[idx], b[n - 1]] = [b[n - 1], a[idx]];
      closeRename();
      await replan(orders, `Swapped ${from} ↔ ${to}; wiring re-drawn.`);
    };
  }

  /* ---- number the modules by clicking them in order, SSC by SSC ----
     The engineer's numbering is never thrown away unless they ask (Delete wiring, or
     Start numbering over): every click is saved at once (cad.wiring.draft), Esc only
     pauses, and the finished numbering (cad.wiring.orders) is kept even when the wiring
     cannot be drawn yet. Both are saved by module position, so they survive re-teaching. */
  const numberedCount = d => d ? Object.values(d.picked || {}).reduce((n, a) => n + a.length, 0) : 0;
  function startNumbering(fresh) {
    const inp = wiringInputs();
    if (!inp.sscs.every(s => s.confirmed && (s.away || s.count >= 1))) { say('Confirm the SSC numbers and module counts first.', 'warn'); return; }
    const list = inp.sscs.filter(s => !s.away).slice().sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
      .map(s => ({ key: s.key, name: s.name, count: s.count, tag: 'S' + ((String(s.name).match(/\d+/) || [''])[0]) }));
    /* carry on from the saved clicks, unless the engineer chose to start over */
    const draft = !fresh && cad.wiring && cad.wiring.draft;
    const picked = {};
    if (draft) {
      const ids = orderIds(draft.picked) || {};
      const known = new Set(components.filter(c => c.kind === 'module').map(c => c.id));
      for (const st of list) picked[st.key] = (ids[st.key] || []).filter(id => known.has(id)).slice(0, st.count);
    }
    let i = list.findIndex(st => (picked[st.key] || []).length < st.count);
    if (i < 0) i = list.length - 1;
    numbering = { list: list, i: i, picked: picked, guide: null };
    closeRename();
    showWiring = false;
    window.addEventListener('keydown', numberKeys);
    numberPrompt(); viewer.redraw();
    if (draft) say(`Continuing your saved numbering: ${numberedCount({ picked: picked })} modules already numbered.`, 'cad-ok');
    /* the guide (good next modules, and a suggested numbering if one keeps every power
       cable apart) takes a moment on a big rack: work it out after the prompt shows */
    if (!draft) say('Working out which modules to click next…');
    const run = numbering;
    setTimeout(() => {
      if (numbering !== run) return;
      try { run.guide = cadWireGuide(inp.comps, inp.sscs.filter(s => !s.away), { pair: inp.pair, tray: inp.tray }); } catch (e) { console.error('Numbering guide failed', e); run.guide = null; }
      numberPrompt(); viewer.redraw();
    }, 30);
  }
  /* good next clicks for the SSC being numbered */
  function numberHint() {
    if (!numbering || !numbering.guide) return { ids: [], suggested: null };
    const st = numbering.list[numbering.i];
    const taken = Object.values(numbering.picked).flat();
    return numbering.guide.next(st.key, numbering.picked[st.key] || [], taken);
  }
  function numberPrompt() {
    const st = numbering.list[numbering.i];
    const n = (numbering.picked[st.key] || []).length;
    const hint = numberHint();
    const where = !numbering.guide ? '' : hint.suggested ? ' · click the bright green module (suggested: keeps power cables apart)'
      : hint.ids.length ? (n ? ' · click a green module: it is next to ' + st.tag + '-M' + n : ' · start next to ' + st.name + ' (green)') : '';
    prompt(`${st.name}: click module ${n + 1} of ${st.count} (${st.tag}-M${n + 1})${where} · Backspace undoes · Esc pauses (your clicks are saved)`);
    if (numbering.guide) say(`Numbering ${st.name} (${numbering.i + 1} of ${numbering.list.length} SSCs, ${n} of ${st.count} modules done).` +
      (numbering.guide.suggested ? ' A suggested numbering with no power crossings is shown in bright green.' : ' No numbering without power crossings was found for this rack; green modules are the ones next to the last click.'));
  }
  function numberKeys(e) {
    if (!numbering || (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName))) return;
    if (e.key === 'Backspace') {
      e.preventDefault();
      let st = numbering.list[numbering.i];
      let arr = numbering.picked[st.key] || [];
      if (!arr.length && numbering.i > 0) { numbering.i--; st = numbering.list[numbering.i]; arr = numbering.picked[st.key] || []; }
      arr.pop();
      saveDraft();
      numberPrompt(); viewer.redraw();
    }
  }
  /* every click is saved straight away, so nothing is lost by Esc, a refresh or a crash */
  function saveDraft() {
    if (!numbering) return;
    cad.wiring = Object.assign({}, cad.wiring, { draft: { picked: orderKeys(numbering.picked), saved: new Date().toISOString() } });
    persist().catch(e => say('Could not save the numbering: ' + e.message, 'warn'));
  }
  function cancelNumbering() {
    if (!numbering) return false;
    const n = numberedCount(numbering);
    numbering = null;
    window.removeEventListener('keydown', numberKeys);
    prompt(''); showWiring = true; viewer.redraw();
    say(n ? `Numbering paused. Your ${n} numbered module${n === 1 ? ' is' : 's are'} saved: press Continue numbering to carry on.` : 'Numbering stopped. Nothing was changed.', n ? 'cad-ok' : '');
    renderWiring();
    return true;
  }
  async function numberClick(pt) {
    const m = components.find(c => c.kind === 'module' && pt[0] >= c.x0 && pt[0] <= c.x1 && pt[1] >= c.y0 && pt[1] <= c.y1);
    if (!m) { say('Click inside a battery module.', 'warn'); return; }
    const owner = numbering.list.find(st => (numbering.picked[st.key] || []).includes(m.id));
    if (owner) { const at = numbering.picked[owner.key].indexOf(m.id) + 1; say(`That module is already ${owner.tag}-M${at}. Backspace undoes the last click.`, 'warn'); return; }
    const st = numbering.list[numbering.i];
    const hint = numberHint();
    const arr = numbering.picked[st.key] = numbering.picked[st.key] || [];
    arr.push(m.id);
    saveDraft();
    const off = numbering.guide && hint.ids.length && !hint.ids.includes(m.id);
    if (arr.length >= st.count) {
      if (numbering.i + 1 < numbering.list.length) { numbering.i++; numberPrompt(); viewer.redraw(); return; }
      /* every SSC numbered: keep the numbering first, then wire it in this order */
      const picked = numbering.picked;
      numbering = null;
      window.removeEventListener('keydown', numberKeys);
      prompt(''); showWiring = true;
      rememberWiring();
      cad.wiring = Object.assign({}, cad.wiring, { orders: orderKeys(picked) });
      delete cad.wiring.draft;
      await persist();
      const left = components.filter(c => c.kind === 'module').length - Object.values(picked).reduce((n, a) => n + a.length, 0);
      if (left) say(`${left} module${left === 1 ? ' was' : 's were'} not numbered; check the SSC module counts.`, 'warn');
      const ok = await replan(picked, 'Modules numbered by hand; wiring drawn in your order.');
      if (!ok) renderWiring();
      return;
    }
    numberPrompt(); viewer.redraw();
    if (off) say(`${st.tag}-M${arr.length} is not next to ${arr.length > 1 ? st.tag + '-M' + (arr.length - 1) : st.name}: its cable has to run along a tray and may cross another power cable. Backspace undoes.`, 'warn');
  }

  function closeRename() { const p = document.getElementById('cad-pop'); if (p) p.remove(); if (focusKey) { focusKey = null; viewer.redraw(); } }

  /* drawings come in mm or scaled down (one rack is 1:44): sizes on screen are set per
     real millimetre, from the battery module width (400 mm) */
  let unitMemo = null;
  function mmPerUnit() {
    if (unitMemo && unitMemo.list === components) return unitMemo.k;
    const ws = components.filter(c => c.kind === 'module').map(c => c.x1 - c.x0).sort((a, b) => a - b);
    const k = ws.length ? ws[ws.length >> 1] / 400.45 : 1;
    unitMemo = { list: components, k: k > 0 ? k : 1 };
    return unitMemo.k;
  }
  function drawOverlay(ctx, toScreen, scaleRaw) {
    const scale = scaleRaw * mmPerUnit();
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
      if (c.id && c.kind !== 'module' && (b[0] - a[0] > 46 || named)) {
        const saved = cad.labels[cadCompKey(c)];
        const text = c.kind === 'jb' && c.jbName ? c.jbName : cadCompLabel(c, cad.labels) + (named && !(saved && saved.confirmed) ? ' ?' : '');
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
          if (c.kind === 'jb') { ctx.font = '800 ' + Math.round(Math.max(12, Math.min(22, 30 * scale))) + 'px Inter, system-ui, sans-serif'; ctx.fillText(text, a[0] + 6, a[1] + Math.max(14, Math.min(24, 30 * scale))); }
          else ctx.fillText(text, a[0] + 4, a[1] + 14);
        }
      }
      for (const t of c.terminals || []) {
        const p = toScreen(t.x, t.y);
        ctx.fillStyle = cadTerminalColor(t.role);
        ctx.beginPath(); ctx.arc(p[0], p[1], Math.max(2.5, Math.min(6, 3 * scale)), 0, Math.PI * 2); ctx.fill();
      }
    }
    if (numbering) {
      ctx.save();
      const hint = numberHint();
      for (const id of hint.ids) {
        const m = components.find(c => c.id === id);
        if (!m) continue;
        const a = toScreen(m.x0, m.y1), b = toScreen(m.x1, m.y0);
        const sug = id === hint.suggested;
        ctx.fillStyle = sug ? 'rgba(34,197,94,.38)' : 'rgba(34,197,94,.14)';
        ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
        ctx.strokeStyle = sug ? '#4ade80' : 'rgba(74,222,128,.85)'; ctx.lineWidth = sug ? 4 : 2; ctx.setLineDash(sug ? [] : [6, 4]);
        ctx.strokeRect(a[0] + 1, a[1] + 1, b[0] - a[0] - 2, b[1] - a[1] - 2);
        ctx.setLineDash([]);
      }
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const mp = (() => { const m = components.find(c => c.kind === 'module'); if (!m) return 200; return Math.abs(toScreen(m.x1, m.y0)[0] - toScreen(m.x0, m.y0)[0]); })();
      const fs = Math.round(Math.max(8, Math.min(22, 34 * scale, mp / 5.2)));
      for (const st of numbering.list) for (const [i, id] of (numbering.picked[st.key] || []).entries()) {
        const m = components.find(c => c.id === id);
        if (!m) continue;
        const a = toScreen(m.x0, m.y1), b = toScreen(m.x1, m.y0);
        const cur = st === numbering.list[numbering.i];
        ctx.fillStyle = cur ? 'rgba(124,58,237,.35)' : 'rgba(124,58,237,.18)';
        ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]);
        ctx.font = '800 ' + fs + 'px Inter, system-ui, sans-serif';
        ctx.lineWidth = 3; ctx.strokeStyle = '#0b1220';
        const t = st.tag + '-M' + (i + 1);
        ctx.strokeText(t, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); ctx.fillStyle = '#e9d5ff'; ctx.fillText(t, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      ctx.restore();
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
    /* labels never wider than the module they sit on */
    const modPx = (() => { const m = components.find(c => c.kind === 'module'); if (!m) return 200; const a = toScreen(m.x0, m.y0), b = toScreen(m.x1, m.y0); return Math.abs(b[0] - a[0]); })();
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
    const fs = Math.round(Math.max(7, Math.min(22, 34 * scale, modPx / 5.2)));
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
      const jm = (cad.wiring && cad.wiring.jbMap && cad.wiring.jbMap[cadCompKey(c)]) || {};
      const jb = jm.jb ? components.find(j => j.kind === 'jb' && cadCompKey(j) === jm.jb) : null;
      const s = { comp: c, key: cadCompKey(c), name: cadCompLabel(c, cad.labels), count: saved.modules || 0, confirmed: !!saved.confirmed,
        jbId: jb ? jb.id : null, pair: jm.pair || null, tray: jm.tray === 'CL' || jm.tray === 'CR' ? jm.tray : null };
      /* its modules are in another rack: wired from there; here only B+ / B- and the ceiling leads */
      const aw = awayOf(s.key);
      if (aw) Object.assign(s, { away: true, count: 0, side: aw.side === 'right' ? 'left' : 'right', linkKey: project.id + ':' + s.key, awayRack: aw.rackName });
      return s;
    });
    /* strings fed by an SSC in another rack: a stand-in SSC at this rack's ceiling on that side */
    const remote = cad.remoteSscs.map(r => {
      const comp = cadwRemoteSsc(components, 'remote:' + r.id, r.side === 'right' ? 'right' : 'left');
      if (!comp) return null;
      comp.linkKey = r.rack + ':' + r.ssc; comp.otherRack = r.rackName;
      return { comp: comp, key: 'remote:' + r.id, name: r.name, count: r.count || 0, confirmed: r.count >= 1, remote: true, remoteRack: r.rackName, jbId: null, pair: null, tray: null };
    }).filter(Boolean);
    sscs.push(...remote);
    const pair = (cad.wiring && cad.wiring.pair) === 'P2' ? 'P2' : 'P1';
    /* cable tray for B+ / B- to the junction box: the engineer must choose it (CL / CR) */
    const tray = cad.wiring && (cad.wiring.tray === 'CL' || cad.wiring.tray === 'CR') ? cad.wiring.tray : null;
    const key = JSON.stringify([pair, tray, sscs.map(s => [s.remote ? s.key : cadCompKey(s.comp), s.name, s.count, s.jbId, s.pair, s.tray, !!s.away, s.side || '', s.comp.linkKey || '']),
      components.map(c => cadCompKey(c) + (c.terminals || []).map(t => t.role).join(''))]);
    /* the planner gets the stand-ins too */
    return { sscs: sscs, pair: pair, tray: tray, key: key, comps: components.concat(remote.map(s => s.comp)) };
  }

  /* one row per SSC: which junction box and which pair its B+ / B- go to */
  function jbTable(inp) {
    const jbs = components.filter(c => c.kind === 'jb');
    if (!jbs.length) return '';
    const names = cadJbNames(components);
    const opts = jbs.slice().sort((a, b) => names.get(a.id).localeCompare(names.get(b.id), undefined, { numeric: true }));
    const nearest = s => jbs.slice().sort((p, q) => Math.hypot((p.x0 + p.x1) / 2 - (s.comp.x0 + s.comp.x1) / 2, (p.y0 + p.y1) / 2 - (s.comp.y0 + s.comp.y1) / 2) - Math.hypot((q.x0 + q.x1) / 2 - (s.comp.x0 + s.comp.x1) / 2, (q.y0 + q.y1) / 2 - (s.comp.y0 + s.comp.y1) / 2))[0];
    const rows = inp.sscs.filter(s => !s.remote).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true })).map(s => {
      const auto = s.away ? nearest(s) : cadAutoJb(components, s.comp);
      const chosen = s.jbId ? components.find(j => j.id === s.jbId) : null;
      const need = !auto && !chosen;
      return `<tr class="${need ? 'cad-jb-need' : ''}"><th>${esc(s.name)}</th>
        <td><select data-jb-ssc="${esc(s.key)}" data-what="jb" aria-label="Junction box for ${esc(s.name)}">
          <option value="">${auto ? 'Own column (' + esc(names.get(auto.id)) + ')' : '— choose —'}</option>
          ${opts.map(j => `<option value="${esc(cadCompKey(j))}" ${chosen === j ? 'selected' : ''}>${esc(names.get(j.id))}</option>`).join('')}
        </select></td>
        <td><select data-jb-ssc="${esc(s.key)}" data-what="pair" aria-label="Pair for ${esc(s.name)}">
          <option value="">Rack pair (${inp.pair === 'P2' ? 'right' : 'left'})</option>
          <option value="P1" ${s.pair === 'P1' ? 'selected' : ''}>Left pair (P1)</option>
          <option value="P2" ${s.pair === 'P2' ? 'selected' : ''}>Right pair (P2)</option>
        </select></td>
        <td><select data-jb-ssc="${esc(s.key)}" data-what="tray" aria-label="Cable tray for ${esc(s.name)}">
          <option value="">${inp.tray ? 'Rack tray (' + inp.tray + ')' : '— choose —'}</option>
          <option value="CL" ${s.tray === 'CL' ? 'selected' : ''}>CL · column left</option>
          <option value="CR" ${s.tray === 'CR' ? 'selected' : ''}>CR · column right</option>
        </select></td></tr>`;
    }).join('');
    const missing = inp.sscs.filter(s => !s.remote && !s.away && ((!s.jbId && !cadAutoJb(components, s.comp)) || (!s.tray && !inp.tray))).length;
    return `<details class="cad-jb" ${missing ? 'open' : ''}><summary>Junction boxes per SSC${missing ? ` · <b>${missing} need a choice</b>` : ''}</summary>
      <p class="muted small">Tray: the cable tray the B+ / B− cables run in up to the junction box, CL (column left) or CR (column right) of the SSC's column. Normally each SSC uses the junction box in its own column. If a column has none, pick another junction box; two SSCs can share one by using its left pair and its right pair. JB numbers are shown on the drawing.</p>
      <table class="cad-wire-table cad-jb-table"><thead><tr><th>SSC</th><th>Junction box</th><th>Pair</th><th>Tray</th></tr></thead><tbody>${rows}</tbody></table></details>`;
  }

  function renderWiring() {
    const box = $('cad-wiring');
    if (!box) return;
    const inp = wiringInputs();
    if (!inp.sscs.length) { box.innerHTML = ''; return; }
    if (wiring && wiring.key !== inp.key) wiring = null;
    const ready = inp.sscs.every(s => s.confirmed && (s.away || s.count >= 1));
    const jbs = components.filter(c => c.kind === 'jb');
    /* a rack whose strings are all fed from SSCs in other racks needs no junction box */
    const needJb = inp.sscs.some(s => !s.remote);
    const jbTaught = jbs.length && jbs.every(j => (j.terminals || []).length === 4);
    const todo = [];
    /* a numbering in progress (saved click by click) */
    const draftN = numberedCount(cad.wiring && cad.wiring.draft);
    const totalN = inp.sscs.reduce((n, s) => n + (s.count || 0), 0);
    if (!ready) todo.push('Confirm the SSC numbers and module counts above.');
    if (needJb && !jbs.length) todo.push('Teach the junction box (the box at the top of each SSC column).');
    else if (needJb && !jbTaught) todo.push('Teach the junction box again and click its four connectors left to right (+, −, +, −).');
    if (!inp.tray && inp.sscs.some(s => !s.tray && !s.remote && !s.away)) todo.push('Choose the cable tray for the junction box cables: CL (column left) or CR (column right).');
    /* numberings saved from racks of this same layout */
    const lib = libraryMatches(inp);
    const day = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }); };
    const libHtml = !lib.length ? '' : `<div class="cad-numlib">
        <h5>Numbering from racks of this layout</h5>
        <p class="muted small">Saved when a numbering was finished on a rack with the same modules, SSCs and junction boxes. Using one numbers this rack the same way (also its junction boxes, pairs and trays); you can still change any module.${ready ? '' : ' <b>Confirm the SSC numbers and module counts above first.</b>'}</p>
        <ul>${lib.slice(0, 4).map((e, i) => `<li>
          <div><b>${esc(e.project || 'Unnamed rack')}${e.folderLabel ? ' · ' + esc(e.folderLabel) : ''}</b>${e.folder && e.folder === project.folder ? '<span class="chip chip-ok numlib-same">This project</span>' : ''}<span class="muted small">${esc(day(e.saved))} · ${e.modules} modules · ${e.sscs} SSCs</span>
            <span class="small ${e.crossings ? 'warn' : 'cad-ok'}">${e.crossings == null ? '' : e.crossings ? e.crossings + ' power crossing' + (e.crossings === 1 ? '' : 's') : 'no power crossings'}</span></div>
          <button class="btn ${i === 0 && !wiring ? 'btn-primary' : 'btn-ghost'} btn-xs" data-numlib="${i}" ${ready && jbTaught ? "" : "disabled"}>Use this numbering</button></li>`).join('')}</ul>
      </div>`;
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
        <p class="muted small">Cables · length along the drawn route, without slack. S1-M1 is the module wired to S− and N. <b>Click a module</b> on the drawing to change its number.</p>
        <label class="cad-wire-show"><input type="checkbox" id="cad-wire-show" ${showWiring ? 'checked' : ''}> Show wiring on the drawing</label>
        <a class="btn btn-primary btn-sm cad-wire-go" href="#/sheet/${project.id}">Open the wiring sheet →</a>
        <p class="muted small">Edit the A3 sheet (title block, power plugs, cable routes, labels) and download it as PDF.</p>`;
    }
    box.innerHTML = `<div class="cad-label-card cad-wire-card">
      <h4><span class="cad-swatch" style="background:#ef4444"></span>Wiring
        <span class="chip ${wiring && !wiring.crossings.length ? 'chip-ok' : 'chip-warn'}">${wiring ? (wiring.crossings.length ? 'Check crossings' : 'Generated') : 'Not generated'}</span></h4>
      <p class="muted small">You number the modules by clicking them in order, SSC by SSC. The tool then draws power in series S− → M1 → … → S+, communication S → M1 N, Mk S → Mk+1 N, last S → N and bus B+ / B− to the junction box, along the risers, and checks that no power cables cross.</p>
      ${todo.length ? `<ul class="cad-wire-todo">${todo.map(t => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
      <div class="cad-wire-row">
        <label for="cad-wire-pair">Junction box connectors</label>
        <select id="cad-wire-pair">
          <option value="P1" ${inp.pair === 'P1' ? 'selected' : ''}>Pair 1 (left + −)</option>
          <option value="P2" ${inp.pair === 'P2' ? 'selected' : ''}>Pair 2 (right + −)</option>
        </select>
      </div>
      <div class="cad-wire-row">
        <label for="cad-wire-tray">Cable tray to the junction box</label>
        <select id="cad-wire-tray" class="${inp.tray ? '' : 'cad-need'}">
          ${inp.tray ? '' : '<option value="" selected>— choose —</option>'}
          <option value="CR" ${inp.tray === 'CR' ? 'selected' : ''}>CR · column right</option>
          <option value="CL" ${inp.tray === 'CL' ? 'selected' : ''}>CL · column left</option>
        </select>
      </div>
      <p class="muted small">The pair and the tray (B+ / B− from the SSC up to the junction box) are used for every SSC unless an SSC below says otherwise.</p>
      ${jbTable(inp)}
      ${!wiring && cad.wiring && cad.wiring.orders && !todo.length ? `<button class="btn btn-primary btn-sm cad-wire-go" id="cad-wire-redraw" title="A setting changed; draw the wiring again with your numbering">Draw the wiring again (your numbering)</button>` : ''}
      ${wiring && cad.wiring && cad.wiring.orders && !todo.length && !(wiring.cables || []).some(c => c.ways) ? `<button class="btn btn-primary btn-sm cad-wire-go" id="cad-wire-redraw" title="This wiring was drawn by an older version: draw it again with your numbering so each power cable gets its other ways to choose from on the wiring sheet">Draw the wiring again (adds route choices for the sheet)</button>` : ''}
      ${libHtml}
      ${draftN ? `<button class="btn btn-primary btn-sm cad-wire-go" id="cad-wire-number" ${todo.length ? 'disabled' : ''} title="Carry on numbering from the last module you clicked">Continue numbering (${draftN} of ${totalN} done)</button>`
        : `<button class="btn ${wiring || (cad.wiring && cad.wiring.orders) ? 'btn-ghost' : 'btn-primary'} btn-sm cad-wire-go" id="cad-wire-number" ${todo.length ? 'disabled' : ''} title="Click each SSC's modules in order: M1 (wired to S− and N), M2, …${cad.wiring && cad.wiring.orders ? ' Your current numbering stays until the new one is finished.' : ''}">${wiring || (cad.wiring && cad.wiring.orders) ? 'Number again' : 'Number modules by clicking'}</button>`}
      ${draftN ? `<p class="muted small">Your clicks are saved as you go${cad.wiring.orders ? '; the finished numbering stays until this one is complete' : ''}.</p>` : ''}
      <div class="cad-wire-actions">
        ${draftN ? `<button class="btn btn-ghost btn-sm" id="cad-wire-restart" title="Clear the modules numbered so far and start again from S1-M1">Start numbering over</button>` : ''}
        ${wiring || (cad.wiring && cad.wiring.orders) ? `<button class="btn btn-ghost btn-sm" id="cad-wire-delete" title="Remove the wiring and the numbering from this drawing">Delete wiring</button>` : ''}
        ${wiringHistory.length ? `<button class="btn btn-ghost btn-sm" id="cad-wire-undo" title="Take back the last wiring change">Undo</button>` : ''}
      </div>
      ${result}
    </div>`;
    box.querySelectorAll('[data-jb-ssc]').forEach(sel => sel.onchange = async () => {
      const k = sel.dataset.jbSsc;
      const map = Object.assign({}, cad.wiring && cad.wiring.jbMap);
      const row = Object.assign({}, map[k] || {});
      row[sel.dataset.what] = sel.value || undefined;
      if (!row.jb && !row.pair && !row.tray) delete map[k]; else map[k] = row;
      rememberWiring();
      cad.wiring = Object.assign({}, cad.wiring, { jbMap: map });
      delete cad.wiring.plan; wiring = null;
      await persist(); renderWiring(); viewer.redraw();
    });
    $('cad-wire-tray').onchange = async e => {
      rememberWiring();
      cad.wiring = Object.assign({}, cad.wiring, { tray: e.target.value || undefined });
      delete cad.wiring.plan; wiring = null;
      await persist(); renderWiring(); viewer.redraw();
    };
    $('cad-wire-pair').onchange = async e => {
      rememberWiring();
      cad.wiring = Object.assign({}, cad.wiring, { pair: e.target.value });
      delete cad.wiring.plan; wiring = null;
      await persist(); renderWiring(); viewer.redraw();
    };
    $('cad-wire-number').onclick = () => startNumbering();
    box.querySelectorAll('[data-numlib]').forEach(b => b.onclick = () => useNumbering(lib[+b.dataset.numlib]));
    if ($('cad-wire-redraw')) $('cad-wire-redraw').onclick = () => replan(orderIds(cad.wiring.orders), 'Wiring drawn again with your numbering.');
    if ($('cad-wire-restart')) $('cad-wire-restart').onclick = async () => {
      if (!confirm(`Start numbering over? The ${draftN} module${draftN === 1 ? '' : 's'} numbered so far will be cleared.`)) return;
      rememberWiring();
      cad.wiring = Object.assign({}, cad.wiring);
      delete cad.wiring.draft;
      await persist(); renderWiring();
      startNumbering(true);
    };
    if ($('cad-wire-delete')) $('cad-wire-delete').onclick = async () => {
      if (!confirm('Delete the wiring and the module numbering of this drawing? Undo brings them back during this session.')) return;
      rememberWiring();
      cad.wiring = Object.assign({}, cad.wiring);
      delete cad.wiring.plan; delete cad.wiring.orders; delete cad.wiring.draft;
      wiring = null;
      await persist(); renderWiring(); viewer.redraw();
      say('Wiring and numbering deleted. Undo brings them back.', 'cad-ok');
    };
    if ($('cad-wire-undo')) $('cad-wire-undo').onclick = async () => {
      const prev = wiringHistory.pop();
      if (prev == null) return;
      cad.wiring = JSON.parse(prev);
      wiring = cad.wiring.plan || null;
      showWiring = true;
      await persist(); renderWiring(); viewer.redraw();
      say('Last wiring change undone.', 'cad-ok');
    };
    if (wiring) $('cad-wire-show').onchange = e => { showWiring = e.target.checked; viewer.redraw(); };
  }

  function recognise() {
    components = cad.signatures.length ? cadRecognise(index, cad.signatures) : [];
    /* copies the engineer removed one by one, and parts marked by hand (ACDP / MSM) */
    const excluded = new Set(cad.excluded || []);
    components = components.filter(c => !excluded.has(cadCompKey(c)));
    (cad.manual || []).forEach((m, i) => components.push({ id: m.kind + '-hand-' + (i + 1), kind: m.kind, name: cadKind(m.kind).label,
      x0: m.x0, y0: m.y0, x1: m.x1, y1: m.y1, terminals: [], manual: true, detail: Infinity }));
    /* proposed ACDP / MSM numbers: ACDP1 = closest to the MSM */
    const jbNames = cadJbNames(components);
    components.forEach(c => { if (c.kind === 'jb') c.jbName = jbNames.get(c.id); });
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

  /* strings whose SSC is in another rack of the project (AYK S10176: SSC-1 in Rack 2, its
     modules in Rack 4): the engineer adds each with its module count and the side that rack
     stands on, then numbers its modules here as usual */
  const remoteTotal = () => cad.remoteSscs.reduce((n, r) => n + (+r.count || 0), 0);
  function remoteCard() {
    const others = otherSscs();
    if (!others.length && !cad.remoteSscs.length) return '';
    if (!components.some(c => c.kind === 'module') && !cad.remoteSscs.length) return '';
    const used = new Set(cad.remoteSscs.map(r => r.rack + ':' + r.ssc));
    const free = others.filter(o => !used.has(o.rack + ':' + o.key));
    return `<div class="cad-label-card cad-remote">
      <h4><span class="cad-swatch" style="background:#7c3aed"></span>Strings fed from another rack
        ${cad.remoteSscs.length ? `<span class="chip ${cad.remoteSscs.every(r => r.count >= 1) ? 'chip-ok' : 'chip-warn'}">${cad.remoteSscs.length}</span>` : ''}</h4>
      <p class="muted small">An SSC in another rack of this project can drive modules here (as AYK S10176: SSC-1 in Rack 2, its modules in Rack 4). Add it with its module count and the side its rack stands on, then number its modules by clicking as usual. Its S, N, S+ and S− come in over the ceiling; its B+ / B− stay in its own rack. Draw that rack's wiring again after this one.</p>
      ${cad.remoteSscs.map(r => `<div class="cad-label-row cad-remote-row">
        <b>${esc(r.name)}</b><span class="muted small">${esc(r.rackName)}</span>
        <input type="number" class="cad-modules" min="1" step="1" inputmode="numeric" value="${r.count || ''}" data-remote-count="${esc(r.id)}" placeholder="modules" aria-label="Modules for ${esc(r.name)}"><span class="muted small">modules</span>
        <select data-remote-side="${esc(r.id)}" aria-label="Where ${esc(r.rackName)} stands"><option value="left" ${r.side !== 'right' ? 'selected' : ''}>its rack on the left</option><option value="right" ${r.side === 'right' ? 'selected' : ''}>its rack on the right</option></select>
        <button class="btn btn-ghost btn-xs" data-remote-del="${esc(r.id)}" title="Remove this string">×</button></div>
        ${components.some(c => c.kind === 'ssc' && cadCompLabel(c, cad.labels) === r.name) ? `<p class="warn small">This rack also has an SSC called ${esc(r.name)}: rename one of them so their module labels (${esc('S' + ((String(r.name).match(/\d+/) || [''])[0]))}-M…) differ.</p>` : ''}`).join('')}
      ${free.length ? `<div class="cad-label-row"><select id="cad-remote-pick" aria-label="SSC in another rack">${free.map(o => `<option value="${o.rack}|${esc(o.key)}">${esc(o.name)} · ${esc(o.rackName)}</option>`).join('')}</select>
        <button class="btn btn-ghost btn-sm" id="cad-remote-add">Add string</button></div>`
        : `<p class="muted small">${others.length ? 'Every SSC of the other racks is added.' : 'No SSC in the other racks of this project.'}</p>`}
    </div>`;
  }
  function wireRemote() {
    const box = $('cad-labels');
    const done = async msg => { await persist(); renderFound(); viewer.redraw(); if (msg) say(msg, 'cad-ok'); };
    const add = box.querySelector('#cad-remote-add');
    if (add) add.onclick = () => {
      const [rack, key] = box.querySelector('#cad-remote-pick').value.split('|');
      const o = otherSscs().find(x => String(x.rack) === rack && x.key === key);
      if (!o) return;
      cad.remoteSscs.push({ id: 'r' + Date.now().toString(36), rack: o.rack, rackName: o.rackName, ssc: o.key, name: o.name, count: null, side: 'left' });
      done(`${o.name} of ${o.rackName} added: enter how many modules it drives here.`);
    };
    box.querySelectorAll('[data-remote-count]').forEach(inp => inp.onchange = () => {
      const r = cad.remoteSscs.find(x => x.id === inp.dataset.remoteCount);
      const v = Math.round(+inp.value);
      r.count = v >= 1 ? v : null; done();
    });
    box.querySelectorAll('[data-remote-side]').forEach(sel => sel.onchange = () => { cad.remoteSscs.find(x => x.id === sel.dataset.remoteSide).side = sel.value; done(); });
    box.querySelectorAll('[data-remote-del]').forEach(b => b.onclick = () => {
      const r = cad.remoteSscs.find(x => x.id === b.dataset.remoteDel);
      if (!confirm(`Remove ${r.name} (${r.rackName}) from this rack? Its numbering here is dropped.`)) return;
      cad.remoteSscs = cad.remoteSscs.filter(x => x !== r); done();
    });
  }

  /* ACDP / MSM labels: ACDP numbered from the MSM, MSM left to right; the
     engineer confirms every label. */
  function renderLabels() {
    const box = $('cad-labels');
    const kinds = CAD_KINDS.filter(k => cadNamed(k.id) && components.some(c => c.kind === k.id));
    const modulesFound = components.filter(c => c.kind === 'module').length;
    const remoteHtml = remoteCard();
    if (!kinds.length) { box.innerHTML = remoteHtml; wireRemote(); return; }
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
          ${k.id === 'ssc' && awayOf(cadCompKey(c)) ? `<input type="hidden" value="0" data-modules="${esc(cadCompKey(c))}" data-away="1"><span class="muted small cad-away">modules in ${esc(awayOf(cadCompKey(c)).rackName)}, wired from there</span>`
            : k.id === 'ssc' ? `<input type="number" class="cad-modules" min="1" step="1" inputmode="numeric" placeholder="modules" value="${saved.modules ? esc(String(saved.modules)) : ''}" data-modules="${esc(cadCompKey(c))}" aria-label="Number of modules for ${esc(cadCompLabel(c, cad.labels))}"><span class="muted small">modules</span>` : ''}
        </div>`;
        }).join('')}
        ${k.id === 'ssc' ? `<p class="small muted" data-total>Total entered: <b>${list.reduce((n, c) => n + (awayOf(cadCompKey(c)) ? 0 : +((cad.labels[cadCompKey(c)] || {}).modules) || 0), 0) + remoteTotal()}</b> of ${modulesFound}${cad.remoteSscs.length ? ' (with the strings fed from another rack)' : ''}</p>` : ''}
        <p class="cad-card-msg" role="alert" hidden></p>
        <button class="btn btn-primary btn-sm" data-confirm="${k.id}">Confirm ${k.id === 'ssc' ? 'SSC numbers and modules' : esc(k.label) + ' labels'}</button>
      </div>`;
    }).join('') + remoteHtml;
    wireRemote();
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
      if (total) total.textContent = [...card.querySelectorAll('input[data-modules]')].reduce((n, i) => n + (+i.value || 0), 0) + remoteTotal();
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
        const awayIn = inputs.map(i => !!card.querySelector(`input[data-modules="${CSS.escape(i.dataset.key)}"][data-away]`));
        counts = inputs.map(i => card.querySelector(`input[data-modules="${CSS.escape(i.dataset.key)}"]`).value.trim());
        const bad = counts.findIndex((v, i) => !awayIn[i] && !/^[1-9][0-9]*$/.test(v));
        if (bad >= 0) { refuse(`Enter the number of modules for ${names[bad]} (a whole number, 1 or more).`, card.querySelector(`input[data-modules="${CSS.escape(inputs[bad].dataset.key)}"]`)); return; }
        counts = counts.map(Number);
        const total = counts.reduce((a, b) => a + b, 0) + remoteTotal();
        if (total !== modulesFound) {
          refuse(`The SSC module counts${cad.remoteSscs.length ? ' (with the strings fed from another rack)' : ''} add up to ${total}, but ${modulesFound} modules were found on the drawing. Check the counts, or teach any missing modules first.`, card.querySelector('input[data-modules]'));
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
      cad.manual = (cad.manual || []).filter(m => m.kind !== kind);
      cad.excluded = (cad.excluded || []).filter(k => !k.startsWith(kind + '@'));
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

  /* ACDP / MSM: save every copy found, or only the boxed one (marked by hand) */
  function teachActions(n) {
    const box = $('cad-teach-actions');
    if (!n && n !== 0) { box.hidden = true; box.innerHTML = ''; return; }
    const label = cadKind(teach.kind).label;
    box.hidden = false;
    box.innerHTML = `<button class="btn btn-primary btn-sm" id="cad-save-all" ${n ? '' : 'disabled'}>Save all ${n} (Enter)</button>
      <button class="btn btn-ghost btn-sm" id="cad-save-one" title="Mark just the boxed area as one ${esc(label)}, without finding copies">Only the boxed one</button>`;
    $('cad-save-all').onclick = () => finishTeach();
    $('cad-save-one').onclick = async () => {
      const t = teach;
      (cad.manual = cad.manual || []).push({ kind: t.kind, x0: t.box.x0, y0: t.box.y0, x1: t.box.x1, y1: t.box.y1 });
      teach = null; teachActions(null); prompt(''); viewer.setMode('pan'); teachButton(false);
      recognise(); await persist();
      say(`${label} marked by hand. Box another missed one the same way if needed.`, 'cad-ok');
    };
  }

  function cancelTeach() {
    if (!teach) return false;
    teach = null;
    teachActions(null);
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
    const all = cadFindMatches(index, sig);
    const detail = sig.features.length;
    const hits = all.filter(h => !components.some(c => c.kind !== teach.kind && (c.detail || 0) > detail && cadOverlap(h, c) >= 0.5));
    const dropped = all.length - hits.length;
    teach.box = box; teach.sig = sig; teach.hits = hits;
    /* copies that overlap parts of another kind mean the box caught a neighbour */
    const overlap = (a, b) => {
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0), h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (w <= 0 || h <= 0) return 0;
      return (w * h) / Math.min((a.x1 - a.x0) * (a.y1 - a.y0), (b.x1 - b.x0) * (b.y1 - b.y0));
    };
    const clash = new Map();
    for (const h of hits) for (const c of components) {
      if (c.kind === teach.kind || overlap(h, c) < 0.3 || (c.detail || 0) > detail) continue;
      clash.set(c.kind, (clash.get(c.kind) || new Set()).add(h));
    }
    const warn = clash.size ? ` · ⚠ ${Math.max(...[...clash.values()].map(v => v.size))} of them overlap ${[...clash.keys()].map(k => cadKind(k).label + 's').join(' and ')}: the box probably caught a neighbouring part. Press Esc and draw a tighter box` : '';
    if (cadKind(teach.kind).wired === false) {
      /* back-wired part: nothing to click, just check the count and save */
      teach.step = 'terminals'; teach.roles = null; teach.picked = []; teach.noTerminals = true;
      viewer.setMode('pan');
      prompt(`Found ${hits.length} ${cadKind(teach.kind).label}${dropped ? ` (${dropped} more matched inside other parts and were left out)` : ''}. Save all, or keep only the boxed one · Wrong? Cancel and box again${warn}`);
      teachActions(hits.length);
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
    teachActions(null);
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

  /* Open: saved parts for this drawing (on a new rack: those of the project's other racks),
     else the device library. */
  if (cad.signatures.length) {
    recognise();
    if (cad.learnedFrom) {
      say(`Parts taught on ${cad.learnedFrom} of this project were used: ${components.length} found. Check them, then confirm the SSCs.`, 'cad-ok');
      delete cad.learnedFrom;
      persist();
    } else if (renamedTerminals) persist();
  }
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
  const project = { name: parts.name || 'Example rack',
    config: { cad: { signatures: parts.signatures, labels: parts.labels, components: [] } },
    status: 'draft', created_at: now, updated_at: now, underlay_kind: 'cad', cad_file: parts.file || 'example.dxf', example: 'rack-111' };
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
  let wiring = cad.wiring && cad.wiring.plan;
  if (!wiring) { shell(`<div class="empty"><h3>No wiring yet</h3><p>Number the modules on the drawing first (Wiring card: Number modules by clicking).</p>${back}</div>`, 'dash'); return; }
  let flat;
  try { flat = cadFlatten(cadParseDxf(await record.blob.text())); } catch (e) { shell(`<div class="empty"><h3>Could not read the drawing</h3><p>${esc(e.message)}</p>${back}</div>`, 'dash'); return; }
  let jbs = (cad.components || []).filter(c => c.kind === 'jb');
  /* SSC and MSM names for the sheet, centred on each part */
  const partsOf = c2 => (c2.components || []).filter(c => c.kind === 'ssc' || c.kind === 'msm').map(c => ({
    id: 'part:' + cadCompKey(c), text: cadCompLabel(c, c2.labels || {}), x: (c.x0 + c.x1) / 2, y: c.y0 + (c.y1 - c.y0) * 0.62 }));
  let parts = partsOf(cad);
  const st = sheetSettings(cad.sheet, project.name);
  /* other racks of the same project drawn beside this one (AYK DWG2586 sheet 2: Rack 2 and Rack 3) */
  const projectRacks = project.folder ? (await localProjects()).filter(p => p.underlay_kind === 'cad' && p.folder === project.folder && p.id !== project.id)
    .sort((x, y) => String(x.name).localeCompare(String(y.name), undefined, { numeric: true })) : [];
  st.racks = st.racks.filter(rid => projectRacks.some(p => p.id === rid));
  let sheetComps = cad.components || [], grounds = [], ground0 = null, rackSkipped = [];
  if (st.racks.length) {
    const list = [{ key: 'r' + project.id, name: project.name, flat: flat, wiring: wiring, components: cad.components || [], parts: parts, jbs: jbs, unit: sheetUnit(cad.components) }];
    for (const rid of st.racks) {
      const p = projectRacks.find(x => x.id === rid), c2 = (p.config && p.config.cad) || {};
      let f = null;
      try { const rec = await localGetUnderlay(rid); f = rec && rec.blob ? cadFlatten(cadParseDxf(await rec.blob.text())) : null; } catch (e) { f = null; }
      if (!f) { rackSkipped.push(p.name); continue; }
      list.push({ key: 'r' + rid, name: p.name, flat: f, wiring: (c2.wiring && c2.wiring.plan) || null, components: c2.components || [], parts: partsOf(c2), jbs: (c2.components || []).filter(c => c.kind === 'jb'), unit: sheetUnit(c2.components) });
    }
    if (list.length > 1) {
      const M = sheetMergeRacks(list, 600);
      flat = M.flat; wiring = M.wiring; jbs = M.jbs; sheetComps = M.components; grounds = M.grounds; ground0 = M.ground0;
      /* each rack's name above it, as DWG2586 */
      const u0 = list[0].unit;
      parts = M.parts.concat(M.racks.map(r => ({ id: 'rack:' + r.key, text: r.name, x: (r.bounds.minX + r.bounds.maxX) / 2, y: r.bounds.maxY + 150 * u0, size: 4.5, color: '#111827', bold: false })));
    }
  }
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
          <span id="sh-page-nav"></span>
          <button class="btn btn-ghost btn-sm" id="sh-zoom-out" title="Zoom out">−</button>
          <button class="btn btn-ghost btn-sm" id="sh-zoom-fit" title="Fit the whole sheet (key 0). The mouse wheel zooms at the pointer (or + / -); drag the paper to move around.">Fit</button>
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
            <label class="sh-field" title="The title block always says SCALE: NTS; this only sets how large the rack is drawn on the A3 sheet"><span>Rack size on sheet</span><select id="sh-scale"><option value="auto">Fit the sheet</option>${SHEET_SCALES.map(v => `<option value="${v}" ${String(F.scale) === String(v) ? 'selected' : ''}>1:${v}</option>`).join('')}</select></label>
            <p class="muted small"><b>Look closely:</b> the <b>mouse wheel</b> zooms in where the pointer is (or + / −, 0 fits the sheet) · drag the paper to move around · click a crossing in the list to zoom to it.</p>
            <p class="muted small"><b>Edit the wiring:</b> <b>double-click</b> a power cable to send it <b>another way</b> (each way shows its length and crossings) or to draw it <b>straight</b>, <b>bent</b> or <b>curved</b> ·<b>pull a cable</b>: across a section to move it, along a section to move the next bend (so it takes a new bend round a port), near a terminal to step it aside (a short stub stays in the terminal) · drag a curved cable sideways to change its curve · <b>Shift + double-click</b> a bent cable to add a bend there · <b>right-click</b> a cable to put it back as planned. Labels, the Note 2 label and the grounding-point label can be dragged too.</p>
            <p class="small" id="sh-cross" role="status"></p>
            <ul class="sh-xlist" id="sh-xlist"></ul>
            <button class="btn btn-ghost btn-sm" id="sh-reset">Undo all moves</button>
          </section>
          <section>
            <h3>Racks on this sheet</h3>
            ${projectRacks.length ? `<p class="muted small">Draw other racks of this project beside ${esc(project.name)}, each with its own wiring (as AYK's DWG2586: Rack 2 and Rack 3 on one sheet). Each rack is still taught, numbered and wired on its own drawing.</p>
              <ul class="sh-racks">${projectRacks.map(p => { const w = !!(p.config && p.config.cad && p.config.cad.wiring && p.config.cad.wiring.plan);
                return `<li><label><input type="checkbox" data-rack="${p.id}" ${st.racks.includes(p.id) ? 'checked' : ''}> ${esc(p.name)}</label>${w ? '' : ' <span class="muted small">(not wired yet: drawn without wiring)</span>'}</li>`; }).join('')}</ul>
              ${rackSkipped.length ? `<p class="small warn">Could not read the drawing of ${esc(rackSkipped.join(', '))}.</p>` : ''}`
              : '<p class="muted small">Put this rack in a project with its other racks to draw several racks on one sheet.</p>'}
          </section>
          <section>
            <h3>Sheets</h3>
            <p class="muted small">A large rack can go over several sheets, as AYK's DWG2586: every sheet draws the whole rack and the wiring of the strings you put on it; strings wired on another sheet are fenced in purple with "Please see sheet N, SSC…, for wiring connections." The title block's Sheet field ("1 OF 14") numbers the first; the next count on.</p>
            <div id="sh-pages"></div>
          </section>
          <section>
            <h3>Title block</h3>
            ${fieldRow('docNumber', 'Document Number')}${fieldRow('docType', 'Document Type')}
            ${fieldRow('designNumber', 'Design Number')}${fieldRow('designName', 'Design Name')}
            ${fieldRow('bankSize', 'Rack Size')}${fieldRow('bankWeight', 'Rack Weight')}
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
  /* drawing units per real mm (a rack drawn at 1:44 has modules ~9 units wide): the sheet,
     the crossing check and cable lengths all work in real millimetres */
  const unit = sheetUnit(cad.components);
  CADW_K = unit;
  const model = () => ({ flat: flat, bounds: flat.bounds, jbs: jbs, parts: parts, wiring: wiring, settings: st, logo: logo, unit: unit, components: sheetComps, grounds: grounds, ground0: ground0 });
  let zoom = 1, P = null, rackKey = '';
  const save = async () => {
    cad.sheet = { fields: Object.assign({}, F, { scaleText: undefined, sheetText: undefined }), plugs: st.plugs, edits: st.edits, pages: st.pages, racks: st.racks };
    project.updated_at = new Date().toISOString();
    try { await localPutProject(project); } catch (e) { say('Could not save: ' + e.message, 'warn'); }
  };

  /* the rack linework, in sheet millimetres (Y down), built once per placement */
  let rackPath = null, rackFrame = 0;
  function paintRack() {
    const key = P.scale + '|' + P.X(0) + '|' + P.Y(0);
    if (key !== rackKey) {
      rackKey = key;
      const X = x => P.X(x), Y = y => A3_H - P.Y(y);
      const path = new Path2D();
      for (const pl of flat.polylines) {
        const a = pl.pts;
        path.moveTo(X(a[0]), Y(a[1]));
        for (let i = 2; i < a.length; i += 2) path.lineTo(X(a[i]), Y(a[i + 1]));
        if (pl.closed) path.closePath();
      }
      for (const c of flat.circles) { path.moveTo(X(c.cx + c.r), Y(c.cy)); path.arc(X(c.cx), Y(c.cy), c.r * P.k, 0, Math.PI * 2); }
      rackPath = path;
    }
    drawRack();
  }
  /* the canvas covers only the part of the sheet in view, at screen resolution, so the
     rack stays sharp however far the engineer zooms in */
  function drawRack() {
    if (rackFrame) return;
    rackFrame = requestAnimationFrame(() => {
      rackFrame = 0;
      if (!rackPath || !$('sh-stage')) return;
      const stage = $('sh-stage'), paper = $('sh-paper'), cv = $('sh-rack');
      const sr = stage.getBoundingClientRect(), pr = paper.getBoundingClientRect();
      const x0 = Math.max(sr.left, pr.left), y0 = Math.max(sr.top, pr.top);
      const x1 = Math.min(sr.right, pr.right), y1 = Math.min(sr.bottom, pr.bottom);
      if (x1 <= x0 || y1 <= y0) return;
      const dpr = window.devicePixelRatio || 1, pxmm = pr.width / A3_W;
      Object.assign(cv.style, { left: (x0 - pr.left) + 'px', top: (y0 - pr.top) + 'px', width: (x1 - x0) + 'px', height: (y1 - y0) + 'px' });
      cv.width = Math.round((x1 - x0) * dpr); cv.height = Math.round((y1 - y0) * dpr);
      const ctx = cv.getContext('2d');
      const k = pxmm * dpr;
      ctx.setTransform(k, 0, 0, k, -(x0 - pr.left) * dpr, -(y0 - pr.top) * dpr);
      ctx.strokeStyle = '#374151';
      ctx.lineWidth = Math.max(0.05, 0.6 / pxmm);   /* about half a screen pixel, at least 0.05 mm */
      ctx.stroke(rackPath);
    });
  }
  let page = 1;
  function render() {
    const svg = sheetSvgTarget();
    page = Math.min(page, sheetPagesOf(st, wiring).count);
    P = sheetDraw(svg, Object.assign(model(), { rack: false, interactive: true, page: page, logo: logo ? { src: logo.src, w: logo.w, h: logo.h } : null }));
    $('sh-g').innerHTML = svg.svg();
    paintRack();
    markCrossings();
    drawPages();
  }
  /* ---- sheets of this rack: switch, add, delete, which strings each wires, the fence notes ---- */
  document.querySelectorAll('[data-rack]').forEach(cb => cb.onchange = async () => {
    const rid = +cb.dataset.rack;
    st.racks = cb.checked ? st.racks.concat([rid]) : st.racks.filter(x => x !== rid);
    await save();
    renderSheetPage(id);
  });
  function drawPages() {
    const pg = sheetPagesOf(st, wiring), n = pg.count;
    const num = k => sheetNumber(F, k, n).n;
    $('sh-page-nav').innerHTML = n > 1 ? `<button class="btn btn-ghost btn-sm" data-page-go="${page - 1}" ${page <= 1 ? 'disabled' : ''} title="Previous sheet (Left arrow or Page Up)">‹</button>
      <select id="sh-page" aria-label="Sheet">${Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${i + 1 === page ? 'selected' : ''}>Sheet ${num(i + 1)}</option>`).join('')}</select>
      <button class="btn btn-ghost btn-sm" data-page-go="${page + 1}" ${page >= n ? 'disabled' : ''} title="Next sheet (Right arrow or Page Down)">›</button>` : '';
    const away = [];
    for (let k = 1; k <= n; k++) if (k !== page) {
      const names = wiring.strings.filter(s => pg.of[s.name] === k).map(s => s.name).sort((x, y) => String(x).localeCompare(String(y), undefined, { numeric: true }));
      if (names.length) away.push({ k: k, key: page + ':' + k, names: names });
    }
    $('sh-pages').innerHTML = `
      <div class="sh-page-tabs">${Array.from({ length: n }, (_, i) => `<button class="btn btn-sm ${i + 1 === page ? 'btn-primary' : 'btn-ghost'}" data-page-go="${i + 1}">Sheet ${num(i + 1)}</button>`).join('')}
        <button class="btn btn-ghost btn-sm" id="sh-page-add" title="Add a sheet: the rack is copied onto it; then choose the strings it wires">+ Add sheet</button></div>
      ${n > 1 ? `<table class="sh-page-table"><thead><tr><th>String</th><th>Wired on</th></tr></thead><tbody>${wiring.strings.map(s => `<tr><td>${esc(s.name)}</td><td><select data-page-of="${esc(s.name)}">${Array.from({ length: n }, (_, i) => `<option value="${i + 1}" ${pg.of[s.name] === i + 1 ? 'selected' : ''}>Sheet ${num(i + 1)}</option>`).join('')}</select></td></tr>`).join('')}</tbody></table>
        ${away.length ? `<h4>Notes on sheet ${num(page)}</h4>${away.map(w => `<label class="sh-field sh-see"><span>${esc(w.names.join(', '))} (sheet ${num(w.k)})</span><textarea rows="2" data-see="${w.key}" placeholder="Please see sheet ${num(w.k)}, ${esc(w.names.join(' & '))}, for wiring connections.">${esc((st.pages.notes || {})[w.key] || '')}</textarea></label>`).join('')}<p class="muted small">Leave a note empty for AYK's wording. Drag a note on the sheet to move it.</p>` : ''}
        <button class="btn btn-ghost btn-sm" id="sh-page-del">Delete sheet ${num(page)}</button>`
      : '<p class="muted small">One sheet: every string is wired on it. Add a sheet to split the wiring.</p>'}`;
    document.querySelectorAll('[data-page-go]').forEach(b => b.onclick = () => { const k = +b.dataset.pageGo; if (k >= 1 && k <= n) { page = k; render(); } });
    if ($('sh-page')) $('sh-page').onchange = e => { page = +e.target.value; render(); };
    /* keyboard: Page Up / Left arrow = previous sheet, Page Down / Right arrow = next */
    if (WF.sheetKeys) document.removeEventListener('keydown', WF.sheetKeys);
    WF.sheetKeys = ev => {
      if (!$('sh-page-nav')) { document.removeEventListener('keydown', WF.sheetKeys); WF.sheetKeys = null; return; }
      if (ev.ctrlKey || ev.metaKey || ev.altKey || /INPUT|TEXTAREA|SELECT/.test((ev.target && ev.target.tagName) || '')) return;
      const d = { PageUp: -1, ArrowLeft: -1, PageDown: 1, ArrowRight: 1 }[ev.key];
      if (!d || page + d < 1 || page + d > n) return;
      ev.preventDefault(); page += d; render();
    };
    document.addEventListener('keydown', WF.sheetKeys);
    $('sh-page-add').onclick = () => {
      st.pages.count = n + 1; page = n + 1;
      save(); render();
      say(`Sheet ${num(page)} added: the rack is copied onto it. Choose the strings it wires in the table.`);
    };
    if ($('sh-page-del')) $('sh-page-del').onclick = () => {
      const mine = wiring.strings.filter(s => pg.of[s.name] === page).map(s => s.name);
      if (!confirm(`Delete sheet ${num(page)}?${mine.length ? ` ${mine.join(', ')} will be wired on sheet ${num(page === 1 ? 1 : page - 1)} instead.` : ''}`)) return;
      const back = page === 1 ? 1 : page - 1;
      const of = {};
      for (const s of wiring.strings) { const k = pg.of[s.name]; of[s.name] = k === page ? back : k > page ? k - 1 : k; }
      st.pages.of = of; st.pages.count = n - 1; st.pages.notes = {};
      page = back; save(); render();
    };
    document.querySelectorAll('[data-page-of]').forEach(sel => sel.onchange = () => { st.pages.of = Object.assign({}, st.pages.of, { [sel.dataset.pageOf]: +sel.value }); save(); render(); });
    document.querySelectorAll('[data-see]').forEach(ta => ta.onchange = () => {
      st.pages.notes = Object.assign({}, st.pages.notes);
      if (ta.value.trim()) st.pages.notes[ta.dataset.see] = ta.value.trim(); else delete st.pages.notes[ta.dataset.see];
      save(); render();
    });
  }
  /* power cables crossing each other with the edits applied: outlined, and counted */
  const planned = (wiring.crossings || []).length;
  const ports = cadwPorts(cad.components || []);
  function markCrossings() {
    const cables = wiring.cables.map(c => Object.assign({}, c, { pts: (st.edits.cables && st.edits.cables[c.id]) || c.pts, box: null }));
    const x = cadwPowerCrossings(cables);
    const bad = new Set(x.flatMap(p => [p.a, p.b]));
    $('sh-g').querySelectorAll('.sh-cable').forEach(el => el.classList.toggle('sh-x', bad.has(el.dataset.id)));
    /* a red ring on the sheet where each pair crosses */
    const byId = new Map(cables.map(c => [c.id, c]));
    const rings = [];
    x.forEach((p, i) => { for (const q of crossPoints(byId.get(p.a).pts, byId.get(p.b).pts)) rings.push(`<circle class="sh-ring" data-x="${i}" cx="${P.X(q[0]).toFixed(2)}" cy="${P.Y(q[1]).toFixed(2)}" r="2.6"/>`); });
    /* no cable may run over a connector (port) it is not connected to: orange ring on the port */
    const over = cables.map(c => ({ id: c.id, at: cadwPortHits(c.pts, ports) })).filter(h => h.at.length);
    for (const h of over) for (const q of h.at) rings.push(`<circle class="sh-ring sh-ring-port" cx="${P.X(q[0]).toFixed(2)}" cy="${P.Y(q[1]).toFixed(2)}" r="1.8"/>`);
    $('sh-g').querySelectorAll('.sh-cable').forEach(el => el.classList.toggle('sh-x', bad.has(el.dataset.id) || over.some(h => h.id === el.dataset.id)));
    $('sh-g').querySelectorAll('.sh-rings').forEach(g => g.remove());
    $('sh-g').insertAdjacentHTML('beforeend', `<g class="sh-rings">${rings.join('')}</g>`);
    x.over = over;
    const el = $('sh-cross');
    if (!el) return x;
    const bits = [];
    if (x.length) bits.push(`${x.length} power cable crossing${x.length === 1 ? '' : 's'} (red rings)${x.length > planned ? ` — ${x.length - planned} more than the planned wiring` : ''}`);
    if (over.length) bits.push(`${over.length} cable${over.length === 1 ? ' runs' : 's run'} over a connector (orange rings)`);
    el.className = 'small ' + (x.length > planned || over.length ? 'warn' : x.length ? '' : 'cad-ok');
    el.textContent = bits.length ? bits.join('; ') + '. Click one to fix it:' : 'No power cables cross, and no cable runs over a connector.';
    const list = $('sh-xlist');
    list.innerHTML = x.map((p, i) => `<li><button type="button" class="sh-xbtn" data-x="${i}"><b>${esc(p.a)}</b><span>crosses</span><b>${esc(p.b)}</b></button></li>`).join('') +
      over.map((h, i) => `<li><button type="button" class="sh-xbtn sh-xport" data-port="${i}"><b>${esc(h.id)}</b><span>runs over a connector</span></button></li>`).join('');
    list.querySelectorAll('[data-x]').forEach(b => b.onclick = ev => fixCrossing(x[+b.dataset.x], ev));
    list.querySelectorAll('[data-port]').forEach(b => b.onclick = ev => fixPort(over[+b.dataset.port], ev));
    return x;
  }
  /* a cable over a connector, picked from the list: zoom to the connector, select the cable */
  function fixPort(h, ev) {
    const q = h.at[0];
    const stage = $('sh-stage');
    const fit = Math.min((stage.clientWidth - 24) / A3_W, (stage.clientHeight - 24) / A3_H);
    zoom = Math.max(zoom, Math.min(ZOOM_MAX, stage.clientWidth / 60 / fit));
    const sr = stage.getBoundingClientRect();
    applyZoom([P.X(q[0]), A3_H - P.Y(q[1]), sr.left + sr.width / 2, sr.top + sr.height / 2]);
    $('sh-g').querySelectorAll('.sh-cable').forEach(e => e.classList.toggle('sh-sel', e.dataset.id === h.id));
    say(`${h.id} runs over a connector (orange ring). Pull it aside: along a section to move the next bend, or near its terminal to step it round the port.`, 'warn');
  }
  /* where two polylines cross (drawing units) */
  function crossPoints(a, b) {
    const out = [];
    for (let i = 1; i < a.length; i++) for (let j = 1; j < b.length; j++) {
      const p = a[i - 1], q = a[i], r = b[j - 1], s = b[j];
      if (!cadwSegCross(p, q, r, s)) continue;
      const d = (q[0] - p[0]) * (s[1] - r[1]) - (q[1] - p[1]) * (s[0] - r[0]);
      if (Math.abs(d) < 1e-12) {
        /* overlapping along the same line: the middle of the shared part */
        const xs = [p, q, r, s].sort((u, v) => u[0] - v[0] || u[1] - v[1]);
        out.push([(xs[1][0] + xs[2][0]) / 2, (xs[1][1] + xs[2][1]) / 2]);
      } else {
        const t = ((r[0] - p[0]) * (s[1] - r[1]) - (r[1] - p[1]) * (s[0] - r[0])) / d;
        out.push([p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])]);
      }
    }
    return out;
  }
  /* a crossing picked from the list: show both cables, then offer the other ways for the
     cable that has more of them */
  function fixCrossing(p, ev) {
    const ca = wiring.cables.find(c => c.id === p.a), cb = wiring.cables.find(c => c.id === p.b);
    /* zoom in on where they cross (about 60 mm of sheet across the view) */
    const q = crossPoints(st.edits.cables[ca.id] || ca.pts, st.edits.cables[cb.id] || cb.pts)[0];
    if (q) {
      const stage = $('sh-stage');
      const fit = Math.min((stage.clientWidth - 24) / A3_W, (stage.clientHeight - 24) / A3_H);
      zoom = Math.max(zoom, Math.min(ZOOM_MAX, stage.clientWidth / 60 / fit));
      const sr = stage.getBoundingClientRect();
      applyZoom([P.X(q[0]), A3_H - P.Y(q[1]), sr.left + sr.width / 2, sr.top + sr.height / 2]);
    }
    $('sh-g').querySelectorAll('.sh-cable').forEach(e => e.classList.toggle('sh-sel', e.dataset.id === p.a || e.dataset.id === p.b));
    const cab = ((cb.ways || []).length > (ca.ways || []).length) ? cb : ca;
    const r = ev.currentTarget.getBoundingClientRect();
    /* over the side panel, so the sheet (and the dashed preview) stays in view */
    const panel = document.querySelector('.sh-side').getBoundingClientRect();
    openShape(cab, panel.left - 4, r.bottom - 12, true);
  }
  /* zoom: 1 = the whole sheet fits; up to 40x to look closely at crossings.
     `at` = [sheet x mm, sheet y mm from the top, screen x, screen y]: that point of the sheet
     ends up under that point of the screen (the pointer, or the middle of the view) */
  const ZOOM_MAX = 40;
  function applyZoom(at) {
    const stage = $('sh-stage'), paper = $('sh-paper');
    if (!stage) return;
    const fit = Math.min((stage.clientWidth - 24) / A3_W, (stage.clientHeight - 24) / A3_H);
    const pxmm = Math.max(0.5, fit * zoom);
    const w = A3_W * pxmm, h = A3_H * pxmm;
    paper.style.width = w + 'px';
    paper.style.height = h + 'px';
    /* centred while smaller than the view; scrollable edge to edge once larger */
    paper.style.marginTop = Math.max(0, (stage.clientHeight - 24 - h) / 2) + 'px';
    if (at) {
      const pr = paper.getBoundingClientRect();
      stage.scrollLeft += (pr.left + at[0] * pxmm) - at[2];
      stage.scrollTop += (pr.top + at[1] * pxmm) - at[3];
    }
    $('sh-zoom-fit').textContent = zoom === 1 ? 'Fit' : Math.round(zoom * 100) + '%';
    drawRack();
  }
  /* the sheet point (mm from the top-left) under a screen point */
  const sheetAt = (cx, cy) => {
    const pr = $('sh-paper').getBoundingClientRect(), pxmm = pr.width / A3_W;
    return [(cx - pr.left) / pxmm, (cy - pr.top) / pxmm, cx, cy];
  };
  const stageMid = () => { const r = $('sh-stage').getBoundingClientRect(); return sheetAt(r.left + r.width / 2, r.top + r.height / 2); };
  const zoomTo = (z, at) => { const a = at || stageMid(); zoom = Math.max(0.6, Math.min(ZOOM_MAX, z)); applyZoom(a); };
  render(); applyZoom();
  wfResizableSide(document.querySelector('.sh-body'));
  new ResizeObserver(() => applyZoom()).observe($('sh-stage'));
  $('sh-stage').addEventListener('scroll', drawRack, { passive: true });
  $('sh-zoom-in').onclick = () => zoomTo(zoom * 1.5);
  $('sh-zoom-out').onclick = () => zoomTo(zoom / 1.5);
  $('sh-zoom-fit').onclick = () => { zoom = 1; applyZoom(); $('sh-stage').scrollTo(0, 0); };
  /* mouse wheel (or pinch on a touchpad) zooms at the pointer; Shift + wheel scrolls */
  $('sh-stage').addEventListener('wheel', ev => {
    if (ev.shiftKey) return;
    ev.preventDefault();
    const dy = Math.max(-60, Math.min(60, ev.deltaY * (ev.deltaMode === 1 ? 16 : 1)));
    zoomTo(zoom * Math.exp(-dy * 0.004), sheetAt(ev.clientX, ev.clientY));
  }, { passive: false });
  /* keyboard: + and - zoom, 0 fits (not while typing in the title block) */
  const zoomKeys = ev => {
    if (!$('sh-stage')) { document.removeEventListener('keydown', zoomKeys); return; }
    if (/INPUT|TEXTAREA|SELECT/.test((ev.target && ev.target.tagName) || '') || ev.ctrlKey || ev.metaKey) return;
    if (ev.key === '+' || ev.key === '=') zoomTo(zoom * 1.5);
    else if (ev.key === '-') zoomTo(zoom / 1.5);
    else if (ev.key === '0') $('sh-zoom-fit').onclick();
  };
  document.addEventListener('keydown', zoomKeys);

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
  $('sh-reset').onclick = () => { st.edits = { cables: {}, labels: {}, kinds: {}, ground: null, plugLabel: null }; render(); save(); say('All moves undone.'); };
  /* after an edit: tell the engineer straight away when it adds a power crossing */
  const afterEdit = (what, id) => {
    render(); save();
    const x = markCrossings();
    const mine = x.filter(p => p.a === id || p.b === id);
    const onPort = (x.over || []).some(h => h.id === id);
    if (onPort) say(`${what} ⚠ It now runs over a connector (orange ring). Pull it clear of the port, or right-click it to undo.`, 'warn');
    else if (mine.length) say(`${what} ⚠ It now crosses ${mine.map(p => p.a === id ? p.b : p.a).join(', ')} (outlined). Move it again or right-click it to undo.`, 'warn');
    else if (x.length > planned) say(`${what} Other edited cables still cross (outlined).`, 'warn');
    else say(what, 'cad-ok');
  };
  const drawingPt = s0 => [(s0[0] - P.X(0)) / P.k, (s0[1] - P.Y(0)) / P.k];
  /* nearest section of a polyline to a point (drawing units); skips zero-length sections */
  const nearestSeg = (pts, d, from, to) => {
    let best = -1, bd = Infinity;
    for (let i = from; i < to; i++) {
      const a = pts[i], b = pts[i + 1];
      const len2 = (b[0] - a[0]) ** 2 + (b[1] - a[1]) ** 2;
      if (len2 < 1e-12) continue;
      const t = Math.max(0, Math.min(1, ((d[0] - a[0]) * (b[0] - a[0]) + (d[1] - a[1]) * (b[1] - a[1])) / len2));
      const dist = Math.hypot(d[0] - a[0] - t * (b[0] - a[0]), d[1] - a[1] - t * (b[1] - a[1]));
      if (dist < bd - 1e-9) { bd = dist; best = i; }
    }
    return best;
  };
  /* how a cable is drawn: the engineer's choice, else as planned */
  if (!st.edits.kinds) st.edits.kinds = {};
  const typeOf = cab => st.edits.kinds[cab.id] || (cab.curve ? 'curved' : cab.pts.length <= 2 ? 'straight' : 'bent');
  /* a smooth curve between two ends, bowed sideways by `off` (drawing units, signed) */
  const bulge = (a, b, off) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L, nx = -uy, ny = ux;
    const k = off * 1.33;
    const c1 = [a[0] + ux * L * 0.2 + nx * k, a[1] + uy * L * 0.2 + ny * k], c2 = [b[0] - ux * L * 0.2 + nx * k, b[1] - uy * L * 0.2 + ny * k];
    const out = [];
    for (let i = 0; i <= 20; i++) {
      const t = i / 20, u = 1 - t;
      out.push([u * u * u * a[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * b[0],
        u * u * u * a[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * b[1]]);
    }
    return out;
  };
  /* the cable redrawn as straight, bent or curved, between the same two terminals */
  const shapeOf = (cab, k) => {
    const a = cab.pts[0].slice(), b = cab.pts[cab.pts.length - 1].slice();
    const dx = b[0] - a[0], dy = b[1] - a[1], span = Math.hypot(dx, dy) || 1;
    if (k === 'straight') return [a, b];
    if (k === 'curved') return cab.curve ? cab.pts.map(p => p.slice()) : bulge(a, b, (Math.abs(dx) >= Math.abs(dy) ? -1 : 1) * Math.sign(dx || 1) * span * 0.18);
    /* bent: the planned right-angle route, else one step out and back beside the line */
    if (!cab.curve && cab.pts.length > 2) return cab.pts.map(p => p.slice());
    if (Math.abs(dx) >= Math.abs(dy)) { const y = Math.min(a[1], b[1]) - span * 0.12; return [a, [a[0], y], [b[0], y], b]; }
    const x = Math.max(a[0], b[0]) + span * 0.12;
    return [a, [x, a[1]], [x, b[1]], b];
  };

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
      const lab = kind === 'label' ? (wiring.strings.flatMap(s => s.labels).concat(parts).find(l => l.id === dEl.dataset.id) || (dEl.dataset.x ? { x: +dEl.dataset.x, y: +dEl.dataset.y } : null)) : null;
      if (kind === 'label' && !lab) return;
      drag = { kind: kind, start: s0, el: dEl, id: dEl.dataset.id,
        orig: kind === 'label' ? (st.edits.labels[dEl.dataset.id] || [lab.x, lab.y]).slice()
          : kind === 'plug' ? (st.edits.plugLabel || [-30, -2]).slice() : (st.edits.ground || [0, 0]).slice() };
    } else if (cEl) {
      const cab = wiring.cables.find(c => c.id === cEl.dataset.id);
      if (!cab) return;
      if (ev.button === 2) return;           /* right-click: handled by contextmenu */
      const type = typeOf(cab);
      if (type === 'curved') {
        /* a curved cable: dragging it sideways changes how deep it curves, and which way */
        const a = cab.pts[0], b = cab.pts[cab.pts.length - 1];
        drag = { kind: 'curve', start: s0, el: cEl, cab: cab, a: a, b: b };
        try { svgEl.setPointerCapture(ev.pointerId); } catch (err) {}
        ev.preventDefault();
        return;
      }
      /* a straight cable becomes bent as soon as it is pulled */
      const pts = (st.edits.cables[cab.id] || (type === 'straight' ? shapeOf(cab, 'bent') : cab.pts)).map(p => p.slice());
      const best = nearestSeg(pts, drawingPt(s0), 0, pts.length - 1);
      if (best < 0) return;
      /* which way it moves is decided by the first few millimetres of the pull (pointermove) */
      drag = { kind: 'cable', start: s0, el: cEl, cab: cab, base: pts, seg: best, mode: null, toBent: type === 'straight' };
    } else {
      /* empty paper: drag to move around the sheet */
      const stage = $('sh-stage');
      drag = { kind: 'pan', x: ev.clientX, y: ev.clientY, sl: stage.scrollLeft, st: stage.scrollTop };
      svgEl.classList.add('sh-panning');
    }
    try { svgEl.setPointerCapture(ev.pointerId); } catch (err) {}
    ev.preventDefault();
  });
  svgEl.addEventListener('pointermove', ev => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const stage = $('sh-stage');
      stage.scrollLeft = drag.sl - (ev.clientX - drag.x);
      stage.scrollTop = drag.st - (ev.clientY - drag.y);
      return;
    }
    const s1 = toSheet(ev);
    const dx = s1[0] - drag.start[0], dy = s1[1] - drag.start[1];
    if (drag.kind === 'curve') {
      /* the curve passes through the pointer: depth and side follow it */
      const d = drawingPt(s1), a = drag.a, b = drag.b;
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      /* signed distance of the pointer from the line between the two ends */
      const off = ((d[0] - a[0]) * -(b[1] - a[1]) + (d[1] - a[1]) * (b[0] - a[0])) / L;
      const pts = bulge(a, b, off);
      drag.pts = pts;
      const attr = pts.map(q => P.X(q[0]).toFixed(3) + ',' + P.Y(q[1]).toFixed(3)).join(' ');
      svgEl.querySelectorAll(`[data-id="${CSS.escape(drag.cab.id)}"]`).forEach(el => el.setAttribute('points', attr));
      drag.moved = true;
    } else if (drag.kind === 'cable') {
      const mv = [dx / P.k, dy / P.k];             /* drawing units */
      if (!drag.mode) {
        if (Math.hypot(dx, dy) < 0.5) return;      /* half a sheet millimetre before deciding */
        pullSetup(drag, mv);
      }
      const i = drag.seg, o = drag.orig;
      const p = o.map(q => q.slice());
      if (drag.horiz) { p[i][1] += mv[1]; p[i + 1][1] += mv[1]; }
      else { p[i][0] += mv[0]; p[i + 1][0] += mv[0]; }
      drag.pts = p;
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
    svgEl.classList.remove('sh-panning');
    if (d.kind === 'pan') return;
    if (!d.moved) return;
    const keep = v => Math.round(v * 1e4) / 1e4;
    if (d.kind === 'cable' || d.kind === 'curve') {
      /* tidy: drop zero-length pieces and points in the middle of a straight run */
      const pts = d.kind === 'curve' ? d.pts : cadwClean(d.pts);
      st.edits.cables[d.cab.id] = pts.map(p => [keep(p[0]), keep(p[1])]);
      if (d.toBent) st.edits.kinds[d.cab.id] = 'bent';
      afterEdit(`${d.cab.id} moved.`, d.cab.id);
      return;
    }
    if (d.kind === 'label') st.edits.labels[d.id] = [d.orig[0] + d.dx / P.k, d.orig[1] + d.dy / P.k];
    else if (d.kind === 'plug') st.edits.plugLabel = [d.orig[0] + d.dx, d.orig[1] + d.dy];
    else if (d.kind === 'ground') st.edits.ground = [d.orig[0] + d.dx, d.orig[1] + d.dy];
    render(); save();
  };
  /* how a pull moves a bent cable (decided on the first half millimetre):
     - across a section: that section moves sideways (its neighbours stretch);
     - along a section: the next bend that way moves, so the cable takes a new bend;
     - a section that ends at a terminal keeps a short straight stub into the terminal and
       the rest moves, so the cable can step round a port beside it. */
  function pullSetup(d, mv) {
    const pts = d.base.map(q => q.slice());
    const n = pts.length;
    const seglen = k => Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
    const isH = k => Math.abs(pts[k + 1][1] - pts[k][1]) < Math.abs(pts[k + 1][0] - pts[k][0]);
    let i = d.seg;
    const horiz0 = isH(i);
    const along = horiz0 ? mv[0] : mv[1], across = horiz0 ? mv[1] : mv[0];
    if (Math.abs(along) > Math.abs(across) * 1.2 && seglen(i) > 0) {
      /* toward the end of the section the pull points to: the next real section there */
      const a = pts[i], b = pts[i + 1];
      const toB = Math.sign(horiz0 ? b[0] - a[0] : b[1] - a[1]) * Math.sign(along) > 0;
      let j = toB ? i + 1 : i - 1;
      while (j >= 0 && j <= n - 2 && seglen(j) < 1e-9) j += toB ? 1 : -1;
      if (j >= 0 && j <= n - 2 && isH(j) !== horiz0) i = j;
    }
    /* a section into a terminal: keep a stub at the terminal (25 mm, at most a third) */
    const stubOf = k => Math.min(seglen(k) * 0.35, 25 * unit);
    if (i === 0 && n > 1) {
      const T = pts[0], N = pts[1], L = seglen(0) || 1, sl = stubOf(0);
      const S = [T[0] + (N[0] - T[0]) / L * sl, T[1] + (N[1] - T[1]) / L * sl];
      pts.splice(1, 0, S, S.slice(), N.slice());
      i = 2;
    } else if (i === n - 2) {
      const T = pts[n - 1], N = pts[n - 2], L = seglen(n - 2) || 1, sl = stubOf(n - 2);
      const S = [T[0] + (N[0] - T[0]) / L * sl, T[1] + (N[1] - T[1]) / L * sl];
      pts.splice(n - 1, 0, N.slice(), S.slice(), S);
      i = n - 1;
    }
    d.orig = pts;
    d.seg = i;
    d.horiz = Math.abs(pts[i + 1][1] - pts[i][1]) < Math.abs(pts[i + 1][0] - pts[i][0]);
    d.mode = 'move';
  }
  svgEl.addEventListener('pointerup', end);
  svgEl.addEventListener('pointercancel', end);
  /* double-click a cable: choose how it is drawn — straight, bent (right-angle bends) or
     curved. Shift + double-click a bent cable adds a bend where you click. */
  const closeShape = () => { const p = document.getElementById('sh-shape'); if (p) p.remove(); const v = document.getElementById('sh-preview'); if (v) v.remove(); };
  document.addEventListener('pointerdown', ev => { if (!ev.target.closest('#sh-shape')) closeShape(); }, true);
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeShape(); });
  svgEl.addEventListener('dblclick', ev => {
    const cEl = ev.target.closest('.sh-cable, .sh-hit');
    const cab = cEl && wiring.cables.find(c => c.id === cEl.dataset.id);
    if (!cab) return;
    ev.preventDefault();
    if (!ev.shiftKey) { openShape(cab, ev.clientX, ev.clientY); return; }
    if (typeOf(cab) !== 'bent') { say('Bends can be added to a bent cable. Double-click it and choose Bent first.'); return; }
    const pts = (st.edits.cables[cab.id] || cab.pts).map(p => p.slice());
    const d = drawingPt(toSheet(ev));
    const i = nearestSeg(pts, d, 0, pts.length - 1);
    if (i < 0) return;
    const a = pts[i], b = pts[i + 1];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const t = Math.max(0, Math.min(L, (d[0] - a[0]) * ux + (d[1] - a[1]) * uy));
    const w = Math.min(L / 4, 4 / P.k);                    /* 4 mm on the sheet, either side */
    const t1 = Math.max(w, Math.min(L - w, t)) - w, t2 = t1 + 2 * w;
    const c1 = [a[0] + ux * t1, a[1] + uy * t1], c2 = [a[0] + ux * t2, a[1] + uy * t2];
    /* doubled points: the piece between them can now be dragged sideways into a step */
    pts.splice(i + 1, 0, c1, c1.slice(), c2, c2.slice());
    st.edits.cables[cab.id] = pts;
    render(); save();
    say(`Bend added to ${cab.id}: drag it sideways where you double-clicked.`, 'cad-ok');
  });
  /* power crossings of one cable if it took `pts`, with every other cable as on the sheet now */
  const crossingsWith = (cab, pts) => {
    const me = { id: cab.id, kind: 'power', pts: pts };
    return wiring.cables.filter(c => c.kind === 'power' && c.id !== cab.id)
      .reduce((n, c) => n + cadwCrossings(me, { pts: st.edits.cables[c.id] || c.pts }), 0);
  };
  const metres = pts => (cadwLen(pts) / unit / 1000).toFixed(2) + ' m';
  /* a dashed preview of a route on the sheet while the pointer is over its button */
  const preview = pts => {
    const old = document.getElementById('sh-preview'); if (old) old.remove();
    if (!pts) return;
    const d = pts.map(q => P.X(q[0]).toFixed(3) + ',' + P.Y(q[1]).toFixed(3)).join(' ');
    $('sh-g').insertAdjacentHTML('beforeend', `<polyline id="sh-preview" points="${d}"/>`);
  };
  function openShape(cab, cx, cy, waysFirst) {
    closeShape();
    const now = typeOf(cab);
    const cur = st.edits.cables[cab.id] || cab.pts;
    const same = (a, b) => a.length === b.length && a.every((p, i) => Math.abs(p[0] - b[i][0]) < 1e-3 && Math.abs(p[1] - b[i][1]) < 1e-3);
    /* the planned route first, then the other ways the planner found */
    const ways = cab.kind === 'power' ? [{ pts: cab.pts, curve: !!cab.curve, planned: true }].concat(cab.ways || []) : [];
    const wayRows = ways.map((w, i) => {
      const n = crossingsWith(cab, w.pts);
      return `<button type="button" class="sh-way ${same(w.pts, cur) ? 'on' : ''}" data-way="${i}">
        <span>${w.planned ? 'As planned' : 'Way ' + i}</span><span>${metres(w.pts)}</span>
        <span class="${n ? 'warn' : 'cad-ok'}">${n ? n + ' crossing' + (n === 1 ? '' : 's') : 'no crossing'}</span></button>`;
    }).join('');
    const pop = document.createElement('div');
    pop.className = 'cad-pop sh-pop'; pop.id = 'sh-shape';
    const waysHtml = cab.kind !== 'power' ? ''
      : cab.ways ? `<p class="muted small">Send it another way (point at one to see it):</p><div class="sh-ways">${wayRows}</div>`
      : `<p class="muted small">No other ways stored for this cable. On the drawing page press <b>Draw the wiring again</b> (your numbering is kept), then come back.</p>`;
    const shapeHtml = `<p class="muted small">Draw this cable as:</p>
      <div class="sh-shape-row">${[['straight', 'Straight'], ['bent', 'Bent'], ['curved', 'Curved']].map(([k, t]) =>
        `<button type="button" class="btn btn-sm ${k === now ? 'btn-primary' : 'btn-ghost'}" data-shape="${k}" aria-pressed="${k === now}">${t}</button>`).join('')}</div>`;
    pop.innerHTML = `<b>${esc(cab.id)}</b>${waysFirst ? waysHtml + shapeHtml : shapeHtml + waysHtml}`;
    document.body.appendChild(pop);
    pop.querySelectorAll('[data-way]').forEach(b => {
      const w = ways[+b.dataset.way];
      b.onpointerenter = () => preview(w.pts);
      b.onpointerleave = () => preview(null);
      b.onclick = () => {
        closeShape(); preview(null);
        if (w.planned) { delete st.edits.cables[cab.id]; delete st.edits.kinds[cab.id]; }
        else { st.edits.cables[cab.id] = w.pts.map(p => p.slice()); st.edits.kinds[cab.id] = w.curve ? 'curved' : w.pts.length <= 2 ? 'straight' : 'bent'; }
        afterEdit(`${cab.id} now goes ${w.planned ? 'as planned' : 'way ' + b.dataset.way} (${metres(w.pts)}).`, cab.id);
      };
    });
    pop.style.left = Math.max(8, Math.min(cx + 12, window.innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.max(8, Math.min(cy + 12, window.innerHeight - pop.offsetHeight - 8)) + 'px';
    pop.querySelectorAll('[data-shape]').forEach(b => b.onclick = () => {
      const k = b.dataset.shape;
      closeShape();
      if (k === now) return;
      const planned = cab.curve ? 'curved' : cab.pts.length <= 2 ? 'straight' : 'bent';
      if (k === planned) { delete st.edits.cables[cab.id]; delete st.edits.kinds[cab.id]; }
      else { st.edits.cables[cab.id] = shapeOf(cab, k); st.edits.kinds[cab.id] = k; }
      afterEdit(`${cab.id} is now ${k}.`, cab.id);
    });
  }
  /* right-click a cable: back to its planned route */
  svgEl.addEventListener('contextmenu', ev => {
    const cEl = ev.target.closest('.sh-cable, .sh-hit');
    const cab = cEl && wiring.cables.find(c => c.id === cEl.dataset.id);
    if (!cab) return;
    ev.preventDefault();
    if (!st.edits.cables[cab.id]) { say(`${cab.id} is already on its planned route.`); return; }
    delete st.edits.cables[cab.id]; delete st.edits.kinds[cab.id];
    afterEdit(`${cab.id} is back on its planned route.`, cab.id);
  });

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
    try { canvas.setPointerCapture(e.pointerId); } catch (err) {}
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

/* ================= BOOT ================= */
(async function boot() {
  await route();
})();
