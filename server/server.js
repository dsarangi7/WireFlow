#!/usr/bin/env node
/* ============================================================
 * WireFlow company server (AYK, http://192.168.3.8)
 * ------------------------------------------------------------
 * Serves the same static app as GitHub Pages, plus a small API so
 * every engineer signs in and works on the shared projects:
 *   - WireFlow accounts made by the admin (passwords hashed with scrypt);
 *   - projects (racks, electrical diagrams) and their DXF in SQLite;
 *   - shared lists: project folders, taught parts, numbering library;
 *   - every change records who made it and when (table `log`).
 * The drawing work (DXF reading, planning, PDF) still runs in each
 * engineer's browser, so the server only stores and hands out data.
 *
 * Plain Node.js (22.13 or newer), no npm packages:
 *   node server/server.js                         start (port 80, data in ./data)
 *   node server/server.js adduser <user> "<Full name>" [--admin]
 *   node server/server.js passwd <user>           set a new password
 *   node server/server.js users                   list the accounts
 *   node server/server.js rename <user> <new>     change a username (e.g. to the email address)
 *   node server/server.js backup [folder]         copy the database (default data/backups)
 * Settings (environment): WIREFLOW_PORT (80), WIREFLOW_HOST (0.0.0.0),
 *   WIREFLOW_DATA (<repo>/data), WIREFLOW_PFX + WIREFLOW_PFX_PASS for HTTPS.
 * ============================================================ */
'use strict';
process.removeAllListeners('warning'); /* node:sqlite prints an "experimental" warning */
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');

const ROOT = path.resolve(__dirname, '..');
const DATA = path.resolve(process.env.WIREFLOW_DATA || path.join(ROOT, 'data'));
const PORT = +(process.env.WIREFLOW_PORT || 80);
const HOST = process.env.WIREFLOW_HOST || '0.0.0.0';
const SESSION_HOURS = 12;
const MAX_BODY = 200 * 1024 * 1024; /* a large rack DXF is tens of MB */
const LISTS = new Set(['folders', 'parts', 'numberings']);

