
import { generateThreeArtwork } from './generate-three';

const candidates = [
  {
    id: 'm_4fb77cc6093bf6f3',
    content: 'Calidad del aire en el Valle de Aburrá sigue lejos de lo exigido por la OMS',
    source: 'bsky:"contaminacion aire medellin"',
    sourceUrl: 'https://bsky.app/profile/aireenvigado.bsky.social/post/3lkq3qrnztc2z',
    category: 'fact',
    attribution: 'Anonymous',
    scrapedAt: new Date().toISOString()
  },
  {
    id: 'm_d058364dab9a56a2',
    content: 'Seis especies de árboles serían claves para combatir contaminación del aire en Medellín',
    source: 'bsky:"contaminacion aire medellin"',
    sourceUrl: 'https://bsky.app/profile/aireenvigado.bsky.social/post/3lnun4keysk2e',
    category: 'fact',
    attribution: 'Anonymous',
    scrapedAt: new Date().toISOString()
  },
  {
    id: 'm_7ddd7aadb5a1933e',
    content: 'Seis especies de árboles serían claves para combatir contaminación del aire en Medellín, según estudio de la UdeA.',
    source: 'bsky:"calidad del aire medellin"',
    sourceUrl: 'https://bsky.app/profile/aireenvigado.bsky.social/post/3lnun4keysk2e',
    category: 'fact',
    attribution: 'Anonymous',
    scrapedAt: new Date().toISOString()
  }
];

(async () => {
  for (const c of candidates) {
    try {
      const out = await generateThreeArtwork({
        content: c.content,
        category: c.category,
        attribution: c.attribution,
        source: c.source,
        sourceUrl: c.sourceUrl,
        scrapedAt: c.scrapedAt
      });
      console.log(`OK ${c.id} -> ${out.htmlPath} (${out.voxelCount} voxels)`);
    } catch (e: any) {
      console.error(`FAIL ${c.id}: ${e.message}`);
    }
  }
})();
