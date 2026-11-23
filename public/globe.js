// Impact globe: a low-poly planet whose zones heal or sicken with the shared world state,
// with the five agents walking between zones and HTML labels + speech bubbles pinned to them.
import * as THREE from 'three';
import { drawFace } from './faces.js';

const ZONE_DIR = {
  forest: new THREE.Vector3(0.75, 0.25, 0.6).normalize(),
  ice: new THREE.Vector3(0.05, 1, 0.1).normalize(),
  desert: new THREE.Vector3(-0.8, 0.05, 0.55).normalize(),
  ocean: new THREE.Vector3(0.1, -0.55, 0.85).normalize(),
  space: new THREE.Vector3(-0.3, 0.75, 0.6).normalize(), // agents in space float above this point
};
// cute pastel palette: healthy zones pop, sick zones go dusty (not muddy) so the planet stays pretty while it's losing
const HEALTHY = { forest: '#62d98a', ice: '#f3fbff', desert: '#ffd894', ocean: '#3fb2ff' };
const SICK = { forest: '#b9a888', ice: '#c4c8d4', desert: '#cfa984', ocean: '#7d8fb0' };
const SHALLOW = { healthy: '#8ee3ff', sick: '#9aa8c2' };
const R = 1;

export function createGlobe(canvas, labelLayer, agentsDef, onAgent) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0.35, 4.4);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.HemisphereLight(0xfff4e0, 0x334477, 1.2));
  const rim = new THREE.DirectionalLight(0x9fd0ff, 1.1);
  rim.position.set(-4, 1, -4);
  scene.add(rim);
  // soft glowing atmosphere behind the planet
  {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const x = c.getContext('2d');
    const g = x.createRadialGradient(128, 128, 60, 128, 128, 128);
    g.addColorStop(0, 'rgba(170,215,255,0.6)');
    g.addColorStop(0.55, 'rgba(200,170,255,0.22)');
    g.addColorStop(1, 'rgba(90,140,255,0)');
    x.fillStyle = g; x.fillRect(0, 0, 256, 256);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthWrite: false, transparent: true }));
    glow.scale.set(3.3, 3.3, 1);
    glow.renderOrder = -1;
    scene.add(glow);
  }
  const sun = new THREE.DirectionalLight(0xffffff, 1.4);
  sun.position.set(3, 4, 5);
  scene.add(sun);

  const world = new THREE.Group();
  scene.add(world);

  // ---- planet: flat-shaded icosphere, each face belongs to the nearest zone
  const geo = new THREE.IcosahedronGeometry(R, 5).toNonIndexed();
  const pos = geo.attributes.position;
  const faceCount = pos.count / 3;
  const faceZone = [];
  const faceJitter = [];
  const faceCoast = [];
  const colors = new Float32Array(pos.count * 3);
  const surfaceZones = ['forest', 'ice', 'desert', 'ocean'];
  const tmp = new THREE.Vector3();
  for (let f = 0; f < faceCount; f++) {
    tmp.set(0, 0, 0);
    for (let k = 0; k < 3; k++) tmp.add(new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k));
    tmp.normalize();
    // noisy nearest-zone so borders look organic
    const n = Math.sin(tmp.x * 9.1) * Math.cos(tmp.y * 7.3) * Math.sin(tmp.z * 8.7) * 0.18;
    let best = 'ocean', bestD = -9, second = -9;
    for (const z of surfaceZones) {
      const bias = z === 'ocean' ? 0.16 : z === 'ice' ? (tmp.y > 0.72 ? 0.5 : -0.2) : z === 'desert' ? -0.1 : 0.04;
      const d = tmp.dot(ZONE_DIR[z]) + bias + (z !== 'ocean' ? n : 0);
      if (d > bestD) { second = bestD; bestD = d; best = z; } else if (d > second) second = d;
    }
    faceCoast.push(best === 'ocean' && bestD - second < 0.09); // shallow turquoise water along the coasts
    if (tmp.y < -0.85) best = 'ice'; // south pole
    faceZone.push(best);
    faceJitter.push(0.95 + Math.random() * 0.1);
    // raise land a touch for a voxel-ish relief
    if (best !== 'ocean') {
      // land relief: snowy peaks on the ice, rolling hills in the forest, dunes in the desert
      const lift = best === 'ice' ? 1.03 + Math.abs(n) * 0.18 : best === 'forest' ? 1.022 + Math.abs(n) * 0.06 : 1.018 + Math.abs(n) * 0.04;
      for (let k = 0; k < 3; k++) {
        const v = new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k).multiplyScalar(lift);
        pos.setXYZ(f * 3 + k, v.x, v.y, v.z);
      }
    }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const planet = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.75 }));
  world.add(planet);
  // drifting puffy clouds
  const clouds = new THREE.Group();
  const cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 1, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    for (let j = 0; j < 3; j++) {
      const puff = new THREE.Mesh(new THREE.IcosahedronGeometry(0.05 + Math.random() * 0.035, 0), cloudMat);
      puff.position.set((j - 1) * 0.06, Math.random() * 0.02, Math.random() * 0.03);
      c.add(puff);
    }
    const d = new THREE.Vector3().randomDirection();
    c.position.copy(d.multiplyScalar(R * 1.22));
    c.lookAt(0, 0, 0);
    clouds.add(c);
  }
  world.add(clouds);

  function paint(H) {
    const c = new THREE.Color();
    const a = new THREE.Color(), b = new THREE.Color();
    for (let f = 0; f < faceCount; f++) {
      const z = faceZone[f];
      const h = Math.max(0, Math.min(1, (H[z] || 0) / 100));
      if (faceCoast[f]) { a.set(SHALLOW.sick); b.set(SHALLOW.healthy); } else { a.set(SICK[z]); b.set(HEALTHY[z]); }
      c.copy(a).lerp(b, Math.pow(h, 0.8)).multiplyScalar(faceJitter[f]);
      for (let k = 0; k < 3; k++) colors.set([c.r, c.g, c.b], (f * 3 + k) * 3);
    }
    geo.attributes.color.needsUpdate = true;
  }

  // ---- trees on the forest (count grows with health) and smog puffs where zones are sick
  const treeGroup = new THREE.Group();
  world.add(treeGroup);
  const trees = [];
  const treeMat = new THREE.MeshToonMaterial({ color: 0x3fae5e });
  const treeMat2 = new THREE.MeshToonMaterial({ color: 0x7fd36a });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x7a5236, flatShading: true });
  for (let i = 0; i < 40; i++) {
    const d = ZONE_DIR.forest.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.9, (Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.9)).normalize();
    const t = new THREE.Group();
    const top = i % 3 ? new THREE.Mesh(new THREE.ConeGeometry(0.035, 0.09, 6), i % 2 ? treeMat : treeMat2) : new THREE.Mesh(new THREE.IcosahedronGeometry(0.04, 1), treeMat2);
    top.position.y = 0.07;
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.04, 5), trunkMat);
    trunk.position.y = 0.02;
    t.add(top, trunk);
    t.position.copy(d.clone().multiplyScalar(R * 1.015));
    t.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
    treeGroup.add(t);
    trees.push(t);
  }
  // little joys that appear as zones heal: flowers in the forest, cacti in the desert, sparkly crystals on the ice
  const decor = [];
  const flowerCols = [0xff8fb8, 0xffe066, 0xc9a0ff, 0xffffff, 0xff9f6b];
  const addDecor = (zone, n, make, spread) => {
    for (let i = 0; i < n; i++) {
      const d = ZONE_DIR[zone].clone().add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.5) * spread * 0.8, (Math.random() - 0.5) * spread)).normalize();
      const m = make(i);
      m.position.copy(d.clone().multiplyScalar(R * (zone === 'ice' ? 1.04 : 1.022)));
      m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d);
      m.userData = { zone, rank: i / n, base: m.scale.x };
      world.add(m);
      decor.push(m);
    }
  };
  addDecor('forest', 26, (i) => new THREE.Mesh(new THREE.IcosahedronGeometry(0.014, 0), new THREE.MeshToonMaterial({ color: flowerCols[i % flowerCols.length] })), 1.0);
  const cactusMat = new THREE.MeshToonMaterial({ color: 0x5fbf6e });
  addDecor('desert', 12, () => { const g = new THREE.Group(); const c = new THREE.Mesh(new THREE.CapsuleGeometry(0.012, 0.04, 3, 6), cactusMat); c.position.y = 0.03; const arm = new THREE.Mesh(new THREE.CapsuleGeometry(0.007, 0.018, 3, 6), cactusMat); arm.position.set(0.016, 0.035, 0); g.add(c, arm); return g; }, 0.8);
  const crystalMat = new THREE.MeshToonMaterial({ color: 0xbfe9ff });
  addDecor('ice', 10, () => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.022, 0), crystalMat); m.scale.y = 1.8; return m; }, 0.7);
  addDecor('ocean', 8, () => { const m = new THREE.Mesh(new THREE.TorusGeometry(0.018, 0.005, 6, 12), new THREE.MeshToonMaterial({ color: 0xffffff })); m.rotation.x = Math.PI / 2; return m; }, 0.8);
  const smog = [];
  const smogMat = new THREE.MeshStandardMaterial({ color: 0x6d5f86, transparent: true, opacity: 0.7, flatShading: true });
  for (const z of surfaceZones) {
    for (let i = 0; i < 7; i++) {
      const d = ZONE_DIR[z].clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.7, (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 0.7)).normalize();
      const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045 + Math.random() * 0.035, 0), smogMat);
      m.position.copy(d.multiplyScalar(R * 1.17));
      m.userData = { zone: z, rank: i / 7, spin: Math.random() * 2 };
      world.add(m);
      smog.push(m);
    }
  }
  // space debris ring (more junk when Space health is low)
  const debris = [];
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8f8a96, flatShading: true });
  for (let i = 0; i < 22; i++) {
    const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.015 + Math.random() * 0.025, 0), rockMat);
    const ang = (i / 22) * Math.PI * 2;
    m.userData = { ang, r: 1.45 + Math.random() * 0.25, y: (Math.random() - 0.5) * 0.25, rank: i / 22 };
    scene.add(m);
    debris.push(m);
  }
  // stars
  const starGeo = new THREE.BufferGeometry();
  const starPos = [];
  for (let i = 0; i < 400; i++) {
    const v = new THREE.Vector3().randomDirection().multiplyScalar(20 + Math.random() * 20);
    starPos.push(v.x, v.y, v.z);
  }
  starGeo.setAttribute('position', new THREE.Float32BufferAttribute(starPos, 3));
  scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));

  // ---- agents: a little cel-shaded body with a face texture, walking on the surface
  const agents = {};
  for (const def of agentsDef) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.11, 16, 12), new THREE.MeshToonMaterial({ color: def.color }));
    body.scale.y = 0.9;
    const face = new THREE.Sprite(new THREE.SpriteMaterial({ map: faceTexture(def), depthTest: true }));
    face.scale.set(0.24, 0.24, 1);
    face.position.z = 0.02;
    g.add(body, face);
    world.add(g);
    const label = document.createElement('div');
    label.className = 'glabel';
    label.innerHTML = `<b role="button" tabindex="0">${def.name}</b><span class="bub"></span>`;
    const open = () => onAgent && onAgent(def.id);
    label.querySelector('b').addEventListener('click', open);
    label.querySelector('b').addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
    labelLayer.appendChild(label);
    agents[def.id] = { def, g, label, bubble: label.querySelector('.bub'), dir: ZONE_DIR[def.home].clone(), target: ZONE_DIR[def.home].clone(), zone: def.home, offset: offsetFor(def.id), bubbleUntil: 0 };
  }
  const zoneLabels = {};
  for (const z of ['forest', 'ice', 'desert', 'ocean', 'space']) {
    const el = document.createElement('div');
    el.className = 'zlabel';
    labelLayer.appendChild(el);
    zoneLabels[z] = el;
  }

  function offsetFor(id) {
    const i = agentsDef.findIndex((a) => a.id === id);
    const a = (i / agentsDef.length) * Math.PI * 2;
    return new THREE.Vector3(Math.cos(a) * 0.17, Math.sin(a) * 0.12, Math.sin(a) * 0.17);
  }

  // ---- interaction: drag to spin
  let dragging = false, lastX = 0, lastY = 0, velY = 0.0016, rotX = 0.25;
  canvas.addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; lastY = e.clientY; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointerup', () => { dragging = false; });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    velY = (e.clientX - lastX) * 0.004;
    world.rotation.y += velY;
    rotX = Math.max(-0.9, Math.min(0.9, rotX + (e.clientY - lastY) * 0.004));
    lastX = e.clientX; lastY = e.clientY;
  });

  let H = { forest: 40, ice: 40, desert: 40, ocean: 40, space: 40 };
  function update(state) {
    H = state.H;
    paint(H);
    trees.forEach((t, i) => { t.visible = i / trees.length < H.forest / 100 + 0.05; });
    for (const m of decor) m.visible = m.userData.rank < (H[m.userData.zone] - 35) / 60;
    for (const a of state.agents) {
      const v = agents[a.id];
      if (!v) continue;
      if (v.zone !== a.zone) { v.zone = a.zone; v.target = ZONE_DIR[a.zone].clone(); }
      if (a.last && a.last !== v.lastAct) {
        v.lastAct = a.last;
        v.bubble.textContent = shout(a.last);
        v.bubbleUntil = performance.now() + 7000;
      }
    }
    for (const z of Object.keys(zoneLabels)) {
      const h = Math.round(H[z]);
      zoneLabels[z].innerHTML = `${z[0].toUpperCase() + z.slice(1)} <i>${h}/100</i>`;
      zoneLabels[z].classList.toggle('sick', h < 30);
    }
  }
  function say(id, text) {
    const v = agents[id];
    if (!v) return;
    v.bubble.textContent = text;
    v.bubbleUntil = performance.now() + 7000;
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = Math.max(4.4, 1.55 / (Math.tan((20 * Math.PI) / 180) * (w / h)));
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  const proj = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  function place(el, worldPos, normal) {
    proj.copy(worldPos).project(camera);
    camDir.copy(camera.position).sub(worldPos).normalize();
    const facing = normal.dot(camDir);
    const x = Math.max(80, Math.min(canvas.clientWidth - 80, (proj.x * 0.5 + 0.5) * canvas.clientWidth));
    const y = (-proj.y * 0.5 + 0.5) * canvas.clientHeight;
    el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -100%)`;
    el.style.opacity = facing > -0.12 ? 1 : 0; // keep names visible at the poles and the rim
    el.style.zIndex = Math.round(facing * 100) + 100;
  }

  const clock = new THREE.Clock();
  const wp = new THREE.Vector3(), nrm = new THREE.Vector3();
  function frame() {
    // a sheet (games, today, story) covers the planet: skip the 3D work so games stay smooth on phones
    if (document.body.classList.contains('covered')) { clock.getDelta(); requestAnimationFrame(frame); return; }
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    if (!dragging) { world.rotation.y += velY; velY += (0.0016 - velY) * 0.02; }
    world.rotation.x += (rotX - world.rotation.x) * 0.1;
    clouds.rotation.y += dt * 0.05;

    for (const m of smog) {
      const show = m.userData.rank < (1 - H[m.userData.zone] / 100) * 1.3 - 0.15;
      m.visible = show;
      m.rotation.y = t * 0.3 + m.userData.spin;
    }
    for (const m of decor) if (m.visible) m.scale.setScalar(1 + Math.sin(t * 2 + m.userData.rank * 9) * 0.08);
    for (const m of debris) {
      const d = m.userData;
      m.visible = d.rank < (1 - H.space / 100) * 0.8;
      const a = d.ang + t * 0.08;
      m.position.set(Math.cos(a) * d.r, d.y + Math.sin(a * 2) * 0.05, Math.sin(a) * d.r);
      m.rotation.x = t * 0.5 + d.ang;
    }

    const now = performance.now();
    for (const v of Object.values(agents)) {
      v.dir.lerp(v.target, Math.min(1, dt * 0.9)).normalize(); // walk along the surface
      const target = v.dir.clone().add(v.offset.clone().multiplyScalar(0.6)).normalize();
      const lift = v.zone === 'space' ? 1.5 : 1.08 + Math.abs(Math.sin(t * 6 + v.offset.x * 20)) * 0.025; // hop while walking
      v.g.position.copy(target.clone().multiplyScalar(R * lift));
      v.g.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), target);
      v.g.getWorldPosition(wp);
      nrm.copy(wp).normalize();
      place(v.label, wp.clone().add(nrm.clone().multiplyScalar(0.12)), nrm);
      v.label.classList.toggle('talk', now < v.bubbleUntil);
    }
    for (const [z, el] of Object.entries(zoneLabels)) {
      const d = z === 'space' ? ZONE_DIR.space.clone().multiplyScalar(1.6) : ZONE_DIR[z].clone().multiplyScalar(1.12);
      wp.copy(d).applyMatrix4(world.matrixWorld);
      place(el, wp, wp.clone().normalize());
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return { update, say, resize };
}

// speech bubbles: short and in character, not log lines
function shout(t) {
  let s = String(t || '').replace(/\s*\([^)]*\)/g, '').replace(/^BETRAYED the guardians:.*/i, 'Hehe… sorry, guardians!');
  s = s.split(/[,:]/)[0];
  s = s.charAt(0).toUpperCase() + s.slice(1);
  return s.length > 42 ? s.slice(0, 40) + '…' : s + (/[!?…]$/.test(s) ? '' : '!');
}
function faceTexture(def) {
  const t = new THREE.CanvasTexture(drawFace(def, 128));
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
