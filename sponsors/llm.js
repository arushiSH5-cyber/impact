// AI for Impact (optional): Gemini or OpenAI, whichever key is set (Gemini first; AI_PROVIDER=openai to force).
//  1) scan(image): reads a receipt or utility bill photo and EXTRACTS line items as JSON (fixed schema).
//     It never does carbon math: the server computes every number from public/factors.js.
//  2) say(entry): one short in-character line for an agent's big moment.
// Raw fetch on purpose: the server has zero dependencies.
// Env: GEMINI_API_KEY (optional GEMINI_MODEL) and/or OPENAI_API_KEY (optional OPENAI_MODEL), optional AI_PROVIDER.
'use strict';
const status = require('./status');
const FX = require('../public/factors.js').ImpactFactors;
const { st, health, fail } = status('set GEMINI_API_KEY or OPENAI_API_KEY to enable (receipt scan + agent voices)');
let provider = null, model = null, calls = 0, scans = 0, lastSay = 0;

// ------------------------------------------------------------------ schema + prompt (shared)
const ITEM_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: FX.KINDS },
          name: { type: 'string', description: 'the line as printed, short' },
          food: { type: 'string', description: `for grocery/meal/food_waste only: one of ${Object.keys(FX.FOOD).join(', ')}, or "other"` },
          kg: { type: 'number', description: 'weight in kg if printed (grocery), else 0' },
          qty: { type: 'number', description: 'kWh, therms, gallons, km, minutes or item count, as printed, else 0' },
        },
        required: ['kind', 'name', 'food', 'kg', 'qty'],
        additionalProperties: false,
      },
    },
  },
  required: ['items'],
  additionalProperties: false,
};
const SCAN_PROMPT = `This is a photo of a grocery receipt, a restaurant receipt, a gas station receipt, or a utility bill.
Extract only what is actually printed. Do not estimate emissions or invent items.
- Grocery lines that match a food in the list: kind "grocery", food = that food, kg = printed weight (0 if no weight is printed).
- Restaurant dishes: kind "meal", food = the main protein from the list (or "other"), qty = number of dishes.
- Gasoline: kind "gas", qty = gallons.
- Electricity bill: kind "kwh", qty = kWh used this period. Natural gas bill: kind "therm", qty = therms.
- Bottled drinks: kind "bottle", qty = count. Clothing: kind "new_clothes", qty = count.
Skip everything else (tax, bag fees, totals, non-food items). If nothing is readable, return an empty list.`;

function parseDataURL(url) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ''));
  if (!m) throw new Error('send a base64 JPEG/PNG/WebP data URL');
  if (m[2].length > 7e6) throw new Error('image too large (resize under ~5 MB)');
  return { mime: m[1], data: m[2], url };
}
async function readError(r, who) { return new Error(`${who} ${r.status} ${(await r.text()).replace(/\s+/g, ' ').slice(0, 180)}`); }

