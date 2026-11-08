(() => {
'use strict';
const CATS = { haushalt: { n: 'Haushalt', e: '🧹' }, tiere: { n: 'Tiere', e: '🐈' }, garten: { n: 'Garten', e: '🌱' }, schule: { n: 'Schule', e: '📚' }, musik: { n: 'Musik', e: '🎵' }, bett: { n: 'Bett', e: '🛏️' }, sonst: { n: 'Sonstiges', e: '⭐' } };
const COLORS = ['#FF7A59', '#4C9AFF', '#2FB37A', '#A97BE8', '#F2A31B', '#E8578A'];
const EMOJIS = ['🦊', '🐼', '🦁', '🐸', '🐙', '🦄', '🐯', '🐨', '🐶', '🐱', '🚀', '⚽', '🌟', '🦖'];
const catIcon = (c) => (CATS[c] && (CATS[c].svg || CATS[c].e)) || '⭐';
const PINKEY = 'hourglass-pin';

let S = null, online = false, view = 'home', tab = 'earn', pinValid = false, version = null, upd = null, mediaDev = null;
try { view = sessionStorage.getItem('pk-view') || 'home'; tab = sessionStorage.getItem('pk-tab') || 'earn'; } catch (e) {}
let pin = ''; try { pin = localStorage.getItem(PINKEY) || ''; } catch (e) {}

const root = document.getElementById('root');
/* ---------- Hell / Dunkel ---------- */
const THEMES = { auto: { i: '🌗', n: 'Automatisch' }, light: { i: '☀️', n: 'Hell' }, dark: { i: '🌙', n: 'Dunkel' } };
let theme = 'auto'; try { theme = localStorage.getItem('hourglass-theme') || 'auto'; } catch (e) {}
const darkMq = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function applyTheme() {
  if (theme === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.setAttribute('data-theme', theme);
  const dark = theme === 'dark' || (theme === 'auto' && darkMq && darkMq.matches);
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.setAttribute('content', dark ? '#17161B' : '#FF7A59');
}
function setTheme(t) { theme = THEMES[t] ? t : 'auto'; try { localStorage.setItem('hourglass-theme', theme); } catch (e) {} applyTheme(); }
if (darkMq && darkMq.addEventListener) darkMq.addEventListener('change', applyTheme);
applyTheme();
const toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl);
const syncEl = document.createElement('div'); syncEl.className = 'sync'; document.body.appendChild(syncEl);
const mEl = document.createElement('div'); document.body.appendChild(mEl);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const kidById = (id) => S.kids.find((k) => k.id === id);
const n = (v) => { v = parseInt(v, 10); return isFinite(v) ? v : 0; };
const isParent = () => !S.cfg.hasPin || pinValid;
const canEarn = () => isParent() || S.cfg.kidEarn;
const canSpend = () => isParent() || S.cfg.kidSpend;
const rate = () => S.cfg.mediaRate || 1;
const minutesFor = (pts) => Math.floor(pts / rate());
const rateText = () => rate() === 1 ? '1 Punkt = 1 Minute' : `${String(rate()).replace('.', ',')} Punkte = 1 Minute`;
function when(t) {
  const d = new Date(t), now = new Date(); const hm = d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return 'Heute ' + hm;
  const y = new Date(now); y.setDate(y.getDate() - 1); if (d.toDateString() === y.toDateString()) return 'Gestern ' + hm;
  return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) + ' ' + hm;
}

/* ---------- API ---------- */
async function api(path, data) {
  const r = await fetch(path, { method: data ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', 'X-Pin': pin }, body: data ? JSON.stringify(data) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || 'Fehler ' + r.status); e.status = r.status; throw e; }
  return j;
}
async function op(o) {
  try { const r = await api('/api/op', o); S = r.state; render(); return r; }
  catch (e) { if (e.status === 403) { pinValid = false; askPin(); } else toast(e.message); throw e; }
}
async function refresh() { S = await api('/api/state'); if (!drag && !(view === 'settings' && document.activeElement && document.activeElement.matches('input,select'))) render(); }
function connect() {
  const es = new EventSource('/api/events');
  es.onopen = () => { online = true; updSync(); };
  es.onmessage = (ev) => { if (!S || n(ev.data) !== S.rev) refresh().catch(() => {}); };
  es.onerror = () => { online = false; updSync(); };
}
function updSync() { syncEl.textContent = (online ? '🟢 verbunden' : '🔴 keine Verbindung') + (S && S.cfg.hasPin ? (pinValid ? ' · 🔓 Eltern' : ' · 🔒 Kinder') : ''); }

/* ---------- PIN ---------- */
async function checkPin() { if (!S.cfg.hasPin) { pinValid = true; return; } if (!pin) { pinValid = false; return; } try { await api('/api/login', { pin }); pinValid = true; } catch { pinValid = false; } }
function askPin(after) {
  modal(`<h4>🔒 Eltern-PIN</h4><p>Zum Buchen und für die Einstellungen.</p><input id="pinIn" type="password" inputmode="numeric" autocomplete="off" placeholder="PIN"><div id="pinErr" class="err"></div>`, 'Entsperren', async () => {
    const v = document.getElementById('pinIn').value.trim();
    try { await api('/api/login', { pin: v }); pin = v; pinValid = true; try { localStorage.setItem(PINKEY, v); } catch (e) {} closeModal(); render(); if (after) after(); }
    catch (e) { document.getElementById('pinErr').textContent = e.message; }
    return false;
  });
}
function lock() { pin = ''; pinValid = false; try { localStorage.removeItem(PINKEY); } catch (e) {} if (view === 'settings') view = 'home'; render(); toast('Gesperrt – Kinder-Ansicht'); }

/* ---------- UI-Helfer ---------- */
const printNote = (x) => x.printed ? ' 🖨️ Bon kommt' : x.printError ? ` (Bon: ${x.printError})` : '';
let tt; function toast(txt, undoId) {
  clearTimeout(tt); toastEl.innerHTML = `<span>${esc(txt)}</span>` + (undoId && isParent() ? `<button data-a="undo-now" data-id="${undoId}">Rückgängig</button>` : '');
  toastEl.classList.add('show'); tt = setTimeout(() => toastEl.classList.remove('show'), 5000);
}
let mOk = null;
function modal(html, okLabel, onOk, cls = 'pri') {
  mOk = onOk; mEl.innerHTML = `<div class="mbg" data-m="bg"><div class="modal">${html}<div class="mact"><button data-m="cancel">Abbrechen</button><button class="${cls}" data-m="ok">${esc(okLabel)}</button></div></div></div>`;
  const f = mEl.querySelector('input'); if (f) setTimeout(() => f.focus(), 50);
}
function closeModal() { mEl.innerHTML = ''; mOk = null; }
async function runOk() { const f = mOk; if (!f) return; const r = await f(); if (r !== false) closeModal(); }
function bump() { const b = root.querySelector('.bal'); if (b) { b.classList.remove('bump'); void b.offsetWidth; b.classList.add('bump'); } }

/* ---------- Views ---------- */
function nextReward(k) { return S.rewards.filter((r) => r.cost > k.pts).sort((a, b) => a.cost - b.cost)[0]; }
function logList(list, showKid) {
  if (!list.length) return '<p class="empty">Noch nichts passiert.</p>';
  const verb = (e) => e.kind === 'earn' ? 'verdient' : e.kind === 'spend' ? 'eingelöst' : e.pts > 0 ? 'Bonus' : 'Abzug';
  return '<ul class="log">' + list.map((e) => { const k = kidById(e.kid); return `<li>${k ? `<span class="who" style="--c:${k.color}">${esc(k.emoji)} ${esc(k.name)}</span>` : ''}<span class="ll">${esc(e.label)}<small>${verb(e)} · ${when(e.t)}</small></span><b class="${e.pts >= 0 ? 'plus' : 'minus'}">${e.pts > 0 ? '+' : ''}${e.pts}</b>${isParent() && e.kind === 'spend' && S.cfg.printer && S.cfg.printer.host ? `<button class="x" data-a="print" data-id="${e.id}" title="Bon drucken" aria-label="Bon drucken">🖨️</button>` : ''}${isParent() ? `<button class="x" data-a="undo" data-id="${e.id}" title="Rückgängig" aria-label="Rückgängig">↺</button>` : ''}</li>`; }).join('') + '</ul>';
}
const themeBtn = () => `<button class="icon" data-a="theme" aria-label="Darstellung: ${THEMES[theme].n}" title="Darstellung: ${THEMES[theme].n}">${THEMES[theme].i}</button>`;
function topRight() {
  const set = `<button class="icon" data-a="go" data-v="settings" aria-label="Einstellungen">⚙️</button>`;
  const btns = !S.cfg.hasPin ? set : pinValid ? `<button class="icon" data-a="lock" aria-label="Sperren">🔓</button>${set}` : `<button class="icon" data-a="unlock" aria-label="Eltern-Modus">🔒</button>`;
  return `<span style="display:flex;gap:8px">${themeBtn()}${btns}</span>`;
}
function home() {
  return `<header class="top"><div><div class="brand">⏳ Hourglass</div><div class="sub">Punkte sammeln · Belohnungen einlösen</div></div>${topRight()}</header>
  <div class="kids">${S.kids.map((k) => { const nx = nextReward(k); const pct = nx ? Math.max(0, Math.min(100, k.pts / nx.cost * 100)) : 100;
    return `<button class="kid" style="--c:${k.color}" data-a="go" data-v="kid:${k.id}"><span class="av">${esc(k.emoji)}</span><span class="kn">${esc(k.name)}</span><span class="kp">${k.pts}<small>Punkte</small></span><span class="next">📺 ${minutesFor(k.pts)} Min Medienzeit${nx ? ` · noch ${nx.cost - k.pts} bis ${esc(nx.emoji)} ${esc(nx.name)}` : ''}</span><span class="bar"><i style="width:${pct}%"></i></span></button>`; }).join('')}</div>
  ${S.kids.length ? '' : '<p class="empty">Lege in den Einstellungen ⚙️ deine Kinder an.</p>'}
  <h2>Zuletzt</h2>${logList(S.log.slice(0, 8), true)}`;
}
function kidView(k) {
  const tabs = [['earn', '➕ Verdienen'], ['spend', '🎁 Einlösen'], ['log', '📜 Verlauf']]; let body = '';
  const lockNote = (ok, txt) => ok ? '' : `<p class="hint" style="margin-top:14px">🔒 ${txt}</p>`;
  if (tab === 'earn') {
    body = lockNote(canEarn(), 'Punkte schreiben Mama oder Papa gut. Sag Bescheid, wenn du etwas erledigt hast!') + Object.entries(CATS).map(([c, m]) => { const ts = S.tasks.filter((t) => t.cat === c); if (!ts.length) return '';
      return `<h3>${catIcon(c)} ${m.n}</h3><div class="tasks">${ts.map((t) => `<button class="task" data-a="earn" data-id="${t.id}"><span>${esc(t.name)}</span><b>+${t.pts}</b></button>`).join('')}</div>`; }).join('')
      + (isParent() ? `<button class="ghost" data-a="adjust">± Eigene Punkte vergeben oder abziehen</button>` : '');
  } else if (tab === 'spend') {
    const maxMin = minutesFor(k.pts);
    const devs = S.devices || []; if (!devs.find((d) => d.id === mediaDev)) mediaDev = devs[0] ? devs[0].id : null;
    const devSel = devs.length > 1 ? `<div class="seg" style="margin-top:12px">${devs.map((d) => `<button class="${d.id === mediaDev ? 'on' : ''}" data-a="dev" data-v="${d.id}">${esc(d.emoji)} ${esc(d.name)}</button>`).join('')}</div>` : '';
    const curDev = devs.find((d) => d.id === mediaDev);
    body = lockNote(canSpend(), 'Zum Einlösen bitte Mama oder Papa fragen.') + `<div class="card" style="margin-top:16px;padding-top:14px"><div class="rn" style="font-size:18px">⏱️ Medienzeit<small>${rateText()} · möglich: ${maxMin} Min${curDev && curDev.hasWebhook ? ' · wird automatisch freigeschaltet' : ''}</small></div>${devSel}
      <div class="quick">${[15, 30, 45, 60].map((m) => `<button data-a="media" data-v="${m}" ${Math.ceil(m * rate()) > k.pts ? 'disabled style="opacity:.4"' : ''}>${m} Min</button>`).join('')}</div>
      <button class="add" style="width:100%" data-a="mediaCustom" ${maxMin < 1 ? 'disabled' : ''}>Andere Minutenzahl …</button></div>
      <h3>🎁 Belohnungen</h3>` + '<div class="rewards" style="margin-top:0">' + ([...S.rewards].sort((a, b) => a.cost - b.cost).map((r) => { const ok = k.pts >= r.cost;
      return `<div class="reward ${ok ? '' : 'off'}"><span class="re">${esc(r.emoji)}</span><span class="rn">${esc(r.name)}<small>${r.cost} Punkte${ok ? '' : ` · noch ${r.cost - k.pts}`}</small></span><button data-a="spend" data-id="${r.id}" ${ok ? '' : 'disabled'}>Einlösen</button></div>`; }).join('') || '<p class="empty">Noch keine Belohnungen angelegt.</p>') + '</div>';
  } else body = '<div style="margin-top:16px">' + logList(S.log.filter((e) => e.kid === k.id), false) + '</div>';
  return `<header class="top" style="--c:${k.color}"><button class="icon" data-a="go" data-v="home" aria-label="Zurück">←</button><div class="kidhead"><span class="av">${esc(k.emoji)}</span><span class="nm">${esc(k.name)}</span><span class="bal">${k.pts}<small>Pkt</small></span></div></header>
  <div class="seg">${tabs.map(([t, l]) => `<button class="${tab === t ? 'on' : ''}" data-a="tab" data-v="${t}">${l}</button>`).join('')}</div><div style="--c:${k.color}">${body}</div>`;
}
/* ---------- Anleitung Home Assistant ---------- */
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch (e) { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
function hookId() {
  let id = lsGet('hourglass-hookid', '');
  if (!id) { const a = new Uint8Array(12); (window.crypto || {}).getRandomValues ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.random() * 256; }); id = 'hourglass-switch-' + Array.from(a, (x) => x.toString(16).padStart(2, '0')).join(''); lsSet('hourglass-hookid', id); }
  return id;
}
function haValues() {
  return {
    base: lsGet('hourglass-ha-base', 'http://192.168.178.10:8123').replace(/\/+$/, ''),
    entity: lsGet('hourglass-ha-entity', 'number.DEINE_SWITCH_maximale_bildschirmzeit_heute'),
    id: hookId(),
  };
}
function haYaml(v) {
  return `alias: Hourglass – Switch freischalten
description: Wird von Hourglass beim Einlösen von Switch-Zeit aufgerufen
mode: queued
triggers:
  - trigger: webhook
    webhook_id: ${v.id}
    allowed_methods: [POST]
    local_only: true
conditions:
  - condition: template
    value_template: "{{ 0 < trigger.json.minuten | int(0) <= 120 }}"
actions:
  - variables:
      limit_entity: ${v.entity}
      aktuell: "{{ states(limit_entity) | int(0) }}"
      step: "{{ state_attr(limit_entity, 'step') | int(1) }}"
      maximum: "{{ state_attr(limit_entity, 'max') | int(360) }}"
      roh: "{{ aktuell + trigger.json.minuten | int(0) }}"
      neu: "{{ [((roh + step - 1) // step) * step, maximum] | min }}"
  - condition: template
    value_template: "{{ aktuell >= 0 }}"
  - action: number.set_value
    target:
      entity_id: "{{ limit_entity }}"
    data:
      value: "{{ neu }}"
  - action: logbook.log
    data:
      name: Hourglass
      message: "{{ trigger.json.kind }} hat {{ trigger.json.minuten }} Min Switch-Zeit eingelöst (Limit heute jetzt {{ neu }} Min)"
      entity_id: "{{ limit_entity }}"
`;
}
const haUrl = (v) => `${v.base}/api/webhook/${v.id}`;
let guideOpen = false;
document.addEventListener('toggle', (ev) => { if (ev.target.classList && ev.target.classList.contains('guide')) guideOpen = ev.target.open; }, true);
function haGuide() {
  const v = haValues(), devs = S.devices || [];
  const def = (devs.find((d) => /switch/i.test(d.id + d.name)) || devs[0] || {}).id;
  return `<details class="card guide" ${guideOpen ? 'open' : ''}><summary>📖 Anleitung: Nintendo Switch über Home Assistant freischalten</summary>
  <ol class="steps">
   <li><b>Nintendo-Kindersicherungs-App:</b> Tägliches Spielzeit-Limit auf <b>0 Minuten</b> und <b>„Spiel unterbrechen“</b> einschalten. So ist die Switch standardmäßig gesperrt.</li>
   <li><b>Integration in Home Assistant installieren</b> (ab Version 2025.11). Am besten am PC, auf dem die Nintendo-App <u>nicht</u> installiert ist:
    <ol type="a" class="sub">
     <li><i>Einstellungen → Geräte & Dienste</i>, unten rechts <b>+ Integration hinzufügen</b>, nach <b>Nintendo Switch Parental Controls</b> suchen.</li>
     <li>Home Assistant fragt nach einem <b>Access Token</b> und zeigt dazu einen Link an. Diesen Link öffnen, es geht ein neuer Tab auf.</li>
     <li>Im neuen Tab mit deinem <b>Nintendo-Konto</b> (Eltern-Konto) anmelden.</li>
     <li>Auf der Seite zum Verknüpfen eines externen Kontos den roten Knopf <b>„Diese Person auswählen“</b> (engl. „Select this person“) <u>nicht</u> anklicken, sondern mit der <b>rechten Maustaste</b> auf <i>Link-Adresse kopieren</i> gehen. Am Handy den Knopf gedrückt halten.</li>
     <li>Den Nintendo-Tab schließen und den kopierten Link (beginnt mit <code>npf…://auth#session_token_code=…</code>) komplett in das Feld <b>Access Token</b> einfügen, <b>Absenden</b>. Die danach angezeigten Optionen mit einem weiteren <b>Absenden</b> bestätigen.</li>
     <li>Danach gibt es ein Gerät für deine Switch. Dort unter <i>Steuerelemente</i> die Zahl <b>„Maximale Bildschirmzeit heute“</b> anklicken, über das Zahnrad ⚙️ die <b>Entitäts-ID</b> kopieren (beginnt mit <code>number.</code>).</li>
    </ol></li>
   <li><b>Deine Angaben:</b>
    <label class="gl">Adresse von Home Assistant im Heimnetz</label><input class="gi" data-g="base" value="${esc(v.base)}" placeholder="http://192.168.178.10:8123">
    <div class="hint" style="font-size:12px;margin-top:4px">Das ist die Adresse, mit der du Home Assistant zu Hause im Browser öffnest, meist <code>http://&lt;IP&gt;:8123</code>. Zu finden unter <i>Einstellungen → System → Netzwerk → Home Assistant-URL → Lokales Netzwerk</i>. Wichtig: <b>http://</b>, nicht https.</div>
    <label class="gl">Entitäts-ID „Maximale Bildschirmzeit heute“ (aus Schritt 2f)</label><input class="gi" data-g="entity" value="${esc(v.entity)}" placeholder="number.…_maximale_bildschirmzeit_heute"></li>
   <li><b>Automation anlegen:</b> <i>Einstellungen → Automationen & Szenen → Automation erstellen → Neue Automation → ⋮ → In YAML bearbeiten</i>. Den Inhalt komplett ersetzen und speichern:
    <div class="codebox"><button class="copy" data-a="copy" data-t="haYaml">Kopieren</button><pre id="haYaml">${esc(haYaml(v))}</pre></div></li>
   <li><b>Webhook beim Gerät eintragen:</b> Diese Adresse setzt sich aus deiner Home-Assistant-Adresse und der Webhook-ID aus der Automation zusammen. Sie wird oben automatisch erzeugt. Am einfachsten übernimmst du sie mit dem Knopf, sie lässt sich aber auch kopieren und oben beim Gerät unter „Webhook eintragen“ einfügen.
    <div class="codebox"><button class="copy" data-a="copy" data-t="haUrl">Kopieren</button><pre id="haUrl">${esc(haUrl(v))}</pre></div>
    <div class="btns"><select id="haDev">${devs.map((d) => `<option value="${d.id}" ${d.id === def ? 'selected' : ''}>${esc(d.emoji)} ${esc(d.name)}</option>`).join('')}</select><button class="pri" data-a="haApply">Bei diesem Gerät übernehmen</button></div></li>
   <li><b>Testen:</b> Oben beim Gerät auf <b>Testen</b> tippen. Danach ein paar Minuten Switch-Zeit einlösen: In Home Assistant steigt „Maximale Bildschirmzeit heute“, und im Logbuch steht ein Eintrag von Hourglass.</li>
  </ol>
  <p class="hint">Den Webhook auch von außen erreichbar machen: In der Automation <code>local_only: false</code> setzen und als Adresse <code>https://&lt;deine-domain&gt;/api/webhook/…</code> verwenden. Pro Einlösung werden höchstens 120 Minuten angenommen.</p></details>`;
}
async function copyText(t, btn) {
  let ok = false;
  try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); ok = true; } } catch (e) {}
  if (!ok) { const ta = document.createElement('textarea'); ta.value = t; ta.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(ta); ta.select(); try { ok = document.execCommand('copy'); } catch (e) {} ta.remove(); }
  if (btn) { const o = btn.textContent; btn.textContent = ok ? '✓ Kopiert' : 'Bitte markieren'; setTimeout(() => { btn.textContent = o; }, 1800); }
}

