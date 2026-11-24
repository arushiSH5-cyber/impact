// Trash Catch: Pokémon-Go-style litter hunting. Doodle litter critters appear over your camera view; flick the bin
// to catch them. Every catch goes into your Trashdex (rarities, evolutions at 3 of a kind) and asks you to bin a real
// piece of litter for seeds. Collection lives on this phone.

export const CRITTERS = [
  { id: 'bottle', name: 'Bottle Bob', rarity: 'common', color: '#9fd8ff', line: 'Glug glug, catch me!', evo: 'Bottle Bobzilla' },
  { id: 'can', name: 'Can Goblin', rarity: 'common', color: '#ff9f9f', line: 'Crinkle crunch!', evo: 'Can King' },
  { id: 'cup', name: 'Cup Kid', rarity: 'common', color: '#ffe08a', line: 'Slurp! Not today!', evo: 'Mega Mug' },
  { id: 'bag', name: 'Bag Ghost', rarity: 'uncommon', color: '#f3f3f3', line: 'Wooooosh…', evo: 'Bag Phantom' },
  { id: 'wrapper', name: 'Wrapper Wraith', rarity: 'uncommon', color: '#d6b3ff', line: 'Crackle crackle!', evo: 'Wrapper Warlord' },
  { id: 'straw', name: 'Straw Snake', rarity: 'rare', color: '#ff8fb8', line: 'Sssslurp!', evo: 'Straw Serpent' },
  { id: 'tire', name: 'Tire Troll', rarity: 'rare', color: '#8a8597', line: 'Roll roll roll!', evo: 'Tire Titan' },
  { id: 'star', name: 'Golden Gunk', rarity: 'legendary', color: '#ffd34d', line: 'You found me?!', evo: 'Golden Gunk ★' },
];
const RARITY = { common: { w: 50, pts: 10, flee: 0.05 }, uncommon: { w: 28, pts: 25, flee: 0.12 }, rare: { w: 15, pts: 60, flee: 0.22 }, legendary: { w: 4, pts: 200, flee: 0.35 } };

