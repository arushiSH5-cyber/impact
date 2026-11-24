// Impact server. Zero dependencies, Node 18+.
//  - serves the PWA in ./public
//  - owns the one shared world and runs the agents on their own timer, even when nobody is connected
//  - multiplayer: every connected player gets the same world pushed over Server-Sent Events
//  - appends every decision to logs/decisions.jsonl (Bruin turns it into marts.agent_report)
//  - reads Bruin's data/daily_spawn.csv every tick (hot-reloaded when the pipeline reruns)
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const IA = require('./public/agents-engine.js').ImpactAgents;
const sponsors = require('./sponsors');

const ROOT = __dirname;
const PUB = path.join(ROOT, 'public');
const DATA = path.join(ROOT, 'data');
const LOGS = path.join(ROOT, 'logs');
fs.mkdirSync(DATA, { recursive: true });
fs.mkdirSync(LOGS, { recursive: true });

const PORT = +process.env.PORT || 8787;
const BODY_LIMIT = 9e6; // room for a resized receipt photo
const TICK_MS = +process.env.TICK_MS || 10000;
const MAX_CATCHUP = 120;
const STATE_FILE = path.join(DATA, 'state.json');
const MEMORY_FILE = path.join(DATA, 'agent_memory.json');
const LOG_FILE = path.join(LOGS, 'decisions.jsonl');
const LEDGER_FILE = path.join(LOGS, 'ledger.jsonl');
const FOOTPRINT_FILE = path.join(DATA, 'footprint_daily.csv');
const SPAWN_FILE = path.join(DATA, 'daily_spawn.csv');
const REPORT_FILE = path.join(DATA, 'agent_report.csv');

// ------------------------------------------------------------------ Bruin output
// small CSV reader; handles the quoted fields DuckDB writes
function parseCSV(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1 || r[0]);
}
function readCSV(file) {
  if (!fs.existsSync(file)) return null;
  const [head, ...rows] = parseCSV(fs.readFileSync(file, 'utf8'));
  if (!head) return null;
  return rows.map((r) => {
    const o = {};
    head.forEach((k, i) => {
      const v = (r[i] || '').trim();
      o[k.trim()] = v !== '' && !isNaN(+v) ? +v : v;
    });
    return o;
  });
}

let SPAWN = null;
let spawnInfo = '';
function loadSpawn() {
  const rows = readCSV(SPAWN_FILE);
  if (rows && rows.length) {
    SPAWN = rows;
    const built = new Date(fs.statSync(SPAWN_FILE).mtimeMs).toISOString().slice(0, 16).replace('T', ' ');
    spawnInfo = `${rows.length} zones · ${rows[0].date} · built ${built} UTC`;
    console.log(`Bruin: loaded daily_spawn (${spawnInfo})`);
  } else {
    SPAWN = null;
    spawnInfo = 'no data/daily_spawn.csv yet: run `bruin run pipeline`';
  }
}
loadSpawn();
fs.watchFile(SPAWN_FILE, { interval: 3000 }, loadSpawn);

// ------------------------------------------------------------------ the world
const readJSON = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return fallback; } };
let MEM = readJSON(MEMORY_FILE, {});
let S = readJSON(STATE_FILE, null);

function appendLog(entries) {
  if (!entries || !entries.length) return;
  const lines = entries.map((e) => JSON.stringify({
    id: e.id, run_seed: e.seed, tick: e.tick, ts: new Date(e.t).toISOString(), agent: e.agent, kind: e.k,
    action: e.act, why: e.why, data: e.data || '', sources: (e.src || []).join(' | '), target: e.target || '',
  }));
  fs.appendFileSync(LOG_FILE, lines.join('\n') + '\n');
}
// every real log line, with the factor key + amount so Bruin can recompute the math from its own factor table
function appendLedger(pid, entry, via) {
  if (!entry.items || !entry.items.length) return;
  const p = S.players[pid] || {};
  const d = new Date();
  const day = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const lines = entry.items.map((x) => JSON.stringify({
    ts: d.toISOString(), day, player_id: pid, player: p.name || '', cat: x.cat, kind: x.kind, factor_key: x.key, amount: +x.amount || 0,
    kg_app: Math.round(x.kg * 1e4) / 1e4, liters: Math.round(x.liters * 10) / 10, items: x.items || 0, saved_kg: Math.round(x.saved * 1e4) / 1e4,
    label: x.label, source: x.src, via: via || 'tap',
  }));
  fs.appendFileSync(LEDGER_FILE, lines.join('\n') + '\n');
}
function persist() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(S));
  fs.writeFileSync(MEMORY_FILE, JSON.stringify(MEM));
}