/* ---------------- database ---------------- */
fs.mkdirSync(DATA, { recursive: true });
const db = new DatabaseSync(path.join(DATA, 'wireflow.db'));
db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;
  CREATE TABLE IF NOT EXISTS users (
    username TEXT PRIMARY KEY, name TEXT NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL,
    admin INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY, username TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE, expires INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS projects (
    id INTEGER PRIMARY KEY AUTOINCREMENT, data TEXT NOT NULL, rev INTEGER NOT NULL DEFAULT 1,
    created_by TEXT, created_at TEXT NOT NULL, updated_by TEXT, updated_at TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS underlays (
    project_id INTEGER PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE, kind TEXT, body BLOB NOT NULL, gz INTEGER NOT NULL DEFAULT 0);
  CREATE TABLE IF NOT EXISTS list_items (
    list TEXT NOT NULL, id TEXT NOT NULL, pos REAL NOT NULL DEFAULT 0, item TEXT NOT NULL,
    updated_by TEXT, updated_at TEXT NOT NULL, PRIMARY KEY (list, id));
  CREATE TABLE IF NOT EXISTS log (
    at TEXT NOT NULL, username TEXT, action TEXT NOT NULL, target TEXT);
`);
const now = () => new Date().toISOString();
const log = (user, action, target) => db.prepare('INSERT INTO log VALUES (?,?,?,?)').run(now(), user || null, action, target == null ? null : String(target));

/* ---------------- passwords and sessions ---------------- */
function hashPassword(pw, salt) { return crypto.scryptSync(String(pw), salt, 64).toString('hex'); }
function checkPassword(user, pw) {
  const h = Buffer.from(hashPassword(pw, user.salt), 'hex');
  const want = Buffer.from(user.hash, 'hex');
  return h.length === want.length && crypto.timingSafeEqual(h, want);
}
function setPassword(username, pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('UPDATE users SET hash = ?, salt = ? WHERE username = ?').run(hashPassword(pw, salt), salt, username);
  db.prepare('DELETE FROM sessions WHERE username = ?').run(username);
}
function passwordProblem(pw) { return typeof pw !== 'string' || pw.length < 8 ? 'The password needs at least 8 characters.' : null; }
function addUser(username, name, pw, admin) {
  const salt = crypto.randomBytes(16).toString('hex');
  db.prepare('INSERT INTO users (username, name, hash, salt, admin, active, created_at) VALUES (?,?,?,?,?,1,?)')
    .run(username, name, hashPassword(pw, salt), salt, admin ? 1 : 0, now());
}
const cleanUser = u => u && { username: u.username, name: u.name, admin: !!u.admin, active: !!u.active };
/* a username is the engineer's email address (or a short name such as the admin's) */
const validUsername = u => typeof u === 'string' && /^[a-z0-9._+-]+(@[a-z0-9.-]+\.[a-z]{2,})?$/.test(u) && u.length >= 2 && u.length <= 80;

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    /* the first of two same-named cookies is the one with the longer path (/wireflow/ before /) */
    const k = i > 0 ? part.slice(0, i).trim() : '';
    if (k && !(k in out)) out[k] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
function sessionUser(req) {
  const token = cookies(req).wf_session;
  if (!token) return null;
  const row = db.prepare('SELECT u.*, s.expires FROM sessions s JOIN users u ON u.username = s.username WHERE s.token = ?').get(token);
  if (!row || row.expires < Date.now() || !row.active) return null;
  /* sliding expiry: working keeps you signed in */
  if (row.expires - Date.now() < (SESSION_HOURS - 1) * 3600e3) db.prepare('UPDATE sessions SET expires = ? WHERE token = ?').run(Date.now() + SESSION_HOURS * 3600e3, token);
  return row;
}
/* Behind nginx (AYK: http://192.168.3.8:3002/wireflow/) the request comes from nginx itself:
   the engineer's address is the last X-Forwarded-For entry, the sub-path is X-Forwarded-Prefix,
   and HTTPS is X-Forwarded-Proto. Those headers are trusted only from this machine. */
const fromProxy = req => /^(127\.|::1$|::ffff:127\.)/.test(req.socket.remoteAddress || '');
function clientIp(req) {
  const fwd = fromProxy(req) && String(req.headers['x-forwarded-for'] || '').split(',').map(s => s.trim()).filter(Boolean).pop();
  return fwd || req.socket.remoteAddress;
}
function sessionCookie(req, token, maxAge) {
  const https = req.socket.encrypted || (fromProxy(req) && req.headers['x-forwarded-proto'] === 'https');
  const prefix = fromProxy(req) && /^\/[\w-]+$/.test(req.headers['x-forwarded-prefix'] || '') ? req.headers['x-forwarded-prefix'] + '/' : '/';
  return `wf_session=${token}; HttpOnly; SameSite=Strict; Path=${prefix}; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
}

/* failed sign-ins: at most 10 per address in 15 minutes */
const failures = new Map();
function tooManyFailures(ip) {
  const f = failures.get(ip);
  return f && f.count >= 10 && Date.now() - f.since < 15 * 60e3;
}
function noteFailure(ip) {
  const f = failures.get(ip);
  if (!f || Date.now() - f.since > 15 * 60e3) failures.set(ip, { count: 1, since: Date.now() });
  else f.count++;
}

/* ---------------- http helpers ---------------- */
/* compressed when the browser accepts it (every browser does): a rack drawing is tens of MB
   of text and shrinks about ten times, so the network is never the slow part */
const acceptsGzip = res => /gzip/.test((res.req && res.req.headers['accept-encoding']) || '');
function send(res, code, body, headers, gzipped) {
  const isBuf = Buffer.isBuffer(body);
  let data = body == null ? '' : isBuf ? body : JSON.stringify(body);
  const extra = {};
  if (gzipped) {
    if (acceptsGzip(res)) extra['Content-Encoding'] = 'gzip'; else data = zlib.gunzipSync(data);
  } else if (data.length > 1024 && acceptsGzip(res)) { data = zlib.gzipSync(data, { level: 6 }); extra['Content-Encoding'] = 'gzip'; }
  if (extra['Content-Encoding']) extra['Vary'] = 'Accept-Encoding';
  res.writeHead(code, Object.assign(extra, {
    'Content-Type': isBuf ? 'application/octet-stream' : 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  }, headers || {}));
  res.end(data);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', c => { size += c.length; if (size > MAX_BODY) { reject(Object.assign(new Error('The upload is too large.'), { code: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) {
  const b = await readBody(req);
  try { return b.length ? JSON.parse(b.toString('utf8')) : {}; } catch (e) { throw Object.assign(new Error('Bad JSON.'), { code: 400 }); }
}
const fail = (code, message) => Object.assign(new Error(message), { code });

/* ---------------- static files ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.gz': 'application/gzip', '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml', '.jpg': 'image/jpeg', '.ps1': 'text/plain; charset=utf-8',
};
/* only the site itself: never the data, the server, the tests or AYK's confidential folder */
const PUBLIC = [/^\/index\.html$/, /^\/(styles|site)\.css$/, /^\/robots\.txt$/, /^\/sitemap\.xml$/, /^\/js\/[\w.-]+\.js$/, /^\/assets\/[\w./-]+$/];
function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';
  if (pathname.includes('..') || !PUBLIC.some(r => r.test(pathname))) return send(res, 404, { error: 'Not found' });
  const file = path.join(ROOT, pathname);
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
    const etag = `"${st.size}-${st.mtimeMs}"`;
    /* scripts revalidate every time, so a git pull reaches every engineer without Ctrl+Shift+R */
    const headers = { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'ETag': etag, 'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'SAMEORIGIN', 'Referrer-Policy': 'same-origin' };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
    if (/^(text|application\/(json|xml))|svg/.test(headers['Content-Type']) && acceptsGzip(res)) {
      res.writeHead(200, Object.assign(headers, { 'Content-Encoding': 'gzip', 'Vary': 'Accept-Encoding' }));
      if (req.method === 'HEAD') return res.end();
      return fs.createReadStream(file).pipe(zlib.createGzip()).pipe(res);
    }
    res.writeHead(200, Object.assign(headers, { 'Content-Length': st.size }));
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
}

/* ---------------- API ---------------- */
function projectOut(row) {
  const p = JSON.parse(row.data);
  return Object.assign(p, { id: row.id, rev: row.rev, created_by: row.created_by, updated_by: row.updated_by, updated_at: p.updated_at || row.updated_at });
}
const userName = u => (db.prepare('SELECT name FROM users WHERE username = ?').get(u) || {}).name || u;
function listOut(list) {
  return db.prepare('SELECT item FROM list_items WHERE list = ? ORDER BY pos, rowid').all(list).map(r => JSON.parse(r.item));
}

async function api(req, res, pathname) {
  /* every change needs this header, so a page on another site cannot post here */
  if (req.method !== 'GET' && req.headers['x-wireflow'] !== '1') throw fail(403, 'Refused.');
  const ip = clientIp(req);

  if (pathname === '/api/login' && req.method === 'POST') {
    if (tooManyFailures(ip)) throw fail(429, 'Too many failed sign-ins. Wait 15 minutes and try again.');
    const b = await readJson(req);
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(String(b.username || '').trim().toLowerCase());
    if (!u || !u.active || !checkPassword(u, b.password || '')) { noteFailure(ip); log(b.username, 'login failed', ip); throw fail(401, 'Wrong username or password.'); }
    failures.delete(ip);
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('DELETE FROM sessions WHERE expires < ?').run(Date.now());
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(token, u.username, Date.now() + SESSION_HOURS * 3600e3);
    log(u.username, 'login', ip);
    return send(res, 200, { user: cleanUser(u) }, { 'Set-Cookie': sessionCookie(req, token, SESSION_HOURS * 3600) });
  }
  if (pathname === '/api/logout' && req.method === 'POST') {
    const token = cookies(req).wf_session;
    if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  const me = sessionUser(req);
  if (pathname === '/api/me') return me ? send(res, 200, { user: cleanUser(me) }) : send(res, 401, { error: 'Not signed in.' });
  if (!me) throw fail(401, 'Not signed in.');

  if (pathname === '/api/password' && req.method === 'POST') {
    const b = await readJson(req);
    if (!checkPassword(me, b.old || '')) throw fail(400, 'The current password is wrong.');
    const bad = passwordProblem(b.new); if (bad) throw fail(400, bad);
    setPassword(me.username, b.new); log(me.username, 'password changed');
    return send(res, 200, { ok: true }, { 'Set-Cookie': sessionCookie(req, '', 0) });
  }

  /* accounts (admin only) */
  if (pathname === '/api/users') {
    if (!me.admin) throw fail(403, 'Only the admin manages accounts.');
    if (req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM users ORDER BY name').all().map(cleanUser));
    if (req.method === 'POST') {
      const b = await readJson(req);
      const username = String(b.username || '').trim().toLowerCase();
      if (!validUsername(username)) throw fail(400, 'Use the engineer\'s email address as the username (e.g. name@aykpower.com).');
      if (!String(b.name || '').trim()) throw fail(400, 'Enter the engineer\'s name.');
      const bad = passwordProblem(b.password); if (bad) throw fail(400, bad);
      if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw fail(409, 'That username is taken.');
      addUser(username, String(b.name).trim(), b.password, !!b.admin);
      log(me.username, 'user added', username);
      return send(res, 200, { ok: true });
    }
  }
  const um = pathname.match(/^\/api\/users\/([a-z0-9._+@-]+)$/);
  if (um && req.method === 'PATCH') {
    if (!me.admin) throw fail(403, 'Only the admin manages accounts.');
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(um[1]);
    if (!u) throw fail(404, 'No such account.');
    const b = await readJson(req);
    if (u.username === me.username && (b.active === false || b.admin === false)) throw fail(400, 'You cannot lock yourself out.');
    if (b.name != null && String(b.name).trim()) db.prepare('UPDATE users SET name = ? WHERE username = ?').run(String(b.name).trim(), u.username);
    if (b.admin != null) db.prepare('UPDATE users SET admin = ? WHERE username = ?').run(b.admin ? 1 : 0, u.username);
    if (b.active != null) { db.prepare('UPDATE users SET active = ? WHERE username = ?').run(b.active ? 1 : 0, u.username); if (!b.active) db.prepare('DELETE FROM sessions WHERE username = ?').run(u.username); }
    if (b.password != null) { const bad = passwordProblem(b.password); if (bad) throw fail(400, bad); setPassword(u.username, b.password); }
    let now_ = u.username;
    if (b.username != null) {
      /* a new username (their email address): they sign in again with it */
      const to = String(b.username).trim().toLowerCase();
      if (to !== u.username) {
        if (!validUsername(to)) throw fail(400, 'Use the engineer\'s email address as the username (e.g. name@aykpower.com).');
        if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(to)) throw fail(409, 'That username is taken.');
        db.prepare('DELETE FROM sessions WHERE username = ?').run(u.username);
        db.prepare('UPDATE users SET username = ? WHERE username = ?').run(to, u.username);
        now_ = to;
      }
    }
    log(me.username, 'user changed', u.username + (now_ !== u.username ? ' -> ' + now_ : '') + ' ' + Object.keys(b).filter(k => k !== 'password').concat(b.password != null ? ['password'] : []).join(','));
    return send(res, 200, { ok: true, username: now_ });
  }
  if (um && req.method === 'DELETE') {
    if (!me.admin) throw fail(403, 'Only the admin manages accounts.');
    if (um[1] === me.username) throw fail(400, 'You cannot delete your own account.');
    const u = db.prepare('SELECT * FROM users WHERE username = ?').get(um[1]);
    if (!u) throw fail(404, 'No such account.');
    db.prepare('DELETE FROM users WHERE username = ?').run(u.username);  /* their sessions go with it */
    log(me.username, 'user deleted', u.username + ' (' + u.name + ')');
    return send(res, 200, { ok: true });
  }

  /* projects */
  if (pathname === '/api/projects') {
    if (req.method === 'GET') return send(res, 200, db.prepare('SELECT * FROM projects').all().map(projectOut));
    if (req.method === 'POST') {
      const p = await readJson(req);
      delete p.id; delete p.rev;
      const t = now();
      const r = db.prepare('INSERT INTO projects (data, rev, created_by, created_at, updated_by, updated_at) VALUES (?,1,?,?,?,?)')
        .run(JSON.stringify(p), userName(me.username), t, userName(me.username), t);
      log(me.username, 'project added', r.lastInsertRowid + ' ' + (p.name || ''));
      return send(res, 200, { id: Number(r.lastInsertRowid), rev: 1 });
    }
  }
  const pm = pathname.match(/^\/api\/projects\/(\d+)(\/underlay)?$/);
  if (pm) {
    const id = +pm[1];
    const row = db.prepare('SELECT * FROM projects WHERE id = ?').get(id);
    if (!row) throw fail(404, 'This project is not on the server (it may have been deleted).');
    if (pm[2]) {
      if (req.method === 'GET') {
        const u = db.prepare('SELECT * FROM underlays WHERE project_id = ?').get(id);
        if (!u) throw fail(404, 'No drawing stored.');
        return send(res, 200, Buffer.from(u.body), { 'X-Kind': u.kind || '' }, !!u.gz);
      }
      if (req.method === 'PUT') {
        const body = await readBody(req);
        db.prepare('INSERT OR REPLACE INTO underlays (project_id, kind, body, gz) VALUES (?,?,?,1)').run(id, String(req.headers['x-kind'] || ''), zlib.gzipSync(body, { level: 6 }));
        log(me.username, 'drawing stored', id);
        return send(res, 200, { ok: true });
      }
    }
    if (req.method === 'GET') return send(res, 200, projectOut(row));
    if (req.method === 'PUT') {
      const p = await readJson(req);
      const base = +req.headers['x-rev'];
      /* someone else saved since this copy was opened: theirs is kept and this save refused */
      if (base && base !== row.rev) return send(res, 409, { error: `${row.updated_by || 'Another engineer'} changed "${JSON.parse(row.data).name || 'this project'}" at ${new Date(row.updated_at).toLocaleString('en-GB')}. Reload the page to get their version.`, by: row.updated_by, at: row.updated_at });
      delete p.id; delete p.rev; delete p.created_by; delete p.updated_by;
      const rev = row.rev + 1;
      db.prepare('UPDATE projects SET data = ?, rev = ?, updated_by = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(p), rev, userName(me.username), now(), id);
      log(me.username, 'project saved', id);
      return send(res, 200, { rev: rev });
    }
    if (req.method === 'DELETE') {
      db.prepare('DELETE FROM projects WHERE id = ?').run(id);
      log(me.username, 'project deleted', id + ' ' + (JSON.parse(row.data).name || ''));
      return send(res, 200, { ok: true });
    }
  }

  /* shared lists: changes are merged item by item, so two engineers never overwrite each other's lists */
  const lm = pathname.match(/^\/api\/lists\/([a-z]+)$/);
  if (lm && LISTS.has(lm[1])) {
    const list = lm[1];
    if (req.method === 'GET') return send(res, 200, listOut(list));
    if (req.method === 'POST') {
      const b = await readJson(req);
      const t = now();
      db.exec('BEGIN');
      try {
        for (const id of b.del || []) db.prepare('DELETE FROM list_items WHERE list = ? AND id = ?').run(list, String(id));
        for (const x of b.put || []) db.prepare('INSERT OR REPLACE INTO list_items (list, id, pos, item, updated_by, updated_at) VALUES (?,?,?,?,?,?)')
          .run(list, String(x.id), +x.pos || 0, JSON.stringify(x.item), me.username, t);
        db.exec('COMMIT');
      } catch (e) { db.exec('ROLLBACK'); throw e; }
      if ((b.del || []).length || (b.put || []).length) log(me.username, 'list ' + list, `${(b.put || []).length} saved, ${(b.del || []).length} removed`);
      return send(res, 200, listOut(list));
    }
  }

  throw fail(404, 'Unknown request.');
}

/* ---------------- server ---------------- */
async function handle(req, res) {
  const pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  try {
    if (pathname.startsWith('/api/')) await api(req, res, pathname);
    else if (req.method === 'GET' || req.method === 'HEAD') serveStatic(req, res, pathname);
    else send(res, 405, { error: 'Method not allowed' });
  } catch (e) {
    if (!e.code || typeof e.code !== 'number') console.error(new Date().toISOString(), req.method, pathname, e);
    if (!res.headersSent) send(res, typeof e.code === 'number' ? e.code : 500, { error: typeof e.code === 'number' ? e.message : 'Server error. See the server log.' });
  }
}

function start() {
  const pfx = process.env.WIREFLOW_PFX;
  const server = pfx ? https.createServer({ pfx: fs.readFileSync(pfx), passphrase: process.env.WIREFLOW_PFX_PASS || '' }, handle) : http.createServer(handle);
  server.requestTimeout = 10 * 60e3;
  server.listen(PORT, HOST, () => {
    const n = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    console.log(`WireFlow server on ${pfx ? 'https' : 'http'}://${HOST}:${PORT}, data in ${DATA}`);
    if (!n) console.log('No accounts yet. Add the admin with:  node server/server.js adduser <username> "<Full name>" --admin');
  });
  return server;
}

/* ---------------- command line ---------------- */
function askPassword(prompt) {
  return new Promise(resolve => {
    const rl = require('node:readline').createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = s => { if (s.includes(prompt)) process.stdout.write(s); };
    rl.question(prompt, a => { rl.close(); process.stdout.write('\n'); resolve(a); });
  });
}
async function cli(args) {
  const [cmd, username, name] = args;
  if (cmd === 'rename') {
    /* node server/server.js rename <old username> <new username>: e.g. to the engineer's email address */
    const to = String(name || '').trim().toLowerCase();
    if (!db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) { console.error('No such account: ' + username); process.exit(1); }
    if (!validUsername(to)) { console.error('Not a valid username: ' + to); process.exit(1); }
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(to)) { console.error('Already taken: ' + to); process.exit(1); }
    db.prepare('DELETE FROM sessions WHERE username = ?').run(username);
    db.prepare('UPDATE users SET username = ? WHERE username = ?').run(to, username);
    log(null, 'user renamed (console)', username + ' -> ' + to);
    console.log(`${username} is now ${to}`);
    return;
  }
  if (cmd === 'users') { for (const u of db.prepare('SELECT * FROM users ORDER BY name').all()) console.log(`${u.username}\t${u.name}${u.admin ? '\t(admin)' : ''}${u.active ? '' : '\t(locked)'}`); return; }
  if ((cmd === 'adduser' || cmd === 'passwd') && validUsername(username)) {
    const exists = db.prepare('SELECT 1 FROM users WHERE username = ?').get(username);
    if (cmd === 'adduser' && exists) { console.error('That username is taken.'); process.exit(1); }
    if (cmd === 'passwd' && !exists) { console.error('No such account.'); process.exit(1); }
    if (cmd === 'adduser' && !name) { console.error('Give the full name in quotes.'); process.exit(1); }
    const pw = await askPassword('Password: ');
    const bad = passwordProblem(pw); if (bad) { console.error(bad); process.exit(1); }
    if (await askPassword('Again: ') !== pw) { console.error('The two passwords differ.'); process.exit(1); }
    if (cmd === 'adduser') { addUser(username, name, pw, args.includes('--admin')); log(null, 'user added (console)', username); console.log(`Account ${username} added${args.includes('--admin') ? ' as admin' : ''}.`); }
    else { setPassword(username, pw); log(null, 'password set (console)', username); console.log('Password changed.'); }
    return;
  }
  if (cmd === 'backup') {
    /* a consistent copy while the server runs; keeps the newest 30 */
    const dir = path.resolve(username || path.join(DATA, 'backups'));
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, 'wireflow-' + now().replace(/[:.]/g, '-').slice(0, 19) + '.db');
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    const old = fs.readdirSync(dir).filter(f => /^wireflow-.*\.db$/.test(f)).sort().reverse().slice(30);
    for (const f of old) fs.unlinkSync(path.join(dir, f));
    console.log('Backup written: ' + file);
    return;
  }
  console.error('Usage: node server/server.js [adduser <user> "<Full name>" [--admin] | passwd <user> | users | rename <user> <new user> | backup [folder]]');
  process.exit(1);
}

if (require.main === module) {
  if (process.argv.length > 2) cli(process.argv.slice(2));
  else start();
}
module.exports = { start, db, addUser };
