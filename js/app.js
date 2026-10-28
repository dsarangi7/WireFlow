/* ============================================================
 * WireFlow — application shell
 * Hash router: #/ landing · #/login · #/app dashboard ·
 * #/project/<id> workspace · #/integrations APS settings
 * ============================================================ */

const cloud = WorkBuddyCloud.createWorkBuddyCloud({
  endpoint: PUBLIC_CONFIG.endpoint,
  oauthRelayBaseUrl: PUBLIC_CONFIG.oauthRelayBaseUrl,
  publishableKey: PUBLIC_CONFIG.publishableKey,
});

const app = document.getElementById('app');
let session = null;
let currentUser = null;

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
async function unwrap(promise, label) {
  const { data, error } = await promise;
  if (error) { toast(`${label}: ${error.message || error.code}`, 'error'); throw error; }
  return data;
}

/* ---------------- auth gate ---------------- */
async function initAuth() {
  const { data } = await cloud.auth.getSession();
  session = data || null;
  if (session) {
    try { const u = await cloud.auth.getUser(); currentUser = u.data?.user || session.user; }
    catch { currentUser = session.user; }
  }
}

function requireAuth() {
  if (!session) { location.hash = '#/login'; return false; }
  return true;
}

/* ---------------- router ---------------- */
window.addEventListener('hashchange', route);

async function route() {
  const h = location.hash || '#/';
  if (!session) { const { data } = await cloud.auth.getSession(); session = data || null; if (session) { try { const u = await cloud.auth.getUser(); currentUser = u.data?.user || session.user; } catch {} } }

  if (h.startsWith('#/project/')) { if (requireAuth()) renderProjectPage(+h.split('/')[2]); return; }
  switch (h) {
    case '#/': renderLanding(); return;
    case '#/login': renderLogin(); return;
    case '#/app': requireAuth() ? renderDashboard() : null; return;
    case '#/integrations': requireAuth() ? renderIntegrations() : null; return;
    default: renderLanding();
  }
}