// ------------------------------------------------------------------ Gemini (generateContent)
const GEMINI = 'https://generativelanguage.googleapis.com/v1beta';
async function geminiPickModel() {
  if (process.env.GEMINI_MODEL) return process.env.GEMINI_MODEL.replace(/^models\//, '');
  // ask which models this key can use; prefer a regular Flash model (fast, cheap, vision + JSON)
  const r = await fetch(`${GEMINI}/models?pageSize=200`, { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY } });
  if (!r.ok) throw await readError(r, 'Gemini models');
  const names = ((await r.json()).models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => m.name.replace(/^models\//, ''));
  // plain numbered Flash models, newest first (gemini-3.8-flash, gemini-3.7-flash, …), then Flash-Lite, then the -latest aliases
  const ver = (n) => parseFloat((/^gemini-(\d+(?:\.\d+)?)-/.exec(n) || [])[1] || 0);
  const plain = names.filter((n) => /^gemini-\d+(\.\d+)?-flash$/.test(n)).sort((a, b) => ver(b) - ver(a));
  const lite = names.filter((n) => /^gemini-\d+(\.\d+)?-flash-lite$/.test(n)).sort((a, b) => ver(b) - ver(a));
  const order = [...plain, ...lite, ...names.filter((n) => /^gemini-flash(-lite)?-latest$/.test(n))];
  // keep the first one that really answers on this key (some have no free quota or are overloaded)
  const tried = [];
  for (const m of order.slice(0, 8)) {
    model = m;
    try { if (await gemini([{ text: 'Reply with the single word: ready' }], false)) return m; } catch (e) { tried.push(`${m}: ${String(e.message).slice(0, 40)}`); }
  }
  throw new Error(`no Gemini model answered on this key (${tried.join('; ') || 'none listed'})`);
}
async function gemini(parts, json) {
  const generationConfig = json ? { responseMimeType: 'application/json', responseJsonSchema: ITEM_SCHEMA } : {};
  const r = await fetch(`${GEMINI}/models/${model}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig }),
  });
  if (!r.ok) throw await readError(r, 'Gemini');
  const j = await r.json();
  const c = (j.candidates || [])[0];
  if (!c) throw new Error(`Gemini returned no answer${j.promptFeedback && j.promptFeedback.blockReason ? ` (${j.promptFeedback.blockReason})` : ''}`);
  return ((c.content && c.content.parts) || []).map((p) => p.text || '').join('').trim();
}

// ------------------------------------------------------------------ OpenAI (Responses API)
async function openai(content, json) {
  const body = { model, input: [{ role: 'user', content }] };
  if (json) body.text = { format: { type: 'json_schema', name: 'receipt_items', strict: true, schema: ITEM_SCHEMA } };
  const r = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.OPENAI_API_KEY },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw await readError(r, 'OpenAI');
  const j = await r.json();
  const out = [];
  for (const item of j.output || []) {
    for (const c of item.content || []) {
      if (c.type === 'refusal') throw new Error('the model declined this request');
      if (c.type === 'output_text') out.push(c.text);
    }
  }
  return out.join('').trim();
}

// ------------------------------------------------------------------ provider-neutral calls
async function ask(text) {
  calls++;
  const t = provider === 'gemini' ? await gemini([{ text }], false) : await openai([{ type: 'input_text', text }], false);
  st.detail = `${provider} · ${model} · ${calls} calls · ${scans} scans`;
  return t;
}
async function extract(img) {
  calls++;
  const t = provider === 'gemini'
    ? await gemini([{ inline_data: { mime_type: img.mime, data: img.data } }, { text: SCAN_PROMPT }], true)
    : await openai([{ type: 'input_image', image_url: img.url }, { type: 'input_text', text: SCAN_PROMPT }], true);
  scans++;
  st.detail = `${provider} · ${model} · ${calls} calls · ${scans} scans`;
  return t;
}

module.exports = {
  health, fail,
  ok: () => st.ok,
  async init() {
    const want = (process.env.AI_PROVIDER || '').toLowerCase();
    const hasG = !!process.env.GEMINI_API_KEY, hasO = !!process.env.OPENAI_API_KEY;
    provider = want === 'openai' && hasO ? 'openai' : want === 'gemini' && hasG ? 'gemini' : hasG ? 'gemini' : hasO ? 'openai' : null;
    if (!provider) return;
    model = provider === 'gemini' ? await geminiPickModel() : process.env.OPENAI_MODEL || 'gpt-6-astra';
    const t = await ask('Reply with the single word: ready');
    if (!t) throw new Error(`${provider} returned an empty reply`);
    st.ok = true;
    st.detail = `${provider} · ${model} · ${calls} calls · ${scans} scans`;
  },
  async say(e) {
    if (!st.ok) return null;
    // voice lines are a nice-to-have: at most one every VOICE_EVERY_MS so free-tier quota stays free for receipt scans
    const now = Date.now();
    if (now - lastSay < (+process.env.VOICE_EVERY_MS || 30000)) return null;
    lastSay = now;
    const who = e.agent === 'baron' ? 'the Smog Baron' : e.agent.charAt(0).toUpperCase() + e.agent.slice(1);
    const t = await ask(`You are ${who}, a character in a cozy eco game. You just did this: "${e.act}". Reason: ${e.why}. Say ONE short in-character line (max 14 words). No quotes, no hashtags.`);
    return t.split('\n')[0].replace(/^"|"$/g, '').slice(0, 140) || null;
  },
  // returns raw items; the caller computes footprints with the cited factors
  async scan(dataURL) {
    if (!st.ok) throw new Error('AI not connected');
    const text = await extract(parseDataURL(dataURL));
    let parsed;
    try { parsed = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch (e) { throw new Error('the AI did not return valid JSON'); }
    return (parsed.items || []).filter((x) => FX.KINDS.includes(x.kind)).slice(0, 40).map((x) => {
      const out = { kind: x.kind, name: String(x.name || '').slice(0, 60) };
      if (x.food && x.food !== 'other') out.food = x.food;
      if (+x.kg > 0) out.kg = +x.kg;
      if (+x.qty > 0) out.qty = +x.qty;
      return out;
    });
  },
};