if (!S || !S.agents) {
  S = IA.create(+process.env.SEED || 42, SPAWN, MEM);
  appendLog(S.log);
}

// What the agents read each tick: Bruin's daily_spawn plus today's Telem news signal per zone
function spawnView() {
  if (!sponsors.telem || !sponsors.telem.pressure) return SPAWN;
  const base = SPAWN && SPAWN.length ? SPAWN : IA.SNAPSHOT;
  return base.map((r) => {
    const n = sponsors.telem.pressure(r.zone);
    return n ? Object.assign({}, r, { news_pressure: n.pressure, news_title: n.title }) : r;
  });
}

function step(live) {
  const r = IA.tick(S, spawnView(), MEM);
  const ended = r.entries.find((e) => e.k === 'end');
  if (ended && live) postcardForRun(ended);
  if (r.restart) {
    const players = S.players, postcards = S.postcards;
    S = IA.create(S.seed + 1, SPAWN, MEM);
    S.postcards = postcards;
    for (const p of Object.values(players)) IA.join(S, p);
    r.entries = S.log.slice();
  }
  citeNews(r.entries);
  appendLog(r.entries);
  persist();
  if (live) {
    broadcast();
    enrich(r.entries);
  }
}

// The world kept going while the server was off: replay the missed ticks (capped).
{
  const missed = Math.min(MAX_CATCHUP, Math.floor((Date.now() - (S.lastTick || Date.now())) / TICK_MS));
  if (missed > 0) {
    const fromTick = S.tick;
    const fromH = Math.round(IA.avgH(S));
    for (let i = 0; i < missed; i++) step(false);
    S.away = { missed, fromTick, toTick: S.tick, fromH, toH: Math.round(IA.avgH(S)), at: Date.now() };
    persist();
    console.log(`caught up ${missed} missed ticks (tick ${fromTick} → ${S.tick}, planet ${fromH} → ${S.away.toH})`);
  }
}
setInterval(() => step(true), TICK_MS);

// Telem: an agent cites today's real news result for its zone (with the link)
function citeNews(entries) {
  if (!sponsors.telem || !sponsors.telem.fact) return;
  for (const e of entries) {
    const def = IA.AG[e.agent];
    if (!def) continue;
    const zone = def.type === 'guardian' ? def.goal : def.home;
    const f = sponsors.telem.fact(zone);
    if (!f) continue;
    e.src = (e.src || []).concat(`Telem · ${f.source}: ${f.title.slice(0, 70)}`);
    e.url = f.url;
  }
}

// Non-blocking sponsor work for important events: LLM voice line, BAND room post.
const BIG = new Set(['betray', 'ally', 'quest', 'end', 'fight', 'council']);
async function enrich(entries) {
  for (const e of entries) {
    if (!BIG.has(e.k) || e.agent === 'human') continue;
    if (e.k !== 'council') { try { const line = await sponsors.llm.say(e); if (line) { e.say = line; broadcast(); } } catch (err) { /* optional */ } }
    try { if (await sponsors.band.post(e)) { e.band = true; persist(); broadcast(); } } catch (err) { /* stays unposted */ }
  }
}

// Runware: every run ends with a storybook postcard of the final planet, shared in the Feed and the BAND room
async function postcardForRun(endEntry) {
  if (!sponsors.runware.ready()) return;
  const snap = { seed: S.seed, status: S.status, H: Object.assign({}, S.H), tick: S.tick };
  const key = S.log.filter((e) => e.k === 'betray' && e.agent === 'sunfox').slice(-1)[0];
  try {
    const pc = await sponsors.runware.postcard({ H: snap.H, ending: snap.status === 'won' ? 'the guardians and humans won' : 'the Smog Baron won', twist: key ? 'a sly fox clutching a bag of seeds' : '' });
    S.postcards = (S.postcards || []).concat([{ seed: snap.seed, status: snap.status, url: pc.url, cost: pc.cost, total: pc.total, cached: pc.cached, t: Date.now() }]).slice(-6);
    endEntry.postcard = pc.url;
    persist(); broadcast();
    sponsors.band.say(`🖼️ Run ${snap.seed} postcard (${snap.status === 'won' ? 'guardians + humans won' : 'the Smog Baron won'}), painted by Runware from the final planet: ${pc.url}`);
  } catch (e) { console.log(`Runware postcard failed: ${String(e.message).slice(0, 160)}`); }
}