/* ================= LANDING PAGE ================= */
function renderLanding() {
  app.innerHTML = `
  <header class="landing-nav">
    <div class="nav-inner">
      <div class="logo"><svg width="26" height="26" viewBox="0 0 24 24" fill="none"><path d="M3 7h6l2-4 2 12 2-4h6" stroke="#f97316" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="2" y="2" width="20" height="20" rx="5" stroke="#1e3a5f" stroke-width="1.6"/></svg> AYK WireFlow</div>
      <nav><a href="#features">Features</a><a href="#workflow">Workflow</a><a href="#rules">Rule engine</a><a href="#pricing">Pricing</a></nav>
      <div class="nav-cta">
        ${session ? `<a class="btn btn-ghost" href="#/app">Open app</a>` : `<a class="btn btn-ghost" href="#/login">Sign in</a><a class="btn btn-primary" href="#/login">Start free</a>`}
      </div>
    </div>
  </header>

  <section class="hero">
    <div class="hero-text">
      <div class="hero-badge">Deterministic wiring automation · Marine battery racks</div>
      <h1>Ship-ready wiring diagrams.<br><span class="accent">Generated, not drawn.</span></h1>
      <p>AYK WireFlow turns your rack configuration into complete power &amp; communication wiring diagrams, cable schedules and BOMs — governed by your own approved engineering rules, and pushed straight into AutoCAD through the Autodesk Platform Services.</p>
      <div class="hero-actions">
        <a class="btn btn-primary btn-lg" href="#/login">Create your account</a>
        <a class="btn btn-ghost btn-lg" href="#workflow">See how it works</a>
      </div>
      <div class="hero-meta">Rule IDs R01–R12 · Validations V01–V12 · DWG in, DWG out</div>
    </div>
    <div class="hero-visual" id="hero-visual"></div>
  </section>

  <section class="strip">
    <div class="strip-item"><b>100%</b><span>deterministic generation</span></div>
    <div class="strip-item"><b>R01–R12</b><span>approved engineering rules encoded</span></div>
    <div class="strip-item"><b>V01–V12</b><span>mandatory validation gate</span></div>
    <div class="strip-item"><b>APS</b><span>native Autodesk cloud pipeline</span></div>
  </section>

  <section id="features" class="features">
    <h2>Everything between rack configuration and released drawing</h2>
    <div class="feature-grid">
      <div class="feature-card"><div class="f-ico">⚙</div><h3>Rule-driven netlists</h3><p>Normal string power and communication sequences (SSC+ → M1+ … M24− → SSC−, daisy-chain S/N) generated from the approved connection templates — no manual netlist entry.</p></div>
      <div class="feature-card"><div class="f-ico">📐</div><h3>Cable length model</h3><p>Cross-rack cables computed from three route segments plus installation allowance, with the power deduction and rounding rules applied exactly as engineering defined them.</p></div>
      <div class="feature-card"><div class="f-ico">🔢</div><h3>Physical module numbering</h3><p>M1…MN is chosen against the real rack: the chain starts and ends next to the SSC and skips the ACDP / MSM slots. Automatic mode scores serpentine, raster and optimised paths against the harness catalogue; custom mode lets the engineer click the order straight onto the imported rack drawing.</p></div>
      <div class="feature-card"><div class="f-ico">✅</div><h3>Validation gate</h3><p>Twelve mandatory checks — polarity, communication chain, harness compatibility, quantity reconciliation, exception approvals — block release on any unresolved item.</p></div>
      <div class="feature-card"><div class="f-ico">🗂</div><h3>Cable schedule &amp; BOM</h3><p>Every drawn cable appears exactly once in the schedule with harness part number, manufactured length and quantity. One-click CSV export.</p></div>
      <div class="feature-card"><div class="f-ico">🧩</div><h3>Autodesk integration</h3><p>Upload DWG references, translate and inspect them in the embedded Autodesk Viewer, and export DXF / AutoCAD scripts that feed Design Automation.</p></div>
      <div class="feature-card"><div class="f-ico">👥</div><h3>Team accounts</h3><p>Per-user workspaces with server-side data isolation. Projects, rule sets and drawing references stay private to each account.</p></div>
    </div>
  </section>

  <section id="workflow" class="workflow">
    <h2>From configuration to drawing in eleven governed steps</h2>
    <div class="steps">
      ${['Load approved master data','Place devices from rack template','Generate power & comm netlists','Resolve every endpoint to a terminal','Choose route pattern, compute routed distance','Apply allowances, select harness P/N','Draw power & comm on separate layers','Generate labels, schedule, BOM, notes','Run electrical & routing validations','Block release on unresolved rules','Export DWG / DXF through Autodesk'].map((t,i)=>`
      <div class="step"><div class="step-n">${i+1}</div><div>${t}</div></div>`).join('')}
    </div>
  </section>

  <section id="rules" class="rules-sec">
    <h2>Your engineering rules, encoded — not remembered</h2>
    <p class="sec-sub">The rule table ships pre-loaded with the approved baseline. Every value stays editable under engineer control.</p>
    <div class="rules-table-wrap"><table class="rules-table">
      <tr><th>Rule</th><th>Encoding</th></tr>
      <tr><td>R02 · R03</td><td>Adjacent power Mx− → Mx+1+ · communication Mx S → Mx+1 N</td></tr>
      <tr><td>R04 · R05 · R06</td><td>SSC endpoints: String+ → M1+, String− → M24−, S → M1 N, N → M24 S</td></tr>
      <tr><td>R07 · R08</td><td>Standard jumpers 100 mm AB power · 450 mm communication</td></tr>
      <tr><td>R09 · R10</td><td>Longer local jumpers 445 mm power · 650 mm communication</td></tr>
      <tr><td>R11</td><td>Two bus power cables per SSC to the junction box</td></tr>
      <tr><td>R12</td><td>130 mm power deduction — configurable per cable family</td></tr>
      <tr><td>Length model</td><td>source route + over-top span + destination route + allowance</td></tr>
    </table></div>
  </section>

  <section id="pricing" class="pricing">
    <h2>Simple pricing for engineering teams</h2>
    <div class="price-grid">
      <div class="price-card"><h3>Engineer</h3><div class="price">Free</div><ul><li>1 workspace</li><li>Unlimited projects</li><li>Full rule engine & validations</li><li>CSV / DXF / SCR export</li></ul><a class="btn btn-ghost" href="#/login">Start free</a></div>
      <div class="price-card featured"><div class="pop">Popular</div><h3>Team</h3><div class="price">$49<i>/user/mo</i></div><ul><li>Everything in Engineer</li><li>Autodesk APS pipeline</li><li>DWG upload & viewer</li><li>Priority validation support</li></ul><a class="btn btn-primary" href="#/login">Start free trial</a></div>
      <div class="price-card"><h3>Fleet</h3><div class="price">Custom</div><ul><li>SSO & audit trail</li><li>Private APS account linking</li><li>Golden-project acceptance testing</li><li>On-prem export pipeline</li></ul><a class="btn btn-ghost" href="#/login">Contact us</a></div>
    </div>
  </section>

  <footer class="footer">
    <div>© 2026 AYK WireFlow · Wiring diagram automation for marine battery systems</div>
    <div class="footer-links"><a href="#features">Features</a><a href="#pricing">Pricing</a><a href="#/login">Sign in</a></div>
  </footer>`;

  // hero visual: mini rack diagram
  const demo = { config: { rules: { ...DEFAULT_RULES, modulesPerString: 12, strings: 1 } } };
  document.getElementById('hero-visual').innerHTML = renderDiagramSVG(demo, []);
}

