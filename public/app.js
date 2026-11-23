// Impact front end. One shared world from the server over SSE; falls back to running the same
// agent engine in the browser when there is no server (offline, single player).
import { createGlobe } from './globe.js';
import { faceURL } from './faces.js';

const IA = window.ImpactAgents;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ZN = IA.ZN;
const ZONE_ICON = { forest: '🌳', ice: '🏔️', desert: '🌵', ocean: '🌊', space: '🛰️' };
const KEY = 'impact.' + (new URLSearchParams(location.search).get('p') || '1');
const store = {
  get(k, d) { try { const v = localStorage.getItem(KEY + '.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(KEY + '.' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};

// ------------------------------------------------------------------ player
const BUDDIES = [
  { id: 'sprout', name: 'Sprout', color: '#bfe3a8' }, { id: 'fox', name: 'Fox', color: '#f5b26b' },
  { id: 'bunny', name: 'Bunny', color: '#f3e9f7' }, { id: 'axolotl', name: 'Axolotl', color: '#f7c3d0' },
  { id: 'penguin', name: 'Penguin', color: '#cfd9e6' }, { id: 'bot', name: 'Ecobot', color: '#d9e8c4' },
];
let me = store.get('me', null);
const myBuddy = () => BUDDIES.find((b) => b.id === (me && me.av)) || BUDDIES[0];
const myFace = (size) => faceURL(Object.assign({}, myBuddy()), size);

// ------------------------------------------------------------------ world connection
let W = null;            // the shared state
let HEALTH = {};
let online = 0;
let mode = 'connecting'; // 'online' | 'offline'
let tickMs = 10000;
let lastSeenLog = store.get('seenLog', 0);
let firstSnapshot = true;

const globe = createGlobe($('#globe'), $('#labels'), IA.AGENTS);

function connect() {
  let es;
  try { es = new EventSource('events'); } catch (e) { return goOffline(); }
  let opened = false;
  const timer = setTimeout(() => { if (!opened) { es.close(); goOffline(); } }, 4000);
  es.onmessage = (m) => {
    opened = true; clearTimeout(timer);
    const d = JSON.parse(m.data);
    mode = 'online';
    HEALTH = d.health || {};
    online = d.online || 1;
    tickMs = d.tickMs || tickMs;
    receive(d.state);
  };
  es.onerror = () => { if (!opened) { clearTimeout(timer); es.close(); goOffline(); } else setNet(); };
}

// offline: the same engine runs here, on its own timer, and persists in this browser
let localMem = store.get('mem', {});
function goOffline() {
  if (mode === 'offline') return;
  mode = 'offline';
  let S = store.get('world', null);
  if (!S || !S.agents) S = IA.create(42, null, localMem);
  const missed = Math.min(120, Math.floor((Date.now() - (S.lastTick || Date.now())) / tickMs));
  if (missed > 0) {
    const fromH = Math.round(IA.avgH(S)), fromTick = S.tick;
    for (let i = 0; i < missed; i++) localTick(S);
    S.away = { missed, fromTick, toTick: S.tick, fromH, toH: Math.round(IA.avgH(S)), at: Date.now() };
  }
  W = S;
  if (me) IA.join(W, me);
  receive(W);
  setInterval(() => { localTick(W); receive(W); }, tickMs);
}
function localTick(S) {
  const r = IA.tick(S, null, localMem);
  if (r.restart) { const pl = S.players; Object.assign(S, IA.create(S.seed + 1, null, localMem)); for (const p of Object.values(pl)) IA.join(S, p); }
  store.set('world', S); store.set('mem', localMem);
}

async function api(path, body) {
  if (mode !== 'online') return null;
  const r = await fetch(path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
}

// ------------------------------------------------------------------ render loop
let prevH = null;
let spoken = new Set();
function receive(S) {
  const restarted = W && W !== S && W.seed !== S.seed;
  W = S;
  setNet();
  globe.update(S);
  renderZones();
  if (me) {
    const p = S.players[me.id];
    $('#seedN').textContent = p ? p.score : 0;
    $('#meLv').textContent = `Lv ${1 + Math.floor((p ? p.score : 0) / 25)}`;
    if (!p && mode === 'online') api('api/join', me);
  }
  const unseen = S.log.filter((e) => e.id > lastSeenLog && e.seed === S.seed).length;
  $('#agentsDot').hidden = !unseen || openTab === 'agents';
  $('#agentsDot').textContent = unseen > 99 ? '99+' : unseen;
  const myQuests = openQuests();
  $('#goDot').hidden = !myQuests.length;
  $('#goDot').textContent = myQuests.length;
  voice(S);
  if (firstSnapshot) { firstSnapshot = false; maybeAway(S); }
  if (restarted) toast(`New run started (seed ${S.seed})`);
  if (openTab && LIVE_TABS.has(openTab)) renderSheet(true);
}

function setNet() {
  const n = $('#net');
  n.className = 'pill stat net ' + (mode === 'online' ? 'on' : mode === 'offline' ? 'off' : '');
  $('#netT').textContent = mode === 'online' ? `${online} online` : mode === 'offline' ? 'offline' : '…';
  n.title = mode === 'online' ? 'Connected: everyone sees the same world' : 'No server: agents run in this browser';
}

function renderZones() {
  const box = $('#zones');
  if (!box.children.length) {
    box.innerHTML = IA.ZONES.map((z) => `<div class="zone" data-z="${z}" title="${ZN[z]}"><span>${ZONE_ICON[z]}</span><b></b><span class="bar"><i></i></span></div>`).join('');
  }
  for (const z of IA.ZONES) {
    const el = box.querySelector(`[data-z=${z}]`);
    const h = Math.round(W.H[z]);
    el.querySelector('b').textContent = h;
    el.querySelector('i').style.width = h + '%';
    el.classList.toggle('sick', h < 30);
    if (prevH && W.H[z] - prevH[z] >= 3) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  }
  prevH = Object.assign({}, W.H);
}

function toast(msg, ms = 2800) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.remove('on'), ms);
}

// ------------------------------------------------------------------ voice (each agent has its own)
let voiceOn = store.get('voice', false);
function voice(S) {
  const fresh = S.log.filter((e) => !spoken.has(e.id));
  fresh.forEach((e) => spoken.add(e.id));
  if (!voiceOn || !('speechSynthesis' in window) || spoken.size === fresh.length) return;
  const big = fresh.filter((e) => ['betray', 'quest', 'end', 'thank'].includes(e.k) && IA.AG[e.agent]).slice(-1)[0];
  if (!big) return;
  const def = IA.AG[big.agent];
  const u = new SpeechSynthesisUtterance(big.say || `${def.name} ${big.act}`);
  u.pitch = def.voice.pitch; u.rate = def.voice.rate;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}

// ------------------------------------------------------------------ "While you were away…"
function maybeAway(S) {
  const last = store.get('lastVisit', 0);
  store.set('lastVisit', Date.now());
  setInterval(() => store.set('lastVisit', Date.now()), 15000);
  if (!me) return;
  const gone = Date.now() - last;
  const missed = S.log.filter((e) => e.t > last && e.agent !== 'human');
  const serverAway = S.away && S.away.at > last ? S.away : null;
  if (!last || gone < 90000 || (!missed.length && !serverAway)) return;
  const pick = (k) => missed.filter((e) => e.k === k);
  const lines = [];
  if (serverAway) lines.push(`The world server was off and caught up <b>${serverAway.missed} missed ticks</b> when it came back.`);
  const startH = serverAway ? serverAway.fromH : null;
  for (const e of [...pick('betray'), ...pick('end'), ...pick('ally'), ...pick('quest'), ...pick('fight')].slice(0, 6)) {
    lines.push(`<b>${esc(name(e.agent))}</b> ${esc(e.act)}`);
  }
  const mins = Math.round(gone / 60000);
  modal(`<h2>While you were away…</h2>
    <p class="muted">You were gone ${mins >= 60 ? Math.round(mins / 60) + ' h' : mins + ' min'}. The agents kept going: ${missed.length} decisions.${startH != null ? ` Planet ${startH} → ${Math.round(IA.avgH(S))}.` : ''}</p>
    <ul class="away">${lines.map((l) => `<li>${l}</li>`).join('') || '<li>Quiet times. Everyone rested.</li>'}</ul>
    <button class="btn wide" data-close>Back to the planet</button>`);
}

const name = (id) => (IA.AG[id] ? IA.AG[id].name : id === 'world' ? 'World' : id);

// ------------------------------------------------------------------ modal + sheet
function modal(html) {
  const m = $('#modal');
  $('#modalC').innerHTML = html;
  m.hidden = false;
  m.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
}
function closeModal() { $('#modal').hidden = true; }

let openTab = null;
const LIVE_TABS = new Set(['agents', 'neighbors', 'go']);
const TABS = {};
function openSheet(tab) {
  openTab = tab;
  document.querySelectorAll('#tabbar button').forEach((b) => b.classList.toggle('on', b.dataset.tab === (tab || 'globe')));
  if (!tab) { $('#sheet').hidden = true; return; }
  $('#sheet').hidden = false;
  $('#sheetB').scrollTop = 0;
  renderSheet(false);
}
function renderSheet(live) {
  const t = TABS[openTab];
  if (!t || !W) return;
  if (live && t.live) return t.live();
  if (live) return;
  $('#sheetT').textContent = t.title;
  $('#sheetB').innerHTML = t.html();
  if (t.mount) t.mount();
}
$('#sheetX').onclick = () => openSheet(null);
document.querySelectorAll('#tabbar button').forEach((b) => (b.onclick = () => openSheet(b.dataset.tab === 'globe' ? null : b.dataset.tab)));
$('#agentsBtn').onclick = () => openSheet('agents');
$('#meBtn').onclick = () => openSheet('me');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else openSheet(null); } });

