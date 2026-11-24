// Paints the in-game scenes with Runware (backgrounds and planet portraits). Run once: node --env-file=.env scripts/scenes.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'art');
fs.mkdirSync(OUT, { recursive: true });
const STYLE = 'cute cozy hand-drawn storybook game background, pastel colors, soft lighting, rich detail, no characters, no text, no letters';
const SCENES = {
  'bg-space': [1344, 768, 'deep space with a dreamy pink and violet nebula, scattered glowing stars, soft clouds of cosmic dust, painterly'],
  'bg-baron': [1024, 1344, 'battlefield on a grey smoggy planet surface, purple smoke stacks and factory towers in the distance, a dark violet sky with glowing smog clouds, a cracked path in the foreground, game arena'],
  'bg-gunk': [1024, 1344, 'battlefield on a small green-grey gunky moon, bubbling slime puddles, soot sprouts, a starry teal sky, game arena'],
  'bg-rust': [1024, 1344, 'battlefield on a rusty orange rock planet, old oil drums and scrap piles, warm dusty sunset sky, game arena'],
  'pl-baron': [768, 768, 'a single round planet floating in space, grey and purple, covered in smog towers and smoke, a tiny top hat on top, centered, dark background'],
  'pl-gunk': [768, 768, 'a single small round moon floating in space, greenish-grey with slime puddles, centered, dark background'],
  'pl-rust': [768, 768, 'a single round planet floating in space, rusty orange rock with scrap piles and a ring of junk, centered, dark background'],
  'bg-park': [1024, 1344, 'a sunny city park path seen from eye level, green grass, trees, benches, a little pond, blue sky, bright and inviting'],
  'bg-beach': [1024, 1344, 'a sparkling beach seen from the shore, turquoise waves, soft sand, a sunny sky with fluffy clouds'],
  'bg-stage': [1344, 768, 'a cute little wooden theater stage with velvet curtains and warm spotlights, forest backdrop'],
};
const ONLY = process.argv.slice(2);
let total = 0;
await Promise.all(Object.entries(SCENES).filter(([id]) => !ONLY.length || ONLY.includes(id)).map(async ([id, [w, h, scene]]) => {
  const r = await fetch('https://api.runware.ai/v1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.RUNWARE_API_KEY },
    body: JSON.stringify([{ taskType: 'imageInference', taskUUID: crypto.randomUUID(), positivePrompt: `${scene}, ${STYLE}`, model: process.env.RUNWARE_MODEL || 'runware:101@1', width: w, height: h, numberResults: 1, outputType: 'URL', outputFormat: 'JPG', includeCost: true }]),
  });
  const j = await r.json();
  const d = (j.data || [])[0];
  if (!d || !d.imageURL) { console.log(id, 'failed', JSON.stringify(j.errors || j).slice(0, 200)); return; }
  total += +d.cost || 0;
  const img = await fetch(d.imageURL);
  fs.writeFileSync(path.join(OUT, `${id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(id, 'ok');
}));
console.log('total cost $' + total.toFixed(4));
