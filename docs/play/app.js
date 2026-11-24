// Impact front end. One shared world from the server over SSE; falls back to running the same
// agent engine in the browser when there is no server (offline, single player).
import { createGlobe } from './globe.js';
import { faceURL } from './faces.js';
import { startSiege } from './siege.js';
import { startCatch, dexHTML, CRITTERS, critterURL, loadDex } from './catch.js';

const IA = window.ImpactAgents;
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ZN = IA.ZN;
const ZONE_ICON = { forest: '<svg class="dd" aria-hidden="true"><use href="#d-tree"/></svg>', ice: '<svg class="dd" aria-hidden="true"><use href="#d-mountain"/></svg>', desert: '<svg class="dd" aria-hidden="true"><use href="#d-cactus"/></svg>', ocean: '<svg class="dd" aria-hidden="true"><use href="#d-wave"/></svg>', space: '<svg class="dd" aria-hidden="true"><use href="#d-orbit"/></svg>' };
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
let LAN = [];
// On the laptop (localhost) a phone can't use that address, so invite with the wifi address instead.
const inviteUrl = () => (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname) && LAN[0]) || location.origin;
let online = 0;
let mode = 'connecting'; // 'online' | 'offline'
let tickMs = 10000;
let lastSeenLog = store.get('seenLog', 0);
let firstSnapshot = true;

const globe = createGlobe($('#globe'), $('#labels'), IA.AGENTS, (id) => openAgent(id));

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
    LAN = d.lan || [];
    online = d.online || 1;
    tickMs = d.tickMs || tickMs;
    receive(d.state);
  };
  es.onerror = () => { if (!opened) { clearTimeout(timer); es.close(); goOffline(); } else setNet(); };
}

