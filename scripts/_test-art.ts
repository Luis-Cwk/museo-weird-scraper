import { generateArtwork } from '../scripts/generate-artwork';

(async () => {
  const r = await generateArtwork({
    content: 'En 1962, un grupo de médicos inyectó células cancerosas a 22 pacientes ancianos sin su consentimiento.',
    category: 'fact',
    attribution: 'Anonymous',
    source: 'r/surreal',
    sourceUrl: 'https://reddit.com',
    postUri: 'test:uri',
  });
  console.log('saved:', r.svgPath);
})().catch(e => { console.error('ERROR:', e); process.exit(1); });
