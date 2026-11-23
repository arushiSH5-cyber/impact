// Character faces drawn on a canvas. Used for the 3D sprites and for every avatar in the UI.
const cache = {};

export function drawFace(def, size = 128) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const x = c.getContext('2d');
  x.scale(size / 128, size / 128);
  x.lineJoin = 'round';
  x.strokeStyle = '#2b2b2b';
  x.lineWidth = 6;
  // ears, leaves, hat behind the head
  x.beginPath();
  if (def.id === 'mossling' || def.id === 'sprout') { x.fillStyle = '#4c9a52'; x.ellipse(48, 28, 15, 7, -0.6, 0, 7); x.moveTo(94, 28); x.ellipse(80, 28, 15, 7, 0.6, 0, 7); }
  if (def.id === 'frostbun' || def.id === 'bunny') { x.fillStyle = '#fff'; x.ellipse(46, 26, 9, 22, -0.15, 0, 7); x.moveTo(91, 26); x.ellipse(82, 26, 9, 22, 0.15, 0, 7); }
  if (def.id === 'sunfox' || def.id === 'fox') { x.fillStyle = def.color; x.moveTo(30, 46); x.lineTo(36, 10); x.lineTo(58, 34); x.closePath(); x.moveTo(98, 46); x.lineTo(92, 10); x.lineTo(70, 34); x.closePath(); }
  if (def.id === 'ripplet' || def.id === 'axolotl') { x.fillStyle = def.color; x.arc(34, 40, 12, 0, 7); x.moveTo(106, 40); x.arc(94, 40, 12, 0, 7); }
  x.fill(); x.stroke();
  // head
  x.fillStyle = def.color;
  x.beginPath(); x.ellipse(64, 72, 46, 40, 0, 0, Math.PI * 2); x.fill(); x.stroke();
  if (def.id === 'baron') { // top hat + monocle
    x.fillStyle = '#2f2a35';
    x.beginPath(); x.rect(38, 4, 52, 28); x.rect(26, 30, 76, 8); x.fill(); x.stroke();
    x.fillStyle = '#c0392b'; x.fillRect(40, 24, 48, 6);
  }
  // eyes
  x.fillStyle = '#2b2b2b';
  x.beginPath(); x.arc(48, 70, 5.5, 0, 7); x.arc(80, 70, 5.5, 0, 7); x.fill();
  x.fillStyle = '#fff';
  x.beginPath(); x.arc(50, 68, 1.8, 0, 7); x.arc(82, 68, 1.8, 0, 7); x.fill();
  if (def.id === 'baron') { x.lineWidth = 3; x.beginPath(); x.arc(80, 70, 11, 0, 7); x.stroke(); }
  // mouth
  x.lineWidth = 4;
  x.beginPath();
  if (def.id === 'baron') x.arc(64, 98, 10, Math.PI * 1.2, Math.PI * 1.8);
  else x.arc(64, 80, 9, 0.15 * Math.PI, 0.85 * Math.PI);
  x.stroke();
  // cheeks
  x.fillStyle = 'rgba(255,130,150,.5)';
  x.beginPath(); x.arc(34, 84, 7, 0, 7); x.arc(94, 84, 7, 0, 7); x.fill();
  return c;
}

export function faceURL(def, size = 96) {
  const k = `${def.id}|${def.color}|${size}`;
  if (!cache[k]) cache[k] = drawFace(def, size).toDataURL();
  return cache[k];
}
