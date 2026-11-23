// Glasser: real-world place data for "Drop-off places near me" (recycling, e-waste, refill) via the Glasser CLI.
//   npm install -g @glasser-ai/cli@latest   ·   glasser login (or GLASSER_API_KEY)   ·   glasser balance
//   glasser search -q "maps places"   ·   glasser inspect -p <provider> -e <endpoint>
// Env: GLASSER_API_KEY, GLASSER_PLACES_PROVIDER, GLASSER_PLACES_ENDPOINT, GLASSER_PLACES_INPUT (JSON template with {{q}})
'use strict';
const { execFile } = require('child_process');
const crypto = require('crypto');
const status = require('./status');
const { st, health, fail } = status('install @glasser-ai/cli, set GLASSER_API_KEY + GLASSER_PLACES_*');
let runs = 0;
const cache = {};

const cli = (args) => new Promise((resolve, reject) => {
  execFile('glasser', args, { timeout: 60000, env: process.env }, (err, out, errOut) => (err ? reject(new Error(String(errOut || err.message).slice(0, 200))) : resolve(out)));
});

function pickList(j) {
  const body = j.output || j.result || j.data || j;
  const list = Array.isArray(body) ? body : body.places || body.local_results || body.results || body.items || [];
  return list.slice(0, 5).map((p) => ({
    name: p.title || p.name || p.displayName && p.displayName.text || '',
    address: p.address || p.formatted_address || p.formattedAddress || '',
    rating: p.rating || null,
    url: p.website || p.websiteUri || p.link || p.url || '',
  })).filter((p) => p.name);
}

module.exports = {
  health, fail,
  async init() {
    if (!process.env.GLASSER_API_KEY) return;
    await cli(['balance', '-j']);
    if (!process.env.GLASSER_PLACES_PROVIDER || !process.env.GLASSER_PLACES_ENDPOINT) {
      st.detail = 'authenticated · set GLASSER_PLACES_PROVIDER/ENDPOINT';
      return;
    }
    st.ok = true;
    st.detail = `${process.env.GLASSER_PLACES_PROVIDER}/${process.env.GLASSER_PLACES_ENDPOINT} · ${runs} runs`;
  },
  async places(q) {
    if (!st.ok) return null;
    if (cache[q]) return cache[q];
    const input = (process.env.GLASSER_PLACES_INPUT || '{"q":"{{q}}"}').replace('{{q}}', q.replace(/["\\]/g, ''));
    const out = await cli(['run', '-p', process.env.GLASSER_PLACES_PROVIDER, '-e', process.env.GLASSER_PLACES_ENDPOINT,
      '-i', input, '-j', '--wait', '--idempotency-key', crypto.randomUUID()]);
    runs++;
    st.detail = `${process.env.GLASSER_PLACES_PROVIDER}/${process.env.GLASSER_PLACES_ENDPOINT} · ${runs} runs`;
    const list = pickList(JSON.parse(out));
    cache[q] = list;
    return list;
  },
};
