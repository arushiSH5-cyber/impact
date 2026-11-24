// Glasser: real-world place data. After you catch a litter critter, "Bin it nearby" finds the closest real
// recycling / e-waste drop-off through Glasser (Serper Google Maps endpoint, $0.003 per call).
// Talks to Glasser's MCP endpoint over plain HTTPS (POST https://api.glasser.ai/mcp, Authorization: Bearer <key>):
//   tools/call balance → connection check (free) · tools/call run {provider, endpoint, input, idempotency_key}
// Env: GLASSER_API_KEY (optional GLASSER_PLACES_PROVIDER / GLASSER_PLACES_ENDPOINT, default serper /maps).
'use strict';
const crypto = require('crypto');
const status = require('./status');
const { st, health, fail } = status('set GLASSER_API_KEY');
const PROVIDER = () => process.env.GLASSER_PLACES_PROVIDER || 'serper';
const ENDPOINT = () => process.env.GLASSER_PLACES_ENDPOINT || '/maps';
let runs = 0, spent = 0;
const cache = {};

async function mcp(name, args) {
  const r = await fetch('https://api.glasser.ai/mcp', {
    method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', authorization: 'Bearer ' + process.env.GLASSER_API_KEY },
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method: 'tools/call', params: { name, arguments: args } }),
  });
  const j = await r.json().catch(() => ({}));
  const text = j && j.result && j.result.content && j.result.content[0] && j.result.content[0].text;
  if (!r.ok || !text) throw new Error(`Glasser ${r.status} ${JSON.stringify(j.error || j).slice(0, 160)}`);
  try { return JSON.parse(text); } catch (e) { throw new Error('Glasser: ' + text.slice(0, 160)); }
}

module.exports = {
  health, fail,
  async init() {
    if (!process.env.GLASSER_API_KEY) return;
    const b = await mcp('balance', {});
    st.ok = true;
    st.detail = `${PROVIDER()}${ENDPOINT()} · balance $${b.available_usd || b.balance_usd} · ${runs} runs`;
  },
  // q: what to look for, near: {lat, lng} (defaults to downtown LA)
  async places(q, near) {
    if (!st.ok) return null;
    const lat = near && isFinite(near.lat) ? (+near.lat).toFixed(3) : '34.052', lng = near && isFinite(near.lng) ? (+near.lng).toFixed(3) : '-118.244';
    const key = `${q}|${lat}|${lng}`;
    if (cache[key]) return cache[key];
    const out = await mcp('run', { provider: PROVIDER(), endpoint: ENDPOINT(), input: { q: String(q).slice(0, 80), ll: `@${lat},${lng},13z`, gl: 'us' }, idempotency_key: crypto.randomUUID() });
    if (out.status !== 'COMPLETED') throw new Error(`Glasser run ${out.status}`);
    runs++;
    spent += 0.003;
    st.detail = `${PROVIDER()}${ENDPOINT()} · ${runs} live runs · ~$${spent.toFixed(3)}`;
    const list = ((out.output && out.output.places) || []).slice(0, 5).map((p) => ({
      name: p.title, address: p.address, rating: p.rating || null, phone: p.phoneNumber || '',
      lat: p.latitude, lng: p.longitude, type: p.type || '', url: p.website || `https://www.google.com/maps/place/?q=place_id:${p.placeId}`,
    }));
    cache[key] = { items: list, run_url: out.run_url };
    return cache[key];
  },
};
