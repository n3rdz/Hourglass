// Hourglass – kleiner Server ohne externe Abhängigkeiten (Node >= 18)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const net = require('net');

const PORT = parseInt(process.env.PORT || '8742', 10);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC = path.join(ROOT, 'public');
const BRANCH = process.env.GIT_BRANCH || ''; // leer = aktueller Branch

/* ---------- Daten ---------- */
const CAT_IDS = ['haushalt', 'tiere', 'garten', 'schule', 'musik', 'bett', 'sonst'];
const CAT_RULES = [ // für die einmalige Zuordnung bestehender Aufgaben
  ['tiere', /katze|katzenklo|hund|gassi|tier|füttern|meerschwein|hase|kaninchen|aquarium|vogel/i],
  ['garten', /garten|rasen|unkraut|gießen|laub|beet|hecke/i],
  ['bett', /zähne|zahn|schlafanzug|bett|schlafen|gute nacht/i],
];
const DEFAULT = {
  v: 1, rev: 0,
  cfg: { pinHash: '', pinSalt: '', kidEarn: false, kidSpend: true, mediaRate: 1, catsV: 2,
    printer: { host: '', port: 9100, width: 48, auto: true, qr: true } },
  devices: [
    { id: 'tv', name: 'Fernsehen', emoji: '📺', webhook: '' },
    { id: 'switch', name: 'Nintendo Switch', emoji: '🎮', webhook: '' },
  ],
  kids: [
    { id: 'k1', name: 'Theo', emoji: '🦊', color: '#FF7A59', pts: 0 },
    { id: 'k2', name: 'Ava', emoji: '🐼', color: '#4C9AFF', pts: 0 },
  ],
  tasks: [
    ['t1', 'Spülmaschine ausräumen', 'haushalt', 10], ['t12', 'Spülmaschine einräumen', 'haushalt', 5],
    ['t2', 'Kompletten Tisch abräumen', 'haushalt', 10], ['t14', 'Tisch decken', 'haushalt', 5],
    ['t3', 'Kinderzimmer aufgeräumt', 'haushalt', 30], ['t15', 'Wohnzimmer aufräumen', 'haushalt', 20],
    ['t16', 'Schuhe & Jacke aufgeräumt', 'haushalt', 5],
    ['t5', 'Wäsche zusammenlegen', 'haushalt', 10], ['t13', 'Wäsche in den Schrank räumen', 'haushalt', 10],
    ['t17', '30 Min Gartenarbeit', 'garten', 15], ['t4', 'Biomüll rausbringen', 'haushalt', 5],
    ['t18', 'Restmüll rausbringen', 'haushalt', 5], ['t19', 'Katzen füttern', 'tiere', 5],
    ['t20', 'Katzenklos (beide) machen', 'tiere', 10],
    ['t6', 'Hausaufgaben erledigt', 'schule', 20], ['t7', 'Für Test gelernt', 'schule', 30], ['t8', 'Vokabeln geübt', 'schule', 10],
    ['t9', 'Instrument 15 Min geübt', 'musik', 15], ['t10', 'Instrument 30 Min geübt', 'musik', 30],
    ['t21', 'Zähne putzen', 'bett', 5], ['t22', 'Schlafanzug anziehen', 'bett', 5], ['t11', '20 Min gelesen', 'sonst', 20],
  ].map(([id, name, cat, pts]) => ({ id, name, cat, pts })),
  rewards: [
    ['r4', 'Lieblingsessen aussuchen', '🍕', 100], ['r5', 'Kino oder Ausflug', '🎬', 300],
  ].map(([id, name, emoji, cost]) => ({ id, name, emoji, cost })),
  log: [],
};

