// Bateria de pruebas del detector de marcos (agnostico al color).
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');
const { skyEdgeBands, trimSkyLetterbox, skyHasLetterbox } = require('./agent.js');

const TEX = path.join(__dirname, '..', 'deploy', 'huaca', 'textures');

// Pega una banda plana de color `val` de `n` filas en el borde indicado.
function conBanda(srcFile, n, val, borde) {
  const img = PNG.sync.read(fs.readFileSync(path.join(TEX, srcFile)));
  const { width, height, data } = img;
  const out = Buffer.from(data);
  const pintar = (r) => {
    for (let x = 0; x < width; x++) {
      const i = (r * width + x) * 4;
      out[i] = val; out[i + 1] = val; out[i + 2] = val; out[i + 3] = 255;
    }
  };
  for (let k = 0; k < n; k++) pintar(borde === 'top' ? k : height - 1 - k);
  const png = new PNG({ width, height });
  out.copy(png.data);
  const dst = path.join(TEX, '_syn_' + borde + '_' + val + '_' + n + '.png');
  fs.writeFileSync(dst, PNG.sync.write(png));
  return dst;
}

(async () => {
  const filas = [];
  const bueno = 'sky-9750.png'; // cielo sano, sin marcos

  // 1) cielo sano: no debe tocarse
  {
    const t = path.join(TEX, '_t1.png'); fs.copyFileSync(path.join(TEX, bueno), t);
    const r = await trimSkyLetterbox(t);
    const d = skyEdgeBands(t);
    filas.push(['cielo sano (no-op)', !r.trimmed && d.top + d.bottom + d.left + d.right === 0]);
    fs.unlinkSync(t);
  }

  // 2) marcos sinteticos: blanco puro, gris medio, gris claro, negro
  for (const [val, nombre] of [[255, 'blanco puro'], [167, 'gris medio'], [205, 'gris claro'], [8, 'negro']]) {
    const f = conBanda(bueno, 60, val, 'top');
    const d = skyEdgeBands(f);
    const r = await trimSkyLetterbox(f);
    const d2 = skyEdgeBands(f);
    const ok = d.top >= 58 && d.top <= 62 && r.trimmed && !skyHasLetterbox(f);
    filas.push([`marco ${nombre} 60px arriba (valor ${val})`, ok, `detectado T${d.top} -> ${d2.top}`]);
    fs.unlinkSync(f);
  }

  // 3) marco abajo y lateral
  {
    const f = conBanda(bueno, 40, 250, 'bottom');
    const d = skyEdgeBands(f);
    const r = await trimSkyLetterbox(f);
    filas.push(['marco 40px abajo', d.bottom >= 38 && r.trimmed && !skyHasLetterbox(f), `detectado B${d.bottom}`]);
    fs.unlinkSync(f);
  }

  // 4) el cielo malo real de la pieza 60
  {
    const t = path.join(TEX, '_t4.png'); fs.copyFileSync(path.join(TEX, 'sky-1686.png'), t);
    const r = await trimSkyLetterbox(t);
    filas.push(['sky-1686 real (57px blanco x2)', r.trimmed && !skyHasLetterbox(t), `${r.size.width}x${r.size.height}`]);
    fs.unlinkSync(t);
  }

  console.log('=== CASOS ===');
  let fallos = 0;
  for (const [n, ok, extra] of filas) {
    if (!ok) fallos++;
    console.log(`${ok ? 'OK  ' : 'FALLA'} ${n}${extra ? '   [' + extra + ']' : ''}`);
  }

  // 5) barrido del corpus: falsos positivos?
  const files = fs.readdirSync(TEX).filter((f) => /^sky-\d+\.png$/.test(f));
  const con = [];
  for (const f of files) {
    const b = skyEdgeBands(path.join(TEX, f));
    if (b && b.top + b.bottom + b.left + b.right >= 3) con.push(f);
  }
  console.log(`\n=== BARRIDO === ${files.length} cielos, ${con.length} con marco detectado`);
  console.log('   ' + con.join(', '));
  console.log(`\nfallos: ${fallos}`);
})();