(() => {
'use strict';
const CATS = { haushalt: { n: 'Haushalt', e: '🧹' }, schule: { n: 'Schule', e: '📚' }, musik: { n: 'Musik', e: '🎵' }, sonst: { n: 'Sonstiges', e: '⭐' } };
const COLORS = ['#FF7A59', '#4C9AFF', '#2FB37A', '#A97BE8', '#F2A31B', '#E8578A'];
const EMOJIS = ['🦊', '🐼', '🦁', '🐸', '🐙', '🦄', '🐯', '🐨', '🐶', '🐱', '🚀', '⚽', '🌟', '🦖'];
const PINKEY = 'punktekonto-pin';

let S = null, online = false, view = 'home', tab = 'earn', pinValid = false, version = null, upd = null;
try { view = sessionStorage.getItem('pk-view') || 'home'; tab = sessionStorage.getItem('pk-tab') || 'earn'; } catch (e) {}
let pin = ''; try { pin = localStorage.getItem(PINKEY) || ''; } catch (e) {}

const root = document.getElementById('root');
const toastEl = document.createElement('div'); toastEl.className = 'toast'; document.body.appendChild(toastEl);
const syncEl = document.createElement('div'); syncEl.className = 'sync'; document.body.appendChild(syncEl);
const mEl = document.createElement('div'); document.body.appendChild(mEl);

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9);
const kidById = (id) => S.kids.find((k) => k.id === id);
const n = (v) => { v = parseInt(v, 10); return isFinite(v) ? v : 0; };
const isParent = () => !S.cfg.hasPin || pinValid;
const canBook = () => isParent() || S.cfg.openBooking;
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
async function refresh() { S = await api('/api/state'); if (!(view === 'settings' && document.activeElement && document.activeElement.matches('input,select'))) render(); }
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
  return '<ul class="log">' + list.map((e) => { const k = kidById(e.kid); return `<li>${k ? `<span class="who" style="--c:${k.color}">${esc(k.emoji)} ${esc(k.name)}</span>` : ''}<span class="ll">${esc(e.label)}<small>${verb(e)} · ${when(e.t)}</small></span><b class="${e.pts >= 0 ? 'plus' : 'minus'}">${e.pts > 0 ? '+' : ''}${e.pts}</b>${isParent() ? `<button class="x" data-a="undo" data-id="${e.id}" title="Rückgängig" aria-label="Rückgängig">↺</button>` : ''}</li>`; }).join('') + '</ul>';
}
function topRight() {
  if (!S.cfg.hasPin) return `<button class="icon" data-a="go" data-v="settings" aria-label="Einstellungen">⚙️</button>`;
  return pinValid ? `<span style="display:flex;gap:8px"><button class="icon" data-a="lock" aria-label="Sperren">🔓</button><button class="icon" data-a="go" data-v="settings" aria-label="Einstellungen">⚙️</button></span>`
    : `<button class="icon" data-a="unlock" aria-label="Eltern-Modus">🔒</button>`;
}
function home() {
  return `<header class="top"><div><div class="brand">⭐ Punktekonto</div><div class="sub">Punkte sammeln · Belohnungen einlösen</div></div>${topRight()}</header>
  <div class="kids">${S.kids.map((k) => { const nx = nextReward(k); const pct = nx ? Math.max(0, Math.min(100, k.pts / nx.cost * 100)) : 100;
    return `<button class="kid" style="--c:${k.color}" data-a="go" data-v="kid:${k.id}"><span class="av">${esc(k.emoji)}</span><span class="kn">${esc(k.name)}</span><span class="kp">${k.pts}<small>Punkte</small></span><span class="next">📺 ${minutesFor(k.pts)} Min Medienzeit${nx ? ` · noch ${nx.cost - k.pts} bis ${esc(nx.emoji)} ${esc(nx.name)}` : ''}</span><span class="bar"><i style="width:${pct}%"></i></span></button>`; }).join('')}</div>
  ${S.kids.length ? '' : '<p class="empty">Lege in den Einstellungen ⚙️ deine Kinder an.</p>'}
  <h2>Zuletzt</h2>${logList(S.log.slice(0, 8), true)}`;
}
function kidView(k) {
  const tabs = [['earn', '➕ Verdienen'], ['spend', '🎁 Einlösen'], ['log', '📜 Verlauf']]; let body = '';
  const lockNote = canBook() ? '' : '<p class="hint" style="margin-top:14px">🔒 Zum Buchen bitte Mama oder Papa fragen.</p>';
  if (tab === 'earn') {
    body = lockNote + Object.entries(CATS).map(([c, m]) => { const ts = S.tasks.filter((t) => t.cat === c); if (!ts.length) return '';
      return `<h3>${m.e} ${m.n}</h3><div class="tasks">${ts.map((t) => `<button class="task" data-a="earn" data-id="${t.id}"><span>${esc(t.name)}</span><b>+${t.pts}</b></button>`).join('')}</div>`; }).join('')
      + (canBook() ? `<button class="ghost" data-a="adjust">± Eigene Punkte vergeben oder abziehen</button>` : '');
  } else if (tab === 'spend') {
    const maxMin = minutesFor(k.pts);
    body = lockNote + `<div class="card" style="margin-top:16px;padding-top:14px"><div class="rn" style="font-size:18px">📺 Medienzeit<small>${rateText()} · möglich: ${maxMin} Min</small></div>
      <div class="quick">${[15, 30, 45, 60].map((m) => `<button data-a="media" data-v="${m}" ${Math.ceil(m * rate()) > k.pts ? 'disabled style="opacity:.4"' : ''}>${m} Min</button>`).join('')}</div>
      <button class="add" style="width:100%" data-a="mediaCustom" ${maxMin < 1 ? 'disabled' : ''}>Andere Minutenzahl …</button></div>
      <h3>🎁 Belohnungen</h3>` + '<div class="rewards" style="margin-top:0">' + ([...S.rewards].sort((a, b) => a.cost - b.cost).map((r) => { const ok = k.pts >= r.cost;
      return `<div class="reward ${ok ? '' : 'off'}"><span class="re">${esc(r.emoji)}</span><span class="rn">${esc(r.name)}<small>${r.cost} Punkte${ok ? '' : ` · noch ${r.cost - k.pts}`}</small></span><button data-a="spend" data-id="${r.id}" ${ok ? '' : 'disabled'}>Einlösen</button></div>`; }).join('') || '<p class="empty">Noch keine Belohnungen angelegt.</p>') + '</div>';
  } else body = '<div style="margin-top:16px">' + logList(S.log.filter((e) => e.kid === k.id), false) + '</div>';
  return `<header class="top" style="--c:${k.color}"><button class="icon" data-a="go" data-v="home" aria-label="Zurück">←</button><div class="kidhead"><span class="av">${esc(k.emoji)}</span><span class="nm">${esc(k.name)}</span><span class="bal">${k.pts}<small>Pkt</small></span></div></header>
  <div class="seg">${tabs.map(([t, l]) => `<button class="${tab === t ? 'on' : ''}" data-a="tab" data-v="${t}">${l}</button>`).join('')}</div><div style="--c:${k.color}">${body}</div>`;
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
  <section class="card"><h2>Aufgaben</h2>${S.tasks.map((t) => `<div class="row wrap"><input class="grow" value="${esc(t.name)}" data-c="tasks" data-id="${t.id}" data-f="name" aria-label="Aufgabe"><select data-c="tasks" data-id="${t.id}" data-f="cat">${catOpts(t.cat)}</select><input class="num" type="number" min="0" inputmode="numeric" value="${t.pts}" data-c="tasks" data-id="${t.id}" data-f="pts" aria-label="Punkte"><button class="del" data-a="del" data-c="tasks" data-id="${t.id}" aria-label="Löschen">✕</button></div>`).join('')}<button class="add" data-a="addTask">+ Aufgabe</button></section>
  <section class="card"><h2>Belohnungen</h2>${S.rewards.map((r) => `<div class="row"><input class="emo" value="${esc(r.emoji)}" data-c="rewards" data-id="${r.id}" data-f="emoji" aria-label="Symbol"><input class="grow" value="${esc(r.name)}" data-c="rewards" data-id="${r.id}" data-f="name" aria-label="Belohnung"><input class="num" type="number" min="0" inputmode="numeric" value="${r.cost}" data-c="rewards" data-id="${r.id}" data-f="cost" aria-label="Kosten"><button class="del" data-a="del" data-c="rewards" data-id="${r.id}" aria-label="Löschen">✕</button></div>`).join('')}<button class="add" data-a="addReward">+ Belohnung</button></section>
  <section class="card"><h2>Medienzeit</h2><div class="row"><span class="grow" style="font-weight:700">Punkte pro Minute Medienzeit</span><input class="num" type="number" min="0.1" step="0.1" inputmode="decimal" value="${rate()}" data-a="mediaRate" aria-label="Punkte pro Minute"></div></section>
  <section class="card"><h2>Eltern-PIN</h2><p class="hint">${S.cfg.hasPin ? 'Ein PIN ist gesetzt. Ohne PIN sehen die Kinder nur ihre Punkte.' : 'Noch kein PIN – jeder kann buchen und Einstellungen ändern.'}</p>
   <div class="btns"><button class="pri" data-a="setPin">${S.cfg.hasPin ? 'PIN ändern' : 'PIN festlegen'}</button>${S.cfg.hasPin ? '<button data-a="removePin">PIN entfernen</button>' : ''}</div>
   ${S.cfg.hasPin ? `<label class="toggle">Kinder dürfen selbst Punkte buchen und einlösen<input type="checkbox" data-a="openBooking" ${S.cfg.openBooking ? 'checked' : ''}></label>` : ''}</section>
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
  const go = () => op({ op: 'settings', kids: S.kids, tasks: S.tasks, rewards: S.rewards }).catch(() => {});
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
  const need = (fn) => (canBook() ? fn() : askPin(fn));
  switch (a) {
    case 'go': view = b.dataset.v; if (view.startsWith('kid:')) tab = 'earn'; if (view === 'settings') { upd = null; loadVersion(); } render(); scrollTo(0, 0); break;
    case 'tab': tab = b.dataset.v; render(); break;
    case 'unlock': askPin(); break;
    case 'lock': lock(); break;
    case 'earn': need(async () => { const t = S.tasks.find((x) => x.id === id); if (!t || !cur) return; const r = await op({ op: 'earn', kid: cur.id, task: t.id }); bump(); toast(`+${t.pts} für „${t.name}“`, r.entry.id); }); break;
    case 'spend': need(() => { const r = S.rewards.find((x) => x.id === id); if (!r || !cur) return;
      modal(`<h4>${esc(r.emoji)} ${esc(r.name)} einlösen?</h4><p>${esc(cur.name)} hat ${cur.pts} Punkte. Danach bleiben ${cur.pts - r.cost}.</p>`, `${r.cost} Punkte einlösen`, async () => { const x = await op({ op: 'spend', kid: cur.id, reward: r.id }).catch(() => null); if (x) { bump(); toast(`${r.name} eingelöst – viel Spaß!`, x.entry.id); } }); }); break;
    case 'adjust': need(() => { if (!cur) return;
      modal(`<h4>Punkte für ${esc(cur.name)}</h4><label>Punkte (minus = abziehen)</label><input id="adjP" type="number" inputmode="numeric" value="5"><div class="quick">${[-10, -5, 5, 10, 20].map((v) => `<button data-a="q" data-v="${v}">${v > 0 ? '+' : ''}${v}</button>`).join('')}</div><label>Grund</label><input id="adjR" placeholder="z. B. Oma beim Einkaufen geholfen">`, 'Buchen', async () => {
        const p = n(document.getElementById('adjP').value); if (!p) return false; const label = document.getElementById('adjR').value.trim();
        const x = await op({ op: 'adjust', kid: cur.id, pts: p, label }).catch(() => null); if (x) { bump(); toast(`${p > 0 ? '+' : ''}${p} · ${x.entry.label}`, x.entry.id); } }); }); break;
    case 'media': case 'mediaCustom': need(() => { if (!cur) return;
      const doMedia = async (min) => { const x = await op({ op: 'media', kid: cur.id, minutes: min }).catch(() => null); if (x) { bump(); toast(`${min} Min Medienzeit – viel Spaß!`, x.entry.id); } };
      if (a === 'media') { const min = n(b.dataset.v), cost = Math.ceil(min * rate());
        modal(`<h4>📺 ${min} Min Medienzeit einlösen?</h4><p>${esc(cur.name)} hat ${cur.pts} Punkte. Danach bleiben ${cur.pts - cost}.</p>`, `${cost} Punkte einlösen`, () => doMedia(min)); }
      else modal(`<h4>📺 Medienzeit für ${esc(cur.name)}</h4><p>Möglich: bis zu ${minutesFor(cur.pts)} Min (${rateText()}).</p><label>Minuten</label><input id="medMin" type="number" min="1" inputmode="numeric" value="${Math.min(20, minutesFor(cur.pts))}"><div id="medErr" class="err"></div>`, 'Einlösen', async () => {
        const min = n(document.getElementById('medMin').value); if (min < 1 || Math.ceil(min * rate()) > cur.pts) { document.getElementById('medErr').textContent = 'So viele Punkte sind nicht da.'; return false; } await doMedia(min); });
    }); break;
    case 'q': document.getElementById('adjP').value = b.dataset.v; break;
    case 'undo-now': toastEl.classList.remove('show'); await op({ op: 'undo', id }).catch(() => {}); bump(); break;
    case 'undo': { const e = S.log.find((x) => x.id === id); if (!e) return; const k = kidById(e.kid);
      modal(`<h4>Eintrag rückgängig machen?</h4><p>${k ? esc(k.emoji + ' ' + k.name) + ': ' : ''}${esc(e.label)} (${e.pts > 0 ? '+' : ''}${e.pts})</p>`, 'Rückgängig', () => op({ op: 'undo', id }).catch(() => {}), 'danger'); break; }
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
    case 'checkUpd': checkUpd(); break;
    case 'applyUpd': applyUpd(); break;
  }
});
document.addEventListener('change', (ev) => {
  const el = ev.target; if (!S) return;
  if (el.dataset.a === 'mediaRate') { const r = Number(String(el.value).replace(',', '.')); if (r > 0) op({ op: 'setMediaRate', value: r }).catch(() => {}); return; }
  if (el.dataset.a === 'openBooking') { op({ op: 'setOpenBooking', value: el.checked }).catch(() => {}); return; }
  if (!el.dataset.c) return; const it = S[el.dataset.c].find((x) => x.id === el.dataset.id); if (!it) return;
  const f = el.dataset.f; it[f] = (f === 'pts' || f === 'cost') ? Math.max(0, n(el.value)) : (el.value.trim() || it[f]); saveSettings();
});
document.addEventListener('keydown', (ev) => { if (!mEl.innerHTML) return; if (ev.key === 'Escape') closeModal(); if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') runOk(); });

/* ---------- Start ---------- */
render();
(async () => { try { S = await api('/api/state'); await checkPin(); online = true; } catch (e) { toast('Server nicht erreichbar'); } render(); connect(); })();
})();
