// Captures what the sponsors really returned on our live server and saves it next to the app, so the
// always-on GitHub Pages build (no server, no keys) can show it, clearly labeled "recorded live today".
// Usage: npm start (with .env keys) in one terminal, then: node scripts/snapshot.mjs
import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.IMPACT_URL || 'http://localhost:8787';
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'snap');
fs.mkdirSync(OUT, { recursive: true });

// every fixed line the app speaks, plus one intro per character (used by "Hear" on character cards)
const LINES = {
  baron: ['Sunfox, my dear… these shiny seeds are yours if you look the other way.', 'That zone looks… delicious.', 'Ah, a little duel. I will learn every move you make.', 'Predictable. So very predictable.', 'Enough games. I will grey this planet myself!', 'Curses! This is not over!', 'Mwahaha! The planet is mine… for now.', ['intro', 'Mwahaha. Soon this whole little planet will be grey, and all mine.']],
  sunfox: ["Nope! I'm sticking with my friends!", 'Hehe… sorry, guardians. A fox has to eat!', ['intro', 'I go wherever the seeds are. Got any more?']],
  mossling: ["Hi friend! Let's heal the planet together!", 'Yes! Teamwork!', 'Max combo! You are on fire!', 'You did it! Thank you!', ['intro', "Hi, I'm Mossling! Help me grow the forest back!"]],
  ripplet: ["Let's go! I'll take the right side!", 'Triple combo! You are amazing!', 'Wow! The ocean is sparkling!', 'Good try! Again?', 'Guardians, positions! Protect the planet!', 'Yes! Teamwork!', 'You did it! Thank you!', 'A wild litter critter appeared!', 'Gotcha! Into the bin you go!', 'Whoa! It evolved!', ['intro', "Hi, I'm Ripplet! Let's keep the ocean clean!"]],
  frostbun: ['Yes! Teamwork!', 'You did it! Thank you!', ['intro', "Hi, I'm Frostbun. The ice needs you today!"]],
};

const get = (p) => fetch(BASE + p).then((r) => r.json());
const post = (p, b) => fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
async function download(url, file) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  fs.writeFileSync(path.join(OUT, file), Buffer.from(await r.arrayBuffer()));
  return 'snap/' + file;
}

const health = await get('/api/health');
const st = await get('/api/state');
const news = await get('/api/news').then((r) => r.items || []).catch(() => []);
const band = (st.state.log || []).filter((e) => e.band).slice(-8).reverse().map((e) => ({ agent: e.agent, act: e.act, why: e.why }));

// Runware postcards: keep a local copy (CDN links can expire)
const seen = new Set();
const postcards = [];
for (const c of (st.state.postcards || []).slice(-4)) {
  if (seen.has(c.url)) continue; seen.add(c.url);
  try { postcards.push({ seed: c.seed, status: c.status, cost: c.cost, url: await download(c.url, `postcard-${c.seed}.jpg`) }); } catch (e) { console.log('postcard skipped', e.message); }
}

// Runware voices: one real TTS call per line through our server's /api/voice
const voices = {};
let n = 0;
for (const [agent, lines] of Object.entries(LINES)) {
  for (const l of lines) {
    const [key, text] = Array.isArray(l) ? l : [l, l];
    const r = await post('/api/voice', { agent, text });
    if (!r.url) { console.log('voice failed', agent, text, r.error); continue; }
    voices[`${agent}|${key}`] = await download(r.url, `voice-${agent}-${n++}.mp3`);
  }
}

const keep = (h) => ({ ok: !!(h && h.ok), detail: h && h.detail });
const snapshot = {
  captured: new Date().toISOString(),
  note: 'Recorded from the live Impact server with real sponsor calls. The GitHub Pages build has no server or API keys, so it replays these.',
  health: { bruin: keep(health.bruin), band: keep(health.band), telem: keep(health.telem), runware: keep(health.runware) },
  spawn: st.spawn || null,
  news, band, postcards, voices,
};
fs.writeFileSync(path.join(OUT, 'snapshot.json'), JSON.stringify(snapshot, null, 1));
console.log(`snapshot: ${news.length} news · ${band.length} BAND posts · ${postcards.length} postcards · ${Object.keys(voices).length} voice clips · spawn ${snapshot.spawn ? snapshot.spawn.length : 0} rows`);
