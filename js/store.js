/* ============================================================
 * WireFlow — where projects are kept
 * ------------------------------------------------------------
 * On the company server (server/server.js) the app signs in and keeps
 * every project, drawing and shared list on the server, so all
 * engineers see the same projects from any PC. Anywhere else (GitHub
 * Pages, a plain static server) /api is missing and everything stays in
 * this browser as before.
 *
 *   wfStoreReady          promise: settles once the mode is known
 *   wfRemote()            true on the company server
 *   wfUser()              the signed-in engineer {username, name, admin} or null
 *   wfStorage             localStorage stand-in: the shared lists (project folders,
 *                         taught parts, numbering library) go to the server
 *   wfApi(method, path, body, headers)  JSON call to the server
 * Loaded before every other script.
 * ============================================================ */
'use strict';

const WF = { remote: false, user: null, lists: {}, base: {}, revs: new Map() };

/* localStorage key -> server list, and what identifies an item of it */
const WF_LISTS = {
  'wireflow.folders': { list: 'folders', id: f => f.id },
  'wireflow-cad-part-library-v1': { list: 'parts', id: s => s.id || [s.kind, s.w, s.h, (s.features || []).length, s.features && s.features[0] && s.features[0].key].join('|') },
  'wireflow.numberings': { list: 'numberings', id: e => 'n' + wfHash([e.layout, e.pair, e.tray, JSON.stringify(e.strings)].join('|')) },
};
function wfHash(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); h1 = Math.imul(h1 ^ c, 16777619); h2 = Math.imul(h2 ^ c, 2246822519); }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

const wfRemote = () => WF.remote;
const wfUser = () => WF.user;

async function wfApi(method, path, body, headers) {
  const opts = { method, credentials: 'same-origin', headers: Object.assign({ 'X-WireFlow': '1' }, headers || {}) };
  if (body !== undefined) {
    if (body instanceof Blob || body instanceof ArrayBuffer) opts.body = body;
    else { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  }
  let res;
  try { res = await fetch(path, opts); } catch (e) { throw new Error('The WireFlow server cannot be reached. Check the network and try again.'); }
  if (res.status === 401 && path !== '/api/login' && path !== '/api/me') {
    WF.user = null;
    if (!location.hash.startsWith('#/login')) location.hash = '#/login';
    throw new Error('Your sign-in has ended. Sign in again.');
  }
  const type = res.headers.get('Content-Type') || '';
  const data = type.includes('json') ? await res.json() : await res.arrayBuffer();
  if (!res.ok) throw Object.assign(new Error((data && data.error) || 'The server refused the request (' + res.status + ').'), { status: res.status });
  return { data, res };
}

/* the mode: /api/me answers only on the company server */
const wfStoreReady = (async () => {
  if (location.protocol === 'file:') return;
  try {
    const res = await fetch('/api/me', { credentials: 'same-origin' });
    const type = res.headers.get('Content-Type') || '';
    if (!type.includes('json') || (res.status !== 200 && res.status !== 401)) return;
    const data = await res.json();
    if (res.status === 401 && !/not signed in/i.test(data.error || '')) return;
    WF.remote = true;
    WF.user = res.ok ? data.user : null;
    if (WF.user) await wfRefreshLists();
  } catch (e) { /* no server: this browser */ }
})();

/* ---------------- shared lists ---------------- */
function wfSetList(list, items) {
  WF.lists[list] = items;
  const cfg = Object.values(WF_LISTS).find(c => c.list === list);
  WF.base[list] = new Map(items.map(x => [String(cfg.id(x)), JSON.stringify(x)]));
}
/** Fetches the shared lists again (on every page change, so other engineers' projects show up). */
async function wfRefreshLists() {
  if (!WF.remote || !WF.user) return;
  await Promise.all(Object.values(WF_LISTS).map(async c => {
    try { const { data } = await wfApi('GET', '/api/lists/' + c.list); wfSetList(c.list, data); } catch (e) { console.warn('WireFlow: could not load ' + c.list, e); }
  }));
}
let wfListSaving = Promise.resolve();
/** Sends only what changed (items added, changed, removed), so two engineers never overwrite each other. */
function wfSaveList(key, value) {
  const cfg = WF_LISTS[key];
  let items;
  try { items = JSON.parse(value); } catch (e) { return; }
  if (!Array.isArray(items)) return;
  const base = WF.base[cfg.list] || new Map();
  const put = [], seen = new Set();
  items.forEach((x, i) => {
    const id = String(cfg.id(x)); seen.add(id);
    const json = JSON.stringify(x);
    if (base.get(id) !== json) put.push({ id, pos: i, item: x });
  });
  const del = [...base.keys()].filter(id => !seen.has(id));
  wfSetList(cfg.list, items); /* at once, so the page sees its own change */
  if (!put.length && !del.length) return;
  wfListSaving = wfListSaving.then(() => wfApi('POST', '/api/lists/' + cfg.list, { put, del }))
    .then(r => { if (r && r.data) wfSetList(cfg.list, r.data); })
    .catch(e => { console.error(e); if (typeof toast === 'function') toast('Could not save to the server: ' + e.message, 'error'); });
}
const wfStorage = {
  getItem(key) {
    if (WF.remote && WF_LISTS[key]) return JSON.stringify(WF.lists[WF_LISTS[key].list] || []);
    return localStorage.getItem(key);
  },
  setItem(key, value) {
    if (WF.remote && WF_LISTS[key]) { wfSaveList(key, value); return; }
    localStorage.setItem(key, value);
  },
  removeItem(key) {
    if (WF.remote && WF_LISTS[key]) { wfSaveList(key, '[]'); return; }
    localStorage.removeItem(key);
  },
};

/* ---------------- projects on the server ---------------- */
const wfRemoteStore = {
  async projects() {
    const { data } = await wfApi('GET', '/api/projects');
    for (const p of data) if (!WF.revs.has(p.id)) WF.revs.set(p.id, p.rev);
    return data.map(wfStrip);
  },
  async project(id) {
    try {
      const { data } = await wfApi('GET', '/api/projects/' + Number(id));
      WF.revs.set(data.id, data.rev);
      return wfStrip(data);
    } catch (e) { if (e.status === 404) return undefined; throw e; }
  },
  async add(p) {
    const { data } = await wfApi('POST', '/api/projects', wfStrip(p));
    WF.revs.set(data.id, data.rev);
    return data.id;
  },
  async put(p) {
    const id = Number(p.id);
    const rev = WF.revs.get(id);
    const { data } = await wfApi('PUT', '/api/projects/' + id, wfStrip(p), rev ? { 'X-Rev': String(rev) } : {});
    WF.revs.set(id, data.rev);
    return id;
  },
  async remove(id) { await wfApi('DELETE', '/api/projects/' + Number(id)); WF.revs.delete(Number(id)); },
  async putUnderlay(id, blob, kind) { await wfApi('PUT', '/api/projects/' + Number(id) + '/underlay', blob, { 'X-Kind': kind || '' }); },
  async getUnderlay(id) {
    try {
      const { data, res } = await wfApi('GET', '/api/projects/' + Number(id) + '/underlay');
      return { projectId: Number(id), blob: new Blob([data]), kind: res.headers.get('X-Kind') || '' };
    } catch (e) { if (e.status === 404) return undefined; throw e; }
  },
};
/* the server keeps rev and who-changed-it itself; they are not part of the saved project */
function wfStrip(p) {
  const o = Object.assign({}, p);
  delete o.rev;
  return o;
}
