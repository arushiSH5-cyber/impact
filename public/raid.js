// Raids: the Clash-of-Clans loop. The litter critters you caught are your squad. Pick a rival planet, send up to 3
// critters, and they battle its smog towers. Tap POWER when it's charged. Win to smash their towers and loot seeds.
// While you're away, rivals raid you back, and you get a revenge button.
import { CRITTERS, loadDex, critterURL, loadGear, GEAR } from './catch.js';

const STATS = { common: [10, 34], uncommon: [14, 40], rare: [19, 48], legendary: [28, 64] };
const RIVALS = [
  { id: 'baron', name: "Smog Baron's Grey World", lvl: 3, loot: 40, color: '#8a7fa0', towers: ['Smog Tower', 'Soot Cannon', 'Smog Baron'] },
  { id: 'gunk', name: 'Gunk Gang Moon', lvl: 1, loot: 15, color: '#9aa6a0', towers: ['Puddle Puff', 'Soot Sprout'] },
  { id: 'rust', name: 'Rust Rider Rock', lvl: 2, loot: 25, color: '#c28b6a', towers: ['Rusty Drum', 'Smog Tower', 'Soot Cannon'] },
];
const LOG_KEY = 'impact.raids';
const load = () => { try { return JSON.parse(localStorage.getItem(LOG_KEY)) || {}; } catch (e) { return {}; } };
const save = (r) => { try { localStorage.setItem(LOG_KEY, JSON.stringify(r)); } catch (e) { /* ignore */ } };

function gearBonus() {
  const g = loadGear(); let atk = 0, hp = 0;
  for (const [id, n] of Object.entries(g)) { const x = GEAR[id]; if (x) { atk += x.atk * Math.min(3, n); hp += x.hp * Math.min(3, n); } }
  return { atk: Math.min(20, atk), hp: Math.min(40, hp) };
}
function squadOf() {
  const d = loadDex();
  const owned = CRITTERS.filter((c) => d[c.id]).map((c) => ({ c, n: d[c.id], evo: d[c.id] >= 3 }));
  return owned;
}

// a rival raided you while you were away (once per visit gap of 2+ minutes): returns the event or null
export function checkRaided() {
  const r = load();
  const now = Date.now();
  const last = r.lastSeen || now;
  r.lastSeen = now;
  let hit = null;
  if (now - last > 2 * 60 * 1000 && !r.pending) {
    const who = RIVALS[Math.floor(Math.random() * RIVALS.length)];
    hit = { by: who.id, name: who.name, lost: 5 + Math.floor(Math.random() * 6), at: now };
    r.pending = hit;
  }
  save(r);
  return hit || r.pending || null;
}
export function clearRaided() { const r = load(); delete r.pending; save(r); }

export function raidHubHTML(faceURL, AG) {
  const sq = squadOf();
  const r = load();
  const pend = r.pending;
  return `${pend ? `<div class="rv"><img src="${faceURL(AG.baron, 80)}" alt=""><div><b>You got raided!</b><p>${pend.name} smashed your towers while you were away and took ${pend.lost} seeds.</p><button class="btn" data-raid="${pend.by}" data-revenge="1">Get revenge</button></div></div>` : ''}
    <h3>Your squad</h3>
    ${(() => { const g = loadGear(), ids = Object.keys(g); const b = gearBonus(); return ids.length ? `<div class="gear">${ids.map((id) => `<span>${GEAR[id] ? GEAR[id].name : id} ×${g[id]}</span>`).join('')}<em>Squad bonus: +${b.atk} attack · +${b.hp} health</em></div>` : '<p class="small muted">Scan real trash in Trash Catch to earn equipment that powers up your whole squad.</p>'; })()}
    ${sq.length ? `<div class="sq">${sq.map((s) => `<div class="sq-c ${s.c.rarity}"><img src="${critterURL(s.c, 80, s.evo)}" alt=""><b>${s.evo ? s.c.evo : s.c.name}</b><small>atk ${Math.round(STATS[s.c.rarity][0] * (s.evo ? 1.5 : 1))} · hp ${Math.round(STATS[s.c.rarity][1] * (s.evo ? 1.5 : 1))}</small></div>`).join('')}</div>`
      : `<div class="sq-empty"><p>No critters yet. Catch litter critters in <b>Trash Catch</b> to build your squad, or take a starter.</p><button class="btn" id="rStarter">Take starters: Bottle Bob + Can Goblin</button></div>`}
    <h3>Raid a planet</h3>
    ${RIVALS.map((p) => `<button class="rp" data-raid="${p.id}"><img class="rp-planet" src="art/pl-${p.id}.jpg" alt=""><span class="rp-body"><b>${p.name}</b><small>Level ${p.lvl} · ${p.towers.length} towers · loot ${p.loot} seeds${(r.wins || {})[p.id] ? ` · smashed ×${r.wins[p.id]}` : ''}</small></span><span class="btn">Raid</span></button>`).join('')}`;
}

