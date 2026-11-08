// Drucken auf normalen Netzwerkdruckern über IPP (AirPrint / Mopria) – ohne externe Abhängigkeiten.
// Eingabe ist ein Gutschein als 8-Bit-Graustufenbild (300 dpi), erzeugt im Browser.
// Je nach Drucker wird daraus PDF, PWG-Raster oder Apple-Raster (URF) für eine A4-Seite gebaut.
'use strict';
const http = require('http');
const zlib = require('zlib');

/* ---------- IPP-Kodierung ---------- */
const T = { opAttrs: 0x01, jobAttrs: 0x02, end: 0x03, keyword: 0x44, uri: 0x45, charset: 0x47, lang: 0x48, mime: 0x49, name: 0x42, integer: 0x21, enum: 0x23, resolution: 0x32 };
const u16 = (n) => Buffer.from([(n >> 8) & 0xff, n & 0xff]);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32BE(n >>> 0); return b; };
function attr(tag, name, value) {
  const n = Buffer.from(name, 'utf8'), v = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return Buffer.concat([Buffer.from([tag]), u16(n.length), n, u16(v.length), v]);
}
function request(op, printerUri, extraOp = [], jobAttrs = []) {
  return Buffer.concat([
    Buffer.from([2, 0]), u16(op), u32(1), Buffer.from([T.opAttrs]),
    attr(T.charset, 'attributes-charset', 'utf-8'),
    attr(T.lang, 'attributes-natural-language', 'de'),
    attr(T.uri, 'printer-uri', printerUri),
    attr(T.name, 'requesting-user-name', 'hourglass'),
    ...extraOp,
    ...(jobAttrs.length ? [Buffer.from([T.jobAttrs]), ...jobAttrs] : []),
    Buffer.from([T.end]),
  ]);
}
function parseResponse(buf) {
  if (buf.length < 8) throw new Error('Ungültige Antwort vom Drucker');
  const status = buf.readUInt16BE(2), attrs = {};
  let i = 8, last = null;
  while (i < buf.length) {
    const tag = buf[i++];
    if (tag === T.end) break;
    if (tag < 0x10) continue; // Gruppenanfang
    const nl = buf.readUInt16BE(i); i += 2;
    const name = buf.toString('utf8', i, i + nl); i += nl;
    const vl = buf.readUInt16BE(i); i += 2;
    const raw = buf.subarray(i, i + vl); i += vl;
    let val;
    if (tag === T.integer || tag === T.enum) val = raw.length === 4 ? raw.readInt32BE(0) : 0;
    else if (tag === T.resolution && raw.length === 9) val = `${raw.readInt32BE(0)}x${raw.readInt32BE(4)}${raw[8] === 3 ? 'dpi' : 'dpcm'}`;
    else val = raw.toString('utf8');
    const key = nl ? name : last;
    if (nl) last = name;
    if (!key) continue;
    (attrs[key] = attrs[key] || []).push(val);
  }
  return { status, attrs };
}
function post(pr, body) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: pr.host, port: pr.port || 631, path: pr.path || '/ipp/print', method: 'POST', headers: { 'Content-Type': 'application/ipp', 'Content-Length': body.length }, timeout: 30000 }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Drucker antwortet mit HTTP ${res.statusCode}${res.statusCode === 404 ? ' – stimmt der Pfad (meist /ipp/print)?' : res.statusCode === 426 ? ' – der Drucker verlangt eine verschlüsselte Verbindung' : ''}`));
        try { resolve(parseResponse(Buffer.concat(chunks))); } catch (e) { reject(e); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('Drucker antwortet nicht (Zeitüberschreitung)')); });
    req.on('error', (e) => reject(new Error(e.code === 'ECONNREFUSED' ? 'Verbindung abgelehnt – stimmt der Port (meist 631)?' : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? 'Drucker im Netzwerk nicht erreichbar' : `Druckerfehler: ${e.code || e.message}`)));
    req.end(body);
  });
}
const printerUri = (pr) => `ipp://${pr.host}:${pr.port || 631}${pr.path || '/ipp/print'}`;

