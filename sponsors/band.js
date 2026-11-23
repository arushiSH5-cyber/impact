// BAND: the agents' social life goes to a real BAND room, so humans can watch the agents' group chat.
// API (docs.band.ai): POST {BASE}/chats/{chat_id}/messages, header X-API-Key,
//   body {message:{content:"@handle ...", mentions:[{id,handle,name}]}}  (at least one @mention is required)
// Env: BAND_API_KEY, BAND_CHAT_ID, optional BAND_BASE, optional BAND_MENTION_ID/HANDLE/NAME.
'use strict';
const status = require('./status');
const { st, health, fail } = status('set BAND_API_KEY + BAND_CHAT_ID');
const BASE = () => process.env.BAND_BASE || 'https://api.band.ai/api/v1/agent';
const RATE_MS = +process.env.BAND_RATE_MS || 60000; // max 1 post per agent per minute
const headers = () => ({ 'content-type': 'application/json', 'x-api-key': process.env.BAND_API_KEY });
let me = null, mention = null, posted = 0;
const lastPost = {};

async function get(p) {
  const r = await fetch(BASE() + p, { headers: headers() });
  if (!r.ok) throw new Error(`BAND GET ${p} → ${r.status}`);
  const j = await r.json();
  return j.data !== undefined ? j.data : j;
}

module.exports = {
  health, fail,
  async init() {
    const chat = process.env.BAND_CHAT_ID;
    if (!process.env.BAND_API_KEY || !chat) return;
    me = await get('/me');
    try {
      const people = await get(`/chats/${chat}/participants`);
      const other = (Array.isArray(people) ? people : people.participants || []).find((x) => x.id !== me.id);
      if (other) mention = { id: other.id, handle: other.handle, name: other.name };
    } catch (e) { /* fall back to env below */ }
    if (!mention && process.env.BAND_MENTION_ID) {
      mention = { id: process.env.BAND_MENTION_ID, handle: process.env.BAND_MENTION_HANDLE, name: process.env.BAND_MENTION_NAME };
    }
    if (!mention) throw new Error('nobody to @mention: add yourself to the room or set BAND_MENTION_ID/HANDLE/NAME');
    st.ok = true;
    st.detail = `room ${chat.slice(0, 8)}… · ${posted} posts`;
  },
  // returns true only when BAND accepted the message
  async post(e) {
    if (!st.ok) return false;
    const now = Date.now();
    if (now - (lastPost[e.agent] || 0) < RATE_MS) return false;
    lastPost[e.agent] = now;
    const who = e.agent === 'world' ? 'World' : e.agent.charAt(0).toUpperCase() + e.agent.slice(1);
    const content = `@${mention.handle} [${who}] ${e.act}. Why: ${e.why}`.slice(0, 900);
    const r = await fetch(`${BASE()}/chats/${process.env.BAND_CHAT_ID}/messages`, {
      method: 'POST', headers: headers(), body: JSON.stringify({ message: { content, mentions: [mention] } }),
    });
    if (!r.ok) { console.log(`BAND post ${r.status}: ${(await r.text()).slice(0, 160)}`); return false; }
    posted++;
    st.detail = `room ${process.env.BAND_CHAT_ID.slice(0, 8)}… · ${posted} posts`;
    return true;
  },
};