let S;
function load() {
  try { S = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch { S = JSON.parse(JSON.stringify(DEFAULT)); }
  let changed = false;
  const oldCatsV = (S.cfg && S.cfg.catsV) || 1; // vor dem Zusammenführen mit den Standardwerten merken
  S.cfg = Object.assign({}, DEFAULT.cfg, S.cfg || {});
  S.cfg.printer = Object.assign({}, DEFAULT.cfg.printer, S.cfg.printer || {});
  if (oldCatsV < 2) { // neue Kategorien Tiere, Garten, Bett: passende Aufgaben einmalig umsortieren
    for (const t of S.tasks) {
      if (t.cat !== 'haushalt' && t.cat !== 'sonst') continue;
      const hit = CAT_RULES.find(([, re]) => re.test(t.name));
      if (hit) t.cat = hit[0];
    }
    S.cfg.catsV = 2;
    changed = true;
  }
  if ('openBooking' in S.cfg) { // alte Einstellung: Kinder dürfen weiterhin einlösen, Gutschreiben bleibt Eltern-Sache
    S.cfg.kidSpend = true; S.cfg.kidEarn = false;
    delete S.cfg.openBooking;
  }
  for (const k of ['kids', 'tasks', 'rewards', 'log']) if (!Array.isArray(S[k])) S[k] = [];
  if (!Array.isArray(S.devices)) S.devices = JSON.parse(JSON.stringify(DEFAULT.devices));
  return changed;
}
function writeData() {
  S.rev = (S.rev || 0) + 1;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(S, null, 1));
  fs.renameSync(tmp, DATA_FILE); // atomar
}
function persist() { writeData(); broadcast(); }
if (load() && fs.existsSync(DATA_FILE)) writeData(); // Umstellung beim ersten Start gleich speichern

const uid = () => crypto.randomBytes(5).toString('hex');
const int = (v) => { v = parseInt(v, 10); return Number.isFinite(v) ? v : 0; };
const str = (v, max = 80) => String(v ?? '').trim().slice(0, max);
const hashPin = (pin, salt) => crypto.scryptSync(String(pin), salt, 32).toString('hex');
function pinOk(pin) {
  if (!S.cfg.pinHash) return true; // noch kein PIN gesetzt
  if (!pin) return false;
  const h = Buffer.from(hashPin(pin, S.cfg.pinSalt), 'hex');
  return crypto.timingSafeEqual(h, Buffer.from(S.cfg.pinHash, 'hex'));
}
function publicState() {
  const { cfg, devices, ...rest } = S;
  return {
    ...rest,
    devices: (devices || []).map(({ webhook, ...d }) => ({ ...d, hasWebhook: !!webhook })), // Webhook-URL bleibt geheim
    cfg: { hasPin: !!cfg.pinHash, kidEarn: !!cfg.kidEarn, kidSpend: !!cfg.kidSpend, mediaRate: cfg.mediaRate || 1, printer: { ...cfg.printer } },
  };
}

/* ---------- Live-Updates (Server-Sent Events) ---------- */
const clients = new Set();
function broadcast() { for (const res of clients) res.write(`data: ${S.rev}\n\n`); }
setInterval(() => { for (const res of clients) res.write(': ping\n\n'); }, 25000);

/* ---------- Git ---------- */
function git(args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile('git', args, { cwd: ROOT, timeout }, (err, stdout, stderr) => {
      if (err) reject(new Error((stderr || err.message).trim())); else resolve(stdout.trim());
    });
  });
}
async function branch() { return BRANCH || git(['rev-parse', '--abbrev-ref', 'HEAD']); }
async function versionInfo() {
  try {
    const [commit, date, subject] = (await git(['log', '-1', '--format=%h%x09%cI%x09%s'])).split('\t');
    return { git: true, branch: await branch(), commit, date, subject };
  } catch (e) { return { git: false, error: e.message }; }
}
let updating = false;