// ------------------------------------------------------------------ Agents panel
let logFilter = 'all';
const FILTERS = { all: 'All', social: 'Ally · trade · betray', fight: 'Fights', quest: 'Quests', human: 'Humans', learn: 'Learning' };
function filterLog(e) {
  if (logFilter === 'all') return true;
  if (logFilter === 'social') return ['ally', 'trade', 'betray'].includes(e.k);
  return e.k === logFilter;
}
function avatarFor(e) {
  if (IA.AG[e.agent]) return `<img src="${faceURL(IA.AG[e.agent], 80)}" alt="">`;
  if (e.agent === 'human') {
    const p = W.players[e.who];
    return p ? `<img src="${faceURL(BUDDIES.find((b) => b.id === p.av) || BUDDIES[0], 80)}" alt="">` : '<span class="hicon">🙂</span>';
  }
  return '<span class="hicon">🌍</span>';
}
function entryHTML(e) {
  const chips = [];
  for (const s of e.src || []) {
    if (/^Telem/.test(s)) chips.push(`<a class="chip" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(s)}</a>`);
    else chips.push(`<span class="chip ${/^Bruin/.test(s) ? 'ok' : ''}">${esc(s)}</span>`);
  }
  if (e.band) chips.push('<span class="chip gold">posted to BAND</span>');
  const who = e.agent === 'human' ? '' : `<span class="who">${esc(name(e.agent))}</span> `;
  return `<div class="entry k-${e.k}">${avatarFor(e)}<div>
    <div>${who}${esc(e.act)}</div>
    ${e.say ? `<div class="say">“${esc(e.say)}”</div>` : ''}
    <div class="why"><b>Why:</b> ${esc(e.why)}</div>
    ${e.data ? `<div class="small muted"><b>Data:</b> ${esc(e.data)}</div>` : ''}
    ${e.alts && e.alts.length ? `<div class="small muted">Also considered: ${e.alts.map(esc).join(', ')}</div>` : ''}
    <div class="chips">${chips.join('')}</div>
    <div class="meta">run ${e.seed} · tick ${e.tick} · ${new Date(e.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</div>
  </div></div>`;
}
function agentCards() {
  return W.agents.map((a) => {
    const d = IA.AG[a.id];
    const ally = a.ally && a.allyUntil > W.tick ? ` · allied with ${IA.AG[a.ally].name}` : '';
    const trust = Object.entries(a.trust).filter(([k]) => IA.AG[k])
      .map(([k, v]) => `<span class="${v > 0.15 ? 'pos' : v < -0.15 ? 'neg' : ''}">${esc(IA.AG[k].name.replace('Smog ', ''))} ${v > 0 ? '+' : ''}${v.toFixed(1)}</span>`).join('');
    return `<div class="acard"><img src="${faceURL(d, 104)}" alt=""><h4>${d.name}</h4>
      <div class="muted small">${d.role} · in ${ZN[a.zone]}${esc(ally)}</div>
      <div class="meter" title="energy"><i style="width:${a.energy}%"></i></div>
      <div class="small">⚡ ${a.energy} · 🌱 ${a.seeds} seeds</div>
      <div class="small muted" style="margin-top:4px">${d.bio}</div>
      <div class="small" style="margin-top:4px">Personality (from seed): teamwork ${a.tr.coop} · greed ${a.tr.greed} · aggression ${a.tr.aggro}</div>
      <div class="trust">${trust}</div>
      ${a.last ? `<div class="small" style="margin-top:6px"><b>Last:</b> ${esc(a.last)}</div>` : ''}</div>`;
  }).join('');
}
function bruinSource() {
  const b = HEALTH.bruin;
  if (mode !== 'online') return '<span class="chip">offline · bundled air snapshot</span>';
  return b && b.ok ? `<span class="chip ok">Bruin daily_spawn · ${esc(b.detail)}</span>` : `<span class="chip bad">Bruin not run yet: snapshot data</span>`;
}
TABS.agents = {
  title: 'The agents',
  html() {
    return `<div class="chips"><span class="chip">${mode === 'online' ? 'Live · shared world' : 'Offline · agents run in this browser'}</span>
        <span class="chip gold" id="runChip"></span>${bruinSource()}</div>
      <p class="small">5 AI agents with their own goals act every ${Math.round(tickMs / 1000)} seconds, even when nobody is playing. They ally, trade, betray, fight and ask humans for real-world help. Every decision is logged with why, the data it used and its source.</p>
      <div class="cards" id="cards"></div>
      <div class="row">
        <button class="btn" id="twiceB">Run it twice</button>
        <button class="btn ghost" id="repB">Run report</button>
        <button class="btn ghost" id="newB">New run</button>
      </div>
      <div id="twiceOut"></div>
      <div id="repOut"></div>
      <h3>📖 Decision log</h3>
      <div class="filter" id="filters">${Object.entries(FILTERS).map(([k, v]) => `<button data-f="${k}" class="${k === logFilter ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="log" id="log"></div>`;
  },
  live() {
    const avg = Math.round(IA.avgH(W));
    $('#runChip').textContent = `Run ${W.seed} · tick ${Math.min(W.tick, IA.ROUND)}/${IA.ROUND} · planet ${avg}/100${W.status !== 'playing' ? ' · ' + (W.status === 'won' ? 'guardians won' : 'Baron won') : ''}`;
    $('#cards').innerHTML = agentCards();
    $('#log').innerHTML = W.log.filter(filterLog).slice(-60).reverse().map(entryHTML).join('') || '<p class="muted">Nothing yet.</p>';
    lastSeenLog = W.log.length ? W.log[W.log.length - 1].id : 0;
    store.set('seenLog', lastSeenLog);
    $('#agentsDot').hidden = true;
  },
  mount() {
    this.live();
    $('#filters').onclick = (e) => {
      const f = e.target.dataset.f;
      if (!f) return;
      logFilter = f;
      $('#filters').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.f === f));
      this.live();
    };
    $('#repB').onclick = runReport;
    $('#twiceB').onclick = runTwice;
    $('#newB').onclick = async () => {
      if (mode === 'online') await api('api/new', { seed: W.seed + 1 });
      else { const pl = W.players; Object.assign(W, IA.create(W.seed + 1, null, localMem)); for (const p of Object.values(pl)) IA.join(W, p); receive(W); }
      toast('New run: the agents remember what worked last time');
    };
  },
};
async function runReport() {
  const out = $('#repOut');
  out.innerHTML = '<p class="muted">Loading…</p>';
  let rep;
  if (mode === 'online') rep = await api('api/report');
  else rep = { source: 'this browser (offline)', rows: IA.report(W.log) };
  const cols = ['agent', 'runs', 'actions', 'allies', 'trades', 'betrayals_and_bribes', 'fights', 'quests_for_humans', 'decisions_using_bruin_data'].filter((c) => rep.rows[0] && c in rep.rows[0]);
  const label = { betrayals_and_bribes: 'betray/bribe', quests_for_humans: 'quests', decisions_using_bruin_data: 'used Bruin data' };
  out.innerHTML = `<h3>🧾 Agent audit</h3><div class="chips"><span class="chip ${rep.bruin ? 'ok' : ''}">Source: ${esc(rep.source)}</span></div>
    <div class="tablewrap"><table><tr>${cols.map((c) => `<th>${label[c] || c}</th>`).join('')}</tr>
    ${rep.rows.map((r) => `<tr>${cols.map((c) => `<td>${esc(r[c])}</td>`).join('')}</tr>`).join('')}</table></div>`;
}
function spark(hist, color) {
  const w = 240, h = 70;
  const pts = hist.map((v, i) => `${(i / Math.max(1, hist.length - 1)) * w},${h - (v / 100) * h}`).join(' ');
  return `<svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none"><line x1="0" x2="${w}" y1="${h / 2}" y2="${h / 2}" stroke="#ddd" stroke-dasharray="4 4"/><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="3"/></svg>`;
}
async function runTwice() {
  const out = $('#twiceOut');
  out.innerHTML = '<p class="muted">Simulating 2 × 120 ticks…</p>';
  const sims = mode === 'online'
    ? await Promise.all([42, 7].map((s) => api(`api/sim?seed=${s}`)))
    : [42, 7].map((s) => IA.simulate(s, null, localMem));
  out.innerHTML = `<h3>🎲 Same agents, two seeds</h3><div class="twice">${sims.map((r) => `<div>
      <b class="hand" style="font-size:22px">Seed ${r.seed}</b> <span class="chip ${r.status === 'won' ? 'ok' : 'bad'}">${r.status === 'won' ? 'Guardians win' : 'Smog Baron wins'} · planet ${r.avg}</span>
      ${spark(r.hist, r.status === 'won' ? '#5fae67' : '#d65a5a')}
      <div class="small muted">Planet health over ${r.ticks} ticks (dashed line = 50 to win)</div>
      <ul style="padding-left:16px;margin:6px 0">${r.key.filter((e) => e.k !== 'end').slice(-5).map((e) => `<li><b>${esc(name(e.agent))}</b> ${esc(e.act)}</li>`).join('')}</ul>
      <div class="small">Betrayals: ${r.report.find((x) => x.agent === 'Sunfox').betrayals_and_bribes} · Baron bribes: ${r.report.find((x) => x.agent === 'Smog Baron').betrayals_and_bribes} · alliances: ${r.report.reduce((s, x) => s + x.allies, 0)}</div>
    </div>`).join('')}</div>
    <p class="small muted">Each seed rolls different starting health, energy, trust and personalities. The agents also carry memory from earlier runs ("remembers run N: prefers to …").</p>`;
}

