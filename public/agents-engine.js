/*
 * Impact agent engine.
 * Runs unchanged in Node (server.js, the authoritative world) and in the browser (offline single-player).
 *
 * Five agents with their own goals act every tick. Each one scores its options from:
 *   goal gap  x  live data signal (Bruin daily_spawn)  x  relationships (trust)  +  seeded personality
 *   +  learned bias from earlier runs  +  a little seeded noise
 * and picks the best. Every decision is logged with why, the data it used, its sources and the
 * runner-up options it rejected.
 */
(function (root) {
  'use strict';

  // ---------------------------------------------------------------- world constants
  const ZONES = ['forest', 'ice', 'desert', 'ocean', 'space'];
  const ZONE_NAME = { forest: 'Forest', ice: 'Ice', desert: 'Desert', ocean: 'Ocean', space: 'Space' };
  const ROUND_TICKS = 120;
  const GOAL_HEALTH = 70;

  // ---- the carbon ledger: every player's real log feeds the agents (math lives in factors.js)
  const FX = typeof module !== 'undefined' && typeof require === 'function' ? require('./factors.js').ImpactFactors : root.ImpactFactors;
  const DEFAULT_BUDGET = { food: 6, travel: 8, water: 250, stuff: 4 }; // per person per day: kg CO2e, kg CO2e, liters, items
  const CAT_ZONE = { food: 'forest', travel: 'ice', water: 'ocean', stuff: 'desert' };
  const CAT_AGENT = { food: 'mossling', travel: 'frostbun', water: 'ripplet', stuff: 'sunfox' };
  const CAT_NAME = { food: 'food', travel: 'travel & energy', water: 'water', stuff: 'stuff & trash' };
  const COUNCIL_EVERY = 12;
  const todayKey = () => new Date().toDateString();

  const AGENTS = [
    { id: 'mossling', name: 'Mossling', role: 'Gardener', type: 'guardian', goal: 'forest', home: 'forest', color: '#5fbf6a',
      voice: { pitch: 1.4, rate: 1.05 }, bio: 'Wants the forest back above 70. Plants trees, makes allies, asks humans for plant-based meals.' },
    { id: 'ripplet', name: 'Ripplet', role: 'Cleaner', type: 'guardian', goal: 'ocean', home: 'ocean', color: '#4aa8e0',
      voice: { pitch: 1.2, rate: 1.1 }, bio: 'Hates plastic. Cleans beaches and recruits humans for litter hunts.' },
    { id: 'frostbun', name: 'Frostbun', role: 'Keeper', type: 'guardian', goal: 'ice', home: 'ice', color: '#bfe6ff',
      voice: { pitch: 1.6, rate: 1.0 }, bio: 'Guards the ice cap. Gets anxious when it is warm and cars are everywhere.' },
    { id: 'sunfox', name: 'Sunfox', role: 'Trader', type: 'trader', goal: 'seeds', home: 'desert', color: '#f2a03d',
      voice: { pitch: 1.0, rate: 1.15 }, bio: 'Wants to get rich in seeds. Trades with anyone, and can be bribed.' },
    { id: 'baron', name: 'Smog Baron', role: 'Villain', type: 'villain', goal: 'smog', home: 'space', color: '#7a6f86',
      voice: { pitch: 0.6, rate: 0.9 }, bio: 'Wants the planet below 30. Pollutes the zones humans ignore and bribes Sunfox.' },
  ];
  const BY_ID = {};
  for (const a of AGENTS) BY_ID[a.id] = a;

  // Labeled fallback when the Bruin pipeline has not produced data/daily_spawn.csv yet.
  const SNAPSHOT = [
    { zone: 'forest', place: 'Griffith Park', pm25: 9.1, temp_c: 16, humidity: 58 },
    { zone: 'ice', place: 'Mt. Baldy', pm25: 5.8, temp_c: 4, humidity: 62 },
    { zone: 'desert', place: 'Downtown LA basin', pm25: 31.6, temp_c: 24, humidity: 30 },
    { zone: 'ocean', place: 'Santa Monica Bay', pm25: 11.2, temp_c: 17, humidity: 76 },
    { zone: 'space', place: 'Low Earth orbit', pm25: 0, temp_c: 0, humidity: 0 },
  ].map((r) => Object.assign(r, { date: '2026-11-22', source: 'bundled snapshot (sample)' }));

  // ---------------------------------------------------------------- helpers
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const r2 = (v) => Math.round(v * 100) / 100;
  const agentOf = (S, id) => S.agents.find((a) => a.id === id);
  const isAllied = (S, a) => !!(a.ally && a.allyUntil > S.tick);
  const avgHealth = (S) => ZONES.reduce((sum, z) => sum + S.H[z], 0) / ZONES.length;
  const weakestZone = (S, zones) => zones.slice().sort((x, y) => S.H[x] - S.H[y])[0];
  const nudgeTrust = (a, otherId, d) => { a.trust[otherId] = clamp((a.trust[otherId] || 0) + d, -1, 1); };

  // xorshift32 kept inside the state so a run is fully reproducible from its seed
  function rand(S) {
    let s = S.rng >>> 0 || 1;
    s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
    S.rng = s >>> 0;
    return (S.rng % 1e9) / 1e9;
  }

  // Merge Bruin rows (or the snapshot) into one record per zone, with game signals filled in.
  function spawnMap(spawn) {
    const rows = spawn && spawn.length ? spawn : SNAPSHOT;
    const m = {};
    for (const r of rows) m[r.zone] = Object.assign({}, r);
    for (const z of ZONES) {
      if (!m[z]) m[z] = Object.assign({}, SNAPSHOT.find((s) => s.zone === z));
      const r = m[z];
      r.pm25 = +r.pm25 || 0;
      r.smog_pressure = r.smog_pressure != null && r.smog_pressure !== '' ? +r.smog_pressure : z === 'space' ? 0.3 : clamp(r.pm25 / 40, 0, 1.2);
      r.heat = r.heat != null && r.heat !== '' ? +r.heat : clamp((+r.temp_c - 5) / 25, 0, 1);
    }
    return m;
  }
  const sourceLabel = (sp) => {
    if (/sample|snapshot/.test(sp.forest.source || '')) return `bundled air snapshot ${sp.forest.date} (Bruin not run yet)`;
    return `Bruin · daily_spawn ${sp.forest.date}`;
  };
  function dataLine(sp, zone) {
    if (!zone) return ZONES.filter((z) => z !== 'space').map((z) => `${ZONE_NAME[z]} PM2.5 ${sp[z].pm25}`).join(' · ');
    const r = sp[zone];
    const where = r.place ? ` (${r.place})` : '';
    if (zone === 'space') return `Space${where}: debris pressure ${r.smog_pressure}`;
    return `${ZONE_NAME[zone]}${where}: PM2.5 ${r.pm25} µg/m³, ${r.temp_c}°C, humidity ${r.humidity}%`;
  }

  function log(S, entry) {
    entry.id = ++S.seq;
    entry.tick = S.tick;
    entry.seed = S.seed;
    entry.t = Date.now();
    entry.k = entry.k || 'act';
    S.log.push(entry);
    if (S.log.length > 400) S.log.splice(0, S.log.length - 400);
    return entry;
  }

  function moveTo(S, a, zone) {
    if (a.zone === zone) return;
    a.from = a.zone;
    a.zone = zone;
    a.moved = S.tick;
  }

  // ---------------------------------------------------------------- create a run
  function create(seed, spawn, mem) {
    seed = seed | 0 || 42;
    const now = Date.now();
    const S = {
      v: 1, seed, rng: (seed * 2654435761) >>> 0, tick: 0, round: 1, status: 'playing',
      H: {}, attn: {}, raid: { hp: 20000, max: 20000, zone: 'desert' },
      agents: [], players: {}, quests: [], offer: null, intel: null,
      log: [], seq: 0, hist: [], started: now, lastTick: now,
      budget: Object.assign({}, DEFAULT_BUDGET), council: 0,
    };
    rand(S);
    const sp = spawnMap(spawn);

    // zone health is rolled from the seed and dented by today's real smog
    for (const z of ZONES) {
      S.H[z] = Math.round((30 + rand(S) * 16 - sp[z].smog_pressure * 8) * 10) / 10;
      S.attn[z] = 0;
    }

    for (const def of AGENTS) {
      const trust = {};
      for (const other of AGENTS) {
        if (other.id === def.id) continue;
        const villainPair = def.type === 'villain' || other.type === 'villain';
        const foxInvolved = def.id === 'sunfox' || other.id === 'sunfox';
        trust[other.id] = villainPair ? (foxInvolved ? -0.1 : -0.8) : r2(rand(S) * 0.6 - 0.1);
      }
      S.agents.push({
        id: def.id, zone: def.home, from: def.home, moved: 0,
        // seeded personality: how cooperative, greedy and aggressive this agent is in this run
        tr: { coop: r2(0.5 + rand(S)), greed: r2(0.4 + rand(S) * 1.2), aggro: r2(0.55 + rand(S) * 0.9) },
        energy: Math.round(55 + rand(S) * 35), seeds: Math.round(10 + rand(S) * 20),
        trust, ally: null, allyUntil: 0, last: '', lastThank: -99, lastQuest: -99,
      });
    }

    log(S, {
      agent: 'world', act: 'started a new run',
      why: `Seed ${seed}. Zone health, energy, trust and personalities are rolled from the seed, so every run plays out differently.`,
      data: dataLine(sp), src: [sourceLabel(sp)],
    });

    // learning between runs: each agent announces the action that has paid off best so far
    if (mem && mem.runs && mem.agents) {
      for (const def of AGENTS) {
        const m = mem.agents[def.id];
        if (!m) continue;
        const best = Object.entries(m).filter(([, v]) => v.n > 2).sort((x, y) => y[1].avg - x[1].avg)[0];
        if (!best) continue;
        const [act, v] = best;
        log(S, {
          agent: def.id, k: 'learn', act: `remembers run ${mem.runs}: prefers to ${act}`,
          why: `Learned between runs: "${act}" averaged ${v.avg > 0 ? '+' : ''}${v.avg.toFixed(2)} for its goal over ${v.n} tries.`,
          src: ['agent memory (learning between runs)'],
        });
      }
    }
    return S;
  }

  // ---------------------------------------------------------------- quests built from a human's profile
  function questFor(zone, profile) {
    const p = profile || {};
    switch (zone) {
      case 'forest':
        return p.eat === 'meat'
          ? ['meal', 'Eat one plant-based meal today', 'You told me you eat a lot of meat. One swap helps my trees.']
          : ['litter', 'Pick up 3 pieces of litter at a park', 'The park needs hands, not just wishes.'];
      case 'ocean':
        if (p.waste === 'bottles') return ['bottle', 'Use a refill bottle all day', 'You said bottles are your biggest waste.'];
        if (p.waste === 'takeout') return ['refuse', 'Say no to 3 single-use plastics', 'Takeout cutlery ends up on my beach.'];
        return ['hunt', 'Do a 150 m Litter Hunt', 'Walk your block and bin what you find.'];
      case 'ice':
        return p.move === 'car'
          ? ['walk', 'Swap one short car trip for walking or biking', 'You drive most days. One trip on foot cools my ice.']
          : ['walk', 'Walk or bike somewhere today', 'Keep it up, every trip counts.'];
      case 'desert':
        return p.home === 'house'
          ? ['unplug', 'Unplug chargers and turn lights off', 'Houses leak power all day.']
          : ['shower', 'Do a 5-minute shower sprint', 'Water is gold out here.'];
      default:
        return p.waste === 'clothes'
          ? ['thrift', 'Thrift, swap or repair instead of buying new', 'You said clothes are your biggest waste.']
          : ['repair', 'Repair or recycle an old gadget', 'Old gadgets become space junk.'];
    }
  }

  // ---------------------------------------------------------------- options per agent type
  function guardianOptions(S, a, def, sp, activePlayers) {
    const O = [];
    const Z = def.goal;
    const gap = clamp((GOAL_HEALTH - S.H[Z]) / GOAL_HEALTH, 0, 1);
    const allied = isAllied(S, a);
    const baron = agentOf(S, 'baron');
    let urgency = gap;
    if (Z === 'ice' && sp.ice.heat > 0.3) urgency += 0.15;       // warm day: ice melts faster
    if (Z === 'forest' && sp.forest.smog_pressure > 0.3) urgency += 0.1;
    const news = +sp[Z].news_pressure || 0; // Telem: today's real news about this zone
    urgency += news;
    const newsWhy = news ? `; today's news: "${sp[Z].news_title}"` : '';

    if (a.zone !== Z) {
      O.push({ t: 'travel', to: Z, s: 0.45 + gap, why: `its home ${ZONE_NAME[Z]} is at ${S.H[Z].toFixed(0)}, below its goal of ${GOAL_HEALTH}` });
    } else {
      O.push({ t: 'tend', s: 0.18 + urgency * 1.1 + a.energy / 600,
        why: `${ZONE_NAME[Z]} health ${S.H[Z].toFixed(0)} is below its goal of ${GOAL_HEALTH}${allied ? `, and its alliance with ${BY_ID[a.ally].name} boosts it` : ''}${newsWhy}` });
    }
    O.push({ t: 'rest', s: 0.12 + (1 - a.energy / 100) * 0.55, why: `energy ${a.energy}/100` });

    const mates = S.agents.filter((b) => BY_ID[b.id].type === 'guardian' && b.id !== a.id);
    if (!allied) {
      const partner = mates.filter((b) => !isAllied(S, b)).sort((x, y) => a.trust[y.id] - a.trust[x.id])[0];
      if (partner) {
        O.push({ t: 'ally', with: partner.id,
          s: (a.tr.coop - 0.5) * 0.3 + 0.18 + (a.trust[partner.id] + 1) / 4 + (baron.zone === Z ? 0.15 : 0),
          why: `trusts ${BY_ID[partner.id].name} (${a.trust[partner.id].toFixed(2)}) and the Smog Baron is a shared threat` });
      }
    }

    const worst = weakestZone(S, ZONES.filter((z) => z !== Z));
    if (S.H[worst] < S.H[Z] - 10) {
      const owner = mates.find((b) => BY_ID[b.id].goal === worst);
      if (!owner || a.trust[owner.id] > -0.2) {
        O.push({ t: 'help', to: worst, owner: owner ? owner.id : null, s: 0.14 + (S.H[Z] - S.H[worst]) / 110,
          why: `${ZONE_NAME[worst]} (${S.H[worst].toFixed(0)}) is far worse off than ${ZONE_NAME[Z]} (${S.H[Z].toFixed(0)})${owner ? '' : ' and nobody guards it'}` });
      }
    }

    if (a.seeds >= 5 && a.energy < 65 && a.trust.sunfox > -0.3) {
      O.push({ t: 'trade', with: 'sunfox', s: 0.16 + (1 - a.energy / 100) * 0.45,
        why: `low energy (${a.energy}) and still trusts Sunfox (${a.trust.sunfox.toFixed(2)})` });
    }
    if (baron.zone === a.zone && (allied || a.energy > 45)) {
      O.push({ t: 'confront', s: 0.5 + (allied ? 0.15 : 0), why: `the Smog Baron is in ${ZONE_NAME[a.zone]}${allied ? ' and it has an ally' : ''}` });
    }
    const hasOpenQuest = S.quests.some((q) => q.from === a.id && q.until > S.tick && !q.done);
    if (activePlayers.length && S.tick - a.lastQuest > 12 && !hasOpenQuest) {
      const n = activePlayers.length;
      O.push({ t: 'quest', s: 0.5 + gap * 0.4, why: `${ZONE_NAME[Z]} needs real-world help and ${n} human${n > 1 ? 's are' : ' is'} on the street` });
    }
    if (S.attn[Z] > 3 && S.tick - a.lastThank > 10 && activePlayers.length) {
      O.push({ t: 'thank', s: 0.42, why: `humans healed ${ZONE_NAME[Z]} by ${S.attn[Z].toFixed(0)} recently` });
    }
    return O;
  }

  function traderOptions(S, a) {
    const O = [];
    const guardians = S.agents.filter((b) => BY_ID[b.id].type === 'guardian');
    const fav = guardians.slice().sort((x, y) => a.trust[y.id] - a.trust[x.id])[0];
    const trustInFox = guardians.reduce((s, b) => s + b.trust.sunfox, 0) / guardians.length;

    O.push({ t: 'trade', with: fav.id, s: 0.3 + (a.trust[fav.id] + 1) / 5, why: `${BY_ID[fav.id].name} trusts it most (${fav.trust.sunfox.toFixed(2)})` });
    O.push({ t: 'hoard', s: 0.2 + (a.seeds < 20 ? 0.15 : 0), why: `only ${a.seeds} seeds and its goal is to get rich` });

    if (S.offer && S.tick - S.offer.tick > 5) S.offer = null; // bribes expire
    if (S.offer) {
      const amt = S.offer.amount;
      O.push({ t: 'betray', s: 0.3 + amt / 35 - trustInFox * 0.4 + (a.tr.greed - 1) * 0.5,
        why: `the Baron offered ${amt} seeds and the guardians only trust it ${trustInFox.toFixed(2)}` });
      O.push({ t: 'refuse', s: 0.4 + trustInFox * 0.5,
        why: `the guardians trust it ${trustInFox.toFixed(2)}, so their friendship is worth more than ${amt} seeds` });
    }
    if (S.intel && trustInFox > 0.1) {
      O.push({ t: 'warn', s: 0.3 + trustInFox * 0.4, why: `it knows the Baron is targeting ${ZONE_NAME[S.intel]}` });
    }
    return O;
  }

  function villainOptions(S, a, sp) {
    const O = [];
    const totalAttention = ZONES.reduce((s, z) => s + S.attn[z], 0);
    // target: low health, ignored by humans, and smoggy in real life
    const appeal = (z) => S.H[z] + S.attn[z] * 3 - sp[z].smog_pressure * 12 - (+sp[z].news_pressure || 0) * 15; // bad news = an easy target
    const target = ZONES.slice().sort((x, y) => appeal(x) - appeal(y))[0];

    if (a.energy >= 12) {
      const to = S.intel || target;
      O.push({ t: 'pollute', to, s: 0.32 + a.tr.aggro * 0.12 + sp[target].smog_pressure * 0.25 + (S.intel ? 0.2 : 0),
        why: S.intel
          ? `Sunfox leaked that ${ZONE_NAME[S.intel]} is weak`
          : sp[target].news_pressure
          ? `today's news says "${sp[target].news_title}", so ${ZONE_NAME[target]} is an easy target`
          : `${ZONE_NAME[target]} is weak (${S.H[target].toFixed(0)}), humans ignore it, and ${target === 'space' ? 'debris' : 'PM2.5 ' + sp[target].pm25} helps the smog` });
    }
    if (!S.offer && a.seeds >= 10) {
      const alliances = S.agents.some((b) => isAllied(S, b));
      O.push({ t: 'bribe', s: 0.38 + (S.tick - (S.lastBribe || -99) > 15 ? 0.12 : 0) + (alliances ? 0.2 : 0),
        why: 'the guardians are teaming up, so it needs an inside agent' });
    }
    O.push({ t: 'camp', to: target, s: 0.18 + (S.raid.zone !== target ? 0.1 : 0), why: `setting up the Smog Blob raid in ${ZONE_NAME[target]}` });
    if (totalAttention > 12) O.push({ t: 'retreat', s: 0.35 + totalAttention / 80, why: `humans are too active (attention ${totalAttention.toFixed(0)})` });
    O.push({ t: 'rest', s: 0.1 + (1 - a.energy / 100) * 0.5, why: `energy ${a.energy}` });
    return O;
  }

  function learnedBias(mem, id, act) {
    const m = mem && mem.agents && mem.agents[id] && mem.agents[id][act];
    return m && m.n > 1 ? clamp(m.avg / 3, -1, 1) * 0.22 : 0;
  }

  // ---------------------------------------------------------------- ledger helpers
  function ledgerOf(p) {
    if (!p.led || p.led.day !== todayKey()) {
      p.led = { day: todayKey(), food: 0, travel: 0, water: 0, stuff: 0, waste: 0, saved: 0, plastic: 0, bags: 0, km: 0, top: '', topKg: 0, items: [] };
    }
    return p.led;
  }
  const loggedToday = (p) => !!(p && p.led && p.led.day === todayKey());

  // a quest built from what this player actually logged today (null when they are within budget)
  function ledgerQuest(cat, p, S) {
    if (!loggedToday(p)) return null;
    const L = p.led, b = S.budget || DEFAULT_BUDGET;
    if (cat === 'food' && L.food > b.food) return ['meal', 'Make your next meal plant-based', `You're at ${L.food.toFixed(1)} kg CO2e from food today (budget ${b.food}).${L.top ? ` Your ${L.top} was the big one.` : ''}`];
    if (cat === 'food' && L.waste > 0) return ['leftovers', 'Eat or freeze leftovers instead of tossing them', `You threw out ${Math.round(L.waste * 1000)} g of food today. It still counts at its full footprint.`];
    if (cat === 'travel' && L.travel > b.travel) return ['walk', 'Swap one short car trip for walking or biking', `Travel and energy are at ${L.travel.toFixed(1)} kg today (budget ${b.travel}).${L.km ? ` You drove ${L.km.toFixed(0)} km.` : ''}`];
    if (cat === 'water' && L.water > b.water) return ['shower', 'Do a 5-minute shower sprint', `You've used about ${Math.round(L.water)} L today (budget ${b.water} L).`];
    if (cat === 'stuff' && (L.stuff > b.stuff || L.plastic > 1)) return ['refuse', 'Say no to 3 single-use plastics', `${L.plastic} plastic items and ${L.bags} trash bags logged today.`];
    return null;
  }
  const catOfAgent = (id) => Object.keys(CAT_AGENT).find((c) => CAT_AGENT[c] === id) || null;

  // an agent whose category a player just blew through reacts fast (beats its usual options)
  function ledgerOption(S, a, activePlayers) {
    const cat = catOfAgent(a.id);
    if (!cat || S.tick - a.lastQuest < 4) return null;
    const hot = activePlayers.find((p) => ledgerQuest(cat, p, S) && !S.quests.some((q) => q.from === a.id && q.to === p.id && !q.done && q.until > S.tick));
    if (!hot) return null;
    return { t: 'quest', hot: hot.id, cat, s: 1.2, why: `${hot.name} went over today's ${CAT_NAME[cat]} budget (real log)` };
  }

  function decide(S, a, sp, mem) {
    const def = BY_ID[a.id];
    const week = 7 * 864e5;
    const activePlayers = Object.values(S.players).filter((p) => Date.now() - (p.seen || 0) < week);
    let O = [];
    if (a.energy < 18) O.push({ t: 'rest', s: 0.9, why: `energy is only ${a.energy}` });
    if (def.type === 'guardian') O = O.concat(guardianOptions(S, a, def, sp, activePlayers));
    else if (def.type === 'trader') O = O.concat(traderOptions(S, a));
    else O = O.concat(villainOptions(S, a, sp));
    const hot = ledgerOption(S, a, activePlayers);
    if (hot) O.push(hot);

    for (const o of O) o.s += learnedBias(mem, a.id, o.t) + rand(S) * 0.12;
    O.sort((x, y) => y.s - x.s);
    const pick = O[0];
    const zone = pick.to || (def.type === 'guardian' ? def.goal : a.zone);
    return { o: pick, used: dataLine(sp, zone), src: [sourceLabel(sp)], alts: O.slice(1, 3).map((x) => x.t) };
  }

  // ---------------------------------------------------------------- apply the chosen action
  function apply(S, a, d, sp) {
    const o = d.o;
    const def = BY_ID[a.id];
    const e = { agent: a.id, why: o.why, data: d.used, src: d.src, alts: d.alts, act: '' };
    const guardians = () => S.agents.filter((b) => BY_ID[b.id].type === 'guardian');

    switch (o.t) {
      case 'rest':
        a.energy += 15; e.act = 'rested'; break;
      case 'travel':
        moveTo(S, a, o.to); a.energy -= 4; e.act = `walked to ${ZONE_NAME[o.to]}`; e.k = 'move'; break;
      case 'tend': {
        const boost = 2.1 * (0.75 + a.tr.coop * 0.35) * (isAllied(S, a) ? 1.5 : 1) * (a.energy > 20 ? 1 : 0.4);
        S.H[def.goal] = clamp(S.H[def.goal] + boost, 0, 100);
        a.energy -= 7;
        const verb = { forest: 'planted trees in', ocean: 'cleaned plastic from', ice: 'rebuilt snow on' }[def.goal];
        e.act = `${verb} ${ZONE_NAME[def.goal]} (+${boost.toFixed(1)})`;
        break;
      }
      case 'ally': {
        const b = agentOf(S, o.with);
        a.ally = b.id; b.ally = a.id;
        a.allyUntil = b.allyUntil = S.tick + 10;
        nudgeTrust(a, b.id, 0.2); nudgeTrust(b, a.id, 0.2);
        e.act = `formed an alliance with ${BY_ID[b.id].name}`; e.k = 'ally'; e.target = b.id;
        break;
      }
      case 'help': {
        moveTo(S, a, o.to);
        S.H[o.to] = clamp(S.H[o.to] + 2, 0, 100);
        a.energy -= 8;
        if (o.owner) { nudgeTrust(agentOf(S, o.owner), a.id, 0.15); e.target = o.owner; }
        e.act = o.owner ? `went to help ${BY_ID[o.owner].name} in ${ZONE_NAME[o.to]} (+2)` : `went to defend unguarded ${ZONE_NAME[o.to]} (+2)`;
        e.k = 'move';
        break;
      }
      case 'trade': {
        const b = agentOf(S, o.with);
        if (def.type === 'trader') {
          a.seeds += 3; b.energy = clamp(b.energy + 8, 0, 100);
          e.act = `traded energy snacks to ${BY_ID[b.id].name} for 3 seeds`;
        } else {
          a.seeds -= 5; b.seeds += 5; a.energy += 14;
          e.act = 'traded 5 seeds to Sunfox for energy';
        }
        nudgeTrust(a, b.id, 0.08); nudgeTrust(b, a.id, 0.08);
        e.k = 'trade'; e.target = b.id;
        break;
      }
      case 'confront': {
        const baron = agentOf(S, 'baron');
        baron.energy = clamp(baron.energy - 20, 0, 100);
        const away = ZONES.filter((z) => z !== a.zone);
        moveTo(S, baron, away[Math.floor(rand(S) * away.length)]);
        a.energy -= 10;
        e.act = `confronted the Smog Baron and chased it to ${ZONE_NAME[baron.zone]}`; e.k = 'fight'; e.target = 'baron';
        break;
      }
      case 'quest': {
        const cat = o.cat || catOfAgent(a.id);
        const zone = cat ? CAT_ZONE[cat] : def.goal;
        const recent = Object.values(S.players).sort((x, y) => (y.seen || 0) - (x.seen || 0));
        const over = cat ? recent.filter((x) => ledgerQuest(cat, x, S)) : [];
        const p = o.hot ? S.players[o.hot] : over.length ? over[0] : recent[Math.floor(rand(S) * Math.min(recent.length, 3))];
        const fromLog = cat ? ledgerQuest(cat, p, S) : null;
        const [kind, text, line] = fromLog || questFor(zone, p && p.profile);
        if (p) {
          p.nudge = p.nudge || {};
          const n = (p.nudge[kind] = p.nudge[kind] || { off: 0, done: 0 });
          n.off++;
        }
        S.quests.push({ id: `q${S.seq + 1}`, from: a.id, to: p ? p.id : null, zone, kind, text, line, until: S.tick + 30, done: false });
        a.lastQuest = S.tick;
        e.act = `asked ${p ? p.name : 'humans'}: "${text}"`;
        if (fromLog) { e.why += `. Based on ${p.name}'s real log today.`; e.src = (e.src || []).concat(["player's real log (cited emission factors)"]); }
        else if (p && p.profile) e.why += `. Picked using ${p.name}'s profile.`;
        e.k = 'quest'; e.target = p ? 'h_' + p.id : '';
        break;
      }
      case 'thank': {
        a.lastThank = S.tick;
        const z = def.goal;
        const top = Object.values(S.players).sort((x, y) => ((y.zoneHelp || {})[z] || 0) - ((x.zoneHelp || {})[z] || 0))[0];
        S.H[z] = clamp(S.H[z] + 2, 0, 100);
        S.attn[z] *= 0.5;
        e.act = `thanked ${top ? top.name : 'the humans'} and boosted ${ZONE_NAME[z]} +2`; e.k = 'thank';
        break;
      }
      case 'hoard':
        a.seeds += 2; e.act = 'hoarded 2 seeds'; break;
      case 'betray': {
        const g = guardians();
        const victim = g[Math.floor(rand(S) * g.length)];
        const stolen = Math.min(8, victim.seeds);
        victim.seeds -= stolen;
        a.seeds += stolen + S.offer.amount;
        S.intel = weakestZone(S, ZONES);
        for (const b of g) nudgeTrust(b, 'sunfox', -0.5);
        nudgeTrust(a, 'baron', 0.3);
        e.act = `BETRAYED the guardians: took ${S.offer.amount} seeds from the Baron, stole ${stolen} from ${BY_ID[victim.id].name} and leaked that ${ZONE_NAME[S.intel]} is weakest`;
        e.k = 'betray'; e.target = victim.id;
        S.offer = null;
        break;
      }
      case 'refuse': {
        for (const b of guardians()) nudgeTrust(b, 'sunfox', 0.12);
        nudgeTrust(a, 'baron', -0.3);
        e.act = `refused the Baron's ${S.offer.amount}-seed bribe`; e.k = 'ally'; e.target = 'baron';
        S.offer = null;
        break;
      }
      case 'warn': {
        e.act = `warned the guardians that the Baron is targeting ${ZONE_NAME[S.intel]}`;
        for (const b of guardians()) {
          nudgeTrust(b, 'sunfox', 0.1);
          if (BY_ID[b.id].goal === S.intel) moveTo(S, b, S.intel);
        }
        S.intel = null; e.k = 'ally';
        break;
      }
      case 'pollute': {
        moveTo(S, a, o.to);
        const dmg = 2.4 * a.tr.aggro * (1 + sp[o.to].smog_pressure * 0.6) * (S.intel === o.to ? 1.8 : 1);
        S.H[o.to] = clamp(S.H[o.to] - dmg, 0, 100);
        a.energy -= 10;
        e.act = `polluted ${ZONE_NAME[o.to]} (−${dmg.toFixed(1)})`; e.k = 'fight';
        if (S.intel === o.to) S.intel = null;
        break;
      }
      case 'bribe': {
        S.lastBribe = S.tick;
        const amt = Math.round(10 + rand(S) * 25);
        a.seeds -= Math.min(a.seeds, amt);
        S.offer = { amount: amt, tick: S.tick };
        e.act = `offered Sunfox ${amt} seeds to betray the guardians`; e.k = 'betray'; e.target = 'sunfox';
        break;
      }
      case 'camp': {
        moveTo(S, a, o.to);
        S.raid.zone = o.to;
        S.raid.hp = Math.min(S.raid.max, S.raid.hp + 300);
        e.act = `camped the Smog Blob raid in ${ZONE_NAME[o.to]} (+300 HP)`; e.k = 'fight';
        break;
      }
      case 'retreat':
        a.energy += 20; moveTo(S, a, 'space'); e.act = 'retreated to recharge in orbit'; break;
    }
    a.energy = clamp(Math.round(a.energy), 0, 100);
    a.last = e.act;
    return log(S, e);
  }

  // ---------------------------------------------------------------- objectives + learning
  function objective(S, a) {
    const def = BY_ID[a.id];
    if (def.type === 'guardian') return S.H[def.goal];
    if (def.type === 'trader') return a.seeds / 3;
    return -avgHealth(S);
  }
  // running average (EMA) of how much each action moved the agent toward its own goal
  function learn(mem, id, act, reward) {
    if (!mem || !act) return;
    mem.agents = mem.agents || {};
    const m = (mem.agents[id] = mem.agents[id] || {});
    const x = (m[act] = m[act] || { n: 0, avg: 0 });
    x.n++;
    x.avg += 0.2 * (reward - x.avg);
  }

  // ---------------------------------------------------------------- the council
  // Every COUNCIL_EVERY ticks the agents meet over the street's real logs and renegotiate tomorrow's budget.
  function council(S) {
    S.budget = S.budget || Object.assign({}, DEFAULT_BUDGET);
    const b = S.budget;
    const loggers = Object.values(S.players).filter(loggedToday);
    const n = Math.max(1, loggers.length);
    const use = {};
    for (const c of Object.keys(b)) use[c] = loggers.reduce((sum, p) => sum + p.led[c], 0) / n;
    const ratio = {};
    for (const c of Object.keys(b)) ratio[c] = use[c] / b[c];
    const data = Object.keys(b).map((c) => `${c} ${c === 'water' || c === 'stuff' ? Math.round(use[c]) : use[c].toFixed(1)}/${b[c]}`).join(' · ');
    const out = [];
    out.push(log(S, {
      agent: 'world', k: 'council', act: "COUNCIL MEETING: rebalancing tomorrow's budget",
      why: `Street average today (${loggers.length} player${loggers.length === 1 ? '' : 's'} logging): ${data}.`,
      data, src: ["players' real logs", 'emission factors (EPA, Poore & Nemecek)'],
    }));

    // the most over-budget category asks for help; only food and travel share a unit (kg CO2e), so only they trade
    const over = Object.keys(b).sort((x, y) => ratio[y] - ratio[x])[0];
    if (loggers.length && ratio[over] > 1) {
      const under = ['food', 'travel'].filter((c) => c !== over).sort((x, y) => ratio[x] - ratio[y])[0];
      const giver = under && agentOf(S, CAT_AGENT[under]);
      const asker = agentOf(S, CAT_AGENT[over]);
      const canTrade = (over === 'food' || over === 'travel') && under && ratio[under] < 0.8 && giver.trust[asker.id] > -0.3;
      if (canTrade) {
        const give = Math.round(Math.min(b[under] * 0.15, 1.5) * 10) / 10;
        b[under] = Math.round((b[under] - give) * 10) / 10;
        b[over] = Math.round((b[over] + give) * 10) / 10;
        nudgeTrust(giver, asker.id, 0.1);
        out.push(log(S, {
          agent: giver.id, k: 'council', target: asker.id,
          act: `gave ${BY_ID[asker.id].name} ${give} kg of tomorrow's ${under} budget`,
          why: `${under} is only at ${Math.round(ratio[under] * 100)}% of budget while ${over} is at ${Math.round(ratio[over] * 100)}%. It trusts ${BY_ID[asker.id].name} (${giver.trust[asker.id].toFixed(2)}).`,
          data, src: ["players' real logs", 'trust matrix'],
        }));
      } else {
        out.push(log(S, {
          agent: asker.id, k: 'council',
          act: `asked the humans to cut ${CAT_NAME[over]} tomorrow (no one could spare budget)`,
          why: `${CAT_NAME[over]} is at ${Math.round(ratio[over] * 100)}% of budget.`, data, src: ["players' real logs"],
        }));
      }
    }

    // the Baron lobbies for a bigger stuff budget; Sunfox casts the deciding vote
    if (rand(S) < 0.6) {
      const fox = agentOf(S, 'sunfox');
      const pull = fox.tr.greed + (-(fox.trust.mossling || 0) - (fox.trust.ripplet || 0)) * 0.3;
      const yes = pull > 1.05;
      b.stuff = yes ? Math.round((b.stuff + 1) * 10) / 10 : Math.max(2, Math.round((b.stuff - 0.5) * 10) / 10);
      out.push(log(S, { agent: 'baron', k: 'betray', target: 'sunfox', act: 'pitched a "Black Friday flash sale": raise the stuff budget', why: 'More shopping means more emissions, which is its goal.', src: ['agent goals'] }));
      out.push(log(S, {
        agent: 'sunfox', k: yes ? 'betray' : 'ally', target: 'baron',
        act: yes ? `VOTED YES on the flash sale (stuff budget → ${b.stuff})` : `voted NO on the flash sale (stuff budget → ${b.stuff})`,
        why: yes ? `its greed (${fox.tr.greed.toFixed(2)}) outweighs its trust in the guardians` : `it trusts the guardians more than it wants seeds (greed ${fox.tr.greed.toFixed(2)})`,
        src: ['agent personality', 'trust matrix'],
      }));
    }

    // what the agents learned about each human: which nudges they follow
    for (const p of loggers) {
      const tried = Object.entries(p.nudge || {}).filter(([, v]) => v.off >= 2).sort((x, y) => y[1].done / y[1].off - x[1].done / x[1].off);
      if (tried.length < 2) continue;
      const [bk, bv] = tried[0], [wk, wv] = tried[tried.length - 1];
      out.push(log(S, {
        agent: 'world', k: 'learn',
        act: `learned: ${p.name} follows "${bk}" nudges (${bv.done}/${bv.off}) but skips "${wk}" (${wv.done}/${wv.off})`,
        why: 'Agents now favor the nudges that actually work for this person.', src: ['nudge history'],
      }));
    }
    return out;
  }

  // ---------------------------------------------------------------- one tick of the world
  function tick(S, spawn, mem) {
    if (S.status !== 'playing') {
      S.tick++;
      S.lastTick = Date.now();
      return S.tick - S.endTick >= 4 ? { restart: true, entries: [] } : { entries: [] };
    }
    const sp = spawnMap(spawn);
    S.budget = S.budget || Object.assign({}, DEFAULT_BUDGET);
    S.tick++;
    S.lastTick = Date.now();
    agentOf(S, 'baron').seeds += 1;

    const before = {};
    for (const a of S.agents) before[a.id] = objective(S, a);

    // the world slowly decays, faster where real-world smog is high
    for (const z of ZONES) S.H[z] = clamp(S.H[z] - 0.32 - sp[z].smog_pressure * 0.07, 0, 100);

    const order = S.agents.slice().sort(() => rand(S) - 0.5);
    const entries = [];
    for (const a of order) {
      const d = decide(S, a, sp, mem);
      a._t = d.o.t;
      entries.push(apply(S, a, d, sp));
    }
    for (const a of S.agents) learn(mem, a.id, a._t, objective(S, a) - before[a.id]);
    if (S.tick - (S.council || 0) >= COUNCIL_EVERY) {
      S.council = S.tick;
      for (const e of council(S)) entries.push(e);
    }

    S.hist = S.hist || [];
    S.hist.push(Math.round(avgHealth(S)));
    if (S.hist.length > 140) S.hist.shift();
    for (const z of ZONES) S.attn[z] *= 0.9;
    S.quests = S.quests.filter((q) => q.until > S.tick - 5);

    const avg = avgHealth(S);
    let winner = null;
    if (avg >= 72) winner = 'guardians';
    else if (avg <= 18) winner = 'baron';
    else if (S.tick >= ROUND_TICKS) winner = avg >= 50 ? 'guardians' : 'baron';
    if (winner) {
      S.status = winner === 'guardians' ? 'won' : 'lost';
      S.endTick = S.tick;
      entries.push(log(S, {
        agent: 'world', k: 'end',
        act: winner === 'guardians' ? 'GUARDIANS + HUMANS WIN THE RUN' : 'THE SMOG BARON WINS THE RUN',
        why: `Planet average health ${avg.toFixed(1)} at tick ${S.tick}.`, src: ['game rules'],
      }));
      if (mem) mem.runs = (mem.runs || 0) + 1;
    }
    return { entries };
  }

  // ---------------------------------------------------------------- humans
  function join(S, p) {
    const prev = S.players[p.id] || { score: 0, acts: 0, zoneHelp: {} };
    const pl = (S.players[p.id] = Object.assign(prev, {
      id: String(p.id).slice(0, 40), name: String(p.name || 'Player').slice(0, 20), av: p.av,
      profile: p.profile || prev.profile, seen: Date.now(),
    }));
    if (!prev.joined) {
      prev.joined = 1;
      log(S, { agent: 'human', who: pl.id, act: `${pl.name} joined the street`, why: 'A new human player is in the world.', src: ['player'], k: 'human' });
    }
    return pl;
  }

  // act = { label, deltas: {zone: +n}, raid, real, proof }   applied=true when the client already applied it locally
  function human(S, pid, act, applied) {
    const p = S.players[pid] || join(S, { id: pid, name: 'Player' });
    p.seen = Date.now();
    let total = 0;
    const parts = [];

    // real log lines: raw items in, numbers computed here from the cited factors (client numbers are ignored)
    let logged = null;
    if (Array.isArray(act.items) && act.items.length && FX) {
      const L = ledgerOf(p);
      act.deltas = Object.assign({}, act.deltas);
      logged = [];
      for (const raw of act.items.slice(0, 40)) {
        const x = FX.compute(raw);
        if (x.skip) continue;
        logged.push(x);
        if (x.cat === 'water') L.water += x.liters;
        else if (x.cat === 'stuff') L.stuff += x.items;
        else L[x.cat] += x.kg;
        L.waste += x.waste; L.saved += x.saved; L.plastic += x.plastic; L.bags += x.bags;
        if (x.kind === 'drive') L.km += x.km;
        if (x.cat === 'food' && x.kg > L.topKg) { L.topKg = x.kg; L.top = x.label.replace(/^\d+× /, '').replace(/ meal$/, ''); }
        L.items.push({ t: Date.now(), label: x.label, cat: x.cat, kg: Math.round(x.kg * 1000) / 1000, liters: Math.round(x.liters), saved: Math.round(x.saved * 1000) / 1000, src: x.src });
        if (L.items.length > 60) L.items.shift();
        // savings heal the matching zone; emissions dent it a little
        let d;
        if (x.saved || x.savedItems) d = Math.min(6, x.saved * 1.5 + (x.savedItems || 0) * 1.2);
        else if (x.cat === 'water') d = -Math.min(3, x.liters / 90);
        else if (x.cat === 'stuff') d = -Math.min(3, x.items * 0.7);
        else d = -Math.min(4, x.kg * 0.3);
        const z = CAT_ZONE[x.cat];
        act.deltas[z] = Math.round(((act.deltas[z] || 0) + d) * 10) / 10;
      }
    }
    for (const [z, d] of Object.entries(act.deltas || {})) {
      if (!ZONES.includes(z) || !isFinite(d)) continue;
      const dd = clamp(+d, -20, 30);
      if (!applied) S.H[z] = clamp(S.H[z] + dd, 0, 100);
      if (dd > 0) { S.attn[z] += dd; p.zoneHelp[z] = (p.zoneHelp[z] || 0) + dd; total += dd; }
      parts.push(`${ZONE_NAME[z]} ${dd >= 0 ? '+' : ''}${dd.toFixed(1)}`);
    }
    if (act.raid > 0) {
      const hit = Math.min(+act.raid, 2000);
      if (!applied) S.raid.hp = Math.max(0, S.raid.hp - hit);
      parts.push(`Smog Blob −${Math.round(hit)}`);
    }
    p.score += Math.round(total);
    p.acts++;

    // a real-world action in the quest's zone completes that agent's quest
    let questNote = '';
    for (const q of S.quests) {
      if (q.done || q.until < S.tick || (q.to && q.to !== pid)) continue;
      const healed = act.real && (act.deltas || {})[q.zone] > 0;
      if (!healed && !(logged && logged.some((x) => fitsQuest(q.kind, x)))) continue;
      q.done = pid;
      p.nudge = p.nudge || {};
      const nn = (p.nudge[q.kind] = p.nudge[q.kind] || { off: 1, done: 0 });
      nn.done++;
      const giver = agentOf(S, q.from);
      giver.trust['h_' + pid] = 1;
      S.H[q.zone] = clamp(S.H[q.zone] + 3, 0, 100);
      questNote = ` Completed ${BY_ID[q.from].name}'s quest (+3 bonus).`;
      break;
    }
    if (logged) {
      const kg = logged.reduce((s2, x) => s2 + x.kg, 0), sv = logged.reduce((s2, x) => s2 + x.saved, 0);
      act.label = act.label || `logged ${logged.length} item${logged.length === 1 ? '' : 's'} (${kg.toFixed(1)} kg CO2e${sv ? `, saved ${sv.toFixed(1)}` : ''})`;
    }
    const proof = logged ? `Real log${act.via === 'scan' ? ' from a scanned receipt/bill' : ''}. ` : act.real ? `Real-world action${act.proof > 1 ? ` with ${act.proof === 3 ? 'photo + walk' : 'photo'} proof (×${act.proof})` : ' (honor)'}. ` : 'In-game action. ';
    const entry = log(S, {
      agent: 'human', who: pid, k: 'human',
      act: `${p.name}: ${String(act.label || 'helped').slice(0, 80)}`,
      why: proof + parts.join(' · ') + questNote,
      src: logged ? ['player (real life)', 'cited emission factors (EPA, Poore & Nemecek)'] : [act.real ? 'player (real life)' : 'player (game)'],
    });
    if (logged) Object.defineProperty(entry, 'items', { value: logged, enumerable: false }); // for logs/ledger.jsonl, not broadcast
    return entry;
  }

  // a logged line that does what the quest asked
  const PLANT = new Set(['tofu', 'beans', 'peas', 'potatoes', 'rice', 'bread', 'nuts', 'tomatoes', 'apples', 'bananas']);
  function fitsQuest(kind, x) {
    if (kind === 'meal') return x.kind === 'meal' && PLANT.has(String(x.key).replace('food:', ''));
    if (kind === 'walk') return x.kind === 'walk';
    if (kind === 'refuse') return x.kind === 'refuse';
    if (kind === 'shower') return x.kind === 'shower' && x.amount <= 5;
    return false;
  }

  // in-app audit (the Bruin agent_report replaces this once the pipeline has run)
  function report(entries) {
    const R = {};
    for (const a of AGENTS) R[a.id] = { agent: a.name, actions: 0, allies: 0, trades: 0, betrayals_and_bribes: 0, fights: 0, quests_for_humans: 0, decisions_using_bruin_data: 0 };
    for (const e of entries) {
      const r = R[e.agent];
      if (!r) continue;
      r.actions++;
      if (e.k === 'ally') r.allies++;
      if (e.k === 'trade') r.trades++;
      if (e.k === 'betray') r.betrayals_and_bribes++;
      if (e.k === 'fight') r.fights++;
      if (e.k === 'quest') r.quests_for_humans++;
      if ((e.src || []).some((s) => /Bruin/.test(s))) r.decisions_using_bruin_data++;
    }
    return Object.values(R);
  }

  // instant headless run (for "Run it twice"): returns the health curve and the key events
  function simulate(seed, spawn, mem, ticks) {
    const memCopy = mem ? JSON.parse(JSON.stringify(mem)) : {};
    const S = create(seed, spawn, memCopy);
    S.players = {};
    const n = ticks || ROUND_TICKS;
    for (let i = 0; i < n && S.status === 'playing'; i++) tick(S, spawn, memCopy);
    const key = S.log.filter((e) => ['betray', 'ally', 'fight', 'end', 'learn'].includes(e.k));
    return { seed, status: S.status, ticks: S.tick, avg: Math.round(avgHealth(S)), H: S.H, hist: S.hist.slice(), key: key.slice(-14), report: report(S.log) };
  }

  root.ImpactAgents = { ZONES, ZONE_NAME, ZN: ZONE_NAME, AGENTS, AG: BY_ID, SNAPSHOT, ROUND: ROUND_TICKS, create, tick, join, human, report, simulate, avgH: avgHealth, spawnMap, questFor,
    ledgerOf, council, DEFAULT_BUDGET, CAT_ZONE, CAT_AGENT, COUNCIL_EVERY };
})(typeof module !== 'undefined' ? module.exports : window);