/* ---------- Drucker abfragen ---------- */
const WANT = ['printer-make-and-model', 'printer-name', 'printer-state', 'document-format-supported', 'urf-supported', 'pwg-raster-document-type-supported', 'pwg-raster-document-resolution-supported'];
async function probe(pr) {
  const extra = WANT.map((w, i) => attr(T.keyword, i ? '' : 'requested-attributes', w));
  const r = await post(pr, request(0x000b, printerUri(pr), extra));
  if (r.status > 0xff) throw new Error(`Drucker meldet Fehler 0x${r.status.toString(16)}`);
  const a = r.attrs, formats = a['document-format-supported'] || [];
  return {
    model: (a['printer-make-and-model'] || a['printer-name'] || ['Unbekannter Drucker'])[0],
    formats,
    urf: (a['urf-supported'] || []),
    pwgTypes: (a['pwg-raster-document-type-supported'] || []),
    pwgRes: (a['pwg-raster-document-resolution-supported'] || []),
    format: chooseFormat(formats),
  };
}
function chooseFormat(formats) {
  for (const f of ['application/pdf', 'image/pwg-raster', 'image/urf']) if (formats.includes(f)) return f;
  return null;
}

/* ---------- Seite aufbauen ---------- */
const A4 = { wmm: 210, hmm: 297 };
const MARGIN_MM = 12;
// Rasterzeile im PWG/URF-Format kodieren (PackBits-ähnlich, Einheit = Pixel)
function encLine(line, bpp) {
  const n = line.length / bpp, out = [];
  const same = (a, b) => { for (let k = 0; k < bpp; k++) if (line[a * bpp + k] !== line[b * bpp + k]) return false; return true; };
  const px = (a) => { for (let k = 0; k < bpp; k++) out.push(line[a * bpp + k]); };
  let i = 0;
  while (i < n) {
    let j = i + 1;
    while (j < n && j - i < 128 && same(i, j)) j++;
    if (j - i > 1) { out.push(j - i - 1); px(i); i = j; continue; }
    let k = i + 1;
    while (k < n && k - i < 128 && !(k + 1 < n && same(k, k + 1))) k++;
    const cnt = k - i;
    if (cnt === 1) { out.push(0); px(i); } else { out.push(257 - cnt); for (let m = i; m < k; m++) px(m); }
    i = k;
  }
  return Buffer.from(out);
}
// Graustufen-Gutschein (300 dpi) auf eine A4-Seite mit gewünschter Auflösung legen; liefert Zeilen-Generator
function pageRaster(img, dpi, bpp) {
  const s = dpi / 300;
  const W = Math.round(A4.wmm / 25.4 * dpi), H = Math.round(A4.hmm / 25.4 * dpi);
  const ox = Math.round(MARGIN_MM / 25.4 * dpi), oy = ox;
  const cw = Math.round(img.w * s), ch = Math.round(img.h * s);
  const row = (y) => {
    const line = Buffer.alloc(W * bpp, 255);
    if (y < oy || y >= oy + ch) return line;
    const sy = Math.min(img.h - 1, Math.floor((y - oy) / s));
    for (let x = 0; x < cw && ox + x < W; x++) {
      const v = img.px[sy * img.w + Math.min(img.w - 1, Math.floor(x / s))];
      for (let k = 0; k < bpp; k++) line[(ox + x) * bpp + k] = v;
    }
    return line;
  };
  return { W, H, row };
}
function rasterData(pg, bpp) {
  const parts = []; let y = 0, prev = null, prevEnc = null, rep = 0;
  const flush = () => { if (prev) { parts.push(Buffer.from([rep - 1]), prevEnc); } };
  for (y = 0; y < pg.H; y++) {
    const line = pg.row(y);
    if (prev && rep < 256 && line.equals(prev)) { rep++; continue; }
    flush(); prev = line; prevEnc = encLine(line, bpp); rep = 1;
  }
  flush();
  return Buffer.concat(parts);
}
function pwgRaster(img, dpi, color) {
  const bpp = color ? 3 : 1, pg = pageRaster(img, dpi, bpp);
  const h = Buffer.alloc(1796);
  h.write('PwgRaster', 0, 'ascii');
  const put = (off, v) => h.writeUInt32BE(v >>> 0, off);
  put(276, dpi); put(280, dpi);                       // HWResolution
  put(340, 1);                                        // NumCopies
  put(352, Math.round(A4.wmm / 25.4 * 72)); put(356, Math.round(A4.hmm / 25.4 * 72)); // PageSize in Punkt
  put(372, pg.W); put(376, pg.H);                     // Breite/Höhe in Pixeln
  put(384, 8); put(388, bpp * 8); put(392, pg.W * bpp); // Bits pro Farbe/Pixel, Bytes pro Zeile
  put(400, color ? 19 : 18);                          // sRGB bzw. sGray
  put(420, bpp);                                      // Anzahl Farben
  put(452, 1); put(456, 1); put(460, 1);              // TotalPageCount, Cross/FeedTransform
  h.write('iso_a4_210x297mm', 1668, 'ascii');         // PageSizeName
  return Buffer.concat([Buffer.from('RaS2', 'ascii'), h, rasterData(pg, bpp)]);
}
function urfRaster(img, dpi, color) {
  const bpp = color ? 3 : 1, pg = pageRaster(img, dpi, bpp);
  const ph = Buffer.alloc(32);
  ph[0] = bpp * 8; ph[1] = color ? 1 : 0; ph[2] = 1; ph[3] = 4; // bpp, Farbraum (sRGB/sGray), simplex, normale Qualität
  ph.writeUInt32BE(pg.W, 12); ph.writeUInt32BE(pg.H, 16); ph.writeUInt32BE(dpi, 20);
  return Buffer.concat([Buffer.from('UNIRAST\0', 'ascii'), u32(1), ph, rasterData(pg, bpp)]);
}
function pdf(img) {
  const pt = (mm) => (mm / 25.4 * 72).toFixed(2);
  const W = pt(A4.wmm), H = pt(A4.hmm);
  const iw = (img.w / 300 * 25.4), ih = (img.h / 300 * 25.4);
  const x = pt(MARGIN_MM), y = (A4.hmm - MARGIN_MM - ih) / 25.4 * 72;
  const data = zlib.deflateSync(Buffer.from(img.px.buffer, img.px.byteOffset, img.px.length));
  const content = `q ${pt(iw)} 0 0 ${pt(ih)} ${x} ${y.toFixed(2)} cm /Im0 Do Q`;
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>`,
    Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`)]),
    Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${data.length} >>\nstream\n`), data, Buffer.from('\nendstream')]),
  ];
  const parts = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')], offs = [];
  let len = parts[0].length;
  objs.forEach((o, i) => {
    const b = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), Buffer.isBuffer(o) ? o : Buffer.from(o), Buffer.from('\nendobj\n')]);
    offs.push(len); parts.push(b); len += b.length;
  });
  const xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offs.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${len}\n%%EOF\n`;
  parts.push(Buffer.from(xref));
  return Buffer.concat(parts);
}

