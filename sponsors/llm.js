// Claude (Anthropic Messages API), optional:
//  1) scan(image): reads a receipt or utility bill photo and EXTRACTS line items as JSON.
//     It never does carbon math: the server computes every number from public/factors.js.
//  2) say(entry): one short in-character line for an agent's big moment.
// Raw fetch on purpose: the server has zero dependencies. Env: ANTHROPIC_API_KEY, optional LLM_MODEL.
'use strict';
const status = require('./status');
const FX = require('../public/factors.js').ImpactFactors;
const { st, health, fail } = status('set ANTHROPIC_API_KEY to enable (receipt scan + agent voices)');
const MODEL = process.env.LLM_MODEL || 'claude-opus-5-5';
let calls = 0, scans = 0;

async function call(body) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'anthropic-beta': 'server-side-fallback-2026-07-01',
    },
    body: JSON.stringify(Object.assign({ model: MODEL, fallbacks: 'default' }, body)),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status} ${(await r.text()).slice(0, 160)}`);
  const j = await r.json();
  calls++;
  st.detail = `${MODEL} · ${calls} calls · ${scans} scans`;
  if (j.stop_reason === 'refusal') throw new Error('the model declined this request');
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return text;
}

// JSON schema for extracted items: only kinds the factor table understands
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
          kg: { type: 'number', description: 'weight in kg if printed or clearly implied (grocery), else 0' },
          qty: { type: 'number', description: 'kWh, therms, gallons, km, minutes or item count, as printed' },
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
- Grocery lines that match a food in the list: kind "grocery", food = that food, kg = printed weight (use 0 if no weight is printed).
- Restaurant dishes: kind "meal", food = the main protein from the list (or "other"), qty = number of dishes.
- Gasoline: kind "gas", qty = gallons.
- Electricity bill: kind "kwh", qty = kWh used this period. Natural gas bill: kind "therm", qty = therms.
- Bottled drinks: kind "bottle", qty = count. Clothing: kind "new_clothes", qty = count.
Skip anything else (tax, bags fees, totals, non-food items). If nothing is readable, return an empty list.`;

function parseDataURL(url) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ''));
  if (!m) throw new Error('send a base64 JPEG/PNG/WebP data URL');
  if (m[2].length > 7e6) throw new Error('image too large (resize under ~5 MB)');
  return { media_type: m[1], data: m[2] };
}

module.exports = {
  health, fail,
  ok: () => st.ok,
  async init() {
    if (!process.env.ANTHROPIC_API_KEY) return;
    const t = await call({ max_tokens: 1024, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with the single word: ready' }] });
    if (t) st.ok = true;
  },
  async say(e) {
    if (!st.ok) return null;
    const who = e.agent.charAt(0).toUpperCase() + e.agent.slice(1);
    const t = await call({
      max_tokens: 1024, output_config: { effort: 'low' },
      messages: [{ role: 'user', content: `You are ${who}, a character in a cozy eco game. You just did this: "${e.act}". Reason: ${e.why}. Say ONE short in-character line (max 14 words), no quotes.` }],
    });
    return t.replace(/^"|"$/g, '').slice(0, 140) || null;
  },
  // returns raw items; the caller computes footprints with the cited factors
  async scan(dataURL) {
    if (!st.ok) throw new Error('Claude not connected');
    const img = parseDataURL(dataURL);
    const text = await call({
      max_tokens: 8000,
      output_config: { effort: 'low', format: { type: 'json_schema', schema: ITEM_SCHEMA } },
      messages: [{ role: 'user', content: [{ type: 'image', source: Object.assign({ type: 'base64' }, img) }, { type: 'text', text: SCAN_PROMPT }] }],
    });
    scans++;
    st.detail = `${MODEL} · ${calls} calls · ${scans} scans`;
    const items = (JSON.parse(text).items || []).slice(0, 40).map((x) => {
      const out = { kind: x.kind, name: String(x.name || '').slice(0, 60) };
      if (x.food && x.food !== 'other') out.food = x.food;
      if (x.kg > 0) out.kg = x.kg;
      if (x.qty > 0) out.qty = x.qty;
      return out;
    });
    return items;
  },
};
