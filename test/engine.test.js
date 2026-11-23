// Quick checks for the agent engine: node test/engine.test.js
'use strict';
const assert = require('assert');
const IA = require('../public/agents-engine.js').ImpactAgents;

// same seed → same run (reproducible); different seed → different run
const a = IA.simulate(42, null, {}), b = IA.simulate(42, null, {}), c = IA.simulate(7, null, {});
assert.deepStrictEqual(a.hist, b.hist, 'seed 42 should replay identically');
assert.notDeepStrictEqual(a.hist, c.hist, 'seeds 42 and 7 should differ');

// every decision has an agent, an action, a why and a source
const mem = {};
let S = IA.create(42, null, mem);
IA.join(S, { id: 'p1', name: 'Riya', profile: { eat: 'meat' } });
for (let i = 0; i < 40; i++) IA.tick(S, null, mem);
for (const e of S.log) {
  assert.ok(e.agent && e.act && e.why, `incomplete entry ${JSON.stringify(e)}`);
  assert.ok(Array.isArray(e.src) && e.src.length, `entry without source: ${e.act}`);
}
// agents interact with each other
const kinds = new Set(S.log.map((e) => e.k));
assert.ok(kinds.has('ally') || kinds.has('trade'), 'agents should ally or trade');
// personalized quest from Riya's profile
const quest = S.log.find((e) => e.k === 'quest' && e.agent === 'mossling');
if (quest) assert.doesNotMatch(quest.act, /plant-based|meal|meat/, 'agents never judge what people eat');

// a real action heals the zone and is logged
const before = S.H.ocean;
IA.human(S, 'p1', { label: 'Used a refill bottle', deltas: { ocean: 4 }, real: true, proof: 2 }, false);
assert.ok(S.H.ocean > before, 'real action should heal the ocean');

// learning: after a finished run, the next run starts with "remembers run N"
const mem2 = {};
let T = IA.create(42, null, mem2);
for (let i = 0; i < 200 && T.status === 'playing'; i++) IA.tick(T, null, mem2);
const next = IA.create(43, null, mem2);
assert.ok(next.log.some((e) => e.k === 'learn'), 'agents should remember the previous run');

// carbon ledger: server-side math from cited factors, ledger quests, council
{
  const L = IA.create(42, null, {});
  IA.join(L, { id: 'r', name: 'Riya' });
  const e = IA.human(L, 'r', { real: true, items: [{ kind: 'meal', food: 'beef' }, { kind: 'drive', qty: 25 }, { kind: 'meal', food: 'unicorn' }] }, false);
  assert.strictEqual(e.items.length, 2, 'unknown foods are skipped, not guessed');
  assert.ok(Math.abs(L.players.r.led.food - 99.48 * 0.15) < 1e-9, 'beef meal = 99.48 kg/kg × 150 g');
  for (let i = 0; i < 13; i++) IA.tick(L, null, {});
  assert.ok(!L.log.some((x) => x.k === 'quest' && /plant-based|meal/.test(x.act)), 'no agent nags about food');
  assert.ok(L.log.some((x) => x.k === 'council'), 'the council meets');
}

console.log(`ok · seed 42: ${a.status} (${a.avg}) · seed 7: ${c.status} (${c.avg}) · ${S.log.length} log entries`);
