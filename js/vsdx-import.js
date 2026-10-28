/* ============================================================
 * AYK WireFlow — .vsdx importer (read the REAL Visio drawing)
 * ------------------------------------------------------------
 * The generated sheet is our own drawing. This module reads the
 * engineer's own Visio file back: it unzips the OPC package,
 * parses every page shape (geometry, text, layers, masters) and
 * rebuilds it as SVG — including the AutoCAD rack that Visio
 * keeps as an OLE object, whose presentation image is a vector
 * EMF rendered by js/emf.js.
 *
 * Everything runs client side: no upload, no conversion server.
 * ============================================================ */

/* ---------- minimal ZIP reader (browser, no dependency) ---------- */
async function vsdxZipRead(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 66000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  const out = new Map();
  if (eocd < 0) throw new Error('Not a valid .vsdx — the file is not a zip package.');

  const total = dv.getUint16(eocd + 10, true);
  let cdOff = dv.getUint32(eocd + 16, true);
  let read = 0;
  for (let n = 0; n < total && dv.getUint32(cdOff, true) === 0x02014b50; n++) {
    const method = dv.getUint16(cdOff + 10, true);
    const csize = dv.getUint32(cdOff + 20, true);
    const nameLen = dv.getUint16(cdOff + 28, true);
    const extraLen = dv.getUint16(cdOff + 30, true);
    const cmtLen = dv.getUint16(cdOff + 32, true);
    const lho = dv.getUint32(cdOff + 42, true);
    let name = '';
    for (let i = 0; i < nameLen; i++) name += String.fromCharCode(u8[cdOff + 46 + i]);
    cdOff += 46 + nameLen + extraLen + cmtLen;
    const lNameLen = dv.getUint16(lho + 26, true);
    const lExtraLen = dv.getUint16(lho + 28, true);
    const dataOff = lho + 30 + lNameLen + lExtraLen;
    const raw = u8.subarray(dataOff, dataOff + csize);
    out.set(name, method === 0 ? new Uint8Array(raw) : await vsdxInflate(raw));
    read++;
  }
  if (read === 0) throw new Error('Not a valid .vsdx — the zip package has no readable parts.');
  return out;
}

async function vsdxInflate(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('This browser cannot unpack a compressed .vsdx (no DecompressionStream). Use Chrome/Edge 90 or newer.');
  }
  const ds = new DecompressionStream('deflate-raw');
  const stream = new Blob([bytes]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ---------- minimal XML tree (works in Node and the browser) ---------- */
function vsdxXml(text) {
  const root = { tag: '#root', attrs: {}, children: [], text: '' };
  const stack = [root];
  const s = String(text);
  let i = 0;
  const ent = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (m, d) => String.fromCharCode(+d))
    .replace(/&#x([0-9a-fA-F]+);/g, (m, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
  while (i < s.length) {
    const lt = s.indexOf('<', i);
    if (lt < 0) { stack[stack.length - 1].text += ent(s.slice(i)); break; }
    if (lt > i) stack[stack.length - 1].text += ent(s.slice(i, lt));
    if (s.startsWith('<!--', lt)) { const e = s.indexOf('-->', lt); i = e < 0 ? s.length : e + 3; continue; }
    if (s.startsWith('<?', lt) || s.startsWith('<!', lt)) { const e = s.indexOf('>', lt); i = e < 0 ? s.length : e + 1; continue; }
    if (s.startsWith('</', lt)) {
      const e = s.indexOf('>', lt);
      const name = s.slice(lt + 2, e).trim();
      for (let k = stack.length - 1; k > 0; k--) { if (stack[k].tag === name) { stack.length = k; break; } }
      i = e + 1; continue;
    }
    /* opening tag */
    let e = lt + 1;
    while (e < s.length && s[e] !== '>' ) {
      if (s[e] === '"' || s[e] === "'") { const q = s[e]; e++; while (e < s.length && s[e] !== q) e++; }
      e++;
    }
    const inner = s.slice(lt + 1, e);
    const selfClose = inner.endsWith('/');
    const body = selfClose ? inner.slice(0, -1) : inner;
    const sp = body.search(/[\s]/);
    const tag = sp < 0 ? body : body.slice(0, sp);
    const attrs = {};
    const re = /([A-Za-z_][-\w:.]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(body))) attrs[m[1]] = ent(m[3] !== undefined ? m[3] : m[4]);
    const node = { tag: tag, attrs: attrs, children: [], text: '' };
    stack[stack.length - 1].children.push(node);
    if (!selfClose) stack.push(node);
    i = e + 1;
  }
  return root;
}