export function giveStarter() {
  try { const d = loadDex(); if (!Object.keys(d).length) { d.bottle = 1; d.can = 1; localStorage.setItem('impact.trashdex', JSON.stringify(d)); } } catch (e) { /* ignore */ }
}

export function startRaid(rivalId, { faceURL, AG, speak, onWin, revenge, cond, condHTML, onEnd }) {
  const CD = cond || { power: 1, pct: 0 };
  const rival = RIVALS.find((x) => x.id === rivalId) || RIVALS[0];
  const sq = squadOf().sort((a, b) => STATS[b.c.rarity][0] - STATS[a.c.rarity][0]).slice(0, 3);
  if (!sq.length) return false;
  const gb = gearBonus();
  const mine = sq.map((s, i) => { const [a, h] = STATS[s.c.rarity]; const k = s.evo ? 1.5 : 1; const hp = Math.round(h * k) + gb.hp; return { i, name: s.evo ? s.c.evo : s.c.name, img: critterURL(s.c, 120, s.evo), atk: Math.round(a * k) + gb.atk, hp, max: hp }; });
  const foes = rival.towers.map((t, i) => {
    const boss = t === 'Smog Baron';
    const hp = Math.round((boss ? 60 + rival.lvl * 10 : 16 + rival.lvl * 9) * (0.85 + (CD.power - 1) * 0.6));
    return { i, name: t, boss, img: boss ? faceURL(AG.baron, 120) : null, atk: boss ? 7 + rival.lvl * 2 : 2 + rival.lvl * 2, hp, max: hp };
  });
  const root = document.createElement('div');
  root.className = 'raid';
  root.style.backgroundImage = `linear-gradient(rgba(20,16,50,.15), rgba(20,16,50,.55) 70%, rgba(20,16,50,.85)), url(art/bg-${rival.id}.jpg)`;
  const unit = (u, side) => `<div class="ru ${side} ${u.boss ? 'boss' : ''}" data-side="${side}" data-i="${u.i}">
      <div class="ru-hp"><i style="width:100%"></i></div>
      ${u.img ? `<img src="${u.img}" alt="">` : `<div class="tower"><span class="t-top"></span><span class="t-eyes">• •</span></div>`}
      <b>${u.name}</b></div>`;
  root.innerHTML = `<div class="r-sky"></div>
    <div class="r-top"><b>${revenge ? 'Revenge raid' : 'Raid'}: ${rival.name}</b><button class="r-x" aria-label="Retreat">✕</button></div>
    <div class="r-field"><div class="r-side mine">${mine.map((u) => unit(u, 'mine')).join('')}</div><div class="r-vs">VS</div><div class="r-side foe">${foes.map((u) => unit(u, 'foe')).join('')}</div></div>
    ${condHTML && cond ? `<div class="r-cond">${condHTML(cond, { air: 'towers +{pct}%', news: 'towers fired up' })}</div>` : ''}
    <div class="r-coach"><img src="${faceURL(AG.mossling, 64)}" alt=""><p class="r-say">${CD.air ? `Commander Mossling: "Bruin says LA air is PM2.5 ${CD.air.pm25} today, so their towers are ${CD.pct}% tougher. Charge POWER and hit them all at once!"` : 'Commander Mossling: "Target the weakest tower first. Charge your POWER and hit them all at once!"'}</p></div>
    <button class="r-power" disabled><span>POWER</span><i></i></button>
    <div class="r-end" hidden></div>`;
  document.body.appendChild(root);
  const $ = (q) => root.querySelector(q);
  const el = (side, i) => root.querySelector(`.ru[data-side="${side}"][data-i="${i}"]`);
  speak && speak('baron', revenge ? 'You dare come back? Smog towers, attack!' : 'Intruders! Smog towers, attack!');
  let charge = 0, done = false, timer = 0;
  const alive = (arr) => arr.filter((u) => u.hp > 0);
  const say = (t) => { $('.r-say').textContent = t; };
  function hit(attacker, target, aSide, dmg, fx) {
    target.hp = Math.max(0, target.hp - dmg);
    const tEl = el(aSide === 'mine' ? 'foe' : 'mine', target.i), aEl = el(aSide, attacker.i);
    aEl.classList.remove('lunge'); void aEl.offsetWidth; aEl.classList.add('lunge');
    // flying projectile
    const p = document.createElement('span');
    p.className = 'r-shot'; p.textContent = fx;
    const a = aEl.getBoundingClientRect(), b = tEl.getBoundingClientRect();
    p.style.left = a.left + a.width / 2 + 'px'; p.style.top = a.top + a.height / 2 + 'px';
    root.appendChild(p);
    requestAnimationFrame(() => { p.style.transform = `translate(${b.left - a.left}px, ${b.top - a.top}px) scale(1.4)`; p.style.opacity = '0.2'; });
    setTimeout(() => p.remove(), 450);
    setTimeout(() => {
      tEl.classList.remove('hit'); void tEl.offsetWidth; tEl.classList.add('hit');
      tEl.querySelector('.ru-hp i').style.width = (target.hp / target.max) * 100 + '%';
      const n = document.createElement('span'); n.className = 'r-dmg'; n.textContent = '-' + dmg; tEl.appendChild(n); setTimeout(() => n.remove(), 700);
      if (target.hp <= 0) tEl.classList.add('down');
    }, 380);
  }
  function turn() {
    if (done) return;
    const ms = alive(mine), fs = alive(foes);
    if (!ms.length || !fs.length) return end(ms.length > 0);
    // my squad: each hits the weakest tower
    const target = fs.sort((x, y) => x.hp - y.hp)[0];
    ms.forEach((u, k) => setTimeout(() => { if (!done && target.hp > 0) hit(u, target, 'mine', Math.max(1, Math.round(u.atk * (0.8 + Math.random() * 0.4))), ['💥', '✨', '♻️'][k % 3]); }, k * 160));
    // towers fire back at a random critter
    setTimeout(() => {
      if (done) return;
      alive(foes).forEach((f, k) => { const t = alive(mine)[Math.floor(Math.random() * alive(mine).length)]; if (t) setTimeout(() => hit(f, t, 'foe', Math.max(1, Math.round(f.atk * (0.8 + Math.random() * 0.4))), f.boss ? '🎩' : '💨'), k * 140); });
    }, 520);
    charge = Math.min(3, charge + 1);
    const pb = $('.r-power');
    pb.disabled = charge < 3; pb.querySelector('i').style.width = (charge / 3) * 100 + '%';
    if (charge === 3) { pb.classList.add('ready'); say('Commander Mossling: "POWER is charged! Tap it now!"'); }
    timer = setTimeout(turn, 1300);
  }
  $('.r-power').onclick = () => {
    if (charge < 3 || done) return;
    charge = 0; const pb = $('.r-power'); pb.classList.remove('ready'); pb.disabled = true; pb.querySelector('i').style.width = '0%';
    root.classList.remove('shake'); void root.offsetWidth; root.classList.add('shake');
    alive(mine).forEach((u, k) => alive(foes).forEach((f, j) => setTimeout(() => hit(u, f, 'mine', Math.round(u.atk * 1.6), '🌟'), (k * 3 + j) * 90)));
    say('Commander Mossling: "Huge hit! Keep the pressure on!"');
    speak && speak('mossling', 'Yes! Teamwork!');
  };
  function end(won) {
    done = true; clearTimeout(timer);
    const box = $('.r-end');
    const r = load();
    if (won) { r.wins = r.wins || {}; r.wins[rival.id] = (r.wins[rival.id] || 0) + 1; if (revenge) delete r.pending; save(r); }
    const loot = won ? rival.loot + (revenge ? 10 : 0) : 0;
    if (won) onWin && onWin(rival, loot);
    onEnd && onEnd(won, rival);
    speak && speak(won ? 'baron' : 'baron', won ? 'Curses! This is not over!' : 'Mwahaha! The planet is mine… for now.');
    box.hidden = false;
    box.innerHTML = won
      ? `<h2>Planet smashed!</h2><p>Your squad flattened every smog tower on ${rival.name}.</p><p class="r-loot">+${loot} seeds</p><p class="small">Catch more critters to build a stronger squad. Rare ones hit harder; 3 of a kind evolves.</p><button class="btn big r-again">Raid again</button> <button class="btn ghost r-close">Back</button>`
      : `<h2>Retreat!</h2><p>${rival.name} held. Catch rarer critters or evolve yours (3 of a kind), then come back.</p><button class="btn big r-again">Try again</button> <button class="btn ghost r-close">Back</button>`;
    box.querySelector('.r-again').onclick = () => { close(); startRaid(rivalId, { faceURL, AG, speak, onWin, revenge, cond, condHTML, onEnd }); };
    box.querySelector('.r-close').onclick = close;
  }
  function close() { done = true; clearTimeout(timer); root.remove(); }
  $('.r-x').onclick = close;
  setTimeout(turn, 900);
  return true;
}
