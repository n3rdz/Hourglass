// Hourglass – kleiner Server ohne externe Abhängigkeiten (Node >= 18)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');

const PORT = parseInt(process.env.PORT || '8742', 10);
const ROOT = __dirname;
const DATA_DIR = process.env.DATA_DIR || path.join(ROOT, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC = path.join(ROOT, 'public');
const BRANCH = process.env.GIT_BRANCH || ''; // leer = aktueller Branch

/* ---------- Daten ---------- */
const DEFAULT = {
  v: 1, rev: 0,
  cfg: { pinHash: '', pinSalt: '', openBooking: false, mediaRate: 1 },
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
    ['t2', 'Kompletten Tisch abräumen', 'haushalt', 10],
    ['t3', 'Zimmer aufräumen', 'haushalt', 20], ['t4', 'Müll rausbringen', 'haushalt', 5],
    ['t5', 'Wäsche zusammenlegen', 'haushalt', 10], ['t13', 'Wäsche in den Schrank räumen', 'haushalt', 10],
    ['t6', 'Hausaufgaben erledigt', 'schule', 20],
    ['t7', 'Für Test gelernt', 'schule', 30], ['t8', 'Vokabeln geübt', 'schule', 10],
    ['t9', 'Instrument 15 Min geübt', 'musik', 15], ['t10', 'Instrument 30 Min geübt', 'musik', 30],
    ['t11', '20 Min gelesen', 'sonst', 20],
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
  S.cfg = Object.assign({}, DEFAULT.cfg, S.cfg || {});
  for (const k of ['kids', 'tasks', 'rewards', 'log']) if (!Array.isArray(S[k])) S[k] = [];
  if (!Array.isArray(S.devices)) S.devices = JSON.parse(JSON.stringify(DEFAULT.devices));
}
function persist() {
  S.rev = (S.rev || 0) + 1;
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DATA_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(S, null, 1));
  fs.renameSync(tmp, DATA_FILE); // atomar
  broadcast();
}
load();

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
    cfg: { hasPin: !!cfg.pinHash, openBooking: !!cfg.openBooking, mediaRate: cfg.mediaRate || 1 },
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
const PARENT_OPS = new Set(['settings', 'setPin', 'setOpenBooking', 'setMediaRate', 'setWebhook', 'testDevice', 'undo']);
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
      const tasks = clean(b.tasks, (t) => ({ id: str(t.id, 20), name: str(t.name) || 'Aufgabe', cat: ['haushalt', 'schule', 'musik', 'sonst'].includes(t.cat) ? t.cat : 'sonst', pts: Math.max(0, Math.min(1000, int(t.pts))) }));
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
    case 'setOpenBooking': S.cfg.openBooking = !!b.value; return {};
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
  } catch (e) { throw new Error('Home Assistant nicht erreichbar'); }
  if (!r.ok) throw new Error(`Home Assistant antwortet mit ${r.status}`);
}

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
      const needsParent = PARENT_OPS.has(b.op) || !S.cfg.openBooking;
      if (needsParent && !pinOk(pin)) return send(res, 403, { error: 'Eltern-PIN nötig' });
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