/* ---------- Operationen ---------- */
const PARENT_OPS = new Set(['settings', 'setPin', 'setKidPerm', 'setPrinter', 'testPrint', 'printEntry', 'setMediaRate', 'setWebhook', 'testDevice', 'undo', 'adjust']);
const KID_PERM = { earn: 'kidEarn', spend: 'kidSpend', media: 'kidSpend' };
function apply(op, b) {
  const kid = (id) => S.kids.find((k) => k.id === id);
  switch (op) {
    case 'earn': {
      const k = kid(b.kid), t = S.tasks.find((x) => x.id === b.task);
      if (!k || !t) throw new Error('Unbekanntes Kind oder Aufgabe');
      return book(k, 'earn', t.name, t.pts);
    }
    case 'spend': {
      const k = kid(b.kid), r = S.rewards.find((x) => x.id === b.reward);
      if (!k || !r) throw new Error('Unbekanntes Kind oder Belohnung');
      if (k.pts < r.cost) throw new Error('Nicht genug Punkte');
      return book(k, 'spend', `${r.emoji} ${r.name}`, -r.cost);
    }
    case 'media': {
      const k = kid(b.kid), min = int(b.minutes), cost = Math.ceil(min * S.cfg.mediaRate);
      const dev = S.devices.find((d) => d.id === b.device) || null;
      if (!k || min <= 0 || min > 600) throw new Error('Ungültige Minutenzahl');
      if (k.pts < cost) throw new Error('Nicht genug Punkte');
      const out = book(k, 'spend', dev ? `${dev.emoji} ${min} Min ${dev.name}` : `📺 ${min} Min Medienzeit`, -cost);
      if (dev) out.entry.device = dev.id;
      return { ...out, device: dev, minutes: min, kid: k };
    }
    case 'adjust': {
      const k = kid(b.kid), p = int(b.pts);
      if (!k || !p) throw new Error('Ungültige Buchung');
      return book(k, 'adj', str(b.label) || (p > 0 ? 'Bonus' : 'Abzug'), p);
    }
    case 'undo': {
      const i = S.log.findIndex((e) => e.id === b.id);
      if (i < 0) throw new Error('Eintrag nicht gefunden');
      const e = S.log[i], k = kid(e.kid);
      if (k) k.pts -= e.pts;
      S.log.splice(i, 1);
      return {};
    }
    case 'settings': {
      const ids = new Set();
      const clean = (arr, fn) => (Array.isArray(arr) ? arr : []).slice(0, 200).map(fn).filter((x) => x.id && !ids.has(x.id) && ids.add(x.id));
      const oldKids = new Map(S.kids.map((k) => [k.id, k]));
      const kids = clean(b.kids, (k) => ({ id: str(k.id, 20), name: str(k.name, 40) || 'Kind', emoji: str(k.emoji, 8) || '⭐', color: /^#[0-9a-f]{6}$/i.test(k.color) ? k.color : '#FF7A59', pts: oldKids.get(k.id)?.pts || 0 }));
      const tasks = clean(b.tasks, (t) => ({ id: str(t.id, 20), name: str(t.name) || 'Aufgabe', cat: CAT_IDS.includes(t.cat) ? t.cat : 'sonst', pts: Math.max(0, Math.min(1000, int(t.pts))) }));
      const rewards = clean(b.rewards, (r) => ({ id: str(r.id, 20), name: str(r.name) || 'Belohnung', emoji: str(r.emoji, 8) || '🎁', cost: Math.max(0, Math.min(100000, int(r.cost))) }));
      const oldDev = new Map(S.devices.map((d) => [d.id, d]));
      const devices = Array.isArray(b.devices) ? clean(b.devices, (d) => ({ id: str(d.id, 20), name: str(d.name, 40) || 'Gerät', emoji: str(d.emoji, 8) || '📺', webhook: oldDev.get(d.id)?.webhook || '' })) : S.devices;
      const keep = new Set(kids.map((k) => k.id));
      S.kids = kids; S.tasks = tasks; S.rewards = rewards; S.devices = devices;
      S.log = S.log.filter((e) => keep.has(e.kid));
      return {};
    }
    case 'setPin': {
      const pin = str(b.newPin, 12);
      if (pin && !/^\d{4,12}$/.test(pin)) throw new Error('PIN: 4–12 Ziffern');
      if (pin) { S.cfg.pinSalt = uid(); S.cfg.pinHash = hashPin(pin, S.cfg.pinSalt); }
      else { S.cfg.pinSalt = ''; S.cfg.pinHash = ''; }
      return {};
    }
    case 'setWebhook': {
      const d = S.devices.find((x) => x.id === b.id), url = str(b.url, 300);
      if (!d) throw new Error('Gerät nicht gefunden');
      if (url && !/^https?:\/\/[^\s]+$/i.test(url)) throw new Error('Bitte eine vollständige http(s)-Adresse eingeben');
      d.webhook = url; return {};
    }
    case 'setPrinter': {
      const host = str(b.host, 100);
      if (host && !/^[a-z0-9.\-:\[\]]+$/i.test(host)) throw new Error('Ungültige Drucker-Adresse');
      const port = int(b.port) || 9100;
      if (port < 1 || port > 65535) throw new Error('Ungültiger Port');
      S.cfg.printer = { host, port, width: [32, 42, 48].includes(int(b.width)) ? int(b.width) : 48, auto: !!b.auto, qr: !!b.qr };
      return {};
    }
    case 'setKidPerm': {
      if (!['kidEarn', 'kidSpend'].includes(b.key)) throw new Error('Unbekannte Einstellung');
      S.cfg[b.key] = !!b.value; return {};
    }
    case 'setMediaRate': {
      const r = Number(b.value);
      if (!(r > 0 && r <= 100)) throw new Error('Ungültiger Wert');
      S.cfg.mediaRate = Math.round(r * 100) / 100; return {};
    }
    default: throw new Error('Unbekannte Aktion');
  }
}
function book(k, kind, label, pts) {
  k.pts += pts;
  const e = { id: uid(), t: Date.now(), kid: k.id, kind, label, pts };
  S.log.unshift(e);
  if (S.log.length > 2000) S.log.length = 2000;
  return { entry: e };
}

/* ---------- Home Assistant Webhook ---------- */
async function callWebhook(dev, payload) {
  let r;
  try {
    r = await fetch(dev.webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal: AbortSignal.timeout(8000) });
  } catch (e) { throw new Error(webhookError(e, dev.webhook)); }
  if (!r.ok) throw new Error(`Home Assistant antwortet mit Status ${r.status}${r.status === 405 ? ' – Methode nicht erlaubt, in der Automation allowed_methods: [POST] setzen' : ''}`);
}

function webhookError(e, url) {
  const cause = e && e.cause;
  const inner = cause && Array.isArray(cause.errors) && cause.errors[0];
  const c = (cause && cause.code) || (inner && inner.code) || (e && e.name === 'TimeoutError' ? 'TimeoutError' : '') || (cause && cause.name !== 'Error' && cause.name) || '';
  const https = /^https:/i.test(url);
  const map = {
    ECONNREFUSED: 'Verbindung abgelehnt – stimmen IP und Port?',
    ENOTFOUND: 'Adresse nicht gefunden – Schreibweise der Adresse prüfen',
    EAI_AGAIN: 'Adresse konnte nicht aufgelöst werden (DNS)',
    EHOSTUNREACH: 'Gerät im Netzwerk nicht erreichbar',
    ENETUNREACH: 'Netzwerk nicht erreichbar',
    ECONNRESET: 'Verbindung wurde getrennt' + (https ? ' – spricht der Server vielleicht nur http?' : ''),
    TimeoutError: 'keine Antwort innerhalb von 8 Sekunden',
    ERR_SSL_WRONG_VERSION_NUMBER: 'der Server spricht kein https – bitte http:// verwenden',
    EPROTO: 'der Server spricht kein https – bitte http:// verwenden',
    ERR_TLS_CERT_ALTNAME_INVALID: 'das Zertifikat passt nicht zur Adresse – http:// mit der IP oder https:// mit dem Domainnamen verwenden',
    DEPTH_ZERO_SELF_SIGNED_CERT: 'selbst signiertes Zertifikat – http:// verwenden',
    SELF_SIGNED_CERT_IN_CHAIN: 'selbst signiertes Zertifikat – http:// verwenden',
    UNABLE_TO_VERIFY_LEAF_SIGNATURE: 'Zertifikat kann nicht geprüft werden – http:// verwenden',
    CERT_HAS_EXPIRED: 'das Zertifikat ist abgelaufen',
  };
  const msg = map[c] || [c, cause && cause.message].filter(Boolean).join(': ') || (e && e.message) || 'unbekannter Fehler';
  console.error('Webhook-Fehler:', c, e && e.cause ? e.cause.message : e && e.message);
  return `Home Assistant nicht erreichbar: ${msg}`;
}

/* ---------- Bondrucker (ESC/POS über TCP, Port 9100) ---------- */
const CP437 = { 'ä': 0x84, 'ö': 0x94, 'ü': 0x81, 'Ä': 0x8e, 'Ö': 0x99, 'Ü': 0x9a, 'ß': 0xe1, 'é': 0x82, 'è': 0x8a, 'à': 0x85, '€': 0xee, '°': 0xf8, '·': 0xfa, '–': 0x2d, '—': 0x2d, '„': 0x22, '“': 0x22, '”': 0x22, '‚': 0x27, '‘': 0x27, '’': 0x27, '…': 0x2e };
function enc(text) {
  const out = [];
  for (const ch of String(text)) {
    const c = ch.codePointAt(0);
    if (c >= 0x20 && c < 0x7f) out.push(c);
    else if (c === 0x0a) out.push(0x0a);
    else if (CP437[ch] !== undefined) { out.push(CP437[ch]); if (ch === '…') out.push(0x2e, 0x2e); }
    // Emojis und andere Zeichen kann der Drucker nicht – werden weggelassen
  }
  return Buffer.from(out);
}
const plain = (t) => String(t).replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, '').replace(/\s+/g, ' ').trim();
const TZ = process.env.TZ || 'Europe/Berlin';
const fmtTime = (t) => new Intl.DateTimeFormat('de-DE', { timeZone: TZ, day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(t)).replace(',', '');
function wrap(text, w) {
  const lines = []; let line = '';
  for (const word of String(text).split(' ')) {
    if ((line + ' ' + word).trim().length > w) { if (line) lines.push(line); line = word.slice(0, w); } else line = (line + ' ' + word).trim();
  }
  if (line) lines.push(line); return lines.join('\n');
}
const kv = (k, v, w) => k + ' '.repeat(Math.max(1, w - k.length - String(v).length)) + v;
function buildReceipt(r, pr) {
  const W = pr.width, W2 = Math.floor(W / 2);
  const ESC = 0x1b, GS = 0x1d, parts = [];
  const raw = (...b) => parts.push(Buffer.from(b));
  const txt = (t) => parts.push(enc(t));
  const center = (on) => raw(ESC, 0x61, on ? 1 : 0), bold = (on) => raw(ESC, 0x45, on ? 1 : 0), big = (on) => raw(GS, 0x21, on ? 0x11 : 0);
  raw(ESC, 0x40); raw(ESC, 0x74, 0); // Init, Zeichensatz CP437
  center(true); big(true); bold(true); txt('HOURGLASS\n'); big(false); bold(false);
  txt('-'.repeat(W) + '\n');
  if (r.test) { txt('\nTestdruck\n\n'); txt('Umlaute: ÄÖÜ äöü ß\n'); txt(`Breite: ${W} Zeichen\n`); txt(fmtTime(Date.now()) + '\n'); }
  else {
    bold(true); txt('GUTSCHEIN\n\n'); bold(false);
    big(true); bold(true); txt(wrap(plain(r.kid), W2) + '\n'); bold(false);
    txt(wrap(plain(r.what), W2) + '\n'); big(false);
    txt('\n' + '-'.repeat(W) + '\n'); center(false);
    txt(kv('Eingelöst:', fmtTime(r.t), W) + '\n');
    txt(kv('Punkte:', String(r.pts), W) + '\n');
    txt(kv('Restpunkte:', String(r.rest), W) + '\n');
    txt(kv('Nr.:', r.nr, W) + '\n');
    center(true);
    if (pr.qr) {
      const data = enc(`HOURGLASS|${r.nr}|${plain(r.kid)}|${plain(r.what)}|${fmtTime(r.t)}`);
      const len = data.length + 3;
      txt('\n');
      raw(GS, 0x28, 0x6b, 4, 0, 0x31, 0x41, 0x32, 0);          // Modell 2
      raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x43, W >= 42 ? 7 : 5);   // Modulgröße
      raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x45, 0x31);             // Fehlerkorrektur M
      raw(GS, 0x28, 0x6b, len & 0xff, len >> 8, 0x31, 0x50, 0x30); parts.push(data);
      raw(GS, 0x28, 0x6b, 3, 0, 0x31, 0x51, 0x30);             // drucken
      txt('\n');
    }
    txt('\nViel Spaß!\n');
  }
  txt('\n\n\n'); raw(GS, 0x56, 0x42, 0); // vorschieben & schneiden
  return Buffer.concat(parts);
}
function sendToPrinter(buf) {
  const pr = S.cfg.printer;
  if (!pr.host) return Promise.reject(new Error('Kein Drucker eingerichtet'));
  return new Promise((resolve, reject) => {
    const sock = net.createConnection({ host: pr.host, port: pr.port });
    const fail = (msg) => { sock.destroy(); reject(new Error(msg)); };
    sock.setTimeout(5000, () => fail('Drucker antwortet nicht (Zeitüberschreitung)'));
    sock.on('error', (e) => fail(e.code === 'ECONNREFUSED' ? 'Verbindung abgelehnt – stimmt der Port (meist 9100)?' : e.code === 'EHOSTUNREACH' || e.code === 'ENETUNREACH' ? 'Drucker im Netzwerk nicht erreichbar' : `Druckerfehler: ${e.code || e.message}`));
    sock.on('connect', () => sock.end(buf));
    sock.on('close', (hadErr) => { if (!hadErr) resolve(); });
  });
}
function receiptFor(e) {
  const k = S.kids.find((x) => x.id === e.kid);
  const id = String(e.id).toUpperCase();
  return { kid: k ? k.name : '?', what: e.label, t: e.t, pts: e.pts, rest: k ? k.pts : '?', nr: `${id.slice(0, 4)}-${id.slice(4, 8)}` };
}
const printEntry = (e) => sendToPrinter(buildReceipt(receiptFor(e), S.cfg.printer));