const KEY = 'impact.trashdex';
export function loadDex() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
function saveDex(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- doodle drawing (wobbly ink lines, cute faces)
export function drawCritter(x, c, s, t = 0, evolved = false) {
  const w = (n) => n + Math.sin(t * 7 + n) * 1.2; // ink wobble
  x.save();
  x.scale(s / 120, s / 120);
  x.lineJoin = x.lineCap = 'round';
  x.strokeStyle = '#2b2a26'; x.lineWidth = 5;
  x.fillStyle = evolved ? '#ffd34d' : c.color;
  x.beginPath();
  switch (c.id) {
    case 'bottle': x.moveTo(w(48), 14); x.lineTo(w(72), 14); x.lineTo(w(72), 30); x.quadraticCurveTo(w(96), 40, w(94), 64); x.lineTo(w(94), 104); x.quadraticCurveTo(60, 114, w(26), 104); x.lineTo(w(26), 64); x.quadraticCurveTo(w(24), 40, w(48), 30); x.closePath(); break;
    case 'can': x.ellipse(60, 22, 32, 9, 0, 0, 7); x.moveTo(28, 22); x.lineTo(w(28), 98); x.ellipse(60, 98, 32, 9, 0, Math.PI, 0, true); x.lineTo(w(92), 22); break;
    case 'cup': x.moveTo(w(24), 30); x.lineTo(w(96), 30); x.lineTo(w(84), 108); x.lineTo(w(36), 108); x.closePath(); x.moveTo(70, 30); x.lineTo(w(84), 4); break;
    case 'bag': x.moveTo(w(22), 40); x.quadraticCurveTo(10, 100, w(34), 110); x.quadraticCurveTo(60, 98, w(86), 110); x.quadraticCurveTo(110, 100, w(98), 40); x.quadraticCurveTo(60, 50, w(22), 40); x.moveTo(36, 42); x.quadraticCurveTo(w(40), 12, 52, 42); x.moveTo(68, 42); x.quadraticCurveTo(w(80), 12, 84, 42); break;
    case 'wrapper': x.moveTo(36, 40); x.lineTo(w(10), 22); x.lineTo(w(14), 60); x.lineTo(w(8), 98); x.lineTo(36, 80); x.quadraticCurveTo(60, 92, 84, 80); x.lineTo(w(112), 98); x.lineTo(w(106), 60); x.lineTo(w(110), 22); x.lineTo(84, 40); x.quadraticCurveTo(60, 28, 36, 40); break;
    case 'straw': x.lineWidth = 5; x.moveTo(16, 100); x.bezierCurveTo(w(20), 40, w(100), 110, w(96), 40); x.lineTo(w(110), 30); x.lineTo(w(102), 52); x.lineTo(w(86), 44); x.quadraticCurveTo(w(84), 98, w(30), 104); x.closePath(); break;
    case 'tire': x.arc(60, 62, 48, 0, 7); x.moveTo(84, 62); x.arc(60, 62, 22, 0, 7, true); break;
    case 'star': for (let i = 0; i < 10; i++) { const r = i % 2 ? 24 : 54, a = -Math.PI / 2 + (i * Math.PI) / 5; x[i ? 'lineTo' : 'moveTo'](60 + Math.cos(a) * w(r), 64 + Math.sin(a) * r); } x.closePath(); break;
  }
  x.fill('evenodd'); x.stroke();
  // face
  const ey = c.id === 'tire' ? 34 : c.id === 'bag' || c.id === 'wrapper' ? 66 : c.id === 'straw' ? 72 : 62;
  const ex = c.id === 'tire' ? 60 : 60;
  x.fillStyle = '#2b2a26';
  x.beginPath(); x.arc(ex - 13, ey, 5, 0, 7); x.arc(ex + 13, ey, 5, 0, 7); x.fill();
  x.fillStyle = '#fff'; x.beginPath(); x.arc(ex - 11, ey - 2, 1.8, 0, 7); x.arc(ex + 15, ey - 2, 1.8, 0, 7); x.fill();
  x.lineWidth = 4; x.beginPath(); x.arc(ex, ey + 8, 7, 0.15 * Math.PI, 0.85 * Math.PI); x.stroke();
  x.fillStyle = 'rgba(255,120,150,.55)'; x.beginPath(); x.arc(ex - 24, ey + 8, 5, 0, 7); x.arc(ex + 24, ey + 8, 5, 0, 7); x.fill();
  if (evolved) { x.fillStyle = '#fff'; x.font = '900 26px system-ui'; x.fillText('★', 94, 26); }
  x.restore();
}
export function critterURL(c, size = 96, evolved = false) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  drawCritter(cv.getContext('2d'), c, size, 0, evolved);
  return cv.toDataURL();
}

export function dexHTML() {
  const d = loadDex();
  const got = CRITTERS.filter((c) => d[c.id]).length;
  return `<div class="dex-top"><b>${got}/${CRITTERS.length}</b> found · <b>${CRITTERS.filter((c) => (d[c.id] || 0) >= 3).length}</b> evolved · <b>${Object.values(d).reduce((a, b) => a + b, 0)}</b> caught</div>
    <div class="dex">${CRITTERS.map((c) => {
      const n = d[c.id] || 0;
      return `<div class="dex-c ${n ? '' : 'locked'} ${c.rarity}"><img src="${critterURL(c, 96, n >= 3)}" alt=""><b>${n ? (n >= 3 ? c.evo : c.name) : '???'}</b><small>${c.rarity}${n ? ` · ×${n}` : ''}</small>${n && n < 3 ? `<i class="evo-bar"><em style="width:${(n / 3) * 100}%"></em></i>` : ''}</div>`;
    }).join('')}</div>`;
}