// ------------------------------------------------------------------ Go! real-world actions
const ACTIONS = [
  { id: 'bottle', label: 'Used a refill bottle', z: { ocean: 4 }, tip: 'Ocean +4' },
  { id: 'refuse', label: 'Said no to 3 single-use plastics', z: { ocean: 4 }, tip: 'Ocean +4' },
  { id: 'walk', label: 'Walked or biked instead of driving', z: { ice: 4 }, tip: 'Ice +4' },
  { id: 'meal', label: 'Ate a plant-based meal', z: { forest: 4 }, tip: 'Forest +4' },
  { id: 'litter', label: 'Picked up litter outside', z: { forest: 2, ocean: 2 }, tip: 'Forest +2 · Ocean +2' },
  { id: 'unplug', label: 'Unplugged chargers, lights off', z: { desert: 4 }, tip: 'Desert +4' },
  { id: 'shower', label: 'Took a 5-minute shower', z: { desert: 3 }, tip: 'Desert +3' },
  { id: 'thrift', label: 'Thrifted or repaired, not new', z: { space: 4 }, tip: 'Space +4' },
  { id: 'recycle', label: 'Recycled e-waste properly', z: { space: 3 }, tip: 'Space +3' },
];
const QUEST_ACTION = { meal: 'meal', litter: 'litter', bottle: 'bottle', refuse: 'refuse', hunt: 'litter', walk: 'walk', unplug: 'unplug', shower: 'shower', thrift: 'thrift', repair: 'recycle' };
function openQuests() {
  if (!W || !me) return [];
  return W.quests.filter((q) => !q.done && q.until >= W.tick && (!q.to || q.to === me.id));
}
TABS.go = {
  title: 'Go! Real life',
  html() {
    return `<p class="small">Real-life actions heal the world 2× more with a photo. The photo stays on your phone.</p>
      <div id="quests"></div>
      <h3>🌍 Do something real</h3>
      <div class="acts">${ACTIONS.map((a) => `<button class="act" data-a="${a.id}"><b>${a.label}</b><small>${a.tip}</small></button>`).join('')}</div>
      <h3>♻️ Bin Buddy</h3>
      <p class="small muted">Not sure where something goes? Type it.</p>
      <input type="search" id="binIn" placeholder="e.g. battery, pizza box, old phone" autocomplete="off">
      <div id="binOut"></div>`;
  },
  live() {
    const qs = openQuests();
    const el = $('#quests');
    if (!el) return;
    const sig = qs.map((q) => q.id).join();
    if (el.dataset.sig === sig) return;
    el.dataset.sig = sig;
    el.innerHTML = qs.length ? '<h3>⭐ Quests for you</h3>' + qs.map((q) => `<div class="quest-card"><img src="${faceURL(IA.AG[q.from], 96)}" alt="">
      <div><b>${esc(IA.AG[q.from].name)}:</b> ${esc(q.text)}<div class="small muted">${esc(q.line)}</div>
      <button class="btn" style="margin-top:6px;min-height:38px;padding:8px 14px" data-q="${esc(q.kind)}">I did it</button></div></div>`).join('') : '';
    el.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => doAction(QUEST_ACTION[b.dataset.q] || 'litter')));
  },
  mount() {
    this.live();
    document.querySelectorAll('.act').forEach((b) => (b.onclick = () => doAction(b.dataset.a)));
    $('#binIn').oninput = (e) => binBuddy(e.target.value);
  },
};
function doAction(id) {
  const a = ACTIONS.find((x) => x.id === id);
  modal(`<h2>${a.label}</h2><p class="muted">${a.tip} · ×2 with a photo</p>
    <label class="btn wide" style="margin:8px 0"><svg class="ic"><use href="#i-camera"/></svg>Add a photo<input type="file" accept="image/*" capture="environment" id="photoIn" hidden></label>
    <img id="photoPrev" class="photo-prev" hidden alt="Your photo (stays on this device)">
    <div class="row" style="justify-content:center"><button class="btn ghost" id="honorB">I did it (no photo)</button><button class="btn" id="proofB" hidden>Send with photo ×2</button></div>
    <p class="small muted">Photos stay on this device. They are not uploaded or checked by AI yet.</p>`);
  $('#photoIn').onchange = (e) => {
    const f = e.target.files[0];
    if (!f) return;
    $('#photoPrev').src = URL.createObjectURL(f);
    $('#photoPrev').hidden = false;
    $('#proofB').hidden = false;
  };
  $('#honorB').onclick = () => submit(a, 1);
  $('#proofB').onclick = () => submit(a, 2);
}
async function submit(a, proof) {
  const deltas = {};
  for (const [z, d] of Object.entries(a.z)) deltas[z] = d * proof;
  const act = { label: a.label, deltas, real: true, proof };
  closeModal();
  if (mode === 'online') await api('api/act', { id: me.id, act });
  else { IA.human(W, me.id, act, false); receive(W); }
  toast(`${Object.entries(deltas).map(([z, d]) => `${ZN[z]} +${d}`).join(' · ')}. Thank you!`);
}
const BIN = [
  [/batter|phone|laptop|charger|cable|electronic|e-?waste|bulb/i, 'E-waste drop-off', 'Never in the trash or recycling bin: batteries start fires in trucks. Take it to an e-waste or hazardous waste drop-off.', 'e-waste battery recycling drop-off near Los Angeles'],
  [/pizza|greasy|food|peel|coffee ground|leftover/i, 'Green bin (organics)', 'Food scraps and greasy pizza boxes go in the green organics bin in LA.', 'composting drop-off near Los Angeles'],
  [/bottle|can|jar|cardboard|paper|carton/i, 'Blue bin (recycling)', 'Empty and dry, caps on. Flatten cardboard.', 'recycling center near Los Angeles'],
  [/bag|film|wrap|styrofoam|foam/i, 'Store drop-off or trash', 'Plastic bags and film jam sorting machines. Many grocery stores take bags back. Foam goes in the trash.', 'plastic bag drop-off near Los Angeles'],
  [/cloth|shirt|shoe|jean|textile/i, 'Donate or textile drop-off', 'Wearable: donate. Worn out: textile recycling drop-off.', 'clothing donation textile recycling near Los Angeles'],
];
function binBuddy(q) {
  const out = $('#binOut');
  if (!q.trim()) { out.innerHTML = ''; return; }
  const hit = BIN.find(([re]) => re.test(q));
  const glasser = HEALTH.glasser && HEALTH.glasser.ok;
  out.innerHTML = hit
    ? `<div class="box"><b>${hit[1]}</b><div class="small">${hit[2]}</div>
       <button class="btn ghost" id="placesB" style="margin-top:8px" ${glasser ? '' : 'disabled'}>Drop-off places near me</button>
       ${glasser ? '' : '<div class="small muted">Place search is off: Glasser not connected on this server.</div>'}
       <div id="placesOut"></div></div>`
    : '<div class="box small muted">Not sure about that one. When in doubt, check your city\'s guide. Wish-cycling contaminates whole bins.</div>';
  if (hit && glasser) $('#placesB').onclick = async () => {
    $('#placesOut').innerHTML = '<p class="muted small">Searching real places via Glasser…</p>';
    const r = await fetch('api/places?q=' + encodeURIComponent(hit[3])).then((x) => x.json()).catch((e) => ({ error: e.message }));
    $('#placesOut').innerHTML = r.items && r.items.length
      ? r.items.map((p) => `<div class="small" style="margin-top:6px"><b>${esc(p.name)}</b>${p.rating ? ` · ★${esc(p.rating)}` : ''}<br>${esc(p.address)}${p.url ? ` · <a href="${esc(p.url)}" target="_blank" rel="noopener">site</a>` : ''}</div>`).join('') + '<div class="chips"><span class="chip ok">via Glasser</span></div>'
      : `<p class="small muted">No places found${r.error ? ': ' + esc(r.error) : ''}.</p>`;
  };
}