/* ---------- Drucken ---------- */
function pickDpi(list, def = 300) {
  const nums = list.map((r) => parseInt(String(r), 10)).filter((n) => n > 0);
  if (!nums.length || nums.includes(300)) return def;
  return nums.sort((a, b) => Math.abs(a - 300) - Math.abs(b - 300))[0];
}
async function printImage(pr, img, jobName) {
  const info = await probe(pr);
  if (!info.format) throw new Error(`Der Drucker nennt kein unterstütztes Format (${info.formats.join(', ') || 'keine Angabe'})`);
  let doc;
  if (info.format === 'application/pdf') doc = pdf(img);
  else if (info.format === 'image/pwg-raster') {
    const gray = !info.pwgTypes.length || info.pwgTypes.includes('sgray_8');
    doc = pwgRaster(img, pickDpi(info.pwgRes), !gray);
  } else {
    const rs = (info.urf.find((x) => /^RS/.test(x)) || 'RS300').slice(2).split('-');
    const gray = !info.urf.length || info.urf.includes('W8');
    doc = urfRaster(img, pickDpi(rs), !gray);
  }
  const body = Buffer.concat([request(0x0002, printerUri(pr), [attr(T.name, 'job-name', jobName || 'Hourglass-Gutschein'), attr(T.mime, 'document-format', info.format)]), doc]);
  const r = await post(pr, body);
  if (r.status > 0xff) throw new Error(`Drucker hat den Auftrag abgelehnt (0x${r.status.toString(16)})`);
  return { format: info.format, model: info.model };
}

module.exports = { probe, printImage, pdf, pwgRaster, urfRaster, encLine, parseResponse };
