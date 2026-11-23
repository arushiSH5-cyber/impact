// BAND: the street's group chat is a real BAND room, and it works both ways.
//  OUT: the agents' social life (alliances, bribes, betrayals, missions, council meetings, run endings) is posted
//       into the room, so humans watch the agents negotiate live.
//  IN:  humans @mention the Impact World agent in the room to steer the world: "rally ocean", "status", "budget", "report".
//       Each command changes the shared game for every player and is logged in the decision log with source "BAND room".
// API (docs.band.ai): REST https://app.band.ai/api/v1/agent (X-API-Key), WebSocket
//   wss://app.band.ai/api/v1/socket/websocket?vsn=2.0.0 (Phoenix V2 frames), topic chat_room:{chat_id}, event message_created.
//   Messages need at least one @mention. Incoming: claim (processing) → act → reply → processed.
// Env: BAND_API_KEY, BAND_CHAT_ID, optional BAND_BASE, BAND_WS, BAND_MENTION_ID/HANDLE/NAME, BAND_RATE_MS.
'use strict';
const status = require('./status');
const { st, health, fail } = status('set BAND_API_KEY + BAND_CHAT_ID');
const BASE = () => process.env.BAND_BASE || 'https://app.band.ai/api/v1/agent';
const WS = () => process.env.BAND_WS || 'wss://app.band.ai/api/v1/socket/websocket';
const RATE_MS = () => +process.env.BAND_RATE_MS || 60000; // max 1 post per agent per minute
const chat = () => process.env.BAND_CHAT_ID;
const headers = () => ({ 'content-type': 'application/json', 'x-api-key': process.env.BAND_API_KEY });
let me = null, owner = null, posted = 0, received = 0, socket = null, wsUp = false, onCommand = null;
const lastPost = {}, seen = new Set();