/* ---------- Aufgaben-Import ---------- */
function guessCat(name) {
  const t = name.toLowerCase();
  if (/katze|katzenklo|hund|gassi|tier|füttern|meerschwein|hase|kaninchen|aquarium|vogel/.test(t)) return 'tiere';
  if (/garten|rasen|unkraut|gießen|laub|beet|hecke/.test(t)) return 'garten';
  if (/zähne|zahn|schlafanzug|bett|schlafen|gute nacht/.test(t)) return 'bett';
  if (/hausaufgabe|\btest|klassenarbeit|schulaufgabe|vokabel|lern|schule|referat/.test(t)) return 'schule';
  if (/instrument|klavier|gitarre|geige|flöte|üb(en|t)|musik|trompete|schlagzeug/.test(t)) return 'musik';
  if (/duschen|baden|gelesen|lesen/.test(t)) return 'sonst';
  return 'haushalt';
}
function parseTasks(text) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim(); if (!line) continue;
    const m = line.match(/^(.*?)[\s:;,=\-–]+(\d{1,4})\s*(?:p|pkt|punkte)?\.?$/i);
    if (!m || !m[1].trim()) continue;
    out.push({ name: m[1].trim().replace(/\s+/g, ' '), pts: parseInt(m[2], 10) });
  }
  return out;
}
function importPreview(list) {
  if (!list.length) return '<p class="hint">Noch keine gültigen Zeilen erkannt. Format: <code>Aufgabe  Punkte</code></p>';
  const known = new Map(S.tasks.map((t) => [t.name.toLowerCase(), t]));
  return `<p class="hint">${list.length} Aufgabe${list.length > 1 ? 'n' : ''} erkannt:</p><ul class="imp">${list.map((x) => { const k = known.get(x.name.toLowerCase());
    return `<li><span>${catIcon(guessCat(x.name))} ${esc(x.name)}</span><b>${x.pts}</b>${k ? `<small>${k.pts === x.pts ? 'schon vorhanden' : `ändert ${k.pts} → ${x.pts}`}</small>` : '<small>neu</small>'}</li>`; }).join('')}</ul>`;
}

