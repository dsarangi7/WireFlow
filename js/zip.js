/* ============================================================
 * WireFlow — minimal ZIP writer (store method, no compression)
 * Enough to package OPC files (.vsdx) fully client-side.
 * ============================================================ */

const ZipCRC_TABLE = (function () {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();

function zipCrc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = ZipCRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** A ZIP archive built with the STORE method (files are uncompressed). */
class ZipWriter {
  constructor() { this.entries = []; }

  /** @param {string} name entry path (use forward slashes) @param {string|Uint8Array} data */
  add(name, data) {
    const content = typeof data === 'string'
      ? new TextEncoder().encode(data)
      : (data instanceof Uint8Array ? data : new Uint8Array(data));
    this.entries.push({ name, content, crc: zipCrc32(content) });
  }

  build() {
    const enc = new TextEncoder();
    const chunks = [];
    const central = [];
    let offset = 0;

    for (const e of this.entries) {
      const nameBytes = enc.encode(e.name);
      const crc = e.crc, size = e.content.length;

      const local = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);       // local file header signature
      lv.setUint16(4, 20, true);               // version needed
      lv.setUint16(6, 0x0800, true);           // flags: UTF-8 names
      lv.setUint16(8, 0, true);                // method: store
      lv.setUint16(10, 0, true);               // mod time
      lv.setUint16(12, 0x5990, true);          // mod date (2026-01-01, fixed)
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);            // compressed
      lv.setUint32(22, size, true);            // uncompressed
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);               // extra len
      local.set(nameBytes, 30);
      chunks.push(local, e.content);

      const cd = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(cd.buffer);
      cv.setUint32(0, 0x02014b50, true);       // central directory signature
      cv.setUint16(4, 20, true);               // version made by
      cv.setUint16(6, 20, true);               // version needed
      cv.setUint16(8, 0x0800, true);           // flags UTF-8
      cv.setUint16(10, 0, true);               // method store
      cv.setUint16(12, 0, true);               // time
      cv.setUint16(14, 0x5990, true);          // date
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);               // extra
      cv.setUint16(32, 0, true);               // comment
      cv.setUint16(34, 0, true);               // disk start
      cv.setUint16(36, 0, true);               // internal attrs
      cv.setUint32(38, 0o644 << 16, true);     // external attrs
      cv.setUint32(42, offset, true);          // local header offset
      cd.set(nameBytes, 46);
      central.push(cd);

      offset += local.length + size;
    }

    const cdStart = offset;
    let cdSize = 0;
    for (const cd of central) { chunks.push(cd); cdSize += cd.length; }

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, this.entries.length, true);
    ev.setUint16(10, this.entries.length, true);
    ev.setUint32(12, cdSize, true);
    ev.setUint32(16, cdStart, true);
    chunks.push(eocd);

    return concatBytes(chunks);
  }
}

function concatBytes(chunks) {
  const total = chunks.reduce((t, c) => t + c.length, 0);
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}
