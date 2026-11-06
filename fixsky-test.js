
const sharp = require('sharp');
const fs = require('fs');

const src = process.argv[2];
const dst = process.argv[3];
const feather = parseInt(process.argv[4], 10) || 192;

(async () => {
  const img = sharp(src);
  const meta = await img.metadata();
  const w = meta.width, h = meta.height;
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels; // typically 3

  const px = Buffer.from(data);
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < channels; c++) {
      const a = px[(y*w + 0)*channels + c];
      const b = px[(y*w + (w-1))*channels + c];
      const avg = (a + b) >> 1;
      for (let x = 0; x < feather; x++) {
        const t = (x === 0) ? 1 : x / feather;
        const idx_l = (y*w + x)*channels + c;
        px[idx_l] = Math.round(px[idx_l] * t + avg * (1 - t));
        const idx_r = (y*w + (w-1-x))*channels + c;
        px[idx_r] = Math.round(px[idx_r] * t + avg * (1 - t));
      }
    }
  }
  await sharp(px, { raw: { width: w, height: h, channels } }).png().toFile(dst);
  console.log(`OK feather=${feather} → ${dst} (${(fs.statSync(dst).size/1024).toFixed(1)} KB)`);
})().catch(e => { console.error(e.message); process.exit(1); });