// BAND: humans in the room steer the world by @mentioning the Impact World agent
const ZONE_WORDS = { forest: 'forest', trees: 'forest', park: 'forest', ice: 'ice', snow: 'ice', mountain: 'ice', desert: 'desert', city: 'desert', air: 'desert', ocean: 'ocean', beach: 'ocean', sea: 'ocean', space: 'space', orbit: 'space' };
const GUARD = { forest: 'Mossling', ice: 'Frostbun', ocean: 'Ripplet', desert: 'Sunfox', space: 'the guardians' };
function statusText() {
  const z = IA.ZONES.map((k) => `${IA.ZN[k]} ${Math.round(S.H[k])}`).join(' · ');
  const last = S.log.filter((e) => ['betray', 'ally', 'fight', 'council'].includes(e.k)).slice(-1)[0];
  return `Run ${S.seed}, tick ${Math.min(S.tick, IA.ROUND)}/${IA.ROUND}. Planet ${Math.round(IA.avgH(S))}/100 (${z}). ${Object.keys(S.players).length} humans on the street.${last ? ` Latest: ${IA.AG[last.agent] ? IA.AG[last.agent].name : 'World'} ${last.act}.` : ''}`;
}
sponsors.band.listen(async (text, from) => {
  const t = text.toLowerCase();
  const zw = Object.keys(ZONE_WORDS).find((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (/\b(rally|help|save|heal|protect|defend)\b/.test(t) && zw) {
    const z = ZONE_WORDS[zw];
    const pid = 'band_' + from.id;
    IA.join(S, { id: pid, name: String(from.name || 'BAND friend').slice(0, 16) });
    const e = IA.human(S, pid, { label: `rallied the street for ${IA.ZN[z]} from the BAND room`, deltas: { [z]: 3 }, real: false }, false);
    e.src = ['BAND room (human command)'];
    appendLog([e]); persist(); broadcast();
    return `Rally logged for ${IA.ZN[z]}: +3 health and +3 human attention, so the Smog Baron is now less likely to target it. ${GUARD[z]} will react on the next tick. ${IA.ZN[z]} is at ${Math.round(S.H[z])}.`;
  }
  if (/\b(status|planet|how)\b/.test(t)) return statusText();
  if (/\bbudget|council\b/.test(t)) {
    const b = S.budget || IA.DEFAULT_BUDGET;
    const c = S.log.filter((e) => e.k === 'council').slice(-2).map((e) => `${IA.AG[e.agent] ? IA.AG[e.agent].name + ' ' : ''}${e.act}`).join(' / ');
    return `Today's street budget per person: travel ${b.travel} kg CO2e, water ${b.water} L, stuff ${b.stuff} items.${c ? ` Last council: ${c}.` : ''}`;
  }
  if (/\b(report|audit|bruin)\b/.test(t)) {
    const rows = readCSV(REPORT_FILE);
    const src = rows && rows.length ? 'Bruin agent_report' : 'live log (Bruin not run yet)';
    const list = (rows && rows.length ? rows : IA.report(S.log)).map((r) => `${r.agent}: ${r.betrayals_and_bribes} betrayals/bribes, ${r.allies} alliances, ${r.fights} fights`).join('; ');
    return `Agent audit (${src}): ${list}.`;
  }
  if (/\bnews\b/.test(t) && sponsors.telem.health().ok) {
    const items = await sponsors.telem.news();
    return items.slice(0, 3).map((n) => `${n.title} (${n.url})`).join('\n') || 'No fresh news today.';
  }
  return `Hi ${from.name}! Mention me with: "status", "rally ocean" (or forest, ice, desert, space), "budget", "report"${sponsors.telem.health().ok ? ', "news"' : ''}. Rallies change the shared planet for everyone playing.`;
});

// ------------------------------------------------------------------ SSE multiplayer
const clients = new Set();
function health() {
  const h = { bruin: { ok: !!SPAWN, detail: spawnInfo } };
  for (const [name, adapter] of Object.entries(sponsors)) {
    if (adapter && typeof adapter.health === 'function') h[name] = adapter.health();
  }
  return h;
}
const lanUrls = () => Object.values(os.networkInterfaces()).flat()
  .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`);
const snapshot = () => ({ state: S, health: health(), tickMs: TICK_MS, online: clients.size, lan: lanUrls() });
function broadcast() {
  const msg = `data: ${JSON.stringify(snapshot())}\n\n`;
  for (const c of clients) c.write(msg);
}

// ------------------------------------------------------------------ HTTP
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.css': 'text/css', '.ico': 'image/x-icon',
};
function readBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; if (b.length > BODY_LIMIT) req.destroy(); });
    req.on('end', () => { try { resolve(JSON.parse(b || '{}')); } catch (e) { resolve({}); } });
  });
}
function send(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}

const routes = {
  'GET /events'(req, res) {
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
    clients.add(res);
    res.write(`data: ${JSON.stringify(snapshot())}\n\n`);
    const keepAlive = setInterval(() => res.write(': ka\n\n'), 25000);
    req.on('close', () => { clients.delete(res); clearInterval(keepAlive); broadcast(); });
    broadcast();
  },
  'GET /api/state': (req, res) => send(res, 200, { state: S, spawn: SPAWN, health: health() }),
  'GET /api/health': (req, res) => send(res, 200, health()),
  async 'POST /api/join'(req, res) {
    const b = await readBody(req);
    if (!b.id) return send(res, 400, { error: 'id required' });
    const isNew = !S.players[b.id] || !S.players[b.id].joined;
    IA.join(S, b);
    if (isNew) appendLog(S.log.slice(-1));
    persist(); broadcast();
    send(res, 200, { ok: true });
  },
  async 'POST /api/act'(req, res) {
    const b = await readBody(req);
    if (!b.id || !b.act) return send(res, 400, { error: 'id and act required' });
    const act = Object.assign({}, b.act);
    if (act.items && !Array.isArray(act.items)) delete act.items;
    const e = IA.human(S, String(b.id), act, false);
    appendLog([e]); appendLedger(String(b.id), e, act.via); persist(); broadcast();
    send(res, 200, { ok: true, entry: e });
  },
  // humans jump into the agents' drama: outbid the Baron, shield a zone, gift an agent, ask for a mission
  async 'POST /api/back'(req, res) {
    const b = await readBody(req);
    if (!b.id || !b.kind) return send(res, 400, { error: 'id and kind required' });
    const r = IA.back(S, String(b.id), String(b.kind), b.amount, b.target);
    if (r.error) return send(res, 400, r);
    if (r.entry) appendLog([r.entry]);
    persist(); broadcast();
    send(res, 200, Object.assign({ ok: true, seeds: (S.players[b.id] || {}).seeds }, r));
  },
  async 'POST /api/new'(req, res) {
    const b = await readBody(req);
    const players = S.players, postcards = S.postcards;
    S = IA.create(+b.seed || S.seed + 1, SPAWN, MEM);
    S.postcards = postcards;
    for (const p of Object.values(players)) IA.join(S, p);
    appendLog(S.log); persist(); broadcast();
    send(res, 200, { ok: true, seed: S.seed });
  },
  'GET /api/report'(req, res) {
    const rows = readCSV(REPORT_FILE);
    if (rows && rows.length) {
      const built = new Date(fs.statSync(REPORT_FILE).mtimeMs).toISOString().slice(0, 16).replace('T', ' ');
      return send(res, 200, { source: `Bruin agent_report (from logs/decisions.jsonl, built ${built} UTC)`, bruin: true, rows });
    }
    send(res, 200, { source: 'live from this run (Bruin report not built yet: run `bruin run pipeline`)', bruin: false, rows: IA.report(S.log) });
  },
  'GET /api/footprint'(req, res) {
    const rows = readCSV(FOOTPRINT_FILE);
    if (rows && rows.length) {
      const built = new Date(fs.statSync(FOOTPRINT_FILE).mtimeMs).toISOString().slice(0, 16).replace('T', ' ');
      return send(res, 200, { source: `Bruin footprint_daily (recomputed from cited factors, built ${built} UTC)`, bruin: true, rows });
    }
    const today = Object.values(S.players).filter((p) => p.led && p.led.day === new Date().toDateString()).map((p) => ({
      player: p.name, day: 'today', food_kg: p.led.food.toFixed(2), travel_energy_kg: p.led.travel.toFixed(2), water_l: Math.round(p.led.water), stuff_items: p.led.stuff, saved_kg: p.led.saved.toFixed(2),
    }));
    send(res, 200, { source: 'live from the server (Bruin footprint_daily not built yet: run `bruin run pipeline`)', bruin: false, rows: today });
  },
  async 'POST /api/scan'(req, res) {
    if (!sponsors.llm.ok()) return send(res, 503, { error: 'Receipt scan needs GEMINI_API_KEY or OPENAI_API_KEY on the server' });
    const b = await readBody(req);
    try {
      const items = await sponsors.llm.scan(b.image);
      send(res, 200, { items, note: 'The AI extracted these lines only; footprints are computed from cited factors.' });
    } catch (e) { send(res, 502, { error: e.message }); }
  },
  'GET /api/sim'(req, res, u) {
    const seed = +u.searchParams.get('seed') || 42;
    send(res, 200, IA.simulate(seed, SPAWN, MEM));
  },
  async 'GET /api/news'(req, res) {
    if (!sponsors.telem.health().ok) return send(res, 503, { error: 'Telem not connected' });
    send(res, 200, { items: await sponsors.telem.news(), source: 'Telem' });
  },
  async 'GET /api/conditions'(req, res) {
    const air = (SPAWN || []).reduce((m, r) => (r.pm25 > (m ? m.pm25 : -1) ? r : m), null);
    const items = sponsors.telem.health().ok ? await sponsors.telem.news().catch(() => []) : [];
    send(res, 200, { air: air ? { pm25: air.pm25, place: air.place, date: air.date, source: air.source } : null, news: items[0] ? { title: items[0].title, source: items[0].source, url: items[0].url } : null, band: sponsors.band.health().ok, runware: sponsors.runware.health().ok });
  },
  async 'POST /api/game-result'(req, res) {
    const b = await readBody(req);
    const who = String(b.name || 'A player').slice(0, 20), text = String(b.text || '').slice(0, 160);
    if (!text) return send(res, 400, { error: 'no text' });
    let posted = false;
    try { posted = await sponsors.band.post({ agent: 'world', k: 'end', act: `${who} ${text}`, why: `played ${String(b.game || 'a game').slice(0, 30)} in Impact` }); } catch (e) { posted = false; }
    send(res, 200, { posted });
  },
  async 'POST /api/voice'(req, res) {
    if (!sponsors.runware.ready()) return send(res, 503, { error: 'Runware not configured' });
    const b = await readBody(req);
    try { send(res, 200, await sponsors.runware.speak(String(b.agent || ''), String(b.text || ''))); } catch (e) { send(res, 502, { error: e.message }); }
  },
  async 'POST /api/postcard'(req, res) {
    if (!sponsors.runware.ready()) return send(res, 503, { error: 'Runware not configured' });
    try { send(res, 200, await sponsors.runware.postcard(await readBody(req))); } catch (e) { send(res, 502, { error: e.message }); }
  },
  async 'GET /api/places'(req, res, u) {
    if (!sponsors.glasser.health().ok) return send(res, 503, { error: 'Glasser not connected' });
    const q = String(u.searchParams.get('q') || 'recycling center').slice(0, 80);
    const near = { lat: parseFloat(u.searchParams.get('lat')), lng: parseFloat(u.searchParams.get('lng')) };
    try { const r = await sponsors.glasser.places(q, near); send(res, 200, Object.assign({ source: 'Glasser' }, r)); } catch (e) { send(res, 502, { error: e.message }); }
  },
};

function serveStatic(res, pathname) {
  let file = path.normalize(path.join(PUB, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
  if (!file.startsWith(PUB)) return send(res, 403, { error: 'forbidden' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(PUB, 'index.html');
  res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://local');
  const handler = routes[`${req.method} ${u.pathname}`];
  try {
    if (handler) return await handler(req, res, u);
    if (u.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
    serveStatic(res, u.pathname);
  } catch (err) {
    console.error(err);
    send(res, 500, { error: 'server error' });
  }
}).listen(PORT, '0.0.0.0', () => {
  const lan = lanUrls();
  console.log(`Impact running: http://localhost:${PORT}   phones on the same wifi: ${lan.join(', ') || 'n/a'}`);
  console.log(`Agents tick every ${TICK_MS / 1000}s · seed ${S.seed} · tick ${S.tick} · Bruin: ${SPAWN ? 'ok' : 'off'} (${spawnInfo})`);
  sponsors.init().then(() => {
    console.log('Sponsors: ' + Object.entries(health()).map(([k, v]) => `${k}:${v.ok ? 'ok' : 'off'}`).join(' '));
    broadcast();
  });
});
