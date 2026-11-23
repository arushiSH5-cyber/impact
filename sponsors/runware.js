// Runware: "Make my world postcard" paints the planet's live state as a storybook postcard.
// API (runware.ai/docs): POST https://api.runware.ai/v1, Authorization: Bearer <key>
//   body [{taskType:"imageInference", taskUUID, positivePrompt, model, width, height, numberResults, outputType:"URL", includeCost:true}]
//   → data[0].imageURL, data[0].cost
// Env: RUNWARE_API_KEY, optional RUNWARE_MODEL. Images are cached per world state.
'use strict';
const crypto = require('crypto');
const status = require('./status');
const { st, health, fail } = status('set RUNWARE_API_KEY');
const MODEL = process.env.RUNWARE_MODEL || 'runware:101@1';
let images = 0, total = 0, keySet = false;
const cache = {};
// verified usage survives restarts (tied to a hash of the key, never the key itself)
const fs = require('fs');
const path = require('path');
const USAGE = path.join(__dirname, '..', 'data', 'runware_usage.json');
const keyHash = () => crypto.createHash('sha256').update(String(process.env.RUNWARE_API_KEY)).digest('hex').slice(0, 12);
function save() { try { fs.writeFileSync(USAGE, JSON.stringify({ key: keyHash(), images, total, last: new Date().toISOString() })); } catch (e) { /* best effort */ } }

async function generate(prompt) {
  const r = await fetch('https://api.runware.ai/v1', {
    signal: AbortSignal.timeout(+process.env.AI_TIMEOUT_MS || 45000),
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.RUNWARE_API_KEY },
    body: JSON.stringify([{ taskType: 'imageInference', taskUUID: crypto.randomUUID(), positivePrompt: prompt, model: MODEL,
      width: 1024, height: 1024, numberResults: 1, outputType: 'URL', outputFormat: 'JPG', includeCost: true }]),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || (j.errors && j.errors.length)) throw new Error(`Runware ${r.status} ${JSON.stringify(j.errors || j).slice(0, 180)}`);
  const d = (j.data || [])[0];
  if (!d || !d.imageURL) throw new Error('Runware returned no image');
  images++;
  total += +d.cost || 0;
  st.ok = true;
  st.detail = `${images} images · total cost $${total.toFixed(4)}`;
  save();
  return { url: d.imageURL, cost: d.cost != null ? +d.cost : null };
}

// Runware voices: each character speaks with its own text-to-speech voice (Inworld TTS-2 on Runware). Cached per line.
const VOICES = {
  mossling: { voice: 'Pixie', tag: '[speak cheerfully, warm and gentle]' },
  ripplet: { voice: 'Sarah', tag: '[speak brightly, bubbly]' },
  frostbun: { voice: 'Olivia', tag: '[speak softly and sweetly]' },
  sunfox: { voice: 'Timothy', tag: '[speak slyly, playful]' },
  baron: { voice: 'Hades', tag: '[speak like a dramatic cartoon villain, slow and sinister]' },
};
const voiceCache = {};
let voices = 0;
async function tts(text, voice) {
  const r = await fetch('https://api.runware.ai/v1', {
    signal: AbortSignal.timeout(30000), method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.RUNWARE_API_KEY },
    body: JSON.stringify([{ taskType: 'audioInference', taskUUID: crypto.randomUUID(), model: process.env.RUNWARE_TTS_MODEL || 'inworld:tts@2', includeCost: true, speech: { text, voice } }]),
  });
  const j = await r.json().catch(() => ({}));
  const d = (j.data || [])[0];
  if (!r.ok || !d || !d.audioURL) throw new Error(`Runware voice ${r.status} ${JSON.stringify(j.errors || j).slice(0, 160)}`);
  return d;
}

const mood = (v) => (v >= 70 ? 'lush and thriving' : v >= 40 ? 'recovering' : 'struggling and grey with smog');

module.exports = {
  health, fail,
  ready: () => keySet,
  async init() {
    if (!process.env.RUNWARE_API_KEY) return;
    keySet = true;
    st.detail = `key set · model ${MODEL} · no image yet`;
    try {
      const u = JSON.parse(fs.readFileSync(USAGE, 'utf8'));
      if (u.key === keyHash() && u.images > 0) {
        images = u.images; total = u.total; st.ok = true;
        st.detail = `verified · ${images} images · total cost $${total.toFixed(4)} (last ${u.last.slice(11, 16)} UTC)`;
      }
    } catch (e) { /* no verified usage yet */ }
    // green only after the first real image (made on demand from the app)
  },
  async speak(agent, text) {
    const v = VOICES[agent] || VOICES.mossling;
    const line = String(text || '').replace(/[\[\]<>]/g, '').slice(0, 160).trim();
    if (!line) throw new Error('nothing to say');
    const key = agent + '|' + line;
    if (voiceCache[key]) return Object.assign({ cached: true, total }, voiceCache[key]);
    let d;
    try { d = await tts(`${v.tag} ${line}`, v.voice); } catch (e) { d = await tts(`${v.tag} ${line}`, 'Sarah'); }
    voices++;
    total += +d.cost || 0;
    st.ok = true;
    st.detail = `${images} images · ${voices} voice lines · total cost $${total.toFixed(4)}`;
    save();
    voiceCache[key] = { url: d.audioURL, cost: d.cost != null ? +d.cost : null, voice: v.voice };
    return Object.assign({ cached: false, total }, voiceCache[key]);
  },
  async postcard(body) {
    const H = body.H || {};
    const bucket = (v) => (v >= 70 ? 2 : v >= 40 ? 1 : 0);
    const key = ['forest', 'ice', 'desert', 'ocean'].map((z) => bucket(+H[z] || 0)).join('') + (body.ending || '') + (body.twist || '');
    if (cache[key]) return Object.assign({ cached: true, total }, cache[key]);
    const prompt = `cute cozy hand-drawn storybook postcard of a tiny round planet floating in space, pastel colors, thick ink outlines, `
      + `a forest that is ${mood(H.forest)}, polar ice that is ${mood(H.ice)}, a desert oasis that is ${mood(H.desert)}, `
      + `an ocean that is ${mood(H.ocean)}, little smiling moss sprite waving, stars, no text`
      + (body.ending ? `, the story ends: ${body.ending}` : '') + (body.twist ? `, ${body.twist}` : '');
    const out = await generate(prompt);
    cache[key] = Object.assign({ prompt }, out);
    return Object.assign({ cached: false, total }, cache[key]);
  },
};