/* ================= LOGIN (Email OTP) ================= */
let pendingOtp = null; // { email, verificationId, isExistingUser }

function renderLogin(mode = 'landing') {
  app.innerHTML = `
  <div class="auth-wrap">
    <div class="auth-card">
      <div class="logo big"><svg width="30" height="30" viewBox="0 0 24 24" fill="none"><path d="M3 7h6l2-4 2 12 2-4h6" stroke="#f97316" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="2" y="2" width="20" height="20" rx="5" stroke="#1e3a5f" stroke-width="1.6"/></svg> AYK WireFlow</div>
      <h2>Sign in or create an account</h2>
      <p class="auth-sub">We'll email you a one-time verification code. No password needed.</p>
      <div class="field"><label>Work email</label><input id="auth-email" type="email" placeholder="you@company.com" autocomplete="email"></div>
      <div class="field" id="otp-field" style="display:none"><label>Verification code</label><input id="auth-otp" inputmode="numeric" placeholder="6-digit code" maxlength="8"></div>
      <div class="auth-err" id="auth-err"></div>
      <button class="btn btn-primary btn-block" id="btn-send">Email me a code</button>
      <button class="btn btn-ghost btn-block" id="btn-verify" style="display:none">Verify & sign in</button>
      <a class="auth-back" href="#/">← Back to site</a>
    </div>
  </div>`;

  const emailEl = document.getElementById('auth-email');
  const otpEl = document.getElementById('auth-otp');
  const errEl = document.getElementById('auth-err');
  const btnSend = document.getElementById('btn-send');
  const btnVerify = document.getElementById('btn-verify');

  btnSend.onclick = async () => {
    const email = emailEl.value.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errEl.textContent = 'Enter a valid email address.'; return; }
    errEl.textContent = ''; btnSend.disabled = true; btnSend.textContent = 'Sending…';
    const sent = await cloud.auth.sendOtp({ email });
    btnSend.disabled = false; btnSend.textContent = 'Email me a code';
    if (sent.error) { errEl.textContent = sent.error.message || 'Could not send the code.'; return; }
    pendingOtp = { email, verificationId: sent.data.verificationId, isExistingUser: sent.data.isExistingUser };
    document.getElementById('otp-field').style.display = '';
    btnVerify.style.display = '';
    btnSend.textContent = 'Resend code';
    otpEl.focus();
    toast('Verification code sent — check your inbox.');
  };

  btnVerify.onclick = async () => {
    if (!pendingOtp || pendingOtp.email !== emailEl.value.trim()) { errEl.textContent = 'Get a code for this email first.'; return; }
    const token = otpEl.value.trim();
    if (!token) { errEl.textContent = 'Enter the verification code.'; return; }
    errEl.textContent = ''; btnVerify.disabled = true; btnVerify.textContent = 'Verifying…';
    const done = await cloud.auth.verifyOtp({
      email: pendingOtp.email, verificationId: pendingOtp.verificationId,
      isExistingUser: pendingOtp.isExistingUser, token,
    });
    btnVerify.disabled = false; btnVerify.textContent = 'Verify & sign in';
    if (done.error) { errEl.textContent = done.error.message || 'Verification failed.'; return; }
    pendingOtp = null;
    session = done.data.session || session;
    const u = await cloud.auth.getUser(); currentUser = u.data?.user || session?.user;
    toast('Signed in.');
    location.hash = '#/app';
  };
  otpEl.addEventListener('keydown', e => { if (e.key === 'Enter') btnVerify.click(); });
  emailEl.addEventListener('keydown', e => { if (e.key === 'Enter') btnSend.click(); });
}

