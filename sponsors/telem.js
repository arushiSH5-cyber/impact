// Telem: live web search for the agents.
//  (a) each zone's agent cites one real, fresh news result (with a link) in its decision log
//  (b) "Live · via Telem" news reels in the Feed
// API (docs.telem.ai): POST https://router.telem.ai/v1/search, Authorization: Bearer <key>
//   body {user_input:[{query}], search:{auto_routing, num_results, published_after}}
//   → preprocessor_runs[].output_payload.results[]
// Env: TELEM_API_KEY, optional TELEM_BASE_URL. Results are cached once a day.
'use strict';
const status = require('./status');
const { st, health, fail } = status('set TELEM_API_KEY (Telem console → API keys)');
const BASE = () => process.env.TELEM_BASE_URL || 'https://router.telem.ai';
const ZONE_QUERIES = {
  forest: 'Griffith Park Los Angeles trees wildfire news',
  ice: 'Sierra Nevada snowpack news this week',
  desert: 'Los Angeles air quality smog today',
  ocean: 'Santa Monica Bay ocean plastic pollution beach cleanup',
  space: 'space debris news this week',
};
let calls = 0, news = [], facts = {}, day = '';
const today = () => new Date().toISOString().slice(0, 10);
const host = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch (e) { return 'web'; } };

function toItem(x) {
  const url = x.url || x.link || x.source_url || '';
  return {
    title: String(x.title || x.name || x.headline || '').trim(),
    url,
    summary: String(x.snippet || x.description || x.summary || x.content || x.text || '').replace(/\s+/g, ' ').slice(0, 240),
    published: x.published_date || x.published_at || x.date || '',
    source: host(url),
  };
}

async function search(queries, num) {
  const since = new Date(Date.now() - 14 * 864e5).toISOString().slice(0, 10);
  const r = await fetch(BASE() + '/v1/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.TELEM_API_KEY },
    body: JSON.stringify({ user_input: queries.map((query) => ({ query })), search: { auto_routing: 'accuracy', num_results: num, published_after: since } }),
  });
  if (!r.ok) throw new Error(`Telem ${r.status} ${(await r.text()).slice(0, 140)}`);
  calls++;
  const j = await r.json();
  const runs = j.preprocessor_runs || [];
  if (process.env.TELEM_DEBUG) console.log('Telem raw:', JSON.stringify(j).slice(0, 1500));
  // results come back per run; match a run to its query when the run says which one it is, else by order
  const byQuery = {};
  runs.forEach((run, i) => {
    if (run.error) return;
    const q = typeof run.query === 'string' ? run.query : (run.query && run.query.query) || queries[i] || queries[0];
    const results = (run.output_payload && run.output_payload.results) || [];
    for (const x of results) {
      const it = toItem(x);
      if (it.title && it.url) (byQuery[q] = byQuery[q] || []).push(it);
    }
  });
  return byQuery;
}

async function refresh() {
  if (day === today() && news.length) return;
  const qs = Object.values(ZONE_QUERIES);
  const res = await search(qs, 2);
  const nextFacts = {};
  for (const [zone, q] of Object.entries(ZONE_QUERIES)) if (res[q] && res[q][0]) nextFacts[zone] = res[q][0];
  const seen = new Set();
  const items = Object.values(res).flat().filter((x) => !seen.has(x.url) && seen.add(x.url));
  if (!items.length) throw new Error('Telem returned no results');
  facts = nextFacts;
  news = items.slice(0, 8);
  day = today();
  st.detail = `${calls} searches · ${news.length} live items today · ${Object.keys(facts).length} zones cited`;
}

module.exports = {
  health, fail,
  async init() {
    if (!process.env.TELEM_API_KEY) return;
    await refresh();
    st.ok = true;
  },
  async news() {
    if (!st.ok) return [];
    try { await refresh(); } catch (e) { /* keep yesterday's cache */ }
    return news;
  },
  fact(zone) { return st.ok ? facts[zone] || null : null; },
};
