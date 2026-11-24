// Smog Siege: the flagship 3D game. Smog bombs fly in from space toward the planet. Spin the planet, tap bombs to
// blow them up, grab golden seeds to grow trees. Your AI guardians orbit with you and zap bombs with lasers on their
// own. Every third wave the Smog Baron himself attacks as a boss.
import * as THREE from 'three';
import { drawFace } from './faces.js';

export function startSiege({ agents, myFace, onEnd, speak, say, cond, condHTML, onResult }) {
  const C = cond || { power: 1, pct: 0 };
  const AG = Object.fromEntries(agents.map((a) => [a.id, a]));
  const root = document.createElement('div');
  root.className = 'siege';
  root.innerHTML = `<canvas></canvas><div class="flash"></div>
    <div class="s-hud"><div><b class="s-score">0</b><small>score</small></div><div class="s-mid"><span class="s-wave">Wave 1</span><span class="s-hp"><i></i></span></div><div><b class="s-combo">x1</b><small>combo</small></div></div>
    <button class="s-x" aria-label="Quit">✕</button>
    <div class="s-feed"></div><div class="s-banner"></div>
    <div class="s-card s-start"><h1>Smog Siege</h1><p>The Smog Baron is bombing the planet. <b>Tap the smog bombs</b> before they land. <b>Drag</b> to spin the planet and find bombs on the back. Grab <b>golden seeds</b> to grow trees. Your guardians fight beside you.</p>
      <div class="s-faces"></div>${condHTML && cond ? condHTML(cond, { air: '{pct}% more smog bombs', news: 'a news wave is coming' }) : ''}<button class="btn big s-go">Defend the planet</button><p class="small muted">Best: <span class="s-best">0</span></p></div>`;
  document.body.appendChild(root);
  const $ = (q) => root.querySelector(q);
  let best = 0; try { best = +localStorage.getItem('impact.siegeBest') || 0; } catch (e) { /* ignore */ }
  $('.s-best').textContent = best;
  const faceImg = (d) => { const c = drawFace(d, 96); c.className = 'sf'; return c; };
  ['mossling', 'ripplet', 'frostbun'].forEach((id) => $('.s-faces').appendChild(faceImg(AG[id])));

  // ---------------------------------------------------------------- scene
  const cv = $('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true });
  let composer = null; // bloom glow, set once the post-processing modules load
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x141a3d);
  new THREE.TextureLoader().load('art/bg-universe.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; scene.background = t; }); // Runware-painted nebula
  const cam = new THREE.PerspectiveCamera(50, 1, 0.1, 200);
  cam.position.set(0, 0, 9);
  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x334477, 1.3));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(4, 5, 6); scene.add(sun);
  const pinkRim = new THREE.DirectionalLight(0xff9fd0, 0.9); pinkRim.position.set(-5, -2, -4); scene.add(pinkRim);
  { // stars + nebula glow
    const g = new THREE.BufferGeometry(), p = [];
    for (let i = 0; i < 900; i++) { const v = new THREE.Vector3().randomDirection().multiplyScalar(40 + Math.random() * 40); p.push(v.x, v.y, v.z); }
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 0.12 })));
    const c = document.createElement('canvas'); c.width = c.height = 256; const x = c.getContext('2d');
    const gr = x.createRadialGradient(128, 128, 50, 128, 128, 128); gr.addColorStop(0, 'rgba(170,215,255,.5)'); gr.addColorStop(.6, 'rgba(210,160,255,.18)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 256, 256);
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true })); s.scale.set(6.5, 6.5, 1); s.position.z = -1; scene.add(s);
  }
  const world = new THREE.Group(); scene.add(world);

  // planet: pastel zones that go dusty as planet health drops
  const DIRS = [[new THREE.Vector3(.75, .25, .6).normalize(), '#62d98a', '#b9a888'], [new THREE.Vector3(0, 1, 0), '#f3fbff', '#c4c8d4'], [new THREE.Vector3(-.8, .05, .55).normalize(), '#ffd894', '#cfa984'], [new THREE.Vector3(.1, -.55, .85).normalize(), '#3fb2ff', '#7d8fb0'], [new THREE.Vector3(-.3, -.4, -.85).normalize(), '#62d98a', '#b9a888'], [new THREE.Vector3(.6, -.1, -.8).normalize(), '#3fb2ff', '#7d8fb0']];
  const R = 1.6;
  const geo = new THREE.IcosahedronGeometry(R, 4).toNonIndexed();
  const pos = geo.attributes.position, cols = new Float32Array(pos.count * 3), faceIdx = [], jit = [];
  const tmp = new THREE.Vector3();
  for (let f = 0; f < pos.count / 3; f++) {
    tmp.set(0, 0, 0); for (let k = 0; k < 3; k++) tmp.add(new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k)); tmp.normalize();
    const n = Math.sin(tmp.x * 9) * Math.cos(tmp.y * 7) * Math.sin(tmp.z * 8) * .2;
    let bi = 3, bd = -9; DIRS.forEach(([d], i) => { const v = tmp.dot(d) + (i === 3 || i === 5 ? .12 : n); if (v > bd) { bd = v; bi = i; } });
    faceIdx.push(bi); jit.push(.93 + Math.random() * .12);
    if (bi !== 3 && bi !== 5) for (let k = 0; k < 3; k++) { const v = new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k).multiplyScalar(1.025 + Math.abs(n) * .08); pos.setXYZ(f * 3 + k, v.x, v.y, v.z); }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(cols, 3)); geo.computeVertexNormals();
  const planet = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: .75 }));
  world.add(planet);
  function paint(h) {
    const a = new THREE.Color(), b = new THREE.Color();
    for (let f = 0; f < faceIdx.length; f++) { const d = DIRS[faceIdx[f]]; a.set(d[2]); b.set(d[1]); a.lerp(b, Math.pow(Math.max(0, h), .7)).multiplyScalar(jit[f]); for (let k = 0; k < 3; k++) cols.set([a.r, a.g, a.b], (f * 3 + k) * 3); }
    geo.attributes.color.needsUpdate = true;
  }
  const treeMats = [new THREE.MeshToonMaterial({ color: 0x3fae5e }), new THREE.MeshToonMaterial({ color: 0x7fd36a }), new THREE.MeshToonMaterial({ color: 0xff8fb8 })];
  function growTree(dir) {
    const t = new THREE.Group();
    const top = new THREE.Mesh(Math.random() < .5 ? new THREE.ConeGeometry(.07, .2, 6) : new THREE.IcosahedronGeometry(.09, 1), treeMats[Math.floor(Math.random() * 3)]);
    top.position.y = .14; t.add(top);
    t.position.copy(dir.clone().multiplyScalar(R * 1.02)); t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    t.scale.setScalar(.01); t.userData.grow = 1; world.add(t); trees.push(t);
  }
  const trees = [];
  for (let i = 0; i < 18; i++) growTree(DIRS[0][0].clone().add(new THREE.Vector3().randomDirection().multiplyScalar(.5)).normalize());

  // guardians orbiting with face sprites
  const guards = ['mossling', 'ripplet', 'frostbun'].map((id, i) => {
    const d = AG[id], g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(.22, 18, 12), new THREE.MeshToonMaterial({ color: d.color }));
    const tex = new THREE.CanvasTexture(drawFace(d, 128)); tex.colorSpace = THREE.SRGBColorSpace;
    const fs = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex })); fs.scale.set(.5, .5, 1);
    g.add(body, fs); scene.add(g);
    return { id, d, g, fs, ang: (i / 3) * Math.PI * 2, tilt: (i - 1) * .5, cd: 1 + i * .7 };
  });
  const lasers = [];

  // the Baron (boss)
  const baronTex = new THREE.CanvasTexture(drawFace(AG.baron, 256)); baronTex.colorSpace = THREE.SRGBColorSpace;
  const boss = new THREE.Group();
  boss.add(new THREE.Mesh(new THREE.SphereGeometry(.7, 24, 16), new THREE.MeshToonMaterial({ color: 0x7a6f86 })));
  const bossFace = new THREE.Sprite(new THREE.SpriteMaterial({ map: baronTex })); bossFace.scale.set(1.7, 1.7, 1); boss.add(bossFace);
  boss.visible = false; scene.add(boss);

  // bombs, seeds, particles
  const bombGeo = new THREE.IcosahedronGeometry(.22, 0), bombMat = new THREE.MeshToonMaterial({ color: 0x8a6fc0, emissive: 0x6a2aa0 });
  const spikeGeo = new THREE.ConeGeometry(.06, .18, 5);
  const seedGeo = new THREE.OctahedronGeometry(.2, 0), seedMat = new THREE.MeshToonMaterial({ color: 0xffd34d, emissive: 0xffb020 });
  const hitGeo = new THREE.SphereGeometry(.55, 8, 6), hitMat = new THREE.MeshBasicMaterial({ visible: false });
  const things = [];
  function spawn(kind) {
    const dir = new THREE.Vector3().randomDirection();
    if (dir.z < -.2 && Math.random() < .6) dir.z *= -1; // most come from the front, some sneak behind
    const g = new THREE.Group();
    if (kind === 'bomb') {
      g.add(new THREE.Mesh(bombGeo, bombMat));
      for (let i = 0; i < 6; i++) { const s = new THREE.Mesh(spikeGeo, bombMat); const v = new THREE.Vector3().randomDirection(); s.position.copy(v.clone().multiplyScalar(.2)); s.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v); g.add(s); }
    } else g.add(new THREE.Mesh(seedGeo, seedMat));
    const hit = new THREE.Mesh(hitGeo, hitMat); g.add(hit);
    g.position.copy(dir.multiplyScalar(kind === 'seed' ? 4.2 : 7.5));
    scene.add(g);
    const t = { g, hit, kind, v: kind === 'seed' ? .35 : (.55 + wave * .09) * (0.8 + Math.random() * .4), spin: new THREE.Vector3(Math.random(), Math.random(), Math.random()), life: kind === 'seed' ? 6 : 99 };
    hit.userData.t = t; things.push(t); return t;
  }
  const parts = [];
  const partGeo = new THREE.BoxGeometry(.07, .07, .07);
  function burst(at, color, n = 16) {
    const m = new THREE.MeshBasicMaterial({ color, transparent: true });
    for (let i = 0; i < n; i++) { const p = new THREE.Mesh(partGeo, m); p.position.copy(at); p.userData.v = new THREE.Vector3().randomDirection().multiplyScalar(2 + Math.random() * 3); p.userData.life = 1; scene.add(p); parts.push(p); }
  }
  const remove = (t) => { t.dead = true; scene.remove(t.g); };

  // ---------------------------------------------------------------- state + HUD
  let score = 0, combo = 1, comboT = 0, hp = 1, wave = 1, toSpawn = 0, spawnT = 0, bossHP = 0, running = false, over = false, shake = 0, kills = 0, seedT = 4;
  const hud = () => {
    $('.s-score').textContent = score;
    $('.s-combo').textContent = 'x' + combo;
    $('.s-hp i').style.width = Math.max(0, hp * 100) + '%';
    $('.s-hp i').style.background = hp > .5 ? '#62d98a' : hp > .25 ? '#f6c453' : '#e0786a';
    $('.s-wave').textContent = boss.visible ? `BOSS · Smog Baron ${bossHP}` : `Wave ${wave}`;
  };
  const feed = (who, text) => {
    const el = document.createElement('div');
    el.className = 's-line';
    el.innerHTML = `<b>${who}</b> ${text}`;
    $('.s-feed').prepend(el);
    setTimeout(() => el.remove(), 2600);
    while ($('.s-feed').children.length > 3) $('.s-feed').lastChild.remove();
  };
  const banner = (t) => { const b = $('.s-banner'); b.textContent = t; b.classList.remove('on'); void b.offsetWidth; b.classList.add('on'); };
  function startWave() {
    const isBoss = wave % 3 === 0;
    toSpawn = Math.round((6 + wave * 3) * C.power); spawnT = 1.2;
    if (isBoss) { boss.visible = true; bossHP = 12 + wave * 2; boss.userData.a = 0; banner('The Smog Baron attacks!'); speak && speak('baron', 'Enough games. I will grey this planet myself!'); }
    else if (wave === 2 && C.news) { banner('News wave!'); feed('Telem', String(C.news.title).split('|')[0].trim().slice(0, 60)); }
    else banner(wave === 1 && C.air ? `Wave 1 · PM2.5 ${C.air.pm25}` : `Wave ${wave}`);
    if (wave === 1 && C.air) feed('Bruin', `LA air PM2.5 ${C.air.pm25}: the Baron has ${C.pct}% more bombs today`);
    hud();
  }

  // ---------------------------------------------------------------- input: drag to spin, tap to blast
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  let down = null, rotV = new THREE.Vector2(0, .15);
  cv.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: 0 }; cv.setPointerCapture(e.pointerId); });
  cv.addEventListener('pointermove', (e) => {
    if (!down) return;
    const dx = e.clientX - down.lx, dy = e.clientY - down.ly;
    down.moved += Math.abs(dx) + Math.abs(dy); down.lx = e.clientX; down.ly = e.clientY;
    if (down.moved > 12) { world.rotation.y += dx * .006; world.rotation.x = Math.max(-1.2, Math.min(1.2, world.rotation.x + dy * .006)); rotV.set(dy * .0004, dx * .0006); }
  });
  cv.addEventListener('pointerup', (e) => { if (down && down.moved <= 12) tap(e.clientX, e.clientY); down = null; });
  function tap(x, y) {
    if (!running) return;
    const r = cv.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, cam);
    if (boss.visible) {
      const hb = ray.intersectObject(boss, true)[0];
      if (hb) { bossHP--; burst(hb.point, 0x9d88c7, 8); shake = .15; if (bossHP <= 0) bossDown(); hud(); return; }
    }
    const hit = ray.intersectObjects(things.filter((t) => !t.dead).map((t) => t.hit))[0];
    if (!hit) { combo = 1; hud(); return; }
    const t = hit.object.userData.t;
    if (t.kind === 'bomb') {
      combo = Math.min(8, comboT > 0 ? combo + 1 : 1); comboT = 1.6;
      score += 10 * combo; kills++;
      burst(t.g.position, 0x8f7ab8); burst(t.g.position, 0xffffff, 6);
      if (combo === 4) feed('Ripplet', 'Combo x4! Keep going!');
      if (combo === 8) { feed('Mossling', 'MAX COMBO!!'); speak && speak('mossling', 'Max combo! You are on fire!'); }
    } else {
      score += 50; hp = Math.min(1, hp + .08); paint(hp);
      growTree(t.g.position.clone().applyMatrix4(new THREE.Matrix4().copy(world.matrixWorld).invert()).normalize());
      burst(t.g.position, 0xffd34d, 20); feed('Mossling', 'A new tree! +50');
    }
    remove(t); hud();
  }
  function bossDown() {
    boss.visible = false; score += 500;
    for (let i = 0; i < 5; i++) burst(boss.position.clone().add(new THREE.Vector3().randomDirection().multiplyScalar(.5)), [0xff8fb8, 0xffd34d, 0x62d98a, 0x3fb2ff, 0xa98bff][i], 24);
    banner('Baron defeated! +500'); feed('Frostbun', 'We beat the Baron!');
    speak && speak('baron', 'Curses! This is not over!');
    things.filter((t) => t.kind === 'bomb' && !t.dead).forEach((t) => { burst(t.g.position, 0x8f7ab8, 6); remove(t); });
  }

  // ---------------------------------------------------------------- loop
  function size() { const w = innerWidth, h = innerHeight; renderer.setSize(w, h, false); if (composer) composer.setSize(w, h); cam.aspect = w / h; cam.position.z = w < h ? 11 : 8.5; cam.updateProjectionMatrix(); }
  addEventListener('resize', size); size(); paint(hp);
  const clock = new THREE.Clock();
  let raf = 0;
  Promise.all([
    import('https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/EffectComposer.js'),
    import('https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/RenderPass.js'),
    import('https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/UnrealBloomPass.js'),
    import('https://unpkg.com/three@0.160.0/examples/jsm/postprocessing/OutputPass.js'),
  ]).then(([{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }]) => {
    const c = new EffectComposer(renderer);
    c.addPass(new RenderPass(scene, cam));
    c.addPass(new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.45, 0.82));
    c.addPass(new OutputPass());
    c.setSize(innerWidth, innerHeight);
    composer = c;
  }).catch(() => { /* plain rendering */ });
  function frame() {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(.05, clock.getDelta()), t = clock.elapsedTime;
    if (!down) { world.rotation.y += rotV.y + .0015; world.rotation.x += rotV.x; rotV.multiplyScalar(.95); world.rotation.x *= .995; }
    for (const tr of trees) if (tr.userData.grow) { const s = Math.min(1, tr.scale.x + dt * 2.5); tr.scale.setScalar(s); if (s >= 1) tr.userData.grow = 0; }
    if (running) {
      comboT -= dt; if (comboT <= 0 && combo > 1) { combo = 1; hud(); }
      // spawning
      spawnT -= dt;
      if (toSpawn > 0 && spawnT <= 0) { spawn('bomb'); toSpawn--; spawnT = Math.max(.35, 1.3 - wave * .1) * (boss.visible ? .7 : 1); }
      seedT -= dt; if (seedT <= 0) { spawn('seed'); seedT = 5 + Math.random() * 4; }
      // bombs fly in
      for (const th of things) {
        if (th.dead) continue;
        th.g.rotation.x += th.spin.x * dt * 2; th.g.rotation.y += th.spin.y * dt * 2;
        if (th.kind === 'seed') { th.life -= dt; th.g.position.multiplyScalar(1 + Math.sin(t * 3) * .002); th.g.scale.setScalar(1 + Math.sin(t * 6) * .12); if (th.life <= 0) remove(th); continue; }
        const d = th.g.position.length();
        th.g.position.multiplyScalar(Math.max(0, d - th.v * dt) / d);
        if (d < R * 1.12) { // impact
          hp -= .07; shake = .35; combo = 1; paint(hp);
          burst(th.g.position, 0x5d566a, 22); remove(th);
          const f = $('.flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on');
          if (navigator.vibrate) navigator.vibrate(80);
          hud();
          if (hp <= 0) return end(false);
        }
      }
      // guardians orbit and zap the closest bomb on their own
      for (const g of guards) {
        g.ang += dt * .6;
        g.g.position.set(Math.cos(g.ang) * 2.6, Math.sin(g.ang * 1.3 + g.tilt) * 1.1 + g.tilt, Math.sin(g.ang) * 2.6);
        g.fs.position.copy(cam.position).sub(g.g.position).normalize().multiplyScalar(.25);
        g.cd -= dt;
        if (g.cd <= 0) {
          const target = things.filter((x) => !x.dead && x.kind === 'bomb').sort((a, b) => a.g.position.distanceTo(g.g.position) - b.g.position.distanceTo(g.g.position))[0];
          if (target && target.g.position.distanceTo(g.g.position) < 4.5) {
            const lg = new THREE.BufferGeometry().setFromPoints([g.g.position.clone(), target.g.position.clone()]);
            const ln = new THREE.Line(lg, new THREE.LineBasicMaterial({ color: new THREE.Color(g.d.color), transparent: true, linewidth: 3 }));
            ln.userData.life = .25; scene.add(ln); lasers.push(ln);
            burst(target.g.position, new THREE.Color(g.d.color).getHex(), 10); remove(target); score += 5;
            if (Math.random() < .25) feed(g.d.name, ['Zap!', 'Got one!', 'Covering you!', 'Teamwork!'][Math.floor(Math.random() * 4)]);
            hud();
          }
          g.cd = Math.max(1.2, 3.2 - wave * .15) + Math.random();
        }
      }
      // the boss circles in and lobs bombs faster
      if (boss.visible) {
        boss.userData.a = (boss.userData.a || 0) + dt * .5;
        boss.position.set(Math.cos(boss.userData.a) * 4.2, 1.6 + Math.sin(t) * .3, Math.sin(boss.userData.a) * 2 + 1.5);
        if (toSpawn <= 0) toSpawn = 2;
      }
      // next wave
      if (toSpawn <= 0 && !boss.visible && !things.some((x) => !x.dead && x.kind === 'bomb')) {
        wave++; hp = Math.min(1, hp + .05); paint(hp);
        if (wave % 3 !== 1) feed('Ripplet', `Wave ${wave - 1} cleared!`);
        startWave();
      }
    }
    for (const l of lasers) { l.userData.life -= dt; l.material.opacity = Math.max(0, l.userData.life * 4); if (l.userData.life <= 0) scene.remove(l); }
    for (const p of parts) { p.position.addScaledVector(p.userData.v, dt); p.userData.v.multiplyScalar(.94); p.userData.life -= dt * 1.4; p.material.opacity = Math.max(0, p.userData.life); p.rotation.x += dt * 5; if (p.userData.life <= 0) scene.remove(p); }
    for (let i = parts.length - 1; i >= 0; i--) if (parts[i].userData.life <= 0) parts.splice(i, 1);
    for (let i = things.length - 1; i >= 0; i--) if (things[i].dead) things.splice(i, 1);
    shake = Math.max(0, shake - dt);
    cam.position.x = (Math.random() - .5) * shake * .6; cam.position.y = (Math.random() - .5) * shake * .6;
    cam.lookAt(0, 0, 0);
    if (composer) composer.render(); else renderer.render(scene, cam);
  }
  frame();

  function end(won) {
    running = false; over = true;
    try { if (score > best) localStorage.setItem('impact.siegeBest', score); } catch (e) { /* ignore */ }
    speak && speak('baron', 'Mwahaha! The planet is mine… for now.');
    const c = $('.s-card');
    c.className = 's-card s-end';
    c.hidden = false;
    c.innerHTML = `<h1>${score > best ? 'New best!' : 'Planet down!'}</h1><p class="big-score">${score}</p><p>You reached wave ${wave} and blew up ${kills} smog bombs.</p>
      <button class="btn big s-again">Play again</button><button class="btn ghost s-quit">Back to the planet</button>`;
    c.querySelector('.s-again').onclick = () => { close(); startSiege({ agents, myFace, onEnd, speak, say }); };
    c.querySelector('.s-quit').onclick = close;
    onEnd && onEnd(score, wave);
    onResult && onResult(score, wave);
  }
  function close() {
    cancelAnimationFrame(raf); removeEventListener('resize', size);
    renderer.dispose(); root.remove();
    if (!over && running) onEnd && onEnd(score, wave);
  }
  $('.s-x').onclick = close;
  $('.s-go').onclick = () => { $('.s-card').hidden = true; running = true; startWave(); speak && speak('ripplet', 'Guardians, positions! Protect the planet!'); };
}
