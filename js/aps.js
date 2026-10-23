/* ============================================================
 * WireFlow — Autodesk Platform Services (APS / former Forge)
 * Client-side integration using the user's own APS credentials
 * (stored per-account in the integrations table).
 *
 * Flow:
 *   1. two-legged OAuth token (client_credentials)
 *   2. ensure bucket (transient policy)
 *   3. upload DWG to OSS
 *   4. Model Derivative translate job (SVF2, 2D)
 *   5. poll manifest -> view in APS Viewer 7
 * ============================================================ */

const APS_BASE = 'https://developer.api.autodesk.com';

function bucketKeyFor(clientId) {
  return ('wfd-' + clientId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 16) + '-app').slice(0, 40);
}

async function apsGetToken(integ) {
  const body = new URLSearchParams({
    client_id: integ.client_id,
    client_secret: integ.client_secret,
    grant_type: 'client_credentials',
    scope: 'data:read data:write data:create bucket:read bucket:create viewables:read',
  });
  const r = await fetch(`${APS_BASE}/authentication/v2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!r.ok) {
    const t = await r.text();
    throw new Error(`APS token request failed (${r.status}): ${t.slice(0, 200)}`);
  }
  return r.json(); // { access_token, expires_in }
}

async function apsEnsureBucket(token, bucketKey) {
  const h = { Authorization: `Bearer ${token}` };
  const det = await fetch(`${APS_BASE}/oss/v2/buckets/${bucketKey}/details`, { headers: h });
  if (det.ok) return bucketKey;
  const create = await fetch(`${APS_BASE}/oss/v2/buckets`, {
    method: 'POST',
    headers: { ...h, 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucketKey, policyKey: 'transient' }),
  });
  if (!create.ok && create.status !== 409) {
    const t = await create.text();
    throw new Error(`Bucket creation failed (${create.status}): ${t.slice(0, 200)}`);
  }
  return bucketKey;
}

async function apsUploadObject(token, bucketKey, objectKey, file, onProgress) {
  const url = `${APS_BASE}/oss/v2/buckets/${encodeURIComponent(bucketKey)}/objects/${encodeURIComponent(objectKey)}`;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = e => { if (onProgress && e.lengthComputable) onProgress(Math.round(e.loaded / e.total * 100)); };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve(JSON.parse(xhr.responseText)); } catch { resolve({}); }
      } else reject(new Error(`APS upload failed (${xhr.status}): ${xhr.responseText.slice(0, 200)}`));
    };
    xhr.onerror = () => reject(new Error('APS upload network error'));
    xhr.send(file);
  });
}

function urnBase64(urn) { return btoa(urn).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }

async function apsTranslate(token, urn) {
  const r = await fetch(`${APS_BASE}/modelderivative/v2/designdata/job`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      input: { urn },
      output: { formats: [{ type: 'svf2', views: ['2d'] }] },
    }),
  });
  if (!r.ok && r.status !== 400) { // 400 = already translated / duplicate job
    const t = await r.text();
    throw new Error(`Translate job failed (${r.status}): ${t.slice(0, 200)}`);
  }
  return r.json().catch(() => ({}));
}

async function apsManifest(token, urn) {
  const r = await fetch(`${APS_BASE}/modelderivative/v2/designdata/${urnBase64(urn)}/manifest`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!r.ok) throw new Error(`Manifest check failed (${r.status})`);
  return r.json();
}

async function apsUploadAndTranslate(integ, file, onProgress, onStage) {
  onStage && onStage('Requesting Autodesk access token…');
  const tok = await apsGetToken(integ);
  const bucketKey = await apsEnsureBucket(tok.access_token, bucketKeyFor(integ.client_id));
  onStage && onStage(`Uploading ${file.name} to OSS bucket ${bucketKey}…`);
  const objectKey = `${Date.now()}_${file.name}`;
  await apsUploadObject(tok.access_token, bucketKey, objectKey, file, onProgress);
  const urn = `urn:adsk.objects:os.object:${bucketKey}/${objectKey}`;
  onStage && onStage('Submitting Model Derivative translation…');
  await apsTranslate(tok.access_token, urn);
  return { urn, accessToken: tok.access_token, bucketKey, objectKey };
}

async function apsWaitForTranslation(token, urn, onStage) {
  for (let i = 0; i < 60; i++) {
    const m = await apsManifest(token, urn);
    if (m.status === 'success' || m.progress === 'complete') return m;
    if (m.status === 'failed') throw new Error('Autodesk translation failed: ' + (m.lastErrorMessage || 'unknown'));
    onStage && onStage(`Translating on Autodesk cloud… (${m.progress || m.status})`);
    await new Promise(res => setTimeout(res, 4000));
  }
  throw new Error('Translation timed out — check the file again in a minute');
}

/* ---- Viewer ---- */
let viewerLoaded = false;
function loadViewerLibs() {
  return new Promise((resolve, reject) => {
    if (viewerLoaded) return resolve();
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = `${APS_BASE}/modelderivative/v2/viewers/7/viewerStyle.css`;
    document.head.appendChild(css);
    const sc = document.createElement('script');
    sc.src = `${APS_BASE}/modelderivative/v2/viewers/7/viewer3D.min.js`;
    sc.onload = () => { viewerLoaded = true; resolve(); };
    sc.onerror = () => reject(new Error('Failed to load Autodesk Viewer libraries'));
    document.head.appendChild(sc);
  });
}

async function showInViewer(containerId, accessToken, urn64) {
  await loadViewerLibs();
  const container = document.getElementById(containerId);
  if (!container) throw new Error('Viewer container missing');
  if (container._viewer) { container._viewer.uninitialize(); container._viewer = null; }
  const options = { env: 'AutodeskProduction', accessToken, isA360: false };
  Autodesk.Viewing.Initializer(options, () => {
    const viewer = new Autodesk.Viewing.GuiViewer3D(container);
    viewer.start();
    container._viewer = viewer;
    Autodesk.Viewing.Document.load(urn64, doc => {
      const viewable = Autodesk.Viewing.Document.getSubItemsWithProperties(doc.getRootItem(), { type: 'geometry' }, true)[0];
      if (viewable) viewer.loadDocumentNode(doc, viewable, { keepCurrentView: false });
    }, errCode => {
      showToast('Autodesk Viewer failed to load document (code ' + errCode + ')', 'error');
    });
  });
}