/* ================= APP SHELL ================= */
function shell(content, active) {
  const name = currentUser?.name || currentUser?.email || 'Account';
  app.innerHTML = `
  <div class="shell">
    <aside class="side">
      <a class="logo side-logo" href="#/"><svg width="22" height="22" viewBox="0 0 24 24" fill="none"><path d="M3 7h6l2-4 2 12 2-4h6" stroke="#f97316" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/><rect x="2" y="2" width="20" height="20" rx="5" stroke="#1e3a5f" stroke-width="1.6"/></svg> AYK WireFlow</a>
      <nav class="side-nav">
        <a href="#/app" class="${active === 'dash' ? 'on' : ''}">◫ Projects</a>
        <a href="#/integrations" class="${active === 'int' ? 'on' : ''}">⚡ Autodesk APS</a>
      </nav>
      <div class="side-foot">
        <div class="side-user" title="${esc(name)}">${esc(name)}</div>
        <button class="btn btn-ghost btn-sm" id="btn-signout">Sign out</button>
      </div>
    </aside>
    <main class="main">${content}</main>
  </div>`;
  document.getElementById('btn-signout').onclick = async () => {
    await cloud.auth.signOut();
    session = null; currentUser = null;
    location.hash = '#/';
  };
}

/* ================= DASHBOARD ================= */
async function renderDashboard() {
  shell(`<div class="loading">Loading projects…</div>`, 'dash');
  const { data: projects, error } = await cloud.database.from('projects').select('*').order('created_at', { ascending: false });
  if (error) { shell(`<div class="empty">Could not load projects: ${esc(error.message)}</div>`, 'dash'); return; }

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
      owner_name: currentUser?.name || null,
    };
    const created = await unwrap(cloud.database.from('projects').insert(project).select(), 'Create project');
    modal.remove();
    toast('Project created.');
    location.hash = `#/project/${created[0].id}`;
  };
}