// ------------------------------------------------------------------ Feed
TABS.feed = {
  title: 'Feed',
  html() { return '<div id="news"></div><div id="pc"></div><h3>🏘️ On your street</h3><div id="street"></div>'; },
  async mount() {
    const street = W.log.filter((e) => ['human', 'quest', 'thank', 'betray', 'end'].includes(e.k)).slice(-25).reverse();
    $('#street').innerHTML = street.map((e) => `<div class="post"><div class="tag">${e.agent === 'human' ? 'Neighbor' : esc(name(e.agent))} · ${new Date(e.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
      <h4>${esc(e.act)}</h4><div class="small muted">${esc(e.why)}</div></div>`).join('') || '<p class="muted">Nothing yet. Do something real in Go!</p>';
    const pcBtn = HEALTH.runware && (HEALTH.runware.ok || /key set/.test(HEALTH.runware.detail || ''));
    $('#pc').innerHTML = pcBtn ? '<div class="post postcard"><div class="tag">Your world · painted live by Runware</div><button class="btn" id="pcB" style="margin-top:6px">Make my world postcard</button><div id="pcOut"></div></div>' : '';
    if (pcBtn) $('#pcB').onclick = postcard;
    const tel = HEALTH.telem && HEALTH.telem.ok;
    if (!tel) { $('#news').innerHTML = '<p class="small muted">Live news reels are off (Telem not connected on this server).</p>'; return; }
    $('#news').innerHTML = '<p class="muted small">Loading live news…</p>';
    const r = await fetch('api/news').then((x) => x.json()).catch(() => ({ items: [] }));
    $('#news').innerHTML = (r.items || []).map((n) => `<div class="post news"><div class="tag">Live · via Telem · ${esc(n.source)}</div>
      <h4><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></h4><div class="small muted">${esc(n.summary)}</div></div>`).join('');
  },
};
async function postcard() {
  const out = $('#pcOut');
  out.innerHTML = '<p class="muted small">Painting your planet from its live state…</p>';
  const r = await api('api/postcard', { H: W.H, name: me && me.name }).catch((e) => ({ error: e.message }));
  out.innerHTML = r && r.url
    ? `<img src="${esc(r.url)}" alt="Storybook postcard of the planet's current state"><div class="chips"><span class="chip ok">Runware</span><span class="chip">${r.cached ? 'cached for this world state' : `cost $${(+r.cost || 0).toFixed(4)}`}</span><span class="chip">total today $${(+r.total || 0).toFixed(4)}</span></div>`
    : `<p class="small muted">Postcard failed: ${esc((r && r.error) || 'no response')}</p>`;
}