function vsdxKids(node, tag) { return node.children.filter((c) => c.tag === tag); }
function vsdxKid(node, tag) { return node.children.find((c) => c.tag === tag) || null; }
/* the page root is <PageContents><Shapes>…, so the container has to be
   found anywhere in the tree, not only among direct children */
function vsdxFind(node, tag) {
  for (const c of node.children) {
    if (c.tag === tag) return c;
    const f = vsdxFind(c, tag);
    if (f) return f;
  }
  return null;
}

function vsdxCells(el) {
  const out = {};
  for (const c of el.children) if (c.tag === 'Cell' && c.attrs.N) out[c.attrs.N] = c.attrs.V;
  return out;
}

function vsdxNum(v, dflt) {
  const n = parseFloat(String(v == null ? '' : v).replace(/[^0-9eE+\-.]/g, ''));
  return Number.isFinite(n) ? n : (dflt === undefined ? 0 : dflt);
}

function vsdxHex(v) { return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v) ? v : null; }

function vsdxRels(bytes) {
  const map = new Map();
  if (!bytes) return map;
  const root = vsdxXml(new TextDecoder().decode(bytes));
  for (const r of root.children[0] ? root.children[0].children : []) {
    if (r.tag === 'Relationship' && r.attrs.Id) map.set(r.attrs.Id, r.attrs.Target);
  }
  if (!map.size) {
    for (const r of root.children) if (r.tag === 'Relationship' && r.attrs.Id) map.set(r.attrs.Id, r.attrs.Target);
  }
  return map;
}

function vsdxResolve(baseDir, target) {
  /* baseDir like 'visio/pages' ; target may be '../media/x.emf' or 'x.emf' */
  const parts = (baseDir ? baseDir.split('/') : []).filter(Boolean);
  for (const seg of String(target || '').split('/')) {
    if (seg === '..') parts.pop();
    else if (seg === '.' || seg === '') continue;
    else parts.push(seg);
  }
  return parts.join('/');
}

