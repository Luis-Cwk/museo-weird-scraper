const fs = require('fs');
const path = require('path');

const cachePath = 'C:/Users/petra/AppData/Local/hermes/cache/terminal/hermes-results/call_9aa0f139bf8ae1e2.txt';
const txt = fs.readFileSync(cachePath, 'utf-8');

const m = txt.match(/"data:image\/png;base64,([^"]+)"/);
if (!m) { console.error('no dataurl'); process.exit(1); }

const out = path.join('C:/Users/petra/museo-weird-scraper/data/prototypes-capture',
  'h_4fb77cc6093bf6f3-air-pollution-fragmented.png');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, Buffer.from(m[1], 'base64'));
console.log('saved:', out, 'size:', fs.statSync(out).size, 'bytes');