async function rest(method, p, body) {
  const r = await fetch(BASE() + p, { signal: AbortSignal.timeout(20000), method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  if (r.status === 204) return null;
  if (!r.ok) throw new Error(`BAND ${method} ${p} → ${r.status} ${(await r.text()).slice(0, 120)}`);
  const j = await r.json().catch(() => ({}));
  return j && j.data !== undefined ? j.data : j;
}
const mentionOf = (x) => ({ id: x.id, handle: x.handle, name: x.name });
function detail() {
  st.detail = `room ${String(chat()).slice(0, 8)}… · ${posted} posts out · ${received} commands in · live socket ${wsUp ? 'on' : 'off'}`;
}

async function send(content, mention) {
  const m = mention || owner;
  const text = `@${m.handle} ${content}`.slice(0, 1500);
  await rest('POST', `/chats/${chat()}/messages`, { message: { content: text, mentions: [m] } });
  posted++;
  detail();
}

// ---------------------------------------------------------------- incoming commands from humans in the room
async function handle(msg) {
  if (!msg || !msg.id || seen.has(msg.id)) return;
  seen.add(msg.id);
  if (msg.sender_id === (me && me.id) || msg.sender_type === 'Agent') return; // only humans steer
  try { await rest('POST', `/chats/${chat()}/messages/${msg.id}/processing`); } catch (e) { /* already claimed */ }
  const from = { id: msg.sender_id, handle: (msg.sender_handle || msg.sender_name || 'friend').toString().replace(/\s+/g, ''), name: msg.sender_name || 'friend' };
  // prefer the participant record (has the real handle)
  try {
    const people = await rest('GET', `/chats/${chat()}/participants`);
    const hit = (Array.isArray(people) ? people : people.participants || []).find((x) => x.id === msg.sender_id);
    if (hit) Object.assign(from, mentionOf(hit));
  } catch (e) { /* keep the fallback */ }
  try {
    const text = String(msg.content || '').replace(/@[\w.-]+/g, ' ').replace(/\s+/g, ' ').trim();
    received++;
    const reply = onCommand ? await onCommand(text, from) : 'The world is starting up, try again in a moment.';
    await send(reply, from);
    await rest('POST', `/chats/${chat()}/messages/${msg.id}/processed`);
  } catch (e) {
    try { await rest('POST', `/chats/${chat()}/messages/${msg.id}/failed`, { error: String(e.message).slice(0, 200) }); } catch (x) { /* ignore */ }
  }
  detail();
}

// backlog from while the server was off (startup only, per BAND docs)
async function drain() {
  for (let i = 0; i < 30; i++) {
    const m = await rest('GET', `/chats/${chat()}/messages/next`);
    if (!m || !m.id) break;
    await handle(m);
  }
}

// live delivery over the Phoenix V2 WebSocket (Node 22+ has WebSocket built in)
function connectSocket() {
  if (typeof WebSocket === 'undefined') return;
  const url = `${WS()}?vsn=2.0.0&agent_id=${encodeURIComponent(me.id)}&api_key=${encodeURIComponent(process.env.BAND_API_KEY)}`;
  let ref = 0, beat = null;
  const topic = `chat_room:${chat()}`;
  const push = (event, payload, joinRef = null) => socket.send(JSON.stringify([joinRef, String(++ref), event === 'heartbeat' ? 'phoenix' : topic, event, payload || {}]));
  socket = new WebSocket(url);
  socket.onopen = () => {
    push('phx_join', {}, '1');
    beat = setInterval(() => { try { push('heartbeat', {}); } catch (e) { /* reconnect handles it */ } }, 30000);
  };
  socket.onmessage = (ev) => {
    let f;
    try { f = JSON.parse(ev.data); } catch (e) { return; }
    const [, , t, event, payload] = f;
    if (event === 'phx_reply' && t === topic) { wsUp = payload && payload.status === 'ok'; detail(); }
    if (event === 'message_created' && t === topic) handle(payload && (payload.message || payload)).catch(() => {});
  };
  socket.onclose = () => { wsUp = false; detail(); clearInterval(beat); setTimeout(() => { if (st.ok) connectSocket(); }, 5000); };
  socket.onerror = () => { /* onclose follows */ };
}

module.exports = {
  health, fail,
  listen(fn) { onCommand = fn; },
  async init() {
    if (!process.env.BAND_API_KEY) return;
    me = await rest('GET', '/me');
    if (!chat()) {
      // no room id given: use the room the agent was added to (prefer "Maple St"); keep checking until there is one
      const chats = await rest('GET', '/chats').catch(() => []);
      const list = Array.isArray(chats) ? chats : chats.chats || [];
      const room = list.find((c) => /maple/i.test(c.name || c.title || '')) || list[0];
      if (!room) {
        st.detail = `key verified (${me.name}) · waiting to be added to a room: in BAND, open your room and add ${me.name}`;
        setTimeout(() => module.exports.init().catch((e) => fail(e.message)), 30000);
        return;
      }
      process.env.BAND_CHAT_ID = room.id;
      console.log(`BAND: found room "${room.name || room.title || room.id}"`);
    }
    try {
      const people = await rest('GET', `/chats/${chat()}/participants`);
      const human = (Array.isArray(people) ? people : people.participants || []).find((x) => x.id !== me.id && !/agent/i.test(x.type || x.participant_type || ''));
      if (human) owner = mentionOf(human);
    } catch (e) { /* fall back to env */ }
    if (!owner && process.env.BAND_MENTION_ID) owner = { id: process.env.BAND_MENTION_ID, handle: process.env.BAND_MENTION_HANDLE, name: process.env.BAND_MENTION_NAME };
    if (!owner) throw new Error('nobody to @mention: add yourself to the room or set BAND_MENTION_ID/HANDLE/NAME');
    st.ok = true;
    detail();
    await send(`Impact World is live 🌍 I'll post the agents' alliances, betrayals and council meetings here. Mention me to steer the planet: "status", "rally ocean", "budget", "report".`);
    drain().catch(() => {});
    connectSocket();
  },
  // OUT: one agent event → the room (rate-limited per agent); true only when BAND accepted it
  async post(e) {
    if (!st.ok) return false;
    const now = Date.now();
    if (e.k !== 'end' && now - (lastPost[e.agent] || 0) < RATE_MS()) return false;
    lastPost[e.agent] = now;
    const who = e.agent === 'world' ? '🌍 World' : e.agent === 'baron' ? '🏭 Smog Baron' : e.agent.charAt(0).toUpperCase() + e.agent.slice(1);
    try {
      await send(`[${who}] ${e.act}.\nWhy: ${e.why}${e.say ? `\n“${e.say}”` : ''}`);
      return true;
    } catch (err) { console.log(`BAND post failed: ${String(err.message).slice(0, 160)}`); return false; }
  },
  async say(text) { if (st.ok) await send(text).catch(() => {}); },
};