// ------------------------------------------------------------------ Neighbors
TABS.neighbors = {
  title: 'Neighbors',
  html() {
    return `<p class="small">Everyone on this server shares one planet.</p><div id="people"></div>
      <h3>📨 Invite someone</h3>
      <div class="box small">Same wifi? Open <b>${esc(location.origin)}</b> on another phone, then Share → Add to Home Screen.</div>
      <div class="row"><button class="btn ghost" id="shareB"><svg class="ic"><use href="#i-link"/></svg>Share link</button>
      <a class="btn ghost" href="https://teamily.ai" target="_blank" rel="noopener">Open the Maple St group in Teamily</a></div>`;
  },
  live() {
    const el = $('#people');
    if (!el) return;
    const ps = Object.values(W.players).sort((a, b) => (b.seen || 0) - (a.seen || 0));
    el.innerHTML = `<h3>🏠 Live on your street (${ps.length})</h3>` + (ps.map((p) => {
      const recent = Date.now() - (p.seen || 0) < 5 * 60000;
      return `<div class="entry human"><img src="${faceURL(BUDDIES.find((b) => b.id === p.av) || BUDDIES[0], 80)}" alt=""><div>
        <b>${esc(p.name)}</b>${me && p.id === me.id ? ' (you)' : ''} <span class="chip ${recent ? 'ok' : ''}">${recent ? 'active now' : 'seen ' + new Date(p.seen).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <div class="small muted">${p.acts} actions · healed ${p.score} · ${Object.entries(p.zoneHelp || {}).map(([z, v]) => `${ZN[z]} +${Math.round(v)}`).join(' · ') || 'no help yet'}</div></div></div>`;
    }).join('') || '<p class="muted">Just you so far.</p>');
  },
  mount() {
    this.live();
    $('#shareB').onclick = async () => {
      const url = location.origin;
      if (navigator.share) navigator.share({ title: 'Impact', text: 'Heal our planet with me', url }).catch(() => {});
      else { navigator.clipboard && navigator.clipboard.writeText(url); toast('Link copied'); }
    };
  },
};