/* ================= PROJECT WORKSPACE ================= */
async function renderProjectPage(id) {
  shell(`<div class="loading">Loading project…</div>`, 'dash');
  const { data: rows, error } = await cloud.database.from('projects').select('*').eq('id', id);
  if (error || !rows || !rows.length) {
    shell(`<div class="empty"><h3>Project not found</h3><p>${esc(error?.message || 'It may belong to another account.')}</p><a class="btn btn-primary" href="#/app">Back to projects</a></div>`, 'dash'); return;
  }
  const project = rows[0];
  const cfg = project.config || { rules: { ...DEFAULT_RULES }, exceptions: [], spans: [] };
  let netlist = null, validations = null;

  const tabs = ['Configuration', 'Numbering', 'Netlist', 'Exceptions', 'Validation', 'Schedule & BOM', 'Diagram', 'Drawings (DWG)'];
  shell(`
    <div class="proj-head">
      <a class="back" href="#/app">← Projects</a>
      <div class="proj-title-row">
        <h1 id="p-name">${esc(project.name)}</h1>
        <span class="chip ${project.status === 'released' ? 'chip-ok' : ''}" id="p-status">${esc(project.status)}</span>
      </div>
      <p class="muted">${esc(project.vessel || '')} ${project.drawing_no ? '· ' + esc(project.drawing_no) + ' rev ' + esc(project.revision) : ''} · ${esc(project.product_family)}</p>
    </div>
    <div class="tabs" id="tabs">${tabs.map((t, i) => `<button class="tab ${i === 0 ? 'on' : ''}" data-i="${i}">${t}</button>`).join('')}</div>
    <div id="tab-body"></div>
  `, 'dash');

  const body = document.getElementById('tab-body');
  const views = [tabConfig, tabNumbering, tabNetlist, tabExceptions, tabValidation, tabSchedule, tabDiagram, tabDrawings];

  async function saveProject(patch) {
    const { data, error } = await cloud.database.from('projects').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', id).select();
    if (error || !data || !data.length) { toast('Save failed — the project may not be yours.', 'error'); return false; }
    Object.assign(project, data[0]);
    return true;
  }

  async function switchTab(i) {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', +t.dataset.i === i));
    body.innerHTML = `<div class="loading">…</div>`;
    await views[i](body, project, { saveProject, getNetlist, getValidations, loadUnderlay });
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
      const { data, error } = await cloud.storage.createSignedUrl(project.underlay_url, 600);
      if (error || !data) return;
      const url = data.url || data;
      const kind = project.underlay_kind || 'image';
      const fit = {
        x: project.underlay_x ?? 120, y: project.underlay_y ?? 280,
        w: project.underlay_w ?? 1000, h: project.underlay_h ?? 640,
      };
      if (kind === 'dxf') {
        const res = await fetch(url);
        const parsed = rackParseDxf(await res.text());
        project.underlay = { kind: 'dxf', prims: rackFitDxf(parsed, fit) };
      } else {
        const res = await fetch(url);
        const blob = await res.blob();
        const src = await new Promise((ok, fail) => {
          const fr = new FileReader();
          fr.onload = () => ok(fr.result); fr.onerror = fail;
          fr.readAsDataURL(blob);
        });
        project.underlay = { kind: 'image', src, ...fit };
      }
    } catch (e) { /* sheet renders without the underlay */ }
  }

  document.getElementById('tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab'); if (b) switchTab(+b.dataset.i);
  });
  await loadUnderlay();
  await switchTab(0);
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
      <p class="muted small">Import your own rack drawing and AYK WireFlow draws the wiring over it. Supports DXF (AutoCAD "Save as DXF"), PNG, JPG and SVG. Binary DWG needs the Autodesk translation — use the Drawings tab for that.</p>
      <div class="field inline"><label>Status</label><span class="muted" id="u-status">${project.underlay_url ? esc('Imported: ' + (project.underlay_kind || 'image')) : 'No rack drawing imported'}</span></div>
      <input type="file" id="u-file" accept=".dxf,.png,.jpg,.jpeg,.svg" style="display:none">
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
      if (!session) throw new Error('Sign in required');
      if (/\.dwg$/i.test(file.name)) {
        throw new Error('Binary DWG needs Autodesk translation. In AutoCAD use "Save As" -> DXF, then import the DXF here.');
      }
      const isDxf = /\.dxf$/i.test(file.name);
      uStatus.textContent = 'Uploading rack drawing…';
      const path = cloud.storage.userPath(session.user.id, `underlay/${Date.now()}_${file.name}`);
      const up = await cloud.storage.upload(path, file, { contentType: file.type || 'application/octet-stream' });
      if (up.error) throw up.error;
      const fit = fitFromInputs();
      const ok = await ctx.saveProject({ underlay_url: path, underlay_kind: isDxf ? 'dxf' : 'image', ...fit });
      if (!ok) throw new Error('Could not save the underlay reference');
      el.querySelector('#u-remove').disabled = false;
      await afterUnderlayChange('Rack drawing imported.');
    } catch (e) {
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
  };
  st.order = (saved && Array.isArray(saved.order) && saved.order.length)
    ? saved.order.filter(id => rackIsModule(st.rack, id))
    : rackModuleCells(st.rack);
  if (!st.order.length) st.order = rackModuleCells(st.rack);
  const required = Math.max(1, Math.round(rules.modulesPerString || 24)) * Math.max(1, Math.round(rules.strings || 1));

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
        '" stroke="#94a3b8" stroke-width="1"/>';
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

  function render() {
    const m = numberMetrics(st.rack, rules, st.order);
    const dev = k => rackDeviceCells(st.rack, k).join(', ') || '—';
    el.innerHTML = `
    <div class="page-head slim">
      <div><h2>Physical module numbering</h2>
        <p class="muted">M1…M${required} is a property of the rack, not of the schematic: the chain starts and ends next to the SSC and has to skip the ACDP, MSM and junction-box slots. Set it once — the netlist, the cable schedule and the drawing all follow it.</p></div>
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
      render();
      toast('Rack layout applied.');
    };
    el.querySelector('#num-reset').onclick = () => {
      st.rack = defaultRack(rules.modulesPerString);
      st.order = rackModuleCells(st.rack);
      st.plans = null;
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
    el.querySelector('#num-save').onclick = async () => {
      const m2 = numberMetrics(st.rack, rules, st.order);
      const num = {
        mode: st.mode,
        planId: st.mode === 'auto' ? st.planId : '',
        planTitle: st.mode === 'auto' ? st.planTitle : '',
        rack: st.rack,
        order: st.order,
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

  render();
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
    </div>
    <div id="vsdx-view" style="overflow:auto;max-height:80vh;background:#eef1f6;border-radius:8px;padding:6px"></div>
  </div>

  <div class="diagram-wrap" style="margin-top:16px">${renderDiagramSVG(project, conns)}</div>`;

  const st = { doc: null, page: 0, layersOn: null, file: null, savedRow: null };
  const $ = (s) => el.querySelector(s);

  /* ---- offer a previously saved .vsdx ---- */
  try {
    const { data: saved } = await cloud.database.from('project_files')
      .select('*').eq('project_id', project.id).order('created_at', { ascending: false });
    const row = (saved || []).find((f) => /\.vsdx$/i.test(f.filename || ''));
    if (row) {
      st.savedRow = row;
      const wrap = $('#vsdx-saved');
      wrap.innerHTML = `<button class="btn btn-ghost btn-sm">Load saved: ${esc(row.filename)}</button>`;
      wrap.firstChild.onclick = async () => {
        try {
          $('#vsdx-status').textContent = 'Downloading saved file…';
          const { data, error } = await cloud.storage.createSignedUrl(row.storage_path, 600);
          if (error) throw error;
          const res = await fetch(data.url || data);
          if (!res.ok) throw new Error('download failed (' + res.status + ')');
          await openBuffer(await res.arrayBuffer(), row.filename);
        } catch (e) { $('#vsdx-status').textContent = ''; toast('Could not load saved Visio file: ' + e.message, 'error'); }
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
      ? `<span class="muted small">Layers:</span>` + layers.map((l) =>
          `<label class="check"><input type="checkbox" data-layer="${l.ix}" checked> ${esc(l.name)}</label>`).join('')
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
    const view = $('#vsdx-view');
    view.innerHTML = r.svg;
    const zoom = $('#vsdx-zoom').value;
    const svg = view.querySelector('svg');
    if (svg) {
      if (zoom === 'fit') { svg.style.width = '100%'; svg.style.height = 'auto'; }
      else { svg.style.width = Math.round(r.page.w * 96 * parseFloat(zoom)) + 'px'; svg.style.height = 'auto'; }
    }
    $('#vsdx-status').textContent = `${st.doc.pages[st.page].name}: ${r.stats.shapes} shapes, ${r.stats.texts} labels`
      + (r.stats.foreign ? `, ${r.stats.foreign} embedded picture${r.stats.foreign > 1 ? 's' : ''}` : '')
      + ` · ${Math.round(performance.now() - t0)} ms`;
  }

  $('#vsdx-zoom').onchange = () => { if (st.doc) render(); };
  $('#btn-vsdx-save').onclick = async () => {
    if (!st.file) return;
    const status = $('#vsdx-status');
    try {
      if (!session) throw new Error('Sign in required');
      status.textContent = 'Saving to project storage…';
      const path = cloud.storage.userPath(session.user.id, `vsdx/${Date.now()}_${st.file.name}`);
      const up = await cloud.storage.upload(path, st.file, { contentType: 'application/vnd.ms-visio.drawing.main+xml' });
      if (up.error) throw up.error;
      await unwrap(cloud.database.from('project_files').insert({
        project_id: project.id, filename: st.file.name, storage_path: path,
        size_bytes: st.file.size, aps_status: 'stored', owner_name: currentUser?.name || null,
      }).select(), 'Save Visio file');
      status.textContent += ' · saved ✓';
      toast('Visio file saved to the project.');
      $('#btn-vsdx-save').style.display = 'none';
    } catch (e) { toast(e.message || 'Save failed', 'error'); status.textContent = status.textContent.replace(/ · saved ✓$/, ''); }
  };
}

/* ---- Tab 8: Drawings (DWG + Autodesk) ---- */
async function tabDrawings(el, project, ctx) {
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
  await initAuth();
  await route();
})();