// ---------------------------------------------------------------- real trash detection (AI runs in the browser)
// COCO-SSD (TensorFlow.js) looks at the live camera. A real bottle, cup, bag, paper or cutlery in view summons its
// critter, and catching it earns equipment for Planet Raids. Nothing leaves the phone.
const REAL = {
  bottle: ['bottle', 'plastic bottle'], 'wine glass': ['bottle', 'glass bottle'], cup: ['cup', 'cup'],
  handbag: ['bag', 'bag'], backpack: ['bag', 'bag'], suitcase: ['bag', 'bag'], book: ['wrapper', 'paper'],
  fork: ['straw', 'plastic cutlery'], knife: ['straw', 'plastic cutlery'], spoon: ['straw', 'plastic cutlery'],
  'cell phone': ['can', 'e-waste'], remote: ['can', 'e-waste'], mouse: ['can', 'e-waste'], keyboard: ['can', 'e-waste'],
  'sports ball': ['tire', 'rubber ball'], frisbee: ['tire', 'plastic disc'],
};
export const GEAR = {
  bottle: { name: 'Bottle Blaster', atk: 4, hp: 0 }, cup: { name: 'Cup Cannon', atk: 4, hp: 0 }, bag: { name: 'Bag Glider', atk: 0, hp: 10 },
  wrapper: { name: 'Paper Shield', atk: 0, hp: 8 }, straw: { name: 'Fork Lance', atk: 5, hp: 0 }, can: { name: 'Circuit Armor', atk: 2, hp: 8 },
  tire: { name: 'Bounce Armor', atk: 0, hp: 14 }, star: { name: 'Golden Crown', atk: 8, hp: 10 },
};
const GKEY = 'impact.gear';
export function loadGear() { try { return JSON.parse(localStorage.getItem(GKEY)) || {}; } catch (e) { return {}; } }
function addGear(id) { const g = loadGear(); g[id] = (g[id] || 0) + 1; try { localStorage.setItem(GKEY, JSON.stringify(g)); } catch (e) { /* ignore */ } return GEAR[id]; }
let detector = null, detLoading = null;
function addScript(src) { return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = no; document.head.appendChild(s); }); }
function loadDetector() {
  if (detector) return Promise.resolve(detector);
  if (!detLoading) detLoading = addScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.17.0/dist/tf.min.js')
    .then(() => addScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js'))
    .then(() => window.cocoSsd.load({ base: 'lite_mobilenet_v2' })).then((m) => (detector = m));
  return detLoading;
}

// ---------------------------------------------------------------- the catch screen
export function startCatch({ onCatch, onReal, speak, cond, condHTML, onPost, onNearby }) {
  const root = document.createElement('div');
  root.className = 'catch';
  root.innerHTML = `<video playsinline muted autoplay></video><div class="c-park"></div><canvas></canvas>
    <div class="c-top"><span class="c-name"></span><button class="c-x" aria-label="Close">✕</button></div>
    <div class="c-scan">AI scanner: point your camera at real trash</div>
    <div class="c-hint">Flick the bin up at the critter!</div>
    ${condHTML && cond ? `<div class="c-cond">${condHTML(cond, { air: 'rare critters +{pct}%', news: 'critters on the move' })}</div>` : ''}
    <div class="c-result" hidden></div>`;
  document.body.appendChild(root);
  const $ = (q) => root.querySelector(q);
  const video = $('video'), cv = $('canvas'), ctx = cv.getContext('2d');
  let stream = null;
  if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.isSecureContext) {
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then((s) => {
        stream = s; video.srcObject = s;
        // only swap the painted park for the camera once real, non-black frames arrive
        const probe = document.createElement('canvas'); probe.width = probe.height = 16; const pc = probe.getContext('2d');
        let tries = 0;
        const check = () => {
          if (!document.body.contains(root)) return;
          if (video.videoWidth > 0) {
            pc.drawImage(video, 0, 0, 16, 16);
            const d = pc.getImageData(0, 0, 16, 16).data; let sum = 0;
            for (let i = 0; i < d.length; i += 4) sum += d[i] + d[i + 1] + d[i + 2];
            if (sum / (d.length / 4) > 30) { root.classList.add('cam'); return; }
          }
          if (++tries < 40) setTimeout(check, 250);
        };
        video.addEventListener('playing', check, { once: true }); setTimeout(check, 600);
        startScan();
      })
      .catch(() => { /* no camera: drawn park background */ });
  }
  const dpr = Math.min(2, devicePixelRatio || 1);
  let W = 0, H = 0;
  const size = () => { W = innerWidth; H = innerHeight; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0); };
  addEventListener('resize', size); size();

  // pick a critter by rarity
  const boost = (c) => RARITY[c.rarity].w * (c.rarity === 'common' ? 1 : (cond && cond.power) || 1); // dirty air → rarer critters
  const total = CRITTERS.reduce((a, c) => a + boost(c), 0);
  let r = Math.random() * total, crit = CRITTERS[0], realFrom = null, box = null;
  for (const c of CRITTERS) { r -= boost(c); if (r <= 0) { crit = c; break; } }
  const dex = loadDex();
  let evolvedNow = (dex[crit.id] || 0) >= 3;
  const nameTag = () => { $('.c-name').innerHTML = `<b>${evolvedNow ? crit.evo : crit.name}</b><small class="${crit.rarity}">${realFrom ? 'from real ' + realFrom : crit.rarity}</small>`; };
  nameTag();
  // live detection loop: real trash in view summons its critter right next to it
  async function startScan() {
    const sc = $('.c-scan');
    sc.textContent = 'AI scanner: loading…';
    try { await loadDetector(); } catch (e) { sc.textContent = 'AI scanner unavailable on this connection'; return; }
    sc.textContent = 'AI scanner: point your camera at real trash';
    const loop = async () => {
      if (!document.body.contains(root) || done) return;
      try {
        const preds = await detector.detect(video);
        const hit = preds.filter((p) => REAL[p.class] && p.score > 0.5).sort((a, b) => b.score - a.score)[0];
        if (hit) {
          // map the video box (object-fit: cover) to screen pixels
          const vw = video.videoWidth, vh = video.videoHeight, k = Math.max(W / vw, H / vh), ox = (W - vw * k) / 2, oy = (H - vh * k) / 2;
          box = { x: hit.bbox[0] * k + ox, y: hit.bbox[1] * k + oy, w: hit.bbox[2] * k, h: hit.bbox[3] * k, label: `${REAL[hit.class][1]} · ${Math.round(hit.score * 100)}%`, t: performance.now() };
          sc.textContent = `Spotted real ${REAL[hit.class][1]}!`;
          sc.classList.add('found');
          if (!realFrom && !C.caught) {
            crit = CRITTERS.find((c) => c.id === REAL[hit.class][0]) || crit;
            realFrom = REAL[hit.class][1];
            evolvedNow = (loadDex()[crit.id] || 0) >= 3;
            nameTag();
            C.x = Math.max(C.size / 2, Math.min(W - C.size / 2, box.x + box.w / 2));
            for (let i = 0; i < 18; i++) sparks.push({ x: C.x, y: C.y, vx: (Math.random() - 0.5) * 7, vy: -Math.random() * 6, l: 1, c: '#fff', e: '✨' });
            speak && speak('ripplet', 'A wild litter critter appeared!');
          }
        }
      } catch (e) { /* keep scanning */ }
      setTimeout(loop, 450);
    };
    loop();
  }
  speak && speak('ripplet', 'A wild litter critter appeared!');

  const C = { x: W / 2, y: H * 0.38, size: Math.min(W, H) * 0.32, t: 0, dodge: 0, caught: false, gone: false };
  const bin = { x: W / 2, y: H - 90, r: 42 };
  let ball = null, drag = null, sparks = [], tries = 0, done = false;

  cv.addEventListener('pointerdown', (e) => {
    if (done || ball) return;
    if (Math.hypot(e.clientX - bin.x, e.clientY - bin.y) < 90) drag = { x: e.clientX, y: e.clientY, t: performance.now(), pts: [] };
  });
  cv.addEventListener('pointermove', (e) => { if (drag) { drag.cx = e.clientX; drag.cy = e.clientY; drag.pts.push([e.clientX, e.clientY, performance.now()]); if (drag.pts.length > 6) drag.pts.shift(); } });
  cv.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const p0 = drag.pts[0] || [drag.x, drag.y, drag.t];
    const dt = Math.max(16, performance.now() - p0[2]);
    const vx = ((e.clientX - p0[0]) / dt) * 16, vy = ((e.clientY - p0[1]) / dt) * 16;
    drag = null;
    if (vy > -6) return; // not a flick up
    ball = { x: bin.x, y: bin.y, vx: vx * 0.9, vy: vy * 1.15, s: 1, spin: 0 };
    tries++;
    $('.c-hint').hidden = true;
  });

  let last = performance.now(), raf = 0;
  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    C.t += dt;
    ctx.clearRect(0, 0, W, H);
    // critter bobs and drifts, sometimes dodges
    if (!C.caught && !C.gone) {
      C.x += Math.sin(C.t * 0.9) * 0.7 + C.dodge * dt * 60; C.dodge *= 0.9;
      C.x = Math.max(C.size / 2, Math.min(W - C.size / 2, C.x));
      const bob = Math.sin(C.t * 2.4) * 12;
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,.18)'; ctx.beginPath(); ctx.ellipse(C.x, C.y + C.size * 0.55, C.size * 0.3, 10, 0, 0, 7); ctx.fill();
      ctx.translate(C.x - C.size / 2, C.y - C.size / 2 + bob);
      drawCritter(ctx, crit, C.size, C.t, evolvedNow);
      ctx.restore();
    }
    if (box && performance.now() - box.t < 1500) {
      ctx.save(); ctx.strokeStyle = '#ffd34d'; ctx.lineWidth = 5; ctx.setLineDash([14, 10]); ctx.lineDashOffset = -C.t * 40;
      ctx.beginPath(); ctx.roundRect(box.x, box.y, box.w, box.h, 18); ctx.stroke();
      ctx.setLineDash([]); ctx.font = '800 15px Nunito, system-ui'; const tw = ctx.measureText(box.label).width + 18;
      ctx.fillStyle = '#ffd34d'; ctx.beginPath(); ctx.roundRect(box.x, Math.max(4, box.y - 30), tw, 26, 13); ctx.fill();
      ctx.fillStyle = '#2b2a26'; ctx.fillText(box.label, box.x + 9, Math.max(4, box.y - 30) + 18); ctx.restore();
    }
    // thrown bin
    if (ball) {
      ball.x += ball.vx * dt * 60; ball.y += ball.vy * dt * 60; ball.vy += 0.55 * dt * 60; ball.s = Math.max(0.45, ball.s - dt * 0.7); ball.spin += dt * 12;
      ctx.save(); ctx.translate(ball.x, ball.y); ctx.rotate(ball.spin); drawBin(ctx, 34 * ball.s); ctx.restore();
      if (!C.caught && Math.hypot(ball.x - C.x, ball.y - C.y) < C.size * 0.42) {
        if (Math.random() < RARITY[crit.rarity].flee && tries < 4) { C.dodge = (Math.random() < 0.5 ? -1 : 1) * 9; toast2('It dodged!'); ball = null; }
        else { C.caught = true; ball = null; catchIt(); }
      } else if (ball && (ball.y > H + 60 || ball.x < -60 || ball.x > W + 60)) { ball = null; toast2(tries >= 3 ? 'So close! Try again' : 'Missed!'); }
    } else if (!done) {
      ctx.save(); ctx.translate(bin.x, bin.y + (drag ? Math.min(30, (drag.cy || bin.y) - drag.y) * 0.3 : Math.sin(C.t * 3) * 3)); drawBin(ctx, 40); ctx.restore();
    }
    for (const s of sparks) { s.x += s.vx; s.y += s.vy; s.vy += 0.15; s.l -= dt; ctx.globalAlpha = Math.max(0, s.l); ctx.fillStyle = s.c; ctx.font = '20px system-ui'; ctx.fillText(s.e, s.x, s.y); }
    ctx.globalAlpha = 1; sparks = sparks.filter((s) => s.l > 0);
  }
  requestAnimationFrame(frame);

  function toast2(t) { const h = $('.c-hint'); h.hidden = false; h.textContent = t; }
  function catchIt() {
    for (let i = 0; i < 26; i++) sparks.push({ x: C.x, y: C.y, vx: (Math.random() - 0.5) * 8, vy: -Math.random() * 7, l: 1.2, c: '#fff', e: ['✨', '⭐', '💚'][i % 3] });
    const d = loadDex(); d[crit.id] = (d[crit.id] || 0) + 1; saveDex(d);
    const n = d[crit.id], evolved = n === 3;
    const pts = RARITY[crit.rarity].pts * (realFrom ? 2 : 1);
    const gear = realFrom ? addGear(crit.id) : null;
    onCatch && onCatch(crit, pts, n);
    onPost && onPost(crit, realFrom);
    speak && speak('ripplet', evolved ? 'Whoa! It evolved!' : 'Gotcha! Into the bin you go!');
    done = true;
    setTimeout(() => {
      const box = $('.c-result');
      box.hidden = false;
      box.innerHTML = `<img src="${critterURL(crit, 140, n >= 3)}" alt=""><h2>${evolved ? `Evolved: ${crit.evo}!` : `Caught ${crit.name}!`}</h2>
        <p><span class="pill-r ${crit.rarity}">${crit.rarity}</span> +${pts} points · ×${n} in your Trashdex${n < 3 ? ` · ${3 - n} more to evolve` : ''}</p>
        ${gear ? `<div class="c-gear"><b>Equipment earned: ${gear.name}</b><span>${gear.atk ? `+${gear.atk} attack` : ''}${gear.atk && gear.hp ? ' · ' : ''}${gear.hp ? `+${gear.hp} health` : ''} for your whole raid squad. Scanned from a real ${realFrom}.</span></div>` : ''}
        <div class="c-real"><b>Now catch a real one.</b> Pick up a piece of litter near you, bin it and snap it: that heals the ocean for your whole street and earns real seeds.</div>
        <button class="btn big c-bin">I binned a real one</button>
        <button class="btn ghost c-near">📍 Bin it nearby (Glasser)</button>
        <div class="c-row"><button class="btn ghost c-next">Catch another</button><button class="btn ghost c-done">Done</button></div>`;
      box.querySelector('.c-bin').onclick = () => { close(); onReal && onReal(); };
      box.querySelector('.c-near').onclick = () => { close(); onNearby && onNearby(crit); };
      box.querySelector('.c-next').onclick = () => { close(); startCatch({ onCatch, onReal, speak, cond, condHTML, onPost, onNearby }); };
      box.querySelector('.c-done').onclick = close;
    }, 700);
  }
  function close() { cancelAnimationFrame(raf); removeEventListener('resize', size); if (stream) stream.getTracks().forEach((t) => t.stop()); root.remove(); }
  $('.c-x').onclick = close;
}

function drawBin(x, r) {
  x.lineJoin = 'round'; x.strokeStyle = '#2b2a26'; x.lineWidth = 4;
  x.fillStyle = '#62d98a';
  x.beginPath(); x.moveTo(-r * 0.8, -r * 0.6); x.lineTo(r * 0.8, -r * 0.6); x.lineTo(r * 0.62, r); x.lineTo(-r * 0.62, r); x.closePath(); x.fill(); x.stroke();
  x.fillStyle = '#3fae5e'; x.beginPath(); x.rect(-r, -r * 0.86, r * 2, r * 0.3); x.fill(); x.stroke();
  x.beginPath(); x.moveTo(-r * 0.25, -r * 0.86); x.quadraticCurveTo(0, -r * 1.25, r * 0.25, -r * 0.86); x.stroke();
  x.fillStyle = '#fff'; x.font = `900 ${r * 0.7}px system-ui`; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('♻', 0, r * 0.2);
}