// ------------------------------------------------------------------ Play: Smog Pop (in-game action)
TABS.play = {
  title: 'Smog Pop',
  html() {
    const z = W.raid.zone;
    return `<p class="small">The Smog Baron camped a Smog Blob over <b>${ZN[z]}</b> (${Math.round(W.raid.hp)} HP). Pop puffs for 20 seconds. Games help a little; real life helps more (see Go!).</p>
      <div class="game" id="game"><div class="hudg"><span id="gT">20s</span><span id="gS">0 popped</span></div>
      <button class="btn" id="gStart" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)">Start</button></div>`;
  },
  mount() { $('#gStart').onclick = smogPop; },
};
function smogPop() {
  const box = $('#game');
  $('#gStart').remove();
  let popped = 0, left = 20;
  const spawn = () => {
    const p = document.createElement('button');
    p.className = 'puff';
    p.setAttribute('aria-label', 'smog puff');
    p.style.left = 10 + Math.random() * (box.clientWidth - 90) + 'px';
    p.style.top = 40 + Math.random() * (box.clientHeight - 100) + 'px';
    p.onpointerdown = () => { popped++; $('#gS').textContent = `${popped} popped`; p.remove(); };
    box.appendChild(p);
    setTimeout(() => p.remove(), 1400);
  };
  const sp = setInterval(spawn, 450);
  const t = setInterval(async () => {
    left--;
    $('#gT').textContent = left + 's';
    if (left > 0) return;
    clearInterval(sp); clearInterval(t);
    box.querySelectorAll('.puff').forEach((p) => p.remove());
    const zone = W.raid.zone;
    const heal = Math.min(3, Math.round(popped * 0.08 * 10) / 10);
    const act = { label: `popped ${popped} smog puffs in Smog Pop`, deltas: { [zone]: heal }, raid: popped * 40, real: false };
    if (mode === 'online') await api('api/act', { id: me.id, act });
    else { IA.human(W, me.id, act, false); receive(W); }
    box.insertAdjacentHTML('beforeend', `<div style="position:absolute;inset:0;display:grid;place-items:center;text-align:center"><div><h2>${popped} popped!</h2><p>${ZN[zone]} +${heal} · Smog Blob −${popped * 40}</p><button class="btn" onclick="this.closest('.game').querySelector('div').remove()">Nice</button></div></div>`);
  }, 1000);
}

