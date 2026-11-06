import { generateThreeArtwork } from './generate-three';

(async () => {
  const out = await generateThreeArtwork({
    content: 'el deslizamiento en Granizal es considerado el mas grande en la historia reciente del Valle de Aburra',
    category: 'medellin_weird',
    attribution: 'Anonymous',
    source: 'bsky:deslizamiento medellin',
    sourceUrl: 'https://bsky.app/',
  });
  console.log(`OK ${out.voxelCount} voxels -> ${out.htmlPath}`);
})().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1); });