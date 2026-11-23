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
  return { url: d.imageURL, cost: d.cost != null ? +d.cost : null };
}

const mood = (v) => (v >= 70 ? 'lush and thriving' : v >= 40 ? 'recovering' : 'struggling and grey with smog');

module.exports = {
  health, fail,
  ready: () => keySet,
  async init() {
    if (!process.env.RUNWARE_API_KEY) return;
    keySet = true;
    st.detail = `key set · model ${MODEL} · no image yet`;
    // green only after the first real image (made on demand from the app)
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