/* ---------- package open ---------------------------------- */
async function vsdxOpen(buf, opts) {
  const pkg = await vsdxZipRead(buf);
  const decode = (p) => (pkg.has(p) ? new TextDecoder().decode(pkg.get(p)) : null);
  const pagesXml = decode('visio/pages/pages.xml');
  if (!pagesXml) throw new Error('Not a Visio drawing — visio/pages/pages.xml is missing.');
  const pagesRoot = vsdxKid(vsdxXml(pagesXml), 'Pages') || vsdxXml(pagesXml);
  const pagesRels = vsdxRels(pkg.get('visio/pages/_rels/pages.xml.rels'));
  const masterRels = vsdxRels(pkg.get('visio/masters/_rels/masters.xml.rels'));
  const mastersXml = decode('visio/masters/masters.xml');
  const masterById = new Map();
  if (mastersXml) {
    const msRoot = vsdxKid(vsdxXml(mastersXml), 'Masters') || vsdxXml(mastersXml);
    for (const ms of vsdxKids(msRoot, 'Master')) {
      const rel = vsdxKid(ms, 'Rel');
      const rid = rel ? rel.attrs['r:id'] : null;
      const target = rid ? masterRels.get(rid) : null;
      if (ms.attrs.ID && target) masterById.set(ms.attrs.ID, 'visio/masters/' + target.replace(/^\.?\/?/, ''));
    }
  }

  const pages = [];
  for (const p of vsdxKids(pagesRoot, 'Page')) {
    const rel = vsdxKid(p, 'Rel');
    const rid = rel ? rel.attrs['r:id'] : null;
    const target = rid ? pagesRels.get(rid) : null;
    if (!target) continue;
    const part = vsdxResolve('visio/pages', target);
    if (!pkg.has(part)) continue;
    const sheet = vsdxKid(p, 'PageSheet');
    const sc = sheet ? vsdxCells(sheet) : {};
    const layers = [];
    if (sheet) {
      for (const sec of vsdxKids(sheet, 'Section')) {
        if (sec.attrs.N !== 'Layer') continue;
        let ix = 0;
        for (const row of vsdxKids(sec, 'Row')) {
          const rc = vsdxCells(row);
          layers.push({ ix: ix++, name: rc.Name || ('Layer ' + ix), visible: rc.Visible !== '0', color: vsdxHex(rc.Color) });
        }
      }
    }
    pages.push({
      id: p.attrs.ID, name: p.attrs.NameU || p.attrs.Name || ('Page ' + (pages.length + 1)),
      part: part, w: vsdxNum(sc.PageWidth, 11.69) , h: vsdxNum(sc.PageHeight, 8.27),
      layers: layers,
    });
  }
  if (!pages.length) throw new Error('This .vsdx has no drawing pages.');

  const mediaCache = new Map();
  const pageCache = new Map();
  const emfPx = (opts && opts.emfPx) || 2200;

  async function imageFor(rid, rels, baseDir) {
    const target = rels.get(rid);
    if (!target) return null;
    const path = vsdxResolve(baseDir, target);
    if (!pkg.has(path)) return null;
    const bytes = pkg.get(path);
    if (/\.emf$/i.test(path)) return await emfImage(bytes, emfPx, mediaCache, path);
    /* OLE object: its presentation image is referenced by <path>.rels */
    if (/oleObject\d+\.bin$/i.test(path)) {
      const ore = vsdxRels(pkg.get(vsdxResolve(path.substring(0, path.lastIndexOf('/')), '_rels/' + path.substring(path.lastIndexOf('/') + 1) + '.rels')));
      for (const [, t] of ore) {
        const p2 = vsdxResolve(path.substring(0, path.lastIndexOf('/')), t);
        if (pkg.has(p2)) {
          return /\.(emf|wmf)$/i.test(p2)
            ? await emfImage(pkg.get(p2), emfPx, mediaCache, p2)
            : Object.assign({ note: 'ole' }, vsdxImageBytes(pkg.get(p2), p2));
        }
      }
      return null;
    }
    return Object.assign({ note: null }, vsdxImageBytes(bytes, path));
  }

  async function renderPage(ix, popts) {
    const page = pages[ix];
    if (!pageCache.has(page.part)) pageCache.set(page.part, vsdxXml(decode(page.part)));
    const root = pageCache.get(page.part);
    const rels = vsdxRels(pkg.get(vsdxResolve(page.part.substring(0, page.part.lastIndexOf('/')), '_rels/' + page.part.substring(page.part.lastIndexOf('/') + 1) + '.rels')));
    const shapeRoot = vsdxFind(root, 'Shapes') || root;
    const onLayers = popts && popts.layersOn ? popts.layersOn : null;   /* Set<number> of layer ix */

    const out = [];
    const foreigns = [];
    let shapes = 0, texts = 0, foreign = 0;

    async function emit(shapesEl, inherited) {
      for (const sh of shapesEl.children) {
        if (sh.tag !== 'Shape') continue;
        const cells = vsdxCells(sh);
        const masterId = sh.attrs.Master;
        const layerIx = cells.LayerMember !== undefined ? parseInt(cells.LayerMember, 10) : inherited;
        if (onLayers && layerIx !== null && layerIx !== undefined && Number.isFinite(layerIx) && !onLayers.has(layerIx)) continue;
        if (cells.Hidden === '1' || sh.attrs.Hidden === '1') continue;
        shapes++;

        const fx = cells.FlipX === '1' ? -1 : 1;
        const fy = cells.FlipY === '1' ? -1 : 1;
        const sw = vsdxNum(cells.Width), shh = vsdxNum(cells.Height);
        const lx = vsdxPin(cells, 'LocPinX', sw / 2), ly = vsdxPin(cells, 'LocPinY', shh / 2);
        const t = `translate(${vsdxNum(cells.PinX)} ${vsdxNum(cells.PinY)}) rotate(${vsdxNum(cells.Angle)}) `
          + `scale(${fx} ${fy}) translate(${-lx} ${-ly})`;

        /* --- foreign object (CAD rack / logo) --- */
        const fd = vsdxKid(sh, 'ForeignData');
        if (fd) {
          const rel = vsdxKid(fd, 'Rel');
          const img = rel ? await imageFor(rel.attrs['r:id'], rels, 'visio/pages') : null;
          const W = vsdxNum(cells.Width), H = vsdxNum(cells.Height);
          if (img) {
            foreign++;
            /* page-inch geometry for "use as wiring base": centre + size of
               the picture on the page (rotation-aware bounding box). */
            const ang = vsdxNum(cells.Angle) * Math.PI / 180;
            const hw = (Math.abs(W / 2 * Math.cos(ang)) + Math.abs(H / 2 * Math.sin(ang)));
            const hh = (Math.abs(W / 2 * Math.sin(ang)) + Math.abs(H / 2 * Math.cos(ang)));
            foreigns.push({
              href: img.href, blob: img.blob || null,
              note: img.note || fd.attrs.ForeignType || 'foreign',
              x: vsdxNum(cells.PinX) - hw, y: vsdxNum(cells.PinY) - hh,
              w: hw * 2, h: hh * 2,
            });
            out.push(`<g transform="${t}">`
              + `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff" stroke="none"/>`
              + `<image x="0" y="0" width="${W}" height="${H}" `
              + `preserveAspectRatio="xMidYMid meet" href="${img.href}" data-vsdx-foreign="${escAttr(img.note || (fd.attrs.ForeignType || 'foreign'))}"/>`
              + `</g>`);
          } else {
            out.push(`<g transform="${t}">`
              + `<rect x="0" y="0" width="${W}" height="${H}" fill="#f1f5f9" stroke="#94a3b8" stroke-width="0.01" stroke-dasharray="0.06 0.04"/>`
              + `<text x="${W / 2}" y="${H / 2}" font-size="${Math.max(0.08, H / 12)}" fill="#64748b" text-anchor="middle" `
              + `font-family="Arial">embedded ${escXml(fd.attrs.ForeignType || 'object')}</text></g>`);
          }
          continue;
        }

        /* --- 1D shape without geometry: draw in parent coordinates --- */
        const geoms = vsdxKids(sh, 'Section').filter((s) => s.attrs.N === 'Geometry');
        if (!geoms.length && cells.BeginX !== undefined && cells.EndX !== undefined) {
          const st = lineStyle(cells);
          if (st.stroke !== 'none') {
            out.push(`<path d="M ${vsdxNum(cells.BeginX)} ${vsdxNum(cells.BeginY)} L ${vsdxNum(cells.EndX)} ${vsdxNum(cells.EndY)}" `
              + `fill="none" stroke="${st.stroke}" stroke-width="${st.width}"/>`);
          }
          continue;
        }

        if (masterId && masterById.has(masterId)) {
          const mxml = decode(masterById.get(masterId));
          if (mxml) {
            const mroot = vsdxXml(mxml);
            const mshapes = vsdxFind(mroot, 'Shapes');
            if (mshapes && mshapes.children.length) {
              /* Master shapes are stored in the master's DESIGN units.
                 The instance maps them onto its own box by the ratio
                 instance/master size (verified: the instance's inherited
                 LocPin equals the master LocPin times exactly this ratio),
                 so the whole master content is wrapped in one scale and
                 the instance transform places it on the page. Text sizes
                 scale with it, exactly as Visio shows them. */
              const mc = vsdxCells(mshapes.children[0]);
              const MW = vsdxNum(mc.Width, 1), MH = vsdxNum(mc.Height, 1);
              const W = vsdxNum(cells.Width, MW), H = vsdxNum(cells.Height, MH);
              const sx = MW > 0 ? W / MW : 1, sy = MH > 0 ? H / MH : 1;
              out.push(`<g transform="${t}">`
                + `<g transform="scale(${sx.toFixed(6)} ${sy.toFixed(6)})" data-master="${escAttr(masterId)}">`);
              await emit(mshapes, layerIx);
              const txt = textOf(sh, cells);
              if (txt) { texts++; out.push(txt); }
              out.push('</g></g>');
              continue;
            }
          }
        }

        /* --- ordinary shape --- */
        out.push(`<g transform="${t}">`);
        for (const g of geoms) {
          const d = geomPath(g, vsdxNum(cells.Width, 1), vsdxNum(cells.Height, 1));
          if (!d) continue;
          const noFill = vsdxCells(g).NoFill === '1' || cells.NoFill === '1' || cells.FillPattern === '0';
          const fill = noFill ? 'none' : (vsdxHex(cells.FillForegnd) || 'none');
          const noLine = vsdxCells(g).NoLine === '1' || cells.NoLine === '1' || cells.LinePattern === '0';
          const ls = lineStyle(cells);
          const stroke = noLine ? 'none' : ls.stroke;
          out.push(`<path d="${d}" fill="${fill}" stroke="${stroke}" stroke-width="${ls.width}" stroke-linejoin="round"/>`);
        }
        const txt = textOf(sh, cells);
        if (txt) { texts++; out.push(txt); }
        const inner = vsdxKid(sh, 'Shapes');
        if (inner) await emit(inner, layerIx);
        out.push('</g>');
      }
    }

    await emit(shapeRoot, null);

    const wpx = Math.round(page.w * 96), hpx = Math.round(page.h * 96);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${wpx} ${hpx}" width="${wpx}" height="${hpx}" `
      + `class="vsdx-svg" data-page="${escAttr(page.name)}">`
      + `<rect x="0" y="0" width="${wpx}" height="${hpx}" fill="#ffffff"/>`
      + `<g transform="translate(0 ${hpx}) scale(96 -96)">${out.join('')}</g></svg>`;
    return { svg: svg, stats: { shapes: shapes, texts: texts, foreign: foreign }, foreigns: foreigns, page: page };
  }

  return {
    pages: pages,
    renderPage: renderPage,
    partCount: pkg.size,
    close: () => { /* package lives in memory */ },
  };
}