// ------------------------------------------------------------------ Me + How Impact works
function footprint(p) {
  // very rough tonnes CO2/yr from published US averages, for conversation only
  let t = 4;
  t += { car: 4.6, transit: 1.5, walk: 0.3 }[p.move] || 2;
  t += { meat: 2.5, mixed: 1.7, plant: 1.0 }[p.eat] || 1.7;
  t += { house: 3, apartment: 1.5 }[p.home] || 2;
  return t.toFixed(1);
}
const SPONSORS = [
  ['bruin', 'Bruin', 'Pipeline feeding the agents live air data and auditing every decision'],
  ['telem', 'Telem', 'Live news the agents cite + Feed news reels'],
  ['band', 'BAND', 'Agent events posted to a real BAND room'],
  ['runware', 'Runware', 'World postcard painted from live game state'],
  ['glasser', 'Glasser', 'Real drop-off places in Bin Buddy'],
  ['llm', 'Claude (optional)', 'One-line in-character agent voice'],
];
TABS.me = {
  title: 'Me',
  html() {
    const p = me.profile || {};
    return `<div class="row"><img src="${myFace(120)}" class="big-av" alt=""><div><h2 class="hand" style="font-size:30px">${esc(me.name)}</h2>
      <div class="small muted">Footprint ≈ ${footprint(p)} t CO₂/yr (very rough, from published averages)</div></div></div>
      <div class="chips">${Object.entries(p).map(([k, v]) => `<span class="chip">${esc(k)}: ${esc(v)}</span>`).join('')}</div>
      <div class="row"><button class="btn ghost" id="quizB">Redo my profile</button>
      <button class="btn ghost" id="voiceB"><svg class="ic"><use href="#i-sound"/></svg>Agent voices: ${voiceOn ? 'on' : 'off'}</button></div>
      <h3>🔧 How Impact works</h3>
      <p class="small">Every ${Math.round(tickMs / 1000)} s each agent scores its options (goal gap × live air data × trust + seeded personality + what it learned in earlier runs) and picks the best. Your real actions heal zones; the Baron avoids zones humans are watching, and guardians ask you for help using your profile.</p>
      <div id="spons"></div>
      <h3>📏 Data honesty</h3>
      <ul class="small"><li>Air data: live Open-Meteo PM2.5, temperature, humidity for 4 LA places, through the Bruin pipeline (or a labeled snapshot).</li>
      <li>Footprint numbers are rough estimates.</li><li>Photos stay on your device and are not verified by AI.</li>
      <li>Sponsors turn green only after a real call worked on this server.</li></ul>`;
  },
  live() {
    const el = $('#spons');
    if (!el) return;
    el.innerHTML = SPONSORS.map(([k, n, what]) => {
      const h = HEALTH[k];
      const ok = h && h.ok;
      return `<div class="box" style="display:flex;gap:10px;align-items:flex-start"><span class="chip ${ok ? 'ok' : ''}" style="flex:none">${ok ? '● live' : '○ off'}</span>
        <div><b>${n}</b><div class="small">${what}</div><div class="small muted">${mode === 'online' ? esc(h ? h.detail : 'not reported') : 'offline mode'}</div></div></div>`;
    }).join('');
  },
  mount() {
    this.live();
    $('#quizB').onclick = () => quiz(0);
    $('#voiceB').onclick = () => { voiceOn = !voiceOn; store.set('voice', voiceOn); renderSheet(false); if (voiceOn) toast('Agents will speak big moments'); };
  },
};