function printerCard() {
  const pr = S.cfg.printer || {}, ipp = pr.type === 'ipp';
  return `<section class="card"><h2>🖨️ Drucker</h2>
   <p class="hint">Bei jeder Einlösung kann ein Gutschein gedruckt werden.</p>
   <div class="seg" style="margin:6px 0 10px"><button class="${!ipp ? 'on' : ''}" data-a="prType" data-v="escpos">🧾 Bondrucker</button><button class="${ipp ? 'on' : ''}" data-a="prType" data-v="ipp">🖨️ Normaler Drucker</button></div>
   <p class="hint" style="font-size:12px">${ipp ? 'Für fast alle Netzwerkdrucker, die auch vom Handy aus drucken können (AirPrint/Mopria). Der Gutschein (10,5 × 7,4 cm) kommt oben auf eine A4-Seite, zum Ausschneiden.' : 'Für Bondrucker mit Netzwerkanschluss und ESC/POS (z. B. Epson TM-Serie oder viele 58/80-mm-Drucker mit LAN).'}</p>
   <div class="row"><input class="grow" data-p="host" value="${esc(pr.host || '')}" placeholder="IP-Adresse, z. B. 192.168.10.50" aria-label="Drucker-IP"><input class="num" style="width:86px" data-p="port" type="number" inputmode="numeric" value="${pr.port || (ipp ? 631 : 9100)}" aria-label="Port"></div>
   ${ipp ? `<div class="row"><span class="grow" style="font-weight:700">Pfad</span><input data-p="path" style="width:140px" value="${esc(pr.path || '/ipp/print')}" aria-label="IPP-Pfad"></div>`
     : `<div class="row"><span class="grow" style="font-weight:700">Papierbreite</span><select data-p="width">${[[48, '80 mm (48 Zeichen)'], [42, '80 mm (42 Zeichen)'], [32, '58 mm (32 Zeichen)']].map(([v, l]) => `<option value="${v}" ${pr.width === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div>`}
   <label class="toggle">Bei jeder Einlösung automatisch drucken<input type="checkbox" data-p="auto" ${pr.auto ? 'checked' : ''}></label>
   ${ipp ? '' : `<label class="toggle">QR-Code auf den Bon drucken<input type="checkbox" data-p="qr" ${pr.qr ? 'checked' : ''}></label>`}
   <div class="btns"><button data-a="probePrinter" ${pr.host ? '' : 'disabled'}>Drucker prüfen</button><button data-a="testPrint" ${pr.host ? '' : 'disabled'}>Testdruck</button></div>
   <div id="prInfo" class="hint" style="font-size:13px"></div>
   <p class="hint" style="font-size:12px">${ipp ? 'Port ist fast immer <b>631</b>, der Pfad meist <b>/ipp/print</b>.' : 'Port ist fast immer <b>9100</b>.'} Einzelne Einlösungen lassen sich im Verlauf mit 🖨️ nachdrucken.</p></section>`;
}
function savePrinter(type) {
  const g = (k) => root.querySelector(`[data-p="${k}"]`), pr = S.cfg.printer || {};
  const t = type || pr.type || 'escpos', switched = type && type !== pr.type;
  return op({ op: 'setPrinter', type: t, host: g('host').value.trim(), port: switched ? (t === 'ipp' ? 631 : 9100) : n(g('port').value),
    path: g('path') ? g('path').value.trim() : (pr.path || '/ipp/print'), width: g('width') ? n(g('width').value) : (pr.width || 48), auto: g('auto').checked, qr: g('qr') ? g('qr').checked : pr.qr !== false });
}

/* ---------- Gutschein als Grafik (für normale Drucker) ---------- */
const noEmoji = (t) => String(t).replace(/\p{Extended_Pictographic}|️|‍/gu, '').replace(/\s+/g, ' ').trim();
function voucherPixels(v) {
  const W = 1240, H = 874, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'), F = 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H); g.fillStyle = '#000'; g.strokeStyle = '#000';
  g.setLineDash([18, 12]); g.lineWidth = 4; g.strokeRect(6, 6, W - 12, H - 12); g.setLineDash([]);
  const text = (t, y, size, weight = 700, max = W - 140) => { let s = size; do { g.font = `${weight} ${s}px ${F}`; s -= 4; } while (g.measureText(t).width > max && s > 20); g.textAlign = 'center'; g.fillText(t, W / 2, y); };
  text('HOURGLASS', 105, 58, 900);
  g.fillRect(70, 135, W - 140, 4);
  if (v.test) {
    text('Testdruck', 330, 120, 900); text('Umlaute: ÄÖÜ äöü ß', 450, 50, 600);
    text(new Date().toLocaleString('de-DE'), 540, 40, 500);
  } else {
    text('GUTSCHEIN', 205, 44, 800);
    text(noEmoji(v.kid), 345, 120, 900);
    text(noEmoji(v.what), 455, 78, 800);
    g.fillRect(70, 510, W - 140, 3);
    g.font = `500 40px ${F}`;
    const row = (k, val, y) => { g.textAlign = 'left'; g.fillText(k, 90, y); g.textAlign = 'right'; g.fillText(val, W - 90, y); };
    row('Eingelöst', v.when, 580); row('Punkte', String(v.pts), 640); row('Restpunkte', String(v.rest), 700); row('Nr.', v.nr, 760);
    text('Viel Spaß!', 838, 44, 800);
  }
  const d = g.getImageData(0, 0, W, H).data, px = new Uint8Array(W * H);
  for (let i = 0; i < px.length; i++) px[i] = Math.round(d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114);
  let bin = ''; for (let i = 0; i < px.length; i += 0x8000) bin += String.fromCharCode.apply(null, px.subarray(i, i + 0x8000));
  return { w: W, h: H, data: btoa(bin) };
}
function voucherFor(e) {
  const k = kidById(e.kid), id = String(e.id).toUpperCase();
  return { kid: k ? k.name : '?', what: e.label, pts: e.pts, rest: k ? k.pts : '?', nr: `${id.slice(0, 4)}-${id.slice(4, 8)}`,
    when: new Date(e.t).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) };
}
async function printVoucher(entryId) { // druckt je nach Druckerart über den Server
  const pr = S.cfg.printer || {};
  if (pr.type !== 'ipp') return api('/api/op', { op: 'printEntry', id: entryId });
  const e = S.log.find((x) => x.id === entryId); if (!e) throw new Error('Eintrag nicht gefunden');
  return api('/api/op', { op: 'printImage', id: entryId, ...voucherPixels(voucherFor(e)) });
}
function autoPrint(x) { // nach einer Einlösung: normale Drucker werden vom Browser aus angestoßen
  const pr = S.cfg.printer || {};
  if (pr.type !== 'ipp' || !pr.host || !pr.auto || !x || !x.entry) return;
  printVoucher(x.entry.id).then(() => toast('🖨️ Gutschein wird gedruckt')).catch((e) => toast('Gutschein konnte nicht gedruckt werden: ' + e.message));
}

function updateCard() {
  const v = version;
  let html = '<section class="card"><h2>App-Version & Updates</h2>';
  if (!v) html += '<p class="hint">Lade …</p>';
  else if (!v.git) html += `<p class="hint">Diese Installation ist kein Git-Checkout – Updates per Knopfdruck gehen hier nicht.</p>`;
  else {
    html += `<div class="ver">Installiert: <code>${esc(v.commit)}</code> auf <code>${esc(v.branch)}</code><br>${esc(v.subject)} · ${new Date(v.date).toLocaleDateString('de-DE')}</div>`;
    if (upd && upd.error) html += `<div class="err">${esc(upd.error)}</div>`;
    if (upd && upd.commits) html += upd.commits.length
      ? `<div class="ver" style="margin-top:10px"><b>${upd.commits.length} neue Änderung${upd.commits.length > 1 ? 'en' : ''}:</b></div><ul class="commits">${upd.commits.slice(0, 15).map((c) => `<li>${esc(c.subject)} <code>${esc(c.commit)}</code></li>`).join('')}</ul>`
      : '<div class="ver" style="margin-top:10px">✅ Du bist auf dem neuesten Stand.</div>';
    html += `<div class="btns"><button data-a="checkUpd">${upd && upd.loading ? '⏳ Suche …' : '🔄 Nach Updates suchen'}</button>${upd && upd.commits && upd.commits.length ? '<button class="pri" data-a="applyUpd">⬇️ Jetzt aktualisieren</button>' : ''}</div>`;
  }
  return html + '</section>';
}
function settings() {
  const catOpts = (c) => Object.entries(CATS).map(([k, m]) => `<option value="${k}" ${k === c ? 'selected' : ''}>${m.e} ${m.n}</option>`).join('');
  return `<header class="top"><button class="icon" data-a="go" data-v="home" aria-label="Zurück">←</button><div class="brand" style="flex:1;font-size:22px">Einstellungen</div></header>
  <section class="card"><h2>Kinder</h2>${S.kids.map((k) => `<div class="row"><button class="eb" data-a="emoji" data-id="${k.id}" title="Symbol wechseln">${esc(k.emoji)}</button><input class="grow" value="${esc(k.name)}" data-c="kids" data-id="${k.id}" data-f="name" aria-label="Name"><button class="sw" style="background:${k.color}" data-a="color" data-id="${k.id}" title="Farbe wechseln"></button><button class="del" data-a="del" data-c="kids" data-id="${k.id}" aria-label="Löschen">✕</button></div>`).join('')}<button class="add" data-a="addKid">+ Kind</button></section>
  <section class="card"><h2>Aufgaben</h2><p class="hint" style="margin-top:-4px">Mit ⠿ nach oben oder unten ziehen, um die Reihenfolge zu ändern.</p><div class="sortlist">${S.tasks.map((t) => `<div class="row wrap" data-row="tasks" data-id="${t.id}"><span class="handle" data-drag="tasks" title="Ziehen zum Sortieren" aria-label="Verschieben">⠿</span><input class="grow" value="${esc(t.name)}" data-c="tasks" data-id="${t.id}" data-f="name" aria-label="Aufgabe"><select data-c="tasks" data-id="${t.id}" data-f="cat">${catOpts(t.cat)}</select><input class="num" type="number" min="0" inputmode="numeric" value="${t.pts}" data-c="tasks" data-id="${t.id}" data-f="pts" aria-label="Punkte"><button class="del" data-a="del" data-c="tasks" data-id="${t.id}" aria-label="Löschen">✕</button></div>`).join('')}</div><button class="add" data-a="addTask">+ Aufgabe</button> <button class="add" data-a="importTasks">📋 Liste einfügen</button></section>
  <section class="card"><h2>Belohnungen</h2>${S.rewards.map((r) => `<div class="row"><input class="emo" value="${esc(r.emoji)}" data-c="rewards" data-id="${r.id}" data-f="emoji" aria-label="Symbol"><input class="grow" value="${esc(r.name)}" data-c="rewards" data-id="${r.id}" data-f="name" aria-label="Belohnung"><input class="num" type="number" min="0" inputmode="numeric" value="${r.cost}" data-c="rewards" data-id="${r.id}" data-f="cost" aria-label="Kosten"><button class="del" data-a="del" data-c="rewards" data-id="${r.id}" aria-label="Löschen">✕</button></div>`).join('')}<button class="add" data-a="addReward">+ Belohnung</button></section>
  <section class="card"><h2>Medienzeit</h2><div class="row"><span class="grow" style="font-weight:700">Punkte pro Minute Medienzeit</span><input class="num" type="number" min="0.1" step="0.1" inputmode="decimal" value="${rate()}" data-a="mediaRate" aria-label="Punkte pro Minute"></div>
   <h3>Geräte</h3>${(S.devices || []).map((d) => `<div class="row wrap"><input class="emo" value="${esc(d.emoji)}" data-c="devices" data-id="${d.id}" data-f="emoji" aria-label="Symbol"><input style="flex:1" value="${esc(d.name)}" data-c="devices" data-id="${d.id}" data-f="name" aria-label="Gerät"><button class="del" data-a="del" data-c="devices" data-id="${d.id}" aria-label="Löschen">✕</button>
     <div class="btns" style="margin-top:0;flex:1 1 100%;align-items:center"><span class="hint" style="flex:1">${d.hasWebhook ? '🔗 Home Assistant verbunden' : 'Ohne Freischaltung'}</span><button data-a="webhook" data-id="${d.id}">${d.hasWebhook ? 'Webhook ändern' : 'Webhook eintragen'}</button>${d.hasWebhook ? `<button data-a="testDev" data-id="${d.id}">Testen</button>` : ''}</div></div>`).join('')}<button class="add" data-a="addDevice">+ Gerät</button></section>
  ${haGuide()}
  ${printerCard()}
  <section class="card"><h2>Eltern-PIN</h2><p class="hint">${S.cfg.hasPin ? 'Ein PIN ist gesetzt. Was die Kinder ohne PIN dürfen, stellst du hier ein:' : 'Noch kein PIN – jeder kann buchen und Einstellungen ändern.'}</p>
   <div class="btns"><button class="pri" data-a="setPin">${S.cfg.hasPin ? 'PIN ändern' : 'PIN festlegen'}</button>${S.cfg.hasPin ? '<button data-a="removePin">PIN entfernen</button>' : ''}</div>
   ${S.cfg.hasPin ? `<label class="toggle">Kinder dürfen selbst einlösen (Medienzeit & Belohnungen)<input type="checkbox" data-a="kidPerm" data-k="kidSpend" ${S.cfg.kidSpend ? 'checked' : ''}></label>
   <label class="toggle">Kinder dürfen sich selbst Punkte gutschreiben<input type="checkbox" data-a="kidPerm" data-k="kidEarn" ${S.cfg.kidEarn ? 'checked' : ''}></label>` : ''}</section>
  ${updateCard()}`;
}
function render() {
  if (!S) { root.innerHTML = '<p class="empty" style="margin-top:40px">Lade …</p>'; return; }
  let k; if (view.startsWith('kid:')) { k = kidById(view.slice(4)); if (!k) view = 'home'; }
  if (view === 'settings' && !isParent()) view = 'home';
  root.innerHTML = view === 'settings' ? settings() : k ? kidView(k) : home(); updSync();
  try { sessionStorage.setItem('pk-view', view); sessionStorage.setItem('pk-tab', tab); } catch (e) {}
}

/* ---------- Einstellungen speichern ---------- */
let setTimer = null;
function saveSettings(now) {
  clearTimeout(setTimer);
  const go = () => op({ op: 'settings', kids: S.kids, tasks: S.tasks, rewards: S.rewards, devices: S.devices }).catch(() => {});
  if (now) return go(); setTimer = setTimeout(go, 600);
}
async function loadVersion() { try { version = await api('/api/version'); } catch (e) { version = { git: false }; } if (view === 'settings') render(); }
async function checkUpd() {
  upd = { loading: true }; render();
  try { const r = await api('/api/update/check', {}); version = r; upd = { commits: r.commits }; }
  catch (e) { upd = { error: e.message }; }
  render();
}
function applyUpd() {
  modal('<h4>Jetzt aktualisieren?</h4><p>Die App lädt die neue Version und startet kurz neu. Punkte und Einstellungen bleiben erhalten.</p>', 'Aktualisieren', async () => {
    const before = version && version.commit;
    try { await api('/api/update/apply', {}); } catch (e) { upd = { error: e.message }; render(); return; }
    const ov = document.createElement('div'); ov.className = 'overlay'; ov.innerHTML = '<div>⏳ App wird neu gestartet …<small>Das dauert nur ein paar Sekunden.</small></div>'; document.body.appendChild(ov);
    const t0 = Date.now();
    const poll = async () => {
      try { const v = await api('/api/version'); if (v.commit && v.commit !== before) { location.reload(); return; } } catch (e) {}
      if (Date.now() - t0 > 90000) { ov.innerHTML = '<div>⚠️ Die App ist nicht wieder hochgekommen.<small>Bitte den Container prüfen (docker compose logs).</small></div>'; return; }
      setTimeout(poll, 1500);
    };
    setTimeout(poll, 2000);
  });
}

/* ---------- Events ---------- */
document.addEventListener('click', async (ev) => {
  const m = ev.target.closest('[data-m]');
  if (m) { if (m.dataset.m === 'ok') runOk(); else if (m.dataset.m === 'cancel' || ev.target === m) closeModal(); return; }
  const b = ev.target.closest('[data-a]'); if (!b || !S) return; const a = b.dataset.a, id = b.dataset.id;
  const cur = view.startsWith('kid:') ? kidById(view.slice(4)) : null;
  const need = (ok, fn) => (ok ? fn() : askPin(fn));
  switch (a) {
    case 'go': view = b.dataset.v; if (view.startsWith('kid:')) tab = 'earn'; if (view === 'settings') { upd = null; loadVersion(); } render(); scrollTo(0, 0); break;
    case 'tab': tab = b.dataset.v; render(); break;
    case 'unlock': askPin(); break;
    case 'lock': lock(); break;
    case 'earn': need(canEarn(), async () => { const t = S.tasks.find((x) => x.id === id); if (!t || !cur) return; const r = await op({ op: 'earn', kid: cur.id, task: t.id }); bump(); toast(`+${t.pts} für „${t.name}“`, r.entry.id); }); break;
    case 'spend': need(canSpend(), () => { const r = S.rewards.find((x) => x.id === id); if (!r || !cur) return;
      modal(`<h4>${esc(r.emoji)} ${esc(r.name)} einlösen?</h4><p>${esc(cur.name)} hat ${cur.pts} Punkte. Danach bleiben ${cur.pts - r.cost}.</p>`, `${r.cost} Punkte einlösen`, async () => { const x = await op({ op: 'spend', kid: cur.id, reward: r.id }).catch(() => null); if (x) { bump(); toast(`${r.name} eingelöst – viel Spaß!` + printNote(x), x.entry.id); autoPrint(x); } }); }); break;
    case 'adjust': need(isParent(), () => { if (!cur) return;
      modal(`<h4>Punkte für ${esc(cur.name)}</h4><label>Punkte (minus = abziehen)</label><input id="adjP" type="number" inputmode="numeric" value="5"><div class="quick">${[-10, -5, 5, 10, 20].map((v) => `<button data-a="q" data-v="${v}">${v > 0 ? '+' : ''}${v}</button>`).join('')}</div><label>Grund</label><input id="adjR" placeholder="z. B. Oma beim Einkaufen geholfen">`, 'Buchen', async () => {
        const p = n(document.getElementById('adjP').value); if (!p) return false; const label = document.getElementById('adjR').value.trim();
        const x = await op({ op: 'adjust', kid: cur.id, pts: p, label }).catch(() => null); if (x) { bump(); toast(`${p > 0 ? '+' : ''}${p} · ${x.entry.label}`, x.entry.id); } }); }); break;
    case 'media': case 'mediaCustom': need(canSpend(), () => { if (!cur) return;
      const dev = (S.devices || []).find((d) => d.id === mediaDev);
      const doMedia = async (min) => { const x = await op({ op: 'media', kid: cur.id, minutes: min, device: dev ? dev.id : '' }).catch(() => null);
        if (x) { bump(); toast((x.unlocked ? `${dev.name}: ${min} Min freigeschaltet – viel Spaß!` : `${min} Min ${dev ? dev.name : 'Medienzeit'} – viel Spaß!`) + printNote(x), x.entry.id); autoPrint(x); } };
      if (a === 'media') { const min = n(b.dataset.v), cost = Math.ceil(min * rate());
        modal(`<h4>${dev ? esc(dev.emoji) + ' ' + min + ' Min ' + esc(dev.name) : '📺 ' + min + ' Min Medienzeit'} einlösen?</h4>${dev && dev.hasWebhook ? '<p>Wird danach automatisch freigeschaltet.</p>' : ''}<p>${esc(cur.name)} hat ${cur.pts} Punkte. Danach bleiben ${cur.pts - cost}.</p>`, `${cost} Punkte einlösen`, () => doMedia(min)); }
      else modal(`<h4>${dev ? esc(dev.emoji) + ' ' + esc(dev.name) : '📺 Medienzeit'} für ${esc(cur.name)}</h4><p>Möglich: bis zu ${minutesFor(cur.pts)} Min (${rateText()}).</p><label>Minuten</label><input id="medMin" type="number" min="1" inputmode="numeric" value="${Math.min(20, minutesFor(cur.pts))}"><div id="medErr" class="err"></div>`, 'Einlösen', async () => {
        const min = n(document.getElementById('medMin').value); if (min < 1 || Math.ceil(min * rate()) > cur.pts) { document.getElementById('medErr').textContent = 'So viele Punkte sind nicht da.'; return false; } await doMedia(min); });
    }); break;
    case 'q': document.getElementById('adjP').value = b.dataset.v; break;
    case 'undo-now': toastEl.classList.remove('show'); await op({ op: 'undo', id }).catch(() => {}); bump(); break;
    case 'undo': { const e = S.log.find((x) => x.id === id); if (!e) return; const k = kidById(e.kid);
      const dv = e.device && (S.devices || []).find((d) => d.id === e.device && d.hasWebhook);
      modal(`<h4>Eintrag rückgängig machen?</h4><p>${k ? esc(k.emoji + ' ' + k.name) + ': ' : ''}${esc(e.label)} (${e.pts > 0 ? '+' : ''}${e.pts})</p>${dv ? `<p>Die Punkte werden zurückgebucht. Die Freischaltung auf ${esc(dv.name)} bleibt aber bestehen.</p>` : ''}`, 'Rückgängig', () => op({ op: 'undo', id }).catch(() => {}), 'danger'); break; }
    case 'emoji': { const k = kidById(id); k.emoji = EMOJIS[(EMOJIS.indexOf(k.emoji) + 1) % EMOJIS.length]; render(); saveSettings(); break; }
    case 'color': { const k = kidById(id); k.color = COLORS[(COLORS.indexOf(k.color) + 1) % COLORS.length]; render(); saveSettings(); break; }
    case 'addKid': S.kids.push({ id: uid(), name: 'Neues Kind', emoji: EMOJIS[S.kids.length % EMOJIS.length], color: COLORS[S.kids.length % COLORS.length], pts: 0 }); saveSettings(true); break;
    case 'addTask': S.tasks.push({ id: uid(), name: 'Neue Aufgabe', cat: 'haushalt', pts: 5 }); saveSettings(true); break;
    case 'addReward': S.rewards.push({ id: uid(), name: 'Neue Belohnung', emoji: '🎁', cost: 20 }); saveSettings(true); break;
    case 'del': { const c = b.dataset.c, it = S[c].find((x) => x.id === id); if (!it) return;
      modal(`<h4>„${esc(it.name)}“ löschen?</h4>${c === 'kids' ? '<p>Punktestand und Verlauf dieses Kindes gehen verloren.</p>' : ''}`, 'Löschen', () => { S[c] = S[c].filter((x) => x.id !== id); return saveSettings(true); }, 'danger'); break; }
    case 'setPin':
      modal(`<h4>${S.cfg.hasPin ? 'PIN ändern' : 'PIN festlegen'}</h4><p>4–12 Ziffern.</p><input id="np" type="password" inputmode="numeric" autocomplete="new-password" placeholder="Neuer PIN"><div id="npErr" class="err"></div>`, 'Speichern', async () => {
        const v = document.getElementById('np').value.trim(); if (!/^\d{4,12}$/.test(v)) { document.getElementById('npErr').textContent = 'Bitte 4–12 Ziffern.'; return false; }
        await op({ op: 'setPin', newPin: v }).catch(() => null); pin = v; pinValid = true; try { localStorage.setItem(PINKEY, v); } catch (e) {} render(); toast('PIN gespeichert'); }); break;
    case 'removePin': modal('<h4>PIN entfernen?</h4><p>Danach kann jeder buchen und Einstellungen ändern.</p>', 'Entfernen', () => op({ op: 'setPin', newPin: '' }).catch(() => {}), 'danger'); break;
    case 'dev': mediaDev = b.dataset.v; render(); break;
    case 'addDevice': S.devices.push({ id: uid(), name: 'Neues Gerät', emoji: '📺' }); saveSettings(true); break;
    case 'webhook': { const d = S.devices.find((x) => x.id === id); if (!d) return;
      modal(`<h4>${esc(d.emoji)} ${esc(d.name)}: Webhook</h4><p>Adresse des Home-Assistant-Webhooks, z. B. <code>http://192.168.178.20:8123/api/webhook/…</code>. Leer lassen, um die Verbindung zu entfernen.</p><input id="whUrl" type="url" placeholder="http://…/api/webhook/…" autocomplete="off"><div id="whErr" class="err"></div>`, 'Speichern', async () => {
        try { const r = await api('/api/op', { op: 'setWebhook', id: d.id, url: document.getElementById('whUrl').value.trim() }); S = r.state; render(); toast('Gespeichert'); }
        catch (e) { document.getElementById('whErr').textContent = e.message; return false; } }); break; }
    case 'testDev': { b.disabled = true; try { await api('/api/op', { op: 'testDevice', id }); toast('✅ Home Assistant hat geantwortet'); } catch (e) { toast('❌ ' + e.message); } b.disabled = false; break; }
    case 'copy': { const el = document.getElementById(b.dataset.t); if (el) copyText(el.textContent, b); break; }
    case 'haApply': { const devId = document.getElementById('haDev').value;
      try { const r = await api('/api/op', { op: 'setWebhook', id: devId, url: haUrl(haValues()) }); S = r.state; render(); toast('Webhook übernommen – jetzt „Testen“ antippen'); }
      catch (e) { toast(e.message); } break; }
    case 'theme': { const order = ['auto', 'light', 'dark']; setTheme(order[(order.indexOf(theme) + 1) % 3]); render(); toast(`${THEMES[theme].i} Darstellung: ${THEMES[theme].n}`); break; }
    case 'testPrint': { b.disabled = true; try { const pr = S.cfg.printer || {};
        if (pr.type === 'ipp') { const r = await api('/api/op', { op: 'printImage', test: true, ...voucherPixels({ test: true }) }); toast(`🖨️ Testdruck gesendet (${r.format})`); }
        else { await api('/api/op', { op: 'testPrint' }); toast('🖨️ Testdruck gesendet'); } } catch (e) { toast('❌ ' + e.message); } b.disabled = false; break; }
    case 'print': { try { await printVoucher(id); toast('🖨️ Gutschein wird gedruckt'); } catch (e) { toast('❌ ' + e.message); } break; }
    case 'prType': savePrinter(b.dataset.v).catch(() => {}); break;
    case 'probePrinter': { b.disabled = true; const info = document.getElementById('prInfo'); if (info) info.textContent = '⏳ Frage den Drucker …';
      try { const r = await api('/api/op', { op: 'probePrinter' });
        if (info) info.innerHTML = r.formats ? `✅ <b>${esc(r.model)}</b><br>${r.format ? `Druckt als <code>${esc(r.format)}</code>` : `⚠️ Kein passendes Format gefunden. Der Drucker kann: ${esc(r.formats.join(', '))}`}` : `✅ ${esc(r.model)}`;
      } catch (e) { if (info) info.textContent = '❌ ' + e.message; } b.disabled = false; break; }
    case 'importTasks':
      modal(`<h4>📋 Aufgaben aus Liste einfügen</h4><p>Eine Aufgabe pro Zeile, die Punkte am Ende, z. B. <code>Katzen füttern 5</code>. Vorhandene Aufgaben mit gleichem Namen bekommen die neuen Punkte. Die Kategorie wird geraten und lässt sich danach ändern.</p>
        <textarea id="impText" rows="8" placeholder="Kinderzimmer aufgeräumt 30
Tisch decken 5
Katzen füttern 5"></textarea><div id="impPrev"></div>`, 'Übernehmen', () => {
        const list = parseTasks(document.getElementById('impText').value); if (!list.length) return false;
        const known = new Map(S.tasks.map((t) => [t.name.toLowerCase(), t])); let added = 0, changed = 0;
        for (const x of list) { const k = known.get(x.name.toLowerCase());
          if (k) { if (k.pts !== x.pts) { k.pts = x.pts; changed++; } } else { const t = { id: uid(), name: x.name.slice(0, 80), cat: guessCat(x.name), pts: Math.min(1000, x.pts) }; S.tasks.push(t); known.set(t.name.toLowerCase(), t); added++; } }
        saveSettings(true); toast(`${added} neu, ${changed} geändert`); });
      break;
    case 'checkUpd': checkUpd(); break;
    case 'applyUpd': applyUpd(); break;
  }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'impText') { const pv = document.getElementById('impPrev'); if (pv) pv.innerHTML = importPreview(parseTasks(ev.target.value)); return; }
  const el = ev.target; if (!el.dataset || !el.dataset.g) return;
  lsSet(el.dataset.g === 'base' ? 'hourglass-ha-base' : 'hourglass-ha-entity', el.value.trim());
  const v = haValues(); const y = document.getElementById('haYaml'), u = document.getElementById('haUrl');
  if (y) y.textContent = haYaml(v); if (u) u.textContent = haUrl(v);
});
document.addEventListener('change', (ev) => {
  const el = ev.target; if (!S) return;
  if (el.dataset.a === 'mediaRate') { const r = Number(String(el.value).replace(',', '.')); if (r > 0) op({ op: 'setMediaRate', value: r }).catch(() => {}); return; }
  if (el.dataset.p) { savePrinter().then(() => {}).catch(() => {}); return; }
  if (el.dataset.a === 'kidPerm') { op({ op: 'setKidPerm', key: el.dataset.k, value: el.checked }).catch(() => {}); return; }
  if (!el.dataset.c) return; const it = S[el.dataset.c].find((x) => x.id === el.dataset.id); if (!it) return;
  const f = el.dataset.f; it[f] = (f === 'pts' || f === 'cost') ? Math.max(0, n(el.value)) : (el.value.trim() || it[f]); saveSettings();
});
document.addEventListener('keydown', (ev) => { if (!mEl.innerHTML) return; if (ev.key === 'Escape') closeModal(); if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') runOk(); });

/* ---------- Sortieren per Drag & Drop (Maus + Touch) ---------- */
let drag = null;
document.addEventListener('pointerdown', (ev) => {
  const h = ev.target.closest('[data-drag]'); if (!h || !S) return;
  ev.preventDefault();
  const row = h.closest('[data-row]'), c = h.dataset.drag;
  const list = [...row.parentNode.querySelectorAll(`[data-row="${c}"]`)];
  const rects = list.map((r) => { const b = r.getBoundingClientRect(); return { top: b.top + scrollY, h: b.height }; });
  const from = list.indexOf(row);
  const slot = list.length > 1 ? (from < list.length - 1 ? rects[from + 1].top - rects[from].top : rects[from].top - rects[from - 1].top) : rects[from].h;
  drag = { c, list, rects, row, from, to: from, slot, startY: ev.clientY + scrollY };
  try { h.setPointerCapture(ev.pointerId); } catch (e) {}
  row.classList.add('dragging'); document.body.classList.add('sorting');
});
document.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  if (ev.clientY < 70) scrollBy(0, -12); else if (ev.clientY > innerHeight - 70) scrollBy(0, 12);
  const dy = ev.clientY + scrollY - drag.startY;
  drag.row.style.transform = `translateY(${dy}px)`;
  const mid = drag.rects[drag.from].top + drag.rects[drag.from].h / 2 + dy;
  let to = 0; drag.rects.forEach((r, i) => { if (i !== drag.from && r.top + r.h / 2 < mid) to++; });
  drag.to = to;
  drag.list.forEach((r, i) => {
    if (i === drag.from) return;
    let shift = 0;
    if (drag.from < to && i > drag.from && i <= to) shift = -drag.slot;
    if (to < drag.from && i >= to && i < drag.from) shift = drag.slot;
    r.style.transform = shift ? `translateY(${shift}px)` : '';
  });
});
function endDrag() {
  if (!drag) return;
  const d = drag; drag = null; document.body.classList.remove('sorting');
  d.list.forEach((r) => { r.style.transform = ''; r.classList.remove('dragging'); });
  if (d.to === d.from) return;
  const ids = d.list.map((r) => r.dataset.id); const [m] = ids.splice(d.from, 1); ids.splice(d.to, 0, m);
  const byId = new Map(S[d.c].map((x) => [x.id, x]));
  S[d.c] = [...ids.map((id) => byId.get(id)).filter(Boolean), ...S[d.c].filter((x) => !ids.includes(x.id))];
  render(); saveSettings(true);
}
document.addEventListener('pointerup', endDrag);
document.addEventListener('pointercancel', endDrag);

/* ---------- Start ---------- */
render();
(async () => { try { S = await api('/api/state'); await checkPin(); online = true; } catch (e) { toast('Server nicht erreichbar'); } render(); connect(); })();
})();