/* ---------- text ------------------------------------------ */
function textOf(sh, cells) {
  const t = vsdxKid(sh, 'Text');
  if (!t) return null;
  let s = (t.text || '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  for (const c of t.children) if (c.text) s += c.text;
  s = s.trim();
  if (!s) return null;
  let size = 0.1, color = '#000000';
  for (const sec of vsdxKids(sh, 'Section')) {
    if (sec.attrs.N !== 'Character') continue;
    const row = vsdxKids(sec, 'Row')[0];
    if (!row) continue;
    const rc = vsdxCells(row);
    if (rc.Size) size = vsdxNum(rc.Size, 0.1);
    if (vsdxHex(rc.Color)) color = vsdxHex(rc.Color);
    break;
  }
  const tf = {};
  for (const sec of vsdxKids(sh, 'Section')) {
    if (sec.attrs.N === 'TextXForm') Object.assign(tf, vsdxCells(sec));
  }
  const w = vsdxNum(cells.Width, 0), h = vsdxNum(cells.Height, 0);
  const tw = vsdxNum(tf.TxtWidth, w), th = vsdxNum(tf.TxtHeight, h);
  const x = tf.TxtPinX !== undefined ? vsdxNum(tf.TxtPinX) - vsdxNum(tf.TxtLocPinX) : w / 2;
  const bottom = tf.TxtPinY !== undefined ? vsdxNum(tf.TxtPinY) - vsdxNum(tf.TxtLocPinY) : (h - th) / 2;
  const y = bottom + th - size * 0.22;
  const ang = vsdxNum(tf.TxtAngle, 0);
  /* Visio wraps text inside the text block; a single <text> would run off
     the page (the notes block is 3 sentences long), so wrap greedily. */
  const blockW = Math.max(0.3, (tf.TxtWidth !== undefined ? vsdxNum(tf.TxtWidth) : w) || w);
  const fs = Math.max(0.04, size);
  const lines = vsdxWrap(s, blockW, fs);
  const lh = fs * 1.25;
  const tspans = lines.map((ln, i) =>
    `<tspan x="0" y="${(i * lh).toFixed(4)}">${escXml(ln)}</tspan>`).join('');
  /* The page group flips y (Visio is y-up, SVG is y-down); a <text> drawn
     in that space comes out mirror-imaged, so the glyphs are un-flipped
     locally around their anchor point. After the double reflection the
     text-local +y points down the screen, so lines stack with +lh. */
  return `<g transform="translate(${x.toFixed(4)} ${y.toFixed(4)})${ang ? ` rotate(${ang.toFixed(3)})` : ''}">`
    + `<text transform="scale(1 -1)" font-family="Arial, Helvetica, sans-serif" `
    + `font-size="${fs.toFixed(4)}" fill="${color}" text-anchor="middle">${tspans}</text></g>`;
}

function vsdxWrap(s, blockW, size) {
  const charW = size * 0.54;                       /* Arial average advance */
  const maxChars = Math.max(10, Math.floor(blockW / charW));
  const out = [];
  for (const para of String(s).split(/\n/)) {
    let line = '';
    for (const word of para.split(/\s+/)) {
      if (!word) continue;
      const cand = line ? line + ' ' + word : word;
      if (cand.length <= maxChars) { line = cand; continue; }
      if (line) out.push(line);
      if (word.length > maxChars) {                /* hard-break huge words */
        for (let i = 0; i < word.length; i += maxChars) out.push(word.slice(i, i + maxChars));
        line = '';
      } else line = word;
      if (out.length > 40) return out;             /* safety cap */
    }
    out.push(line);
  }
  return out.length ? out : [''];
}

/* LocPin defaults to half the size when the cell is absent. */
function vsdxPin(cells, key, size, half) {
  return cells[key] !== undefined ? vsdxNum(cells[key]) : (size || half);
}

/* ---------- geometry -------------------------------------- */
function geomPath(geom, W, H) {
  const d = [];
  let cx = 0, cy = 0;
  for (const row of vsdxKids(geom, 'Row')) {
    const T = row.attrs.T || '';
    const c = vsdxCells(row);
    const X = vsdxNum(c.X, cx), Y = vsdxNum(c.Y, cy);
    if (T === 'MoveTo') { d.push(`M ${X} ${Y}`); cx = X; cy = Y; continue; }
    if (T === 'RelMoveTo') { cx += X; cy += Y; d.push(`M ${cx} ${cy}`); continue; }
    if (T === 'RelLineTo') { cx += X; cy += Y; d.push(`L ${cx} ${cy}`); continue; }
    if (T === 'LineTo') { d.push(`L ${X} ${Y}`); cx = X; cy = Y; continue; }
    if (T === 'PolylineTo') {
      const poly = polyPoints(c.A || c.F || '');
      if (poly.length >= 4) {
        for (let i = 0; i < poly.length; i += 2) d.push(`L ${(poly[i] * W).toFixed(4)} ${(poly[i + 1] * H).toFixed(4)}`);
        cx = poly[poly.length - 2] * W; cy = poly[poly.length - 1] * H;
      } else { d.push(`L ${X} ${Y}`); cx = X; cy = Y; }
      continue;
    }
    if (T === 'Ellipse') {
      const A = vsdxNum(c.A, X + 1), B = vsdxNum(c.B, Y), C = vsdxNum(c.C, X), D = vsdxNum(c.D, Y + 1);
      const rx = Math.hypot(A - X, B - Y), ry = Math.hypot(C - X, D - Y);
      const deg = (Math.atan2(B - Y, A - X) * 180) / Math.PI;
      if (rx > 0 && ry > 0) {
        const x1 = X - Math.cos((deg * Math.PI) / 180) * rx, y1 = Y - Math.sin((deg * Math.PI) / 180) * rx;
        const x2 = X + Math.cos((deg * Math.PI) / 180) * rx, y2 = Y + Math.sin((deg * Math.PI) / 180) * rx;
        d.push(`M ${x1.toFixed(4)} ${y1.toFixed(4)} A ${rx.toFixed(4)} ${ry.toFixed(4)} ${deg.toFixed(2)} 0 1 ${x2.toFixed(4)} ${y2.toFixed(4)}`
          + ` A ${rx.toFixed(4)} ${ry.toFixed(4)} ${deg.toFixed(2)} 0 1 ${x1.toFixed(4)} ${y1.toFixed(4)} Z`);
      }
      continue;
    }
    if (T === 'InfiniteLine' || T === 'NURBSTo' || T === 'SplineStart' || T === 'PolylineTo') continue;
    if (T === 'ArcTo' || T === 'EllipticalArcTo' || T === 'CubicBezTo' || T === 'QuadBezTo' || T === 'RelCubBezTo') {
      d.push(`L ${X} ${Y}`); cx = X; cy = Y; continue;   /* endpoint approximation */
    }
    if (c.X !== undefined) { d.push(`L ${X} ${Y}`); cx = X; cy = Y; }
  }
  return d.length ? d.join(' ') : null;
}

function polyPoints(raw) {
  const m = String(raw).match(/POLYLINE\s*\(([^)]*)\)/i);
  if (!m) return [];
  const nums = m[1].split(/[\s,]+/).map(parseFloat).filter(Number.isFinite);
  return nums;
}

