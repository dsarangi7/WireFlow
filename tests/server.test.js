/* Company server: sign-in, accounts, shared projects, conflicts, shared lists, static files.
   Starts the server on a free port with a throw-away data folder. Run: node tests/server.test.js */
'use strict';
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wireflow-server-'));
process.env.WIREFLOW_DATA = dir;
process.env.WIREFLOW_PORT = '0';
process.env.WIREFLOW_HOST = '127.0.0.1';
const srv = require('../server/server.js');

let passed = 0;
const ok = (cond, msg) => { assert.ok(cond, msg); passed++; };

(async () => {
  const server = srv.start();
  await new Promise(r => server.once('listening', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  srv.addUser('dibya', 'Dibya Jyoti Sarangi', 'admin-pass-1', true);

  const client = () => {
    let cookie = '';
    return async (method, p, body, headers) => {
      const h = Object.assign({ 'X-WireFlow': '1' }, headers || {});
      if (cookie) h.Cookie = cookie;
      let b;
      if (Buffer.isBuffer(body)) b = body; else if (body !== undefined) { b = JSON.stringify(body); h['Content-Type'] = 'application/json'; }
      const res = await fetch(base + p, { method, headers: h, body: b });
      const sc = res.headers.get('set-cookie');
      if (sc) cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
      const type = res.headers.get('content-type') || '';
      return { status: res.status, headers: res.headers, data: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
    };
  };
  const admin = client(), eng = client(), anon = client();

  /* sign-in */
  ok((await anon('GET', '/api/me')).status === 401, 'not signed in');
  ok((await anon('GET', '/api/projects')).status === 401, 'projects need sign-in');
  ok((await admin('POST', '/api/login', { username: 'dibya', password: 'wrong-pass' })).status === 401, 'wrong password refused');
  const li = await admin('POST', '/api/login', { username: 'Dibya', password: 'admin-pass-1' });
  ok(li.status === 200 && li.data.user.admin, 'admin signs in (username case ignored)');
  ok(/HttpOnly/.test(li.headers.get('set-cookie')) && /SameSite=Strict/.test(li.headers.get('set-cookie')), 'cookie is HttpOnly + SameSite');
  ok((await admin('POST', '/api/projects', {}, { 'X-WireFlow': '' })).status === 403, 'change without the WireFlow header refused');

  /* accounts */
  ok((await admin('POST', '/api/users', { username: 'ravi', name: 'Ravi', password: 'short' })).status === 400, 'short password refused');
  ok((await admin('POST', '/api/users', { username: 'ravi', name: 'Ravi Kumar', password: 'engineer-1' })).status === 200, 'admin adds an engineer');
  ok((await admin('POST', '/api/users', { username: 'ravi', name: 'Ravi', password: 'engineer-1' })).status === 409, 'username taken');
  ok((await eng('POST', '/api/login', { username: 'ravi', password: 'engineer-1' })).status === 200, 'engineer signs in');
  ok((await eng('GET', '/api/users')).status === 403, 'engineer cannot manage accounts');
  ok((await admin('PATCH', '/api/users/dibya', { active: false })).status === 400, 'admin cannot lock themself');

  /* projects shared */
  const add = await admin('POST', '/api/projects', { name: 'Rack 1', underlay_kind: 'cad', folder: 'p1', config: { cad: { a: 1 } } });
  ok(add.status === 200 && add.data.id === 1 && add.data.rev === 1, 'project added');
  const list = await eng('GET', '/api/projects');
  ok(list.data.length === 1 && list.data[0].name === 'Rack 1' && list.data[0].created_by === 'Dibya Jyoti Sarangi', 'engineer sees the admin\'s project, with who made it');
  const dxf = Buffer.from('0\nSECTION\n2\nENTITIES\n0\nENDSEC\n0\nEOF\n');
  ok((await admin('PUT', '/api/projects/1/underlay', dxf, { 'X-Kind': 'cad' })).status === 200, 'drawing stored');
  const u = await eng('GET', '/api/projects/1/underlay', undefined, { 'Accept-Encoding': 'gzip' });
  ok(u.status === 200 && u.data.equals(dxf) && u.headers.get('x-kind') === 'cad', 'drawing read back byte for byte');
  ok(u.headers.get('content-encoding') === 'gzip', 'drawing sent compressed');

  /* edits and conflicts */
  const s1 = await eng('PUT', '/api/projects/1', { name: 'Rack 1', config: { cad: { a: 2 } } }, { 'X-Rev': '1' });
  ok(s1.status === 200 && s1.data.rev === 2, 'engineer saves');
  const got = (await admin('GET', '/api/projects/1')).data;
  ok(got.config.cad.a === 2 && got.updated_by === 'Ravi Kumar', 'admin sees the change and who made it');
  const stale = await admin('PUT', '/api/projects/1', { name: 'Rack 1', config: { cad: { a: 3 } } }, { 'X-Rev': '1' });
  ok(stale.status === 409 && /Ravi Kumar/.test(stale.data.error), 'save on an old copy refused, naming who changed it');
  ok((await admin('GET', '/api/projects/1')).data.config.cad.a === 2, 'the other engineer\'s work is kept');

  /* shared lists merge item by item */
  await admin('POST', '/api/lists/folders', { put: [{ id: 'p1', pos: 0, item: { id: 'p1', number: 'S10176' } }] });
  const l2 = await eng('POST', '/api/lists/folders', { put: [{ id: 'p2', pos: 1, item: { id: 'p2', number: 'S10195' } }] });
  ok(l2.data.length === 2, 'two engineers add folders without losing either');
  const l3 = await admin('POST', '/api/lists/folders', { del: ['p2'] });
  ok(l3.data.length === 1 && l3.data[0].number === 'S10176', 'folder removed');
  ok((await admin('GET', '/api/lists/secrets')).status === 404, 'unknown list refused');

  /* locking and passwords */
  await admin('PATCH', '/api/users/ravi', { active: false });
  ok((await eng('GET', '/api/projects')).status === 401, 'locked engineer is signed out');
  ok((await eng('POST', '/api/login', { username: 'ravi', password: 'engineer-1' })).status === 401, 'locked engineer cannot sign in');
  await admin('PATCH', '/api/users/ravi', { active: true, password: 'engineer-2' });
  ok((await eng('POST', '/api/login', { username: 'ravi', password: 'engineer-2' })).status === 200, 'unlocked with a new password');
  ok((await eng('POST', '/api/password', { old: 'engineer-2', new: 'engineer-3' })).status === 200, 'engineer changes own password');
  ok((await eng('GET', '/api/projects')).status === 401, 'a password change signs out');
  ok((await eng('POST', '/api/login', { username: 'ravi', password: 'engineer-3' })).status === 200, 'signs in with the new password');

  /* delete */
  ok((await eng('DELETE', '/api/projects/1')).status === 200, 'project deleted');
  ok((await admin('GET', '/api/projects/1')).status === 404 && (await admin('GET', '/api/projects/1/underlay')).status === 404, 'project and drawing gone');

  /* static site, and nothing else */
  const idx = await anon('GET', '/');
  ok(idx.status === 200 && /store\.js/.test(idx.data.toString()), 'site served');
  ok((await anon('GET', '/js/app.js')).status === 200, 'scripts served');
  for (const p of ['/server/server.js', '/data/wireflow.db', '/tests/server.test.js', '/.git/config', '/Electrical%20Diagram/x.dxf', '/js/../server/server.js'])
    ok((await anon('GET', p)).status === 404, 'not served: ' + p);

  /* every change was logged */
  const n = srv.db.prepare('SELECT COUNT(*) AS n FROM log').get().n;
  ok(n > 10, 'changes logged');

  server.close();
  srv.db.close();
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('Server tests passed: ' + passed);
})().catch(e => { console.error(e); process.exit(1); });
