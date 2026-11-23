// Optional: a one-line, in-character voice for an agent's big moments (Anthropic Messages API).
// The game works fully without it. Env: ANTHROPIC_API_KEY, optional LLM_MODEL.
'use strict';
const status = require('./status');
const { st, health, fail } = status('set ANTHROPIC_API_KEY to enable');
const MODEL = process.env.LLM_MODEL || 'claude-haiku-5-5';
let calls = 0;

async function ask(prompt) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: MODEL, max_tokens: 60, messages: [{ role: 'user', content: prompt }] }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status} ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  calls++;
  st.detail = `${MODEL} · ${calls} calls`;
  return ((j.content && j.content[0] && j.content[0].text) || '').trim().replace(/^"|"$/g, '');
}

module.exports = {
  health, fail,
  async init() {
    if (!process.env.ANTHROPIC_API_KEY) return;
    if (await ask('Reply with the single word: ready')) st.ok = true;
  },
  async say(e) {
    if (!st.ok) return null;
    const who = e.agent.charAt(0).toUpperCase() + e.agent.slice(1);
    return ask(`You are ${who}, a character in a cozy eco game. You just did this: "${e.act}". Reason: ${e.why}. Say ONE short in-character line (max 14 words), no quotes.`);
  },
};