function lineStyle(cells) {
  const stroke = vsdxHex(cells.LineColor) || (String(cells.LineColor).startsWith('#') ? cells.LineColor : (cells.LineColor === '0' ? '#000000' : '#000000'));
  return { stroke: stroke, width: Math.max(0.0035, vsdxNum(cells.LineWeight, 0.01)) };
}

/* ---------- images ---------------------------------------- */
/* Turns raw media bytes into { href, blob }. The blob is kept on the record
 * so downstream consumers ("use as wiring base") never have to re-fetch the
 * href — a fetch on a data:/blob: URL is the thing that fails hardest. */
function vsdxImageBytes(bytes, path) {
  const mime = /\.png$/i.test(path) ? 'image/png' : /\.jpe?g$/i.test(path) ? 'image/jpeg'
    : /\.gif$/i.test(path) ? 'image/gif' : /\.svg$/i.test(path) ? 'image/svg+xml' : /\.bmp$/i.test(path) ? 'image/bmp'
    : /\.emf$/i.test(path) ? 'image/x-emf' : 'application/octet-stream';
  let blob = null;
  try {
    if (typeof Blob !== 'undefined' && bytes) blob = new Blob([bytes], { type: mime });
  } catch (e) { blob = null; }
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  const href = 'data:' + mime + ';base64,' + (typeof btoa === 'function' ? btoa(bin) : Buffer.from(bin, 'binary').toString('base64'));
  return { href: href, blob: blob };
}

