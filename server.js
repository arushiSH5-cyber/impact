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

function step(live) {
  const r = IA.tick(S, SPAWN, MEM);
  if (r.restart) {
    const players = S.players;
    S = IA.create(S.seed + 1, SPAWN, MEM);
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
const BIG = new Set(['betray', 'ally', 'quest', 'end', 'fight']);
async function enrich(entries) {
  for (const e of entries) {
    if (!BIG.has(e.k) || e.agent === 'human') continue;
    try { const line = await sponsors.llm.say(e); if (line) { e.say = line; broadcast(); } } catch (err) { /* optional */ }
    try { if (await sponsors.band.post(e)) { e.band = true; persist(); broadcast(); } } catch (err) { /* stays unposted */ }
  }
}

// ------------------------------------------------------------------ SSE multiplayer
const clients = new Set();
function health() {
  const h = { bruin: { ok: !!SPAWN, detail: spawnInfo } };
  for (const [name, adapter] of Object.entries(sponsors)) {
    if (adapter && typeof adapter.health === 'function') h[name] = adapter.health();
  }
  return h;
}
const snapshot = () => ({ state: S, health: health(), tickMs: TICK_MS, online: clients.size });
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
  async 'POST /api/new'(req, res) {
    const b = await readBody(req);
    const players = S.players;
    S = IA.create(+b.seed || S.seed + 1, SPAWN, MEM);
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
  async 'POST /api/postcard'(req, res) {
    if (!sponsors.runware.ready()) return send(res, 503, { error: 'Runware not configured' });
    try { send(res, 200, await sponsors.runware.postcard(await readBody(req))); } catch (e) { send(res, 502, { error: e.message }); }
  },
  async 'GET /api/places'(req, res, u) {
    if (!sponsors.glasser.health().ok) return send(res, 503, { error: 'Glasser not connected' });
    const q = String(u.searchParams.get('q') || 'recycling center near Los Angeles').slice(0, 80);
    try { send(res, 200, { items: await sponsors.glasser.places(q), source: 'Glasser' }); } catch (e) { send(res, 502, { error: e.message }); }
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
  const lan = Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal).map((i) => `http://${i.address}:${PORT}`);
  console.log(`Impact running: http://localhost:${PORT}   phones on the same wifi: ${lan.join(', ') || 'n/a'}`);
  console.log(`Agents tick every ${TICK_MS / 1000}s · seed ${S.seed} · tick ${S.tick} · Bruin: ${SPAWN ? 'ok' : 'off'} (${spawnInfo})`);
  sponsors.init().then(() => {
    console.log('Sponsors: ' + Object.entries(health()).map(([k, v]) => `${k}:${v.ok ? 'ok' : 'off'}`).join(' '));
    broadcast();
  });
});