// ------------------------------------------------------------------ onboarding
const QUIZ = [
  ['move', 'How do you usually get around?', [['car', '🚗 Car, mostly'], ['transit', '🚌 Bus or train'], ['walk', '🚲 Walk or bike']]],
  ['eat', 'What do you eat most?', [['meat', '🍔 Meat most days'], ['mixed', '🥗 A mix'], ['plant', '🌱 Mostly plants']]],
  ['waste', 'What do you throw away most?', [['bottles', '🧴 Plastic bottles'], ['takeout', '🥡 Takeout containers'], ['clothes', '👕 Clothes I stop wearing'], ['food', '🍎 Food']]],
  ['home', 'Where do you live?', [['apartment', '🏢 Apartment'], ['house', '🏠 House']]],
];
function welcome() {
  let pick = BUDDIES[0].id;
  const draw = () => {
    modal(`<h1>Impact</h1><p class="muted">heal the planet together</p>
      <img class="big-av" id="bigAv" src="${faceURL(BUDDIES.find((b) => b.id === pick), 120)}" alt="">
      <p class="small"><b>Pick your buddy</b></p>
      <div class="buddies">${BUDDIES.map((b) => `<button data-b="${b.id}" class="${b.id === pick ? 'on' : ''}"><img src="${faceURL(b, 80)}" alt="">${b.name}</button>`).join('')}</div>
      <input type="text" id="nameIn" placeholder="Your name" maxlength="20" autocomplete="nickname">
      <button class="btn wide" id="goB" style="margin-top:12px">Let's go!</button>
      <p class="small muted">5 AI agents already live here. Games heal the world a little. Real-life actions heal it more.</p>`);
    document.querySelectorAll('[data-b]').forEach((b) => (b.onclick = () => { const n = $('#nameIn').value; pick = b.dataset.b; draw(); $('#nameIn').value = n; }));
    $('#goB').onclick = () => {
      const n = $('#nameIn').value.trim() || 'Player';
      me = { id: 'u' + Math.random().toString(36).slice(2, 10), name: n, av: pick, profile: {} };
      store.set('me', me);
      setMe();
      quiz(0);
    };
  };
  draw();
}
function quiz(i) {
  if (i >= QUIZ.length) return quizDone();
  const [key, q, opts] = QUIZ[i];
  modal(`<div class="steps">${QUIZ.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div>
    <img class="big-av" src="${myFace(120)}" alt=""><h2>${q}</h2>
    <div class="opts">${opts.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join('')}</div>
    <p class="small muted">Your answers help the agents pick quests that fit your life.</p>`);
  document.querySelectorAll('[data-v]').forEach((b) => (b.onclick = () => { me.profile[key] = b.dataset.v; store.set('me', me); quiz(i + 1); }));
}
async function quizDone() {
  if (mode === 'online') await api('api/join', me);
  else if (W) { IA.join(W, me); receive(W); }
  modal(`<img class="big-av" src="${myFace(120)}" alt=""><h2>Thanks, ${esc(me.name)}!</h2>
    <p><b>Your footprint: about ${footprint(me.profile)} t CO₂/year</b> <span class="small muted">(very rough, from published averages)</span></p>
    <p class="muted">The agents now know your habits. They'll ask you for real-world help that fits your life. Tap <b>Agents</b> to see every decision they make.</p>
    <button class="btn wide" data-close>See the planet</button>`);
}
function setMe() {
  if (!me) return;
  $('#meAv').src = myFace(68);
  $('#meName').textContent = me.name;
}

// ------------------------------------------------------------------ boot
setMe();
if (!me) welcome();
else if (!me.profile || !me.profile.home) quiz(0);
connect();
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
window.addEventListener('beforeunload', () => store.set('lastVisit', Date.now()));