// offline: the same engine runs here, on its own timer, and persists in this browser
let localMem = store.get('mem', {});
let SNAP = null;
async function loadSnap() {
  try { SNAP = await fetch('snap/snapshot.json').then((r) => (r.ok ? r.json() : null)); } catch (e) { SNAP = null; }
  if (SNAP) {
    // sponsors show as "recorded today" with what they really returned on our server
    HEALTH = Object.fromEntries(Object.entries(SNAP.health || {}).map(([k, v]) => [k, Object.assign({}, v, { snap: true })]));
  }
}
async function goOffline() {
  if (mode === 'offline') return;
  mode = 'offline';
  await loadSnap();
  let S = store.get('world', null);
  if (!S || !S.agents) S = IA.create(42, (SNAP && SNAP.spawn) || null, localMem);
  if (SNAP && SNAP.postcards && !(S.postcards || []).length) S.postcards = SNAP.postcards;
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

// ------------------------------------------------------------------ Runware voices: the characters talk out loud
const voiceQ = [];
let voiceBusy = false;
async function speak(agent, text, force) {
  if (!voiceOn && !force) return;
  // no server (GitHub Pages): play the Runware clips recorded from our live server today
  let url = null;
  if (mode !== 'online') {
    const v = (SNAP && SNAP.voices) || {};
    url = v[agent + '|' + text] || (force ? v[agent + '|intro'] : null);
    if (!url) return;
  } else if (!HEALTH.runware) return;
  voiceQ.push({ agent, text, url });
  if (voiceQ.length > 2) voiceQ.splice(0, voiceQ.length - 2); // never pile up old lines
  if (voiceBusy) return;
  voiceBusy = true;
  while (voiceQ.length) {
    const { agent: ag, text: t, url } = voiceQ.shift();
    try {
      const r = url ? { url } : await api('/api/voice', { agent: ag, text: t });
      if (r && r.url) await new Promise((ok) => { const a = new Audio(r.url); a.onended = ok; a.onerror = ok; a.play().catch(ok); setTimeout(ok, 12000); });
    } catch (e) { /* voice is a nice-to-have */ }
  }
  voiceBusy = false;
}
function setVoiceBtn() { const b = $('#voiceBtn'); if (b) { b.textContent = voiceOn ? '🔊' : '🔇'; b.setAttribute('aria-pressed', voiceOn); } }
setTimeout(() => {
  setVoiceBtn();
  const b = $('#voiceBtn');
  if (b) b.onclick = () => {
    voiceOn = !voiceOn; setVoiceBtn();
    store.set('voice', voiceOn);
    toast(voiceOn ? 'Voices on (Runware)' : 'Voices off');
    if (voiceOn) speak('mossling', "Hi friend! Let's heal the planet together!");
  };
}, 0);

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
  renderShow();
  cheerMe(S);
  renderZones();
  if (me) {
    const p = S.players[me.id];
    $('#seedN').textContent = p ? (p.seeds == null ? 10 : p.seeds) : 0;
    const alive = p && p.streakDay && (p.streakDay === new Date().toDateString() || p.streakDay === new Date(Date.now() - 864e5).toDateString());
    $('#streakN').textContent = alive ? p.streak || 0 : 0;
    $('#streakP').title = alive && p.streakDay !== new Date().toDateString() ? 'Do one real thing today to keep your streak' : 'Daily streak: do one real thing every day';
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
  $("#netT").textContent = mode === "online" ? (innerWidth < 440 ? `${online}` : `${online} online`) : mode === 'offline' ? 'solo' : '…';
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
  if (!voiceOn || spoken.size === fresh.length) return;
  const big = fresh.filter((e) => ['betray', 'quest', 'end', 'thank'].includes(e.k) && IA.AG[e.agent]).slice(-1)[0];
  if (!big) return;
  const def = IA.AG[big.agent];
  // real character voices from Runware; the browser's speech is only a fallback
  if (HEALTH.runware && HEALTH.runware.ok) return speak(big.agent, big.say || `${def.name} ${big.act}`);
  if (!('speechSynthesis' in window)) return;
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
  const pick = (k) => missed.filter((e) => e.k === k).slice(-2);
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
  document.body.classList.add('modal-open');
  $('#show').hidden = true;
  m.querySelectorAll('[data-close]').forEach((b) => (b.onclick = closeModal));
}
function closeModal() { $('#modal').hidden = true; document.body.classList.remove('modal-open'); setTimeout(renderShow, 0); }

let openTab = null;
const LIVE_TABS = new Set(['agents', 'neighbors', 'go', 'today']);
const TABS = {};
function openSheet(tab) {
  openTab = tab;
  document.body.classList.toggle('covered', !!tab);
  setTimeout(renderShow, 0);
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
document.querySelectorAll('#tabbar button').forEach((b) => (b.onclick = () => (b.dataset.tab === 'log' ? composer() : openSheet(b.dataset.tab === 'globe' ? null : b.dataset.tab))));
$('#agentsBtn').onclick = () => openSheet('agents');
$('#net').onclick = () => openSheet('neighbors');
$('#meBtn').onclick = () => openSheet('me');
document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#modal').hidden) closeModal(); else openSheet(null); } });

// ------------------------------------------------------------------ Agents panel
let logFilter = 'all';
const FILTERS = { all: 'All', council: 'Council', social: 'Ally · trade · betray', fight: 'Fights', quest: 'Quests', human: 'Humans', learn: 'Learning' };
function filterLog(e) {
  if (logFilter === 'all') return true;
  if (logFilter === 'social') return ['ally', 'trade', 'betray'].includes(e.k);
  return e.k === logFilter;
}
function avatarFor(e) {
  if (IA.AG[e.agent]) return `<img src="${faceURL(IA.AG[e.agent], 80)}" alt="">`;
  if (e.agent === 'human') {
    const p = W.players[e.who];
    return p ? `<img src="${faceURL(BUDDIES.find((b) => b.id === p.av) || BUDDIES[0], 80)}" alt="">` : '<span class="hicon"><svg class="dd" aria-hidden="true"><use href="#d-smile"/></svg></span>';
  }
  return '<span class="hicon"><svg class="dd" aria-hidden="true"><use href="#d-planet"/></svg></span>';
}
function entryHTML(e) {
  const chips = [];
  for (const s of e.src || []) {
    if (/^Telem/.test(s)) chips.push(`<a class="chip" href="${esc(e.url)}" target="_blank" rel="noopener">${esc(s)}</a>`);
    else chips.push(`<span class="chip ${/^Bruin/.test(s) ? 'ok' : ''}">${esc(s)}</span>`);
  }
  if (e.band) chips.push('<span class="chip gold">posted to BAND</span>');
  if (e.postcard) chips.push(`<a class="chip ok" href="${esc(e.postcard)}" target="_blank" rel="noopener">Runware postcard</a>`);
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
      <div class="small"><svg class="dd" aria-hidden="true"><use href="#d-bolt"/></svg> ${a.energy} · <svg class="dd" aria-hidden="true"><use href="#d-sprout"/></svg> ${a.seeds} seeds</div>
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
  title: 'Story',
  html() {
    return `<div id="story"></div>
      <details class="receipts"><summary>Every decision, with reasons and sources (for the curious and the judges)</summary>
      <div class="chips"><span class="chip">${mode === 'online' ? 'Live · shared world' : 'Offline · agents run in this browser'}</span>
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
      <h3><svg class="dd" aria-hidden="true"><use href="#d-book"/></svg> Decision log</h3>
      <div class="filter" id="filters">${Object.entries(FILTERS).map(([k, v]) => `<button data-f="${k}" class="${k === logFilter ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="log" id="log"></div></details>`;
  },
  live() {
    $('#story').innerHTML = storyHTML();
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
  out.innerHTML = `<h3><svg class="dd" aria-hidden="true"><use href="#d-receipt"/></svg> Agent audit</h3><div class="chips"><span class="chip ${rep.bruin ? 'ok' : ''}">Source: ${esc(rep.source)}</span></div>
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
  out.innerHTML = `<h3><svg class="dd" aria-hidden="true"><use href="#d-dice"/></svg> Same agents, two seeds</h3><div class="twice">${sims.map((r) => `<div>
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
      <button class="hunt-card" id="huntB"><span class="hunt-emoji"><svg class="dd" aria-hidden="true"><use href="#d-map"/></svg></span><span><b>Litter Hunt</b><small>Walk 150 m, bin the litter you find, snap a photo. Ripplet cleans the ocean for every piece.</small></span><span class="btn">Start</span></button>
      <h3><svg class="dd" aria-hidden="true"><use href="#d-planet"/></svg> Do something real</h3>
      <div class="acts">${ACTIONS.map((a) => `<button class="act" data-a="${a.id}"><b>${a.label}</b><small>${a.tip}</small></button>`).join('')}</div>
      <h3><svg class="dd" aria-hidden="true"><use href="#d-recycle"/></svg> Bin Buddy</h3>
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
    el.innerHTML = qs.length ? '<h3><svg class="dd" aria-hidden="true"><use href="#d-star"/></svg> Quests for you</h3>' + qs.map((q) => `<div class="quest-card"><img src="${faceURL(IA.AG[q.from], 96)}" alt="">
      <div><b>${esc(IA.AG[q.from].name)}:</b> ${esc(q.text)}<div class="small muted">${esc(q.line)}</div>
      <button class="btn" style="margin-top:6px;min-height:38px;padding:8px 14px" data-q="${esc(q.kind)}">I did it</button></div></div>`).join('') : '';
    el.querySelectorAll('[data-q]').forEach((b) => (b.onclick = () => doQuest(b.dataset.q)));
  },
  mount() {
    this.live();
    document.querySelectorAll('.act').forEach((b) => (b.onclick = () => doAction(b.dataset.a)));
    $('#huntB').onclick = litterHunt;
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
       ${glasser ? '<button class="btn ghost" id="placesB" style="margin-top:8px">Drop-off places near me</button>' : ''}
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
  html() { return '<div id="news"></div><div id="pc"></div><h3><svg class="dd" aria-hidden="true"><use href="#d-street"/></svg> On your street</h3><div id="street"></div>'; },
  async mount() {
    const street = W.log.filter((e) => ['human', 'quest', 'thank', 'betray', 'end'].includes(e.k)).slice(-25).reverse();
    $('#street').innerHTML = street.map((e) => `<div class="post"><div class="tag">${e.agent === 'human' ? 'Neighbor' : esc(name(e.agent))} · ${new Date(e.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>
      <h4>${esc(e.act)}</h4><div class="small muted">${esc(e.why)}</div></div>`).join('') || '<p class="muted">Nothing yet. Do something real in Go!</p>';
    const pcBtn = mode === 'online' && HEALTH.runware && (HEALTH.runware.ok || /key set/.test(HEALTH.runware.detail || ''));
    const cards = (W.postcards || []).slice().reverse();
    const gallery = cards.length ? `<div class="post postcard"><div class="tag">Run postcards · painted by Runware from each run's final planet</div>${cards.map((c) => `<figure style="margin:8px 0"><img src="${esc(c.url)}" alt="Postcard of run ${c.seed}" loading="lazy"><figcaption class="small">Run ${c.seed}: ${c.status === 'won' ? 'guardians + humans won' : 'the Smog Baron won'}${c.cost != null ? ` · $${(+c.cost).toFixed(4)}` : ''}</figcaption></figure>`).join('')}</div>` : '';
    $('#pc').innerHTML = gallery + (pcBtn ? '<div class="post postcard"><div class="tag">Your world · painted live by Runware</div><button class="btn" id="pcB" style="margin-top:6px">Make my world postcard</button><div id="pcOut"></div></div>' : '');
    if (pcBtn) $('#pcB').onclick = postcard;
    if (mode !== 'online' && SNAP) {
      // GitHub Pages: show what Telem and BAND really returned on our live server today
      $('#news').innerHTML = `<h3>Powered by our sponsors</h3>${sponsorStrip()}`
        + (SNAP.news || []).map((n) => `<div class="post news"><div class="tag">Telem · captured today · ${esc(n.source)}</div>
        <h4><a href="${esc(n.url)}" target="_blank" rel="noopener">${esc(n.title)}</a></h4><div class="small muted">${esc(n.summary)}</div></div>`).join('');
      $('#news').insertAdjacentHTML('beforeend', (SNAP.band || []).map((b) => `<div class="post band"><div class="tag">Posted to our BAND room today · ${esc(name(b.agent))}</div><h4>${esc(b.act)}</h4><div class="small muted">Why: ${esc(b.why)}</div></div>`).join(''));
      return;
    }
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
      <h3>Powered live by</h3>${sponsorStrip()}
      <h3><svg class="dd" aria-hidden="true"><use href="#d-mail"/></svg> Invite someone</h3>
      <div class="box small">Same wifi? Open <b>${esc(inviteUrl())}</b> on another phone, then Share → Add to Home Screen.</div>
      <div class="row"><button class="btn ghost" id="shareB"><svg class="ic"><use href="#i-link"/></svg>Share link</button>
      <a class="btn ghost" href="https://teamily.ai" target="_blank" rel="noopener">Open the Maple St group in Teamily</a></div>
      <h3><svg class="dd" aria-hidden="true"><use href="#d-chat"/></svg> The street's BAND room</h3>
      <div class="box small">${HEALTH.band && HEALTH.band.ok
        ? `The agents post their alliances, betrayals and council meetings into the BAND room, and you can steer them from there. Mention <b>Impact World</b> with <b>status</b>, <b>rally ocean</b> (or forest, ice, desert, space), <b>budget</b> or <b>report</b>. A rally changes the planet for everyone. <div class="muted" style="margin-top:4px">${esc(HEALTH.band.detail)}</div>`
        : 'BAND is not connected on this server yet.'}</div>
      <a class="btn ghost" href="https://app.band.ai" target="_blank" rel="noopener">Open BAND</a>`;
  },
  live() {
    const el = $('#people');
    if (!el) return;
    const ps = Object.values(W.players).sort((a, b) => (b.seen || 0) - (a.seen || 0));
    const hunters = ps.filter((p) => p.hunt && p.hunt.hunts).sort((a, b) => (b.hunt.pieces * 50 + b.hunt.meters) - (a.hunt.pieces * 50 + a.hunt.meters));
    const board = hunters.length ? `<h3><svg class="dd" aria-hidden="true"><use href="#d-map"/></svg> Top Litter Hunters</h3>` + hunters.slice(0, 5).map((p, i) => `<div class="li"><span>${['<svg class="dd" style="color:#f6c453" aria-hidden="true"><use href="#d-medal"/></svg>', '<svg class="dd" style="color:#c9d3e6" aria-hidden="true"><use href="#d-medal"/></svg>', '<svg class="dd" style="color:#e8a878" aria-hidden="true"><use href="#d-medal"/></svg>'][i] || '·'} ${esc(p.name)}${me && p.id === me.id ? ' (you)' : ''}<small>${p.hunt.hunts} hunt${p.hunt.hunts === 1 ? '' : 's'} · ${p.hunt.meters} m walked (GPS)${p.streak ? ` · <svg class="dd" aria-hidden="true"><use href="#d-flame"/></svg> ${p.streak}-day streak` : ''}</small></span><b>${p.hunt.pieces} pcs</b></div>`).join('') : '';
    el.innerHTML = board + `<h3><svg class="dd" aria-hidden="true"><use href="#d-house"/></svg> Live on your street (${ps.length})</h3>` + (ps.map((p) => {
      const recent = Date.now() - (p.seen || 0) < 5 * 60000;
      return `<div class="entry human"><img src="${faceURL(BUDDIES.find((b) => b.id === p.av) || BUDDIES[0], 80)}" alt=""><div>
        <b>${esc(p.name)}</b>${me && p.id === me.id ? ' (you)' : ''} <span class="chip ${recent ? 'ok' : ''}">${recent ? 'active now' : 'seen ' + new Date(p.seen).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
        <div class="small muted">${p.acts} actions · healed ${p.score} · ${Object.entries(p.zoneHelp || {}).map(([z, v]) => `${ZN[z]} +${Math.round(v)}`).join(' · ') || 'no help yet'}</div>
        ${ledToday(p) ? `<div class="small"><b>Today (real log):</b> travel ${p.led.travel.toFixed(1)} kg CO₂e · water ${Math.round(p.led.water)} L · ${p.led.stuff} items</div>` : ''}</div></div>`;
    }).join('') || '<p class="muted">Just you so far.</p>');
  },
  mount() {
    this.live();
    $('#shareB').onclick = async () => {
      const url = inviteUrl();
      if (navigator.share) navigator.share({ title: 'Impact', text: 'Heal our planet with me', url }).catch(() => {});
      else { navigator.clipboard && navigator.clipboard.writeText(url); toast('Link copied'); }
    };
  },
};

// ------------------------------------------------------------------ live sponsor strip (green only after a real call worked)
const SPONSOR_ROLES = [
  ['bruin', 'Bruin', 'live air data → agent decisions + audit'],
  ['band', 'BAND', 'agents post to a real chat room; rally from it'],
  ['telem', 'Telem', 'today\'s real news moves the agents'],
  ['runware', 'Runware', 'character voices + story postcards'],
];
function sponsorStrip() {
  return `<div class="sstrip">${SPONSOR_ROLES.map(([k, n, what]) => {
    const ok = HEALTH[k] && HEALTH[k].ok, snap = HEALTH[k] && HEALTH[k].snap;
    return `<span class="sp ${ok ? 'ok' : ''}" title="${esc(what)}"><i></i><b>${n}</b><small>${esc(what)}${snap ? ' · recorded live today' : ''}</small></span>`;
  }).join('')}</div>`;
}

// ------------------------------------------------------------------ Games hub
TABS.games = {
  title: 'Games',
  html() {
    const d = loadDex(), caught = Object.values(d).reduce((x, y) => x + y, 0);
    const game = (id, art, tag, title, what, btn, cls = '') => `<article class="gm ${cls}" id="${id}" role="button" tabindex="0">
      <div class="gm-art" style="background-image:url(art/${art}.jpg)"><span class="gm-tag">${tag}</span></div>
      <div class="gm-body"><h3>${title}</h3><p>${what}</p><span class="btn">${btn}</span></div></article>`;
    return `<p class="gm-intro">Pick a game. Every game heals the shared planet. The real-world ones also earn seeds.</p>
      ${game('gSiege', 'siege', 'Main game · 3D', 'Smog Siege', 'Smog bombs are falling on the planet. Tap them before they land. Your guardians help. Beat the Baron boss.', 'Play', 'main')}
      ${game('gCatch', 'catch', 'Real world', 'Trash Catch', `Catch cute litter monsters with your camera, then bin a real piece for seeds. Trashdex: ${caught} caught.`, 'Catch')}
      <div class="gm-row">
        ${game('gDash', 'dash', 'Quick · 45 s', 'Trash Dash', 'Catch falling trash with Ripplet. Dodge bombs.', 'Play', 'mini')}
        ${game('gDuel', 'duel', 'Quick · 3 rounds', 'Baron Duel', 'Leaf, Wave, Fire vs the Baron.', 'Play', 'mini')}
      </div>
      <div class="gm-links"><button class="btn ghost" id="gDex">My Trashdex</button><button class="btn ghost" id="gHunt">Litter Hunt walk</button></div>
      <p class="small muted gm-credit">Game art painted by Runware · voices by Runware</p>`;
  },
  mount() {
    const on = (id, fn) => { const el = $('#' + id); if (!el) return; el.onclick = fn; el.onkeydown = (e) => { if (e.key === 'Enter') fn(); }; };
    on('gSiege', playSiege);
    on('gCatch', playCatch);
    on('gDash', () => openSheet('dash'));
    on('gDuel', () => openSheet('duel'));
    on('gDex', () => openSheet('dex'));
    on('gHunt', litterHunt);
  },
};

// ------------------------------------------------------------------ Trash Catch + Trashdex (public/catch.js)
function playCatch() {
  openSheet(null);
  startCatch({
    speak,
    onCatch: async (c, pts) => {
      if (me && mode === 'online') await api('api/act', { id: me.id, act: { label: `caught a ${c.name} in Trash Catch`, deltas: { ocean: 0.5 }, raid: pts, real: false } });
      confetti();
    },
    onReal: () => doAction('litter'),
  });
}
TABS.dex = {
  title: 'Trashdex',
  html() {
    return `<button class="feature hunt" id="dxGo"><span class="f-tag">go catch</span><b>Trash Catch</b><small>Open your camera, find doodle litter critters, flick the bin. 3 of a kind evolves.</small><span class="btn big">Catch</span></button>
      ${dexHTML()}
      <h3>Real hunt</h3>
      <button class="gcard" id="dxHunt"><span><b>Litter Hunt walk</b><small>Walk 150 m with GPS, bin real litter, snap proof. Heals the ocean and earns seeds.</small></span><em>real life · seeds</em></button>`;
  },
  mount() { $('#dxGo').onclick = playCatch; $('#dxHunt').onclick = litterHunt; },
};

// ------------------------------------------------------------------ Smog Siege (3D flagship, public/siege.js)
function playSiege() {
  openSheet(null);
  startSiege({
    agents: IA.AGENTS,
    speak,
    onEnd: async (score, wave) => {
      const heal = Math.min(5, Math.round(score / 150));
      if (heal > 0 && me && mode === 'online') await api('api/act', { id: me.id, act: { label: `defended the planet in Smog Siege (wave ${wave}, ${score} points)`, deltas: { forest: heal, ocean: heal }, raid: score, real: false } });
      if (score >= 300) confetti();
    },
  });
}

// ------------------------------------------------------------------ Trash Dash: real-time co-op arcade game
// You and an AI teammate (Ripplet) catch falling litter. The Smog Baron flies overhead dropping smog bombs.
// Ripplet is an agent: it chases the most valuable item on its half and calls out combos.
TABS.dash = {
  title: 'Trash Dash',
  html() {
    let best = 0; try { best = +localStorage.getItem('impact.dashBest') || 0; } catch (e) { /* ignore */ }
    return `<div class="dash" id="dash"><canvas id="dashC"></canvas>
      <div class="dash-hud"><span id="dScore">0</span><span id="dHearts">❤️❤️❤️</span><span id="dTime">45s</span></div>
      <div class="dash-start" id="dStart"><img src="${faceURL(IA.AG.ripplet, 96)}" alt=""><h2>Trash Dash</h2>
        <p>Drag to move. Catch litter 🥤🥫🛍️ with Ripplet. Golden seeds 🌟 are worth 5. Dodge the Baron's smog bombs 💣.</p>
        <button class="btn big" id="dGo">Play</button><p class="small muted">Best: ${best}</p></div></div>`;
  },
  mount() { $('#dGo').onclick = dashRun; },
};
function dashRun() {
  const wrap = $('#dash'), cv = $('#dashC'), ctx = cv.getContext('2d');
  $('#dStart').hidden = true;
  const dpr = Math.min(2, devicePixelRatio || 1);
  const W2 = wrap.clientWidth, H2 = wrap.clientHeight;
  cv.width = W2 * dpr; cv.height = H2 * dpr; cv.style.width = W2 + 'px'; cv.style.height = H2 + 'px';
  ctx.scale(dpr, dpr);
  const img = (d) => { const i = new Image(); i.src = faceURL(d, 96); return i; };
  const meImg = new Image(); meImg.src = myFace(96);
  const rip = img(IA.AG.ripplet), bar = img(IA.AG.baron);
  const LITTER = ['🥤', '🥫', '🛍️', '🧴', '📦', '🍾'];
  const P = { x: W2 * 0.3, w: 70 }, A = { x: W2 * 0.7, w: 70, say: '', sayT: 0 };
  const baron = { x: W2 / 2, dir: 1 };
  let items = [], parts = [], score = 0, hearts = 3, combo = 0, left = 45, t0 = performance.now(), last = t0, spawnT = 0, bombT = 0, over = false, mateCatches = 0;
  const say = (s) => { A.say = s; A.sayT = performance.now() + 1600; };
  const move = (e) => { const r = cv.getBoundingClientRect(); P.x = Math.max(P.w / 2, Math.min(W2 - P.w / 2, (e.touches ? e.touches[0].clientX : e.clientX) - r.left)); };
  cv.addEventListener('pointermove', move); cv.addEventListener('pointerdown', move);
  cv.addEventListener('touchmove', (e) => { e.preventDefault(); move(e); }, { passive: false });
  speak('ripplet', "Let's go! I'll take the right side!");
  const burst = (x, y, col) => { for (let i = 0; i < 10; i++) parts.push({ x, y, vx: (Math.random() - 0.5) * 4, vy: -Math.random() * 4, life: 1, col }); };
  const catcher = (c, it) => Math.abs(it.x - c.x) < c.w / 2 + 14 && it.y > H2 - 92 && it.y < H2 - 40;
  function frame(now) {
    if (over) return;
    if (!document.body.contains(cv)) { over = true; return; } // player left the game screen
    const dt = Math.min(0.08, (now - last) / 1000); last = now;
    left = Math.max(0, 45 - (now - t0) / 1000);
    const speed = 1 + (45 - left) / 30; // it gets faster
    // spawn
    spawnT -= dt; bombT -= dt;
    if (spawnT <= 0) { spawnT = 0.55 / speed; const gold = Math.random() < 0.08; items.push({ x: 20 + Math.random() * (W2 - 40), y: -20, v: (90 + Math.random() * 60) * speed, e: gold ? '🌟' : LITTER[Math.floor(Math.random() * LITTER.length)], k: gold ? 'gold' : 'trash' }); }
    if (bombT <= 0) { bombT = 1.6 / speed; items.push({ x: baron.x, y: 50, v: 140 * speed, e: '💣', k: 'bomb' }); }
    baron.x += baron.dir * 120 * speed * dt; if (baron.x < 40 || baron.x > W2 - 40) baron.dir *= -1;
    // AI teammate: chase the best reachable item on the right half, never a bomb
    const mine = items.filter((it) => it.k !== 'bomb' && it.x > W2 * 0.45 && it.y < H2 - 60).sort((a, b) => (b.k === 'gold') - (a.k === 'gold') || b.y - a.y)[0];
    const bomb = items.find((it) => it.k === 'bomb' && Math.abs(it.x - A.x) < 50 && it.y > H2 - 200);
    let target = mine ? mine.x : W2 * 0.72;
    if (bomb) target = A.x + (A.x > bomb.x ? 80 : -80);
    A.x += Math.max(-260 * dt, Math.min(260 * dt, target - A.x)); A.x = Math.max(W2 * 0.4, Math.min(W2 - A.w / 2, A.x));
    // physics + catches
    for (const it of items) {
      it.y += it.v * dt;
      for (const [c, who] of [[P, 'me'], [A, 'mate']]) {
        if (it.dead || !catcher(c, it)) continue;
        it.dead = true;
        if (it.k === 'bomb') {
          if (who === 'me') { hearts--; combo = 0; burst(it.x, it.y, '#6d5f86'); if (navigator.vibrate) navigator.vibrate(120); globe.say('baron', 'Gotcha!'); }
          else { say('Ow! Smog!'); burst(it.x, it.y, '#6d5f86'); score = Math.max(0, score - 3); }
        } else {
          const pts = it.k === 'gold' ? 5 : 1;
          if (who === 'me') { combo++; score += pts * (combo >= 10 ? 3 : combo >= 5 ? 2 : 1); if (combo === 5) say('Combo x2! 🔥'); if (combo === 10) { say('x3!! Unstoppable!'); speak('ripplet', 'Triple combo! You are amazing!'); } }
          else { score += pts; mateCatches++; if (mateCatches % 6 === 0) say(['Got it!', 'Teamwork!', 'Ocean says thanks!'][mateCatches % 3]); }
          burst(it.x, it.y, it.k === 'gold' ? '#ffd34d' : '#7fd36a');
        }
      }
      if (!it.dead && it.y > H2 + 20) { it.dead = true; if (it.k !== 'bomb') combo = 0; }
    }
    items = items.filter((i) => !i.dead);
    // draw: sea-to-sky background
    const g = ctx.createLinearGradient(0, 0, 0, H2); g.addColorStop(0, '#2c2f6e'); g.addColorStop(0.6, '#5a8fd8'); g.addColorStop(1, '#8ee3ff');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W2, H2);
    ctx.fillStyle = '#3fb2ff'; ctx.beginPath(); ctx.moveTo(0, H2 - 34);
    for (let x = 0; x <= W2; x += 20) ctx.lineTo(x, H2 - 34 + Math.sin(x / 30 + now / 300) * 5);
    ctx.lineTo(W2, H2); ctx.lineTo(0, H2); ctx.fill();
    ctx.drawImage(bar, baron.x - 28, 6, 56, 56);
    ctx.font = '30px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const it of items) ctx.fillText(it.e, it.x, it.y);
    for (const [c, im] of [[P, meImg], [A, rip]]) {
      ctx.fillStyle = 'rgba(255,255,255,.9)'; ctx.strokeStyle = '#2b2a26'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.roundRect(c.x - c.w / 2, H2 - 64, c.w, 26, 12); ctx.fill(); ctx.stroke();
      ctx.drawImage(im, c.x - 24, H2 - 112, 48, 48);
    }
    if (performance.now() < A.sayT) { ctx.font = '700 14px Nunito, system-ui'; const w = ctx.measureText(A.say).width + 18; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.roundRect(A.x - w / 2, H2 - 150, w, 28, 12); ctx.fill(); ctx.stroke(); ctx.fillStyle = '#2b2a26'; ctx.fillText(A.say, A.x, H2 - 136); }
    for (const p of parts) { p.x += p.vx; p.y += p.vy; p.vy += 0.2; p.life -= dt * 1.8; ctx.globalAlpha = Math.max(0, p.life); ctx.fillStyle = p.col; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, 7); ctx.fill(); }
    ctx.globalAlpha = 1; parts = parts.filter((p) => p.life > 0);
    $('#dScore').textContent = `${score}${combo >= 5 ? ` · x${combo >= 10 ? 3 : 2}` : ''}`;
    $('#dHearts').textContent = '❤️'.repeat(Math.max(0, hearts)) + '🖤'.repeat(3 - Math.max(0, hearts));
    $('#dTime').textContent = Math.ceil(left) + 's';
    if (left <= 0 || hearts <= 0) return dashEnd(score, hearts > 0);
    requestAnimationFrame(frame);
  }
  async function dashEnd(sc, survived) {
    over = true;
    let best = 0; try { best = +localStorage.getItem('impact.dashBest') || 0; if (sc > best) localStorage.setItem('impact.dashBest', sc); } catch (e) { /* ignore */ }
    const heal = Math.min(4, Math.round(sc / 12));
    if (heal > 0 && mode === 'online') await api('api/act', { id: me.id, act: { label: `scored ${sc} in Trash Dash with Ripplet`, deltas: { ocean: heal }, raid: sc * 5, real: false } });
    if (sc >= 20) confetti();
    speak('ripplet', sc >= 20 ? 'Wow! The ocean is sparkling!' : 'Good try! Again?');
    const st = $('#dStart'); st.hidden = false;
    st.innerHTML = `<img src="${faceURL(IA.AG.ripplet, 96)}" alt=""><h2>${survived ? 'Time!' : 'Smogged!'} ${sc} points</h2>
      <p>${sc > best ? '🏆 New best! ' : ''}Ocean +${heal} for everyone on the street.</p><button class="btn big" id="dGo">Play again</button>`;
    $('#dGo').onclick = () => renderSheet(false);
  }
  requestAnimationFrame(frame);
}

// ------------------------------------------------------------------ Baron Duel: co-op Leaf/Wave/Fire with an AI teammate
// Leaf drinks Wave, Wave puts out Fire, Fire burns Leaf. The Baron is an agent that learns: he counters the move you
// play most. Your teammate is an agent too: it reads the Baron's pattern out loud and picks its own move.
const MOVES = { leaf: '🌱', wave: '💧', fire: '🔥' };
const BEATS = { leaf: 'wave', wave: 'fire', fire: 'leaf' };
const COUNTER = { wave: 'leaf', fire: 'wave', leaf: 'fire' }; // COUNTER[x] beats x
const MNAME = { leaf: 'Leaf', wave: 'Wave', fire: 'Fire' };
let duel = null;
function duelNew() {
  const weak = IA.ZONES.filter((z) => z !== 'space').sort((a, b) => W.H[a] - W.H[b])[0];
  const mate = IA.AGENTS.find((x) => x.type === 'guardian' && x.goal === weak) || IA.AG.mossling;
  duel = { round: 1, team: 0, baron: 0, mine: [], baronMoves: [], mate, zone: weak, log: [], done: false };
}
function baronPick() {
  // count what the humans played; counter the favourite (with a little randomness so he can be read)
  const c = { leaf: 0, wave: 0, fire: 0 };
  duel.mine.forEach((m) => c[m]++);
  const fav = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
  if (!duel.mine.length || Math.random() < 0.3) return Object.keys(MOVES)[Math.floor(Math.random() * 3)];
  return COUNTER[fav];
}
function mateAdvice() {
  if (!duel.baronMoves.length) return { move: 'leaf', why: 'No idea yet what he likes. I\'ll start with Leaf!' };
  const c = { leaf: 0, wave: 0, fire: 0 };
  duel.mine.forEach((m) => c[m]++);
  const fav = Object.keys(c).sort((a, b) => c[b] - c[a])[0];
  const predict = COUNTER[fav]; // the Baron will counter your favourite
  return { move: COUNTER[predict], why: `He keeps countering your ${MNAME[fav]}. I bet he plays ${MNAME[predict]}, so I'm going ${MNAME[COUNTER[predict]]}!` };
}
TABS.duel = {
  title: 'Baron Duel',
  html() {
    if (!duel || duel.done && duel.fresh) duelNew();
    const adv = mateAdvice();
    duel.adv = adv;
    const res = (a, b) => (BEATS[a] === b ? 'win' : BEATS[b] === a ? 'lose' : 'tie');
    return `<div class="duel">
      <div class="duel-score"><span><img src="${myFace(64)}" alt=""><img src="${faceURL(duel.mate, 64)}" alt=""><b>${duel.team}</b></span><i>Round ${Math.min(3, duel.round)} of 3</i><span><b>${duel.baron}</b><img src="${faceURL(IA.AG.baron, 64)}" alt=""></span></div>
      ${duel.done
        ? `<div class="duel-end ${duel.team > duel.baron ? 'good' : 'bad'}"><h2>${duel.team > duel.baron ? 'You beat the Baron!' : duel.team === duel.baron ? 'A draw!' : 'The Baron wins this one'}</h2>
            <p>${duel.team > duel.baron ? `${ZN[duel.zone]} +2 for everyone on the street.` : 'He\'s learning your moves. Mix it up next time!'}</p>
            <button class="btn" id="dAgain">Play again</button></div>`
        : `<div class="duel-mate"><img src="${faceURL(duel.mate, 64)}" alt=""><p><b>${duel.mate.name}:</b> “${esc(adv.why)}”</p></div>
           <p class="small muted" style="text-align:center">Leaf drinks Wave · Wave puts out Fire · Fire burns Leaf</p>
           <div class="duel-moves">${Object.keys(MOVES).map((m) => `<button class="mv" data-mv="${m}"><span>${MOVES[m]}</span>${MNAME[m]}</button>`).join('')}</div>`}
      <div class="duel-log">${duel.log.slice().reverse().map((l) => `<div class="dl ${l.cls}">${l.html}</div>`).join('')}</div>
    </div>`;
  },
  mount() {
    if (duel && duel.round === 1 && !duel.log.length) speak('baron', 'Ah, a little duel. I will learn every move you make.');
    document.querySelectorAll('#sheetB [data-mv]').forEach((b) => (b.onclick = () => duelPlay(b.dataset.mv)));
    const again = $('#dAgain');
    if (again) again.onclick = () => { duelNew(); renderSheet(false); };
  },
};
async function duelPlay(mine) {
  if (!duel || duel.done) return;
  const bm = baronPick();
  const mm = duel.adv.move;
  const out = (a) => (BEATS[a] === bm ? 1 : BEATS[bm] === a ? -1 : 0);
  const you = out(mine), mate = out(mm);
  const pts = you + mate;
  if (pts > 0) duel.team++; else if (pts < 0) duel.baron++;
  duel.mine.push(mine); duel.baronMoves.push(bm);
  const w = (r) => (r > 0 ? 'beat' : r < 0 ? 'lost to' : 'tied');
  duel.log.push({ cls: pts > 0 ? 'good' : pts < 0 ? 'bad' : '', html: `R${duel.round}: you ${MOVES[mine]} ${w(you)} · ${esc(duel.mate.name)} ${MOVES[mm]} ${w(mate)} · Baron ${MOVES[bm]} → <b>${pts > 0 ? 'team point' : pts < 0 ? 'Baron point' : 'no point'}</b>` });
  if (pts > 0) { globe.say(duel.mate.id, 'Teamwork!!'); speak(duel.mate.id, 'Yes! Teamwork!'); }
  else if (pts < 0) { globe.say('baron', 'Predictable!'); speak('baron', 'Predictable. So very predictable.'); }
  duel.round++;
  if (duel.round > 3 || duel.team === 2 || duel.baron === 2) {
    duel.done = true;
    if (duel.team > duel.baron) {
      confetti();
      const act = { label: `beat the Smog Baron in a Baron Duel with ${duel.mate.name}`, deltas: { [duel.zone]: 2 }, raid: 40, real: false };
      if (mode === 'online') await api('api/act', { id: me.id, act });
    }
  }
  renderSheet(false);
}

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
  ['bruin', 'Bruin', "Recomputes everyone's carbon ledger, feeds the agents live air data, audits every agent decision"],
  ['band', 'BAND', "The street's group chat: agents post alliances, betrayals and council meetings; humans @mention Impact World to steer the planet"],
  ['telem', 'Telem', "Today's real news per zone changes what the agents do (and is cited with a link)"],
  ['runware', 'Runware', 'Every run ends with a storybook postcard of the final planet, shared in the Feed and the BAND room'],
  ['llm', 'Gemini', 'Reads receipts and bills (extraction only) + agent voice lines'],
  ['glasser', 'Glasser', 'Real drop-off places in Bin Buddy'],
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
      <details class="receipts"><summary>How Impact works (for judges): sponsors, data, honesty</summary>
      <h3>How Impact works</h3>
      <p class="small">Every ${Math.round(tickMs / 1000)} s each agent scores its options (goal gap × live air data × trust + seeded personality + what it learned in earlier runs) and picks the best. Your real actions heal zones; the Baron avoids zones humans are watching, and guardians ask you for help using your profile.</p>
      <div id="spons"></div>
      <h3><svg class="dd" aria-hidden="true"><use href="#d-ruler"/></svg> Data honesty</h3>
      <ul class="small"><li>Air data: live Open-Meteo PM2.5, temperature, humidity for 4 LA places, through the Bruin pipeline (or a labeled snapshot).</li>
      <li>Footprint numbers are rough estimates.</li><li>Photos stay on your device and are not verified by AI.</li>
      <li>Sponsors turn green only after a real call worked on this server.</li></ul></details>`;
  },
  live() {
    const el = $('#spons');
    if (!el) return;
    el.innerHTML = SPONSORS.filter(([k]) => k !== 'glasser' || (HEALTH.glasser && HEALTH.glasser.ok)).map(([k, n, what]) => {
      const h = HEALTH[k];
      const ok = h && h.ok;
      return `<div class="box" style="display:flex;gap:10px;align-items:flex-start"><span class="chip ${ok ? 'ok' : ''}" style="flex:none">${ok ? '● live' : '○ off'}</span>
        <div><b>${n}</b><div class="small">${what}</div><div class="small muted">${mode === 'online' ? esc(h ? h.detail : 'not reported') : 'offline mode'}</div></div></div>`;
    }).join('');
  },
  mount() {
    this.live();
    $('#quizB').onclick = () => quiz(0);
    $('#voiceB').onclick = () => { voiceOn = !voiceOn; store.set('voice', voiceOn); setVoiceBtn(); renderSheet(false); if (voiceOn) toast('Agents will speak big moments'); };
  },
};

// ------------------------------------------------------------------ onboarding
const QUIZ = [
  ['move', 'How do you usually get around?', [['car', '<svg class="dd" aria-hidden="true"><use href="#d-car"/></svg> Car, mostly'], ['transit', '<svg class="dd" aria-hidden="true"><use href="#d-bus"/></svg> Bus or train'], ['walk', '<svg class="dd" aria-hidden="true"><use href="#d-bike"/></svg> Walk or bike']]],
  ['waste', 'What do you throw away most?', [['bottles', '<svg class="dd" aria-hidden="true"><use href="#d-bottle"/></svg> Plastic bottles'], ['takeout', '<svg class="dd" aria-hidden="true"><use href="#d-takeout"/></svg> Takeout containers'], ['clothes', '<svg class="dd" aria-hidden="true"><use href="#d-shirt"/></svg> Clothes I stop wearing'], ['food', '<svg class="dd" aria-hidden="true"><use href="#d-apple"/></svg> Food']]],
  ['home', 'Where do you live?', [['apartment', '<svg class="dd" aria-hidden="true"><use href="#d-office"/></svg> Apartment'], ['house', '<svg class="dd" aria-hidden="true"><use href="#d-house"/></svg> House']]],
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
    <p class="muted">The agents now know your habits. They'll ask you for real-world help that fits your life. Tap <b>Story</b> to see every decision they make.</p>
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

// ------------------------------------------------------------------ Today: your real carbon ledger, governed by the council
const FX = window.ImpactFactors;
const CATUI = [['travel', 'Travel & energy', 'frostbun', '#7fc2e0', 'kg CO₂e'], ['water', 'Water', 'ripplet', '#4a9fe0', 'L'], ['stuff', 'Stuff & trash', 'sunfox', '#e8b86a', 'items']];
const EMPTY_LED = { food: 0, travel: 0, water: 0, stuff: 0, waste: 0, saved: 0, plastic: 0, bags: 0, km: 0, items: [] };
function ledToday(p) { return !!(p && p.led && p.led.day === new Date().toDateString()); }
function myLed() { const p = me && W && W.players[me.id]; return ledToday(p) ? p.led : EMPTY_LED; }
function ringSVG(v, max, color) {
  const r = 56, c = 2 * Math.PI * r, f = Math.min(1, v / max);
  return `<svg viewBox="0 0 132 132"><circle cx="66" cy="66" r="${r}" fill="none" stroke="#e8e1cc" stroke-width="14"/><circle cx="66" cy="66" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round" stroke-dasharray="${c * f} ${c}"/></svg>`;
}
function agentLine(agent) {
  const R = W.log.slice().reverse();
  const mine = me && R.find((e) => e.agent === agent && e.k === 'quest' && e.act.includes(`asked ${me.name}:`));
  if (mine) return mine.act.replace(`asked ${me.name}: `, 'asks you: ');
  const other = R.find((e) => e.agent === agent && (e.k === 'council' || e.k === 'thank'));
  return other ? other.act : IA.AG[agent].bio;
}
let FOOT = null;
TABS.today = {
  title: 'Today',
  html() {
    const L = myLed(), b = W.budget || IA.DEFAULT_BUDGET;
    const tot = L.travel, bud = b.travel, over = tot > bud;
    const llm = mode === 'online' && HEALTH.llm && HEALTH.llm.ok;
    const council = W.log.filter((e) => e.k === 'council').slice(-3).reverse();
    return `<div class="tdh"><div class="ring">${ringSVG(tot, bud, over ? '#e0786a' : '#7cc07f')}<div><span><b>${tot.toFixed(1)}</b><small>of ${bud.toFixed(1)} kg CO₂e</small></span></div></div>
      <div><p style="margin:0;font-weight:800">${!L.items.length ? 'Nothing logged yet today.' : over ? 'Over budget. The council is worried.' : 'Under budget. The council is happy.'}</p>
      <p class="small muted" style="margin:4px 0">Your daily budget is set by the agent council and changes when they negotiate. Every number uses cited EPA and Poore &amp; Nemecek factors.</p>
      ${L.saved > 0 ? `<span class="chip ok">${L.saved.toFixed(1)} kg saved by walking/biking</span>` : ''}</div></div>
      <div class="bigacts"><button class="p" id="tdLog"><svg class="ic"><use href="#i-plus"/></svg><span>Log something<small>trips, energy, showers, trash…</small></span></button>
      <button id="tdScan"><svg class="ic"><use href="#i-scan"/></svg><span>Scan a receipt or bill<small>${llm ? 'AI reads it, factors do the math' : 'needs the server + an AI key'}</small></span></button></div>
      ${CATUI.map(([k, n, ag, col, unit]) => {
        const v = L[k] || 0, bb = b[k] || 1;
        return `<div class="cat"><img src="${faceURL(IA.AG[ag], 80)}" alt=""><div><div class="top"><span>${n}</span><span>${k === 'water' || k === 'stuff' ? Math.round(v) : v.toFixed(1)} / ${bb} ${unit}</span></div>
          <div class="cbar"><i style="width:${Math.min(100, (v / bb) * 100)}%;background:${v > bb ? '#e0786a' : col}"></i></div>
          <div class="small muted"><b>${IA.AG[ag].name}:</b> ${esc(agentLine(ag))}</div></div></div>`;
      }).join('')}
      ${openQuests().length ? `<h3><svg class="dd" aria-hidden="true"><use href="#d-star"/></svg> Missions for you</h3>${openQuests().map((q) => `<div class="quest-card"><img src="${faceURL(IA.AG[q.from], 96)}" alt=""><div><b>${esc(IA.AG[q.from].name)}:</b> ${esc(q.text)}<div class="small muted">“${esc(q.line)}”</div><button class="btn" style="margin-top:6px;min-height:38px;padding:8px 14px" data-qk="${esc(q.kind)}">Do it</button></div></div>`).join('')}` : ''}
      ${council.length ? `<h3><svg class="dd" aria-hidden="true"><use href="#d-columns"/></svg> Latest council decisions</h3>${council.map(entryHTML).join('')}` : ''}
      <h3><svg class="dd" aria-hidden="true"><use href="#d-notebook"/></svg> Today's log</h3>${L.items.length ? L.items.slice().reverse().map((x) => `<div class="li"><span>${esc(x.label)}<small>${esc(x.src || '')}</small></span><b>${x.cat === 'water' ? Math.round(x.liters) + ' L' : x.saved ? '−' + x.saved.toFixed(2) + ' kg' : x.kg ? x.kg.toFixed(2) + ' kg' : x.cat === 'stuff' ? 'item' : '·'}</b></div>`).join('') : '<p class="small muted">Log your first thing: the agents react on their next tick.</p>'}
      <h3><svg class="dd" aria-hidden="true"><use href="#d-chart"/></svg> Street footprint history</h3><div id="footOut">${FOOT ? footTable(FOOT) : '<p class="small muted">Loading…</p>'}</div>
      <div class="row" style="margin-top:12px"><button class="btn" id="tdHunt"><svg class="dd" aria-hidden="true"><use href="#d-map"/></svg> Litter Hunt</button><button class="btn ghost" id="tdGo">More real actions</button><button class="btn ghost" id="tdPlay">Games</button><button class="btn ghost" id="tdFeed">Feed &amp; news</button></div>`;
  },
  live() { const sc = $('#sheetB').scrollTop; $('#sheetB').innerHTML = this.html(); this.wire(); $('#sheetB').scrollTop = sc; },
  mount() { this.wire(); loadFoot(); },
  wire() {
    $('#tdLog').onclick = () => composer();
    $('#tdScan').onclick = scanFlow;
    $('#tdGo').onclick = () => openSheet('go');
    $('#tdHunt').onclick = litterHunt;
    $('#tdPlay').onclick = () => openSheet('games');
    $('#tdFeed').onclick = () => openSheet('feed');
    document.querySelectorAll('#sheetB [data-qk]').forEach((x) => (x.onclick = () => doQuest(x.dataset.qk)));
  },
};
function footTable(r) {
  if (!r.rows || !r.rows.length) return `<p class="small muted">No history yet. Source: ${esc(r.source)}</p>`;
  const cols = Object.keys(r.rows[0]).filter((k) => k !== 'player_id');
  return `<div class="chips"><span class="chip ${r.bruin ? 'ok' : ''}">Source: ${esc(r.source)}</span></div><div class="tablewrap"><table><tr>${cols.map((k) => `<th>${esc(k.replace(/_/g, ' '))}</th>`).join('')}</tr>${r.rows.slice(0, 10).map((x) => `<tr>${cols.map((k) => `<td>${esc(x[k])}</td>`).join('')}</tr>`).join('')}</table></div>`;
}
async function loadFoot() {
  if (mode === 'online') { try { FOOT = await api('api/footprint'); } catch (e) { /* keep last */ } }
  else { const L = myLed(); FOOT = { source: 'this device (offline)', rows: [{ day: 'today', food_kg: L.food.toFixed(2), travel_energy_kg: L.travel.toFixed(2), water_l: Math.round(L.water), stuff_items: L.stuff }] }; }
  const o = $('#footOut');
  if (o && FOOT) o.innerHTML = footTable(FOOT);
}
// quests: ledger quests open the composer on the right category; others use the Go! actions
function doQuest(kind) {
  if (kind === 'hunt' || kind === 'litter') return litterHunt();
  const toComposer = { walk: 'travel', refuse: 'stuff', shower: 'water' };
  if (toComposer[kind]) return composer(toComposer[kind]);
  doAction(QUEST_ACTION[kind] || 'litter');
}

// ------------------------------------------------------------------ composer: quick logging with live, cited math
const QL = {
  travel: [['<svg class="dd" aria-hidden="true"><use href="#d-car"/></svg>', 'Drove', { kind: 'drive' }, 'km', 10], ['<svg class="dd" aria-hidden="true"><use href="#d-fuel"/></svg>', 'Filled up gas', { kind: 'gas' }, 'gal', 8], ['<svg class="dd" aria-hidden="true"><use href="#d-bike"/></svg>', 'Walked/biked instead', { kind: 'walk' }, 'km', 3],
    ['<svg class="dd" aria-hidden="true"><use href="#d-plug"/></svg>', 'Electricity (from bill)', { kind: 'kwh' }, 'kWh', 10], ['<svg class="dd" aria-hidden="true"><use href="#d-flame"/></svg>', 'Natural gas (from bill)', { kind: 'therm' }, 'therms', 2]],
  water: [['<svg class="dd" aria-hidden="true"><use href="#d-shower"/></svg>', 'Shower', { kind: 'shower' }, 'min', 8], ['<svg class="dd" aria-hidden="true"><use href="#d-basket"/></svg>', 'Laundry load', { kind: 'laundry', qty: 1 }]],
  stuff: [['<svg class="dd" aria-hidden="true"><use href="#d-bottle"/></svg>', 'Plastic bottle', { kind: 'bottle', qty: 1 }], ['<svg class="dd" aria-hidden="true"><use href="#d-takeout"/></svg>', 'Takeout container', { kind: 'takeout', qty: 1 }], ['<svg class="dd" aria-hidden="true"><use href="#d-shirt"/></svg>', 'Bought new clothes', { kind: 'new_clothes', qty: 1 }],
    ['<svg class="dd" aria-hidden="true"><use href="#d-bin"/></svg>', 'Trash bag out', { kind: 'trash', qty: 1 }], ['<svg class="dd" aria-hidden="true"><use href="#d-nope"/></svg>', 'Refused a single-use item', { kind: 'refuse', qty: 1 }]],
};
let PEND = [];
const lineAmount = (x) => (x.cat === 'water' ? Math.round(x.liters || 0) + ' L' : x.saved ? '−' + x.saved.toFixed(2) + ' kg' : x.cat === 'stuff' ? (x.items || 0) + ' item' : (x.kg || 0).toFixed(2) + ' kg');
function composer(tab = 'travel') {
  if (!QL[tab]) tab = 'travel';
  if (!me) return;
  const draw = () => {
    const lines = PEND.map(FX.compute);
    modal(`<h2>Log it</h2><div class="ctabs">${CATUI.map(([k, n]) => `<button data-ct="${k}" class="${k === tab ? 'on' : ''}">${n}</button>`).join('')}</div>
      <div class="qchips">${QL[tab].map((c, i) => c[3]
        ? `<span class="step">${c[0]} ${c[1]} <input type="number" min="0" step="any" value="${c[4]}" id="qv${i}" aria-label="${c[3]}"> ${c[3]} <button data-qa="${i}">Add</button></span>`
        : `<button data-qa="${i}">${c[0]} ${c[1]}</button>`).join('')}</div>
      <div class="pend">${lines.map((x, i) => `<div class="li"><span>${esc(x.label)}<small>${esc(x.src)}${x.note ? ' · ' + esc(x.note) : ''}</small></span><b>${lineAmount(x)}</b><button class="x" data-rm="${i}" aria-label="Remove">✕</button></div>`).join('') || '<p class="small muted">Tap what you did today. The math uses cited factors.</p>'}</div>
      <div class="row" style="justify-content:center"><button class="btn" id="qlGo" ${PEND.length ? '' : 'disabled'}>Log ${PEND.length || ''} item${PEND.length === 1 ? '' : 's'}</button><button class="btn ghost" data-close>Close</button></div>`);
    document.querySelectorAll('[data-ct]').forEach((x) => (x.onclick = () => { tab = x.dataset.ct; draw(); }));
    document.querySelectorAll('[data-qa]').forEach((x) => (x.onclick = () => {
      const c = QL[tab][+x.dataset.qa];
      const it = Object.assign({}, c[2]);
      if (c[3]) { it.qty = +$('#qv' + x.dataset.qa).value || 0; if (!it.qty) return; }
      PEND.push(it); draw();
    }));
    document.querySelectorAll('[data-rm]').forEach((x) => (x.onclick = () => { PEND.splice(+x.dataset.rm, 1); draw(); }));
    $('#qlGo').onclick = () => { const items = PEND; PEND = []; submitLog(items, 'tap'); };
  };
  draw();
}
async function submitLog(items, via) {
  const lines = items.map(FX.compute).filter((x) => !x.skip);
  const kg = lines.reduce((a, x) => a + x.kg, 0), saved = lines.reduce((a, x) => a + x.saved, 0);
  const act = { items, real: true, via };
  closeModal();
  if (mode === 'online') { const r = await api('api/act', { id: me.id, act }).catch(() => null); if (!r) return toast('Could not reach the server'); }
  else { IA.human(W, me.id, act, false); receive(W); }
  toast(`Logged ${lines.length} item${lines.length === 1 ? '' : 's'}: ${kg.toFixed(1)} kg CO₂e${saved ? `, saved ${saved.toFixed(1)}` : ''}. The agents react next tick.`, 3500);
  openSheet('today');
}

// ------------------------------------------------------------------ receipt / bill scan: the AI extracts, factors do the math
function scanFlow() {
  if (!(mode === 'online' && HEALTH.llm && HEALTH.llm.ok)) {
    modal(`<h2>Scan needs an AI key</h2><p class="muted">Receipt and bill scanning runs on the server with a Gemini or OpenAI key (GEMINI_API_KEY or OPENAI_API_KEY). The AI only reads the line items. The carbon math uses cited EPA and Poore &amp; Nemecek factors, so it can't make up numbers.</p>
      <div class="row" style="justify-content:center"><button class="btn" id="scQ">Log by tapping instead</button><button class="btn ghost" data-close>Close</button></div>`);
    $('#scQ').onclick = () => composer();
    return;
  }
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
  inp.onchange = async () => {
    const f = inp.files[0];
    if (!f) return;
    modal('<h2>Reading your receipt…</h2><p class="muted">The AI extracts the lines. The factors do the math.</p>');
    const url = await new Promise((res) => {
      const im = new Image();
      im.onload = () => {
        const k = Math.min(1, 1280 / Math.max(im.width, im.height));
        const c = document.createElement('canvas');
        c.width = Math.round(im.width * k); c.height = Math.round(im.height * k);
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', 0.85));
      };
      im.src = URL.createObjectURL(f);
    });
    const r = await fetch('api/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ image: url }) }).then((x) => x.json()).catch((e) => ({ error: e.message }));
    if (r.error) {
      modal(`<h2>Scan failed</h2><p class="muted">${esc(r.error)}. You can log by tapping instead.</p><button class="btn" id="scQ">Log by tapping</button>`);
      $('#scQ').onclick = () => composer();
      return;
    }
    const items = r.items || [];
    const draw = () => {
      const lines = items.map(FX.compute);
      modal(`<img src="${url}" alt="Your receipt" class="photo-prev"><h2>Found ${items.length} item${items.length === 1 ? '' : 's'}</h2>
        <div class="pend">${lines.map((x, i) => `<div class="li"><span>${esc(x.label)}<small>${x.skip ? 'not counted (no cited factor)' : esc(x.src)}</small></span><b>${x.skip ? '·' : lineAmount(x)}</b><button class="x" data-rm="${i}" aria-label="Remove">✕</button></div>`).join('') || '<p class="small muted">Nothing readable. Try a clearer photo.</p>'}</div>
        <div class="row" style="justify-content:center"><button class="btn" id="scGo" ${items.length ? '' : 'disabled'}>Log these</button><button class="btn ghost" data-close>Cancel</button></div>
        <p class="small muted">Read by AI. Numbers from cited factors, recomputed by Bruin.</p>`);
      document.querySelectorAll('[data-rm]').forEach((x) => (x.onclick = () => { items.splice(+x.dataset.rm, 1); draw(); }));
      $('#scGo').onclick = () => submitLog(items, 'scan');
    };
    draw();
  };
  inp.click();
}

// ------------------------------------------------------------------ Litter Hunt: a real walk, counted by GPS, with photo proof
const HUNT_GOAL_M = 150;
let HUNT = null; // { watch, meters, last, pieces, photos, gps, started, err }
function metersBetween(a, b) {
  const R = 6371000, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(b.latitude - a.latitude), dLon = rad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function litterHunt() {
  if (!me) return;
  const gpsOk = 'geolocation' in navigator && window.isSecureContext;
  modal(`<div class="hunt-hero"><svg class="dd" aria-hidden="true"><use href="#d-map"/></svg></div><h2>Litter Hunt</h2>
    <p class="muted">Walk at least ${HUNT_GOAL_M} m around your block. Every time you bin a piece of litter, tap <b>Binned one</b> and snap a photo. Ripplet cleans the ocean for everyone on your street.</p>
    <div class="hunt-rules small"><span><svg class="dd" aria-hidden="true"><use href="#d-walk"/></svg> ${HUNT_GOAL_M} m walk: Ocean +2</span><span><svg class="dd" aria-hidden="true"><use href="#d-bin"/></svg> each piece with a photo: +0.8</span><span><svg class="dd" aria-hidden="true"><use href="#d-star"/></svg> completes Ripplet's mission</span></div>
    ${gpsOk ? '' : `<p class="small hunt-warn">GPS needs a secure (https) link, so it's off on this connection. You can still hunt on your honor: litter counts, the walk counts less.</p>`}
    <div class="row" style="justify-content:center"><button class="btn" id="huntGo">${gpsOk ? 'Start walking' : 'Start (honor mode)'}</button><button class="btn ghost" data-close>Not now</button></div>
    <p class="small muted">Your location stays on this phone. Only the distance is sent. Photos stay on this phone too.</p>`);
  $('#huntGo').onclick = () => startHunt(gpsOk);
}
function startHunt(gpsOk) {
  HUNT = { meters: 0, last: null, pieces: 0, photos: 0, gps: false, started: Date.now(), err: '', watch: null };
  if (gpsOk) {
    HUNT.watch = navigator.geolocation.watchPosition((pos) => {
      const c = pos.coords;
      if (c.accuracy > 35) return; // too fuzzy to count
      if (HUNT.last) {
        const d = metersBetween(HUNT.last, c);
        if (d < 4) return;          // GPS jitter while standing still
        if (d < 80) HUNT.meters += d; // ignore teleports
      }
      HUNT.last = c;
      HUNT.gps = true;
      drawHunt();
    }, (e) => { HUNT.err = e.code === 1 ? 'Location permission was denied, so this hunt is in honor mode.' : 'No GPS signal yet. Keep walking outside.'; drawHunt(); },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 });
  }
  drawHunt();
}
function drawHunt() {
  if (!HUNT) return;
  const pct = Math.min(100, (HUNT.meters / HUNT_GOAL_M) * 100);
  const mins = Math.floor((Date.now() - HUNT.started) / 60000);
  const canFinish = HUNT.meters >= HUNT_GOAL_M || HUNT.pieces > 0 || !HUNT.watch;
  modal(`<h2>Litter Hunt</h2>
    <div class="hunt-meter"><b>${Math.round(HUNT.meters)}</b><span>of ${HUNT_GOAL_M} m${HUNT.watch ? '' : ' (no GPS)'}</span></div>
    <div class="cbar" style="height:14px"><i style="width:${pct}%;background:var(--sea)"></i></div>
    <p class="small muted">${HUNT.err ? esc(HUNT.err) : HUNT.watch ? (HUNT.gps ? `Tracking your walk · ${mins} min` : 'Waiting for GPS… step outside') : 'Honor mode: walk your block, then finish.'}</p>
    <div class="hunt-count"><svg class="dd" aria-hidden="true"><use href="#d-bin"/></svg> ${HUNT.pieces} binned · <svg class="dd" aria-hidden="true"><use href="#d-camera"/></svg> ${HUNT.photos} photo${HUNT.photos === 1 ? '' : 's'}</div>
    <label class="btn wide" style="margin:6px 0"><svg class="ic"><use href="#i-camera"/></svg>Binned one (snap it)<input type="file" accept="image/*" capture="environment" id="huntPhoto" hidden></label>
    <button class="btn ghost wide" id="huntNoPhoto">Binned one (no photo)</button>
    <div class="row" style="justify-content:center;margin-top:8px"><button class="btn" id="huntDone" ${canFinish ? '' : 'disabled'}>Finish hunt</button><button class="btn ghost" id="huntQuit">Cancel</button></div>`);
  $('#huntPhoto').onchange = (e) => { if (e.target.files[0]) { HUNT.pieces++; HUNT.photos++; toast('Nice! +1 piece with photo'); drawHunt(); } };
  $('#huntNoPhoto').onclick = () => { HUNT.pieces++; drawHunt(); };
  $('#huntQuit').onclick = () => { stopHunt(); closeModal(); };
  $('#huntDone').onclick = finishHunt;
}
function stopHunt() { if (HUNT && HUNT.watch != null) navigator.geolocation.clearWatch(HUNT.watch); }
async function finishHunt() {
  stopHunt();
  const h = { meters: Math.round(HUNT.meters), pieces: HUNT.pieces, photos: HUNT.photos, gps: HUNT.gps };
  HUNT = null;
  const act = { hunt: h };
  let entry = null;
  if (mode === 'online') { const r = await api('api/act', { id: me.id, act }).catch(() => null); entry = r && r.entry; }
  else { entry = IA.human(W, me.id, act, false); receive(W); }
  modal(`<div class="hunt-hero"><svg class="dd" aria-hidden="true"><use href="#d-wave"/></svg></div><h2>Hunt complete!</h2>
    <p><b>${h.gps ? `${h.meters} m walked` : 'Walk done (honor)'} · ${h.pieces} piece${h.pieces === 1 ? '' : 's'} binned</b></p>
    <p class="muted">${entry ? esc(entry.why) : 'Saved.'}</p>
    <p class="small muted">Ripplet will react on the next tick. Check the Street tab for the leaderboard.</p>
    <button class="btn wide" data-close>Back to the planet</button>`);
}

// ------------------------------------------------------------------ THE GAME LAYER: showdowns, characters, story
const dd = (n, cls = '') => `<svg class="dd ${cls}" aria-hidden="true"><use href="#d-${n}"/></svg>`;
const mySeeds = () => { const p = me && W && W.players[me.id]; return p ? (p.seeds == null ? 10 : p.seeds) : 0; };
let showDismissed = '';
let lastResult = null;   // { id, text, good } for the showdown result card
let seenFoxDecision = 0;

async function back(kind, amount, target) {
  if (!me) return null;
  if (mode !== 'online') {
    const r = IA.back(W, me.id, kind, amount, target);
    if (r.error) toast(r.error); else receive(W);
    return r;
  }
  const r = await fetch('api/back', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: me.id, kind, amount, target }) }).then((x) => x.json()).catch(() => ({ error: 'Could not reach the server' }));
  if (r.error) toast(r.error, 3500);
  return r;
}

// a card that floats over the planet whenever something needs you
function renderShow() {
  const el = $('#show');
  if (!W || !me || openTab || !$('#modal').hidden) { el.hidden = true; return; }
  const seeds = mySeeds();
  let html = '', key = '';
  // 1) Sunfox just decided: show what happened
  const dec = W.log.filter((e) => e.agent === 'sunfox' && /BETRAYED|refused the Baron/.test(e.act)).slice(-1)[0];
  if (dec && dec.id > seenFoxDecision && Date.now() - dec.t < 15000) {
    const good = /refused/.test(dec.act);
    key = 'res' + dec.id;
    html = `<div class="show-card ${good ? 'good' : 'bad'}"><img src="${faceURL(IA.AG.sunfox, 96)}" alt="">
      <div><b class="show-h">${good ? 'Sunfox stayed loyal!' : 'Sunfox BETRAYED everyone!'}</b>
      <span class="show-sub">${good ? (/thanks to/.test(dec.act) ? 'Your street outbid the Baron. The guardians cheer.' : 'He turned the Baron down.') : 'He took the Baron\'s seeds and leaked the weakest zone. Get revenge: shield it before the Baron strikes.'}</span>
      ${good ? '' : `<div class="show-btns"><button class="btn" data-back="shield" data-amt="5" ${seeds < 5 ? 'disabled' : ''}>${dd('shield')} Shield it +5</button><button class="btn ghost" data-hunt>${dd('map')} Earn seeds</button></div>`}</div>
      <button class="x" data-dismiss aria-label="Close">✕</button></div>`;
    if (good && dec.act.includes('humans') && !confetti.done?.[dec.id]) { confetti(); (confetti.done = confetti.done || {})[dec.id] = 1; }
  } else if (W.offer) {
    // 2) live bribe showdown
    const left = Math.max(0, IA.OFFER_WAIT - (W.tick - W.offer.tick));
    const out = W.offer.outbid || 0;
    key = 'bribe' + W.offer.tick;
    html = `<div class="show-card hot"><img src="${faceURL(IA.AG.baron, 96)}" alt="">
      <div><b class="show-h">${dd('hat')} The Baron is bribing Sunfox!</b>
      <span class="show-sub">Baron offers <b>${W.offer.amount}</b> seeds · your street: <b>${out}</b> · Sunfox decides ${left ? `in ${left} tick${left === 1 ? '' : 's'}` : 'now'}</span>
      <div class="show-bar"><i style="width:${Math.min(100, (out / Math.max(1, W.offer.amount + out)) * 100)}%"></i></div>
      <div class="show-btns"><button class="btn" data-back="outbid" data-amt="5" ${seeds < 5 ? 'disabled' : ''}>${dd('sprout')} Outbid +5</button><button class="btn" data-back="outbid" data-amt="15" ${seeds < 15 ? 'disabled' : ''}>Outbid +15</button><span class="show-seeds">${dd('sprout')} ${seeds}</span></div></div></div>`;
  } else if (W.threat && W.agents.find((a) => a.id === 'baron').energy >= 12 && W.H[W.threat.zone] < 45) {
    // 3) the Baron is eyeing a weak zone: shield it
    const z = W.threat.zone, sh = (W.shield || {})[z] || 0;
    key = 'threat' + z;
    html = `<div class="show-card warn"><img src="${faceURL(IA.AG.baron, 96)}" alt="">
      <div><b class="show-h">The Baron is eyeing the ${ZN[z]}!</b>
      <span class="show-sub">${ZN[z]} is at <b>${Math.round(W.H[z])}</b>. Shield it so his next attack bounces off${sh ? ` (shield ${sh})` : ''}.</span>
      <div class="show-btns"><button class="btn" data-back="shield" data-amt="5" data-target="${z}" ${seeds < 5 ? 'disabled' : ''}>${dd('shield')} Shield +5</button><button class="btn ghost" data-hunt>${dd('map')} Earn seeds: Litter Hunt</button><span class="show-seeds">${dd('sprout')} ${seeds}</span></div></div>
      <button class="x" data-dismiss aria-label="Close">✕</button></div>`;
  } else {
    // 4) your next mission
    const q = openQuests()[0];
    if (q) {
      key = 'q' + q.id;
      html = `<div class="show-card"><img src="${faceURL(IA.AG[q.from], 96)}" alt="">
        <div><b class="show-h">${esc(IA.AG[q.from].name)}: “${esc(q.text)}”</b><span class="show-sub">${esc(q.line)}</span>
        <div class="show-btns"><button class="btn" data-quest="${esc(q.kind)}">Let's go</button><span class="show-seeds">+5 ${dd('sprout')}</span></div></div>
        <button class="x" data-dismiss aria-label="Close">✕</button></div>`;
    }
  }
  if (!html || key === showDismissed) { el.hidden = true; return; }
  if (el.dataset.key === key && el.dataset.seeds === String(seeds) && el.dataset.tick === String(W.tick) && !el.hidden) return;
  if (el.dataset.key !== key) {
    if (key.startsWith('bribe')) speak('baron', 'Sunfox, my dear… these shiny seeds are yours if you look the other way.');
    else if (key.startsWith('res')) speak('sunfox', html.includes('stayed loyal') ? "Nope! I'm sticking with my friends!" : 'Hehe… sorry, guardians. A fox has to eat!');
    else if (key.startsWith('threat')) speak('baron', 'That zone looks… delicious.');
  }
  el.dataset.key = key; el.dataset.seeds = seeds; el.dataset.tick = W.tick;
  el.innerHTML = html;
  el.hidden = false;
  el.querySelectorAll('[data-back]').forEach((b) => (b.onclick = async () => {
    b.disabled = true;
    const r = await back(b.dataset.back, +b.dataset.amt, b.dataset.target);
    if (r && !r.error) { toast(b.dataset.back === 'outbid' ? 'Seeds sent! Sunfox is thinking…' : 'Shield up!'); globe.say(b.dataset.back === 'outbid' ? 'sunfox' : 'mossling', b.dataset.back === 'outbid' ? 'Ooh… tempting!' : 'Nice shield!'); }
  }));
  el.querySelectorAll('[data-dismiss]').forEach((b) => (b.onclick = () => { showDismissed = key; if (key.startsWith('res')) seenFoxDecision = +key.slice(3); el.hidden = true; }));
  el.querySelectorAll('[data-quest]').forEach((b) => (b.onclick = () => doQuest(b.dataset.quest)));
  el.querySelectorAll('[data-hunt]').forEach((b) => (b.onclick = litterHunt));
}

// tap a character on the planet
function openAgent(id) {
  const d = IA.AG[id], a = W && W.agents.find((x) => x.id === id);
  if (!d || !a) return;
  const trustYou = me ? a.trust['h_' + me.id] || 0 : 0;
  const mood = a.energy < 25 ? 'exhausted' : id === 'baron' ? 'scheming' : d.type === 'guardian' && W.H[d.goal] < 35 ? 'worried' : 'happy';
  const want = d.type === 'guardian' ? `${ZN[d.goal]} back above 70 (now ${Math.round(W.H[d.goal])})` : id === 'sunfox' ? `more seeds (has ${a.seeds})` : 'the planet below 30';
  const seeds = mySeeds();
  const ally = a.ally && a.allyUntil > W.tick ? IA.AG[a.ally].name : null;
  modal(`<img class="big-av" src="${faceURL(d, 160)}" alt=""><h2>${d.name}</h2>
    <div class="chips" style="justify-content:center"><span class="chip">${d.role}</span><span class="chip">${mood}</span><span class="chip">energy ${a.energy}</span>${ally ? `<span class="chip ok">allied with ${ally}</span>` : ''}</div>
    <p><b>Wants:</b> ${want}</p>
    <p class="muted">${esc(a.last ? 'Just now: ' + a.last : d.bio)}</p>
    <button class="btn ghost" id="agVoice">🔊 Hear ${d.name}</button>
    <p class="small">Trusts you: <b>${trustYou > 0.5 ? 'a lot' : trustYou > 0 ? 'a little' : 'not yet'}</b></p>
    ${id === 'baron'
      ? `<div class="show-btns" style="justify-content:center"><button class="btn" id="agShield" ${seeds < 5 || !W.threat ? 'disabled' : ''}>${dd('shield')} Shield ${W.threat ? ZN[W.threat.zone] : ''} +5</button></div>`
      : `<div class="show-btns" style="justify-content:center"><button class="btn" id="agMission">${dd('star')} Give me a mission</button><button class="btn ghost" id="agGift" ${seeds < 5 ? 'disabled' : ''}>${dd('gift')} Give 5 seeds</button></div>`}
    <p class="small muted">You have ${seeds} seeds. Earn more by doing real things: Litter Hunts, logging good swaps, missions.</p>`);
  const s = $('#agShield'), m = $('#agMission'), g = $('#agGift'), vb = $('#agVoice');
  if (vb) vb.onclick = () => {
    const nm = me ? me.name : 'friend';
    const line = id === 'baron' ? 'Mwahaha. Soon this whole little planet will be grey, and all mine.'
      : d.type === 'guardian'
        ? (W.H[d.goal] < 40 ? `${nm}, the ${ZN[d.goal]} really needs you today. Please help!` : `The ${ZN[d.goal]} is feeling better! Thank you, ${nm}!`)
        : `I go wherever the seeds are. I have ${a.seeds}. Got any more?`;
    vb.disabled = true; vb.textContent = '🔊 …';
    speak(id, line, true).then(() => { vb.disabled = false; vb.textContent = `🔊 Hear ${d.name}`; });
  };
  if (s) s.onclick = async () => { const r = await back('shield', 5, W.threat.zone); if (r && !r.error) { closeModal(); toast('Shield up!'); } };
  if (g) g.onclick = async () => { const r = await back('gift', 5, id); if (r && !r.error) { closeModal(); globe.say(id, `Thank you ${me.name}!!`); toast(`${d.name} loves you a bit more`); } };
  if (m) m.onclick = async () => {
    const r = await back('mission', 0, id);
    if (r && r.quest) { closeModal(); globe.say(id, `${me.name}! I need you!`); doQuest(r.quest.kind); }
  };
}

// agents shout your name when you help
let cheeredUpTo = 0;
function cheerMe(S) {
  if (!me) return;
  if (!cheeredUpTo) { cheeredUpTo = S.seq; return; }
  for (const e of S.log) {
    if (e.id <= cheeredUpTo) continue;
    if (e.agent === 'human' && e.who === me.id && /Completed (\w+)'s quest/.test(e.why)) {
      const name = /Completed (\w+)'s quest/.exec(e.why)[1];
      const ag = IA.AGENTS.find((x) => x.name === name);
      if (ag) { globe.say(ag.id, `YOU DID IT, ${me.name.toUpperCase()}!`); speak(ag.id, 'You did it! Thank you!'); }
      confetti();
    } else if (e.agent === 'human' && e.who === me.id && /Litter Hunt/.test(e.act)) {
      globe.say('ripplet', `Woo! Thanks ${me.name}!`); confetti();
    } else if (e.k === 'thank' && e.target === 'h_' + me.id) {
      globe.say(e.agent, `${me.name}, you're a legend!`);
    }
  }
  cheeredUpTo = S.seq;
}

// the story: a few big moments, not a log
function storyHTML() {
  const pick = W.log.filter((e) => ['betray', 'ally', 'fight', 'council', 'end', 'thank', 'quest', 'learn'].includes(e.k) && e.agent !== 'world' || e.k === 'end' || (e.k === 'human' && /outbid|shield|Litter Hunt/.test(e.act)))
    .filter((e) => !/rested|is thinking/.test(e.act))
    .slice(-40).reverse();
  const seen = new Set();
  const moments = [];
  for (const e of pick) {
    const k = e.agent + e.k;
    if (seen.has(k) && moments.length > 3) continue;
    seen.add(k);
    moments.push(e);
    if (moments.length >= 8) break;
  }
  const headline = (e) => {
    const who = e.agent === 'human' ? (W.players[e.who] || {}).name || 'Someone' : name(e.agent);
    const act = e.agent === 'human' ? e.act.replace(/^[^:]+: /, '') : e.act;
    return `<b>${esc(who)}</b> ${esc(act.replace(/\s*\([^)]*\)/g, ''))}`;
  };
  const tone = (e) => /BETRAY|polluted|offered Sunfox|flash sale/.test(e.act) ? 'bad' : /refused|alliance|thanked|cheered|outbid|shield|Litter|WIN/.test(e.act) ? 'good' : '';
  const avg = Math.round(IA.avgH(W));
  return `<div class="story-top"><div><b class="hand" style="font-size:28px">Run ${W.seed}</b><div class="small muted">tick ${Math.min(W.tick, IA.ROUND)} of ${IA.ROUND} · planet ${avg}/100 · ${avg >= 50 ? 'guardians are winning' : 'the Baron is winning'}</div></div>
    <div class="story-meter"><i style="width:${avg}%"></i></div></div>
    <div class="story">${moments.map((e) => `<div class="moment ${tone(e)}"><img src="${e.agent === 'human' ? faceURL(BUDDIES.find((b) => b.id === (W.players[e.who] || {}).av) || BUDDIES[0], 96) : IA.AG[e.agent] ? faceURL(IA.AG[e.agent], 96) : faceURL(BUDDIES[0], 96)}" alt="">
      <div><div class="moment-h">${headline(e)}</div><div class="small muted">${esc((e.why || '').split('. ')[0])}</div></div></div>`).join('') || '<p class="muted">The story starts in a few seconds…</p>'}</div>`;
}

// a little celebration
function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#f6c453', '#5fae67', '#4a9fe0', '#f28b82', '#b9a4dc'];
  for (let i = 0; i < 40; i++) {
    const p = document.createElement('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = Math.random() * 0.3 + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    box.appendChild(p);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 2200);
}