/* ---------- HTTP ---------- */
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json' };
function send(res, code, obj) { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); }
function body(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => { d += c; if (d.length > 1e6) { reject(new Error('zu groß')); req.destroy(); } });
    req.on('end', () => { try { resolve(d ? JSON.parse(d) : {}); } catch { reject(new Error('Ungültiges JSON')); } });
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  const pin = req.headers['x-pin'] || '';
  try {
    if (p === '/api/state' && req.method === 'GET') return send(res, 200, publicState());
    if (p === '/api/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      res.write(`data: ${S.rev}\n\n`);
      clients.add(res); req.on('close', () => clients.delete(res));
      return;
    }
    if (p === '/api/login' && req.method === 'POST') {
      const b = await body(req);
      return pinOk(b.pin) ? send(res, 200, { ok: true }) : send(res, 403, { error: 'Falscher PIN' });
    }
    if (p === '/api/op' && req.method === 'POST') {
      const b = await body(req);
      const needsParent = PARENT_OPS.has(b.op) || !S.cfg[KID_PERM[b.op]];
      if (needsParent && !pinOk(pin)) return send(res, 403, { error: 'Eltern-PIN nötig' });
      if (b.op === 'testPrint') {
        await sendToPrinter(buildReceipt({ test: true }, S.cfg.printer));
        return send(res, 200, { ok: true });
      }
      if (b.op === 'printEntry') {
        const e = S.log.find((x) => x.id === b.id);
        if (!e) throw new Error('Eintrag nicht gefunden');
        await printEntry(e);
        return send(res, 200, { ok: true });
      }
      if (b.op === 'testDevice') {
        const d = S.devices.find((x) => x.id === b.id);
        if (!d || !d.webhook) throw new Error('Kein Webhook hinterlegt');
        await callWebhook(d, { test: true, minuten: 0, kind: 'Test', kind_id: '', geraet: d.id });
        return send(res, 200, { ok: true });
      }
      const out = apply(b.op, b);
      if (out.device && out.device.webhook) {
        try {
          await callWebhook(out.device, { minuten: out.minutes, kind: out.kid.name, kind_id: out.kid.id, geraet: out.device.id });
          out.unlocked = true;
        } catch (e) {
          apply('undo', { id: out.entry.id }); // nicht freigeschaltet → Punkte zurückbuchen
          throw new Error(`${out.device.name} konnte nicht freigeschaltet werden (${e.message}). Es wurden keine Punkte abgezogen.`);
        }
      }
      persist();
      if (out.entry && out.entry.kind === 'spend' && S.cfg.printer.host && S.cfg.printer.auto) {
        try { await printEntry(out.entry); out.printed = true; }
        catch (e) { out.printError = e.message; } // Einlösung bleibt gültig, nur der Bon fehlt
      }
      const { device, kid: _k, minutes, ...rest } = out;
      return send(res, 200, { ok: true, ...rest, state: publicState() });
    }
    if (p === '/api/version') return send(res, 200, await versionInfo());
    if (p === '/api/update/check' && req.method === 'POST') {
      if (!pinOk(pin)) return send(res, 403, { error: 'Eltern-PIN nötig' });
      const br = await branch();
      await git(['fetch', '--quiet', 'origin', br], 60000);
      const log = await git(['log', '--format=%h%x09%cI%x09%s', `HEAD..origin/${br}`]);
      const commits = log ? log.split('\n').map((l) => { const [commit, date, subject] = l.split('\t'); return { commit, date, subject }; }) : [];
      return send(res, 200, { ...(await versionInfo()), commits });
    }
    if (p === '/api/update/apply' && req.method === 'POST') {
      if (!pinOk(pin)) return send(res, 403, { error: 'Eltern-PIN nötig' });
      if (updating) return send(res, 409, { error: 'Update läuft bereits' });
      updating = true;
      try {
        const br = await branch();
        await git(['fetch', '--quiet', 'origin', br], 60000);
        await git(['merge', '--ff-only', `origin/${br}`]);
      } catch (e) { updating = false; throw e; }
      send(res, 200, { ok: true, restarting: true, ...(await versionInfo()) });
      // Neustart: Docker (restart: unless-stopped) bzw. systemd startet den Prozess neu
      setTimeout(() => process.exit(0), 400);
      return;
    }
    // Statische Dateien
    let file = path.normalize(path.join(PUBLIC, p === '/' ? 'index.html' : decodeURIComponent(p)));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Verboten' });
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Nicht gefunden'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(data);
    });
  } catch (e) { send(res, 400, { error: e.message }); }
});

server.listen(PORT, () => console.log(`Hourglass läuft auf http://0.0.0.0:${PORT}`));
for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, () => process.exit(0));