/* Recovers a Blob from an href when the record lost its blob reference
 * (data: URL parse, never a network call). */
function vsdxHrefToBlob(href) {
  if (href && /^data:/i.test(href)) {
    const m = String(href).match(/^data:([^;,]+)?(;base64)?,(.*)$/s);
    if (!m) return null;
    try {
      const mime = m[1] || 'application/octet-stream';
      if (m[2]) {
        const bin = atob(m[3]);
        const arr = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
        return new Blob([arr], { type: mime });
      }
      return new Blob([decodeURIComponent(m[3])], { type: mime });
    } catch (e) { return null; }
  }
  return null;
}

async function emfImage(bytes, maxPx, cache, path) {
  if (cache.has(path)) return cache.get(path);
  const cv = emfToCanvas(bytes, maxPx);
  let blob = null;
  if (typeof cv.canvas.convertToBlob === 'function') {
    blob = await cv.canvas.convertToBlob({ type: 'image/png' });
  }
  let href = null;
  if (blob && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    href = URL.createObjectURL(blob);
  } else {
    href = cv.canvas.toDataURL('image/png');
    blob = blob || vsdxHrefToBlob(href);
  }
  const rec = { href: href, blob: blob, note: 'emf', stats: cv.stats, width: cv.width, height: cv.height };
  cache.set(path, rec);
  return rec;
}

function escXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function escAttr(s) { return escXml(s).replace(/'/g, '&#39;'); }

if (typeof module !== 'undefined' && module.exports) {
  try { module.exports = { vsdxOpen, vsdxZipRead, vsdxXml, vsdxCells, geomPath, vsdxNum, vsdxRels }; } catch (e) { /* browser */ }
}
