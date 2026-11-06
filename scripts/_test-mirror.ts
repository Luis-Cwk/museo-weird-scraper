import { generateThreeArtwork } from './generate-three';

(async () => {
  const out = await generateThreeArtwork({
    content: 'PRUEBA ESPEJO',
    category: 'other',
    attribution: 'Anonymous',
    source: 'local-test',
    sourceUrl: 'http://localhost:8765/',
  });
  console.log(`OK ${out.voxelCount} voxels -> ${out.htmlPath}`);
})().catch((e) => { console.error('FAIL:', e?.message || e); process.exit(1); });
