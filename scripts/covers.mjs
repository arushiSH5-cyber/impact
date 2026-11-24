// Paints the Games screen cover art with Runware (one image per game). Run once: node --env-file=.env scripts/covers.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const OUT = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'public', 'art');
fs.mkdirSync(OUT, { recursive: true });
const STYLE = 'cute cozy hand-drawn storybook illustration, pastel colors, thick ink outlines, soft lighting, no text, no letters';
const COVERS = {
  siege: 'a tiny round low-poly planet in space being defended by three cute round guardian creatures (a green leaf sprite, a blue axolotl, a white bunny) shooting sparkly lasers at spiky purple smog bombs, a grumpy cartoon villain blob with a top hat and monocle in the background',
  catch: 'a cute park at sunset with funny doodle litter monsters (a smiling plastic bottle, a grinning soda can, a ghostly plastic bag) peeking from bushes, a green recycling bin flying through the air to catch them',
  dash: 'a cheerful blue axolotl and a green leaf sprite catching falling plastic bottles and cans into bins on a sparkling beach, a sneaky top-hat smog villain dropping smog bombs from a cloud above',
  duel: 'a cute rock paper scissors style duel: a green leaf, a blue water drop and an orange flame with happy faces facing a grumpy top-hat smog villain blob across a little stage',
};
let total = 0;
for (const [id, scene] of Object.entries(COVERS)) {
  const r = await fetch('https://api.runware.ai/v1', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + process.env.RUNWARE_API_KEY },
    body: JSON.stringify([{ taskType: 'imageInference', taskUUID: crypto.randomUUID(), positivePrompt: `${scene}, ${STYLE}`, model: process.env.RUNWARE_MODEL || 'runware:101@1', width: 1024, height: 640, numberResults: 1, outputType: 'URL', outputFormat: 'JPG', includeCost: true }]),
  });
  const j = await r.json();
  const d = (j.data || [])[0];
  if (!d || !d.imageURL) { console.log(id, 'failed', JSON.stringify(j.errors || j).slice(0, 200)); continue; }
  total += +d.cost || 0;
  const img = await fetch(d.imageURL);
  fs.writeFileSync(path.join(OUT, `${id}.jpg`), Buffer.from(await img.arrayBuffer()));
  console.log(id, 'ok', d.cost);
}
console.log('total cost $' + total.toFixed(4));
