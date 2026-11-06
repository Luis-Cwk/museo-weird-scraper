// _test-trim-loop.js — Verifica que UNA pasada de recorte deje el cielo limpio
// para el guard posterior (skyHasLetterbox), en TODOS los casos reales del corpus.
//
// Por que importa: tras el trim, generateSkyForCandidate llama a
// skyHasLetterbox(). Si todavia ve barras, REINTENTA con otro prompt (gastando
// creditos de OpenRouter) y si se agotan cae a un cielo procedural, que NO se
// mintea (skyOk exige !isFallback). O sea: un guard que no se limpia con un
// recorte = piezas que dejan de salir.
const fs = require("fs");
const os = require("os");
const path = require("path");
const agent = require("./agent.js");

const ORIG = path.join(__dirname, "..", "deploy", "huaca", "textures");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "huaca-loop-"));

// Los 8 que el barrido marca como marcos reales
const CASOS = ["sky-1686", "sky-665", "sky-2991", "sky-2788", "sky-3228", "sky-7577", "sky-8028", "sky-9006"];

(async () => {
  let fallos = 0;
  console.log("caso            bandas iniciales    tras 1 recorte        guard post-trim");
  for (const n of CASOS) {
    const src = path.join(ORIG, `${n}.png`);
    if (!fs.existsSync(src)) { console.log(`${n.padEnd(15)} no existe`); continue; }
    const copia = path.join(TMP, `${n}.png`);
    fs.copyFileSync(src, copia);

    const b = agent.skyEdgeBands(copia);
    const inicial = `T${b.top} B${b.bottom} L${b.left} R${b.right}`;
    await agent.trimSkyLetterbox(copia);
    const b2 = agent.skyEdgeBands(copia);
    const despues = `T${b2.top} B${b2.bottom} L${b2.left} R${b2.right}`;
    const guard = agent.skyHasLetterbox(copia);

    if (guard) fallos++;
    console.log(`${n.padEnd(15)} ${inicial.padEnd(19)} ${despues.padEnd(21)} ${guard ? "TODAVIA VE BARRAS <- dispararia reintento" : "limpio (ok)"}`);
  }

  // Control: un cielo sano NO debe quedar marcado (evita reintentos falsos)
  console.log("\n--- control: cielos sanos no deben marcarse ---");
  let falsos = 0;
  const todos = fs.readdirSync(ORIG).filter((f) => /^sky-\d+\.png$/.test(f));
  for (const f of todos) {
    const copia = path.join(TMP, f);
    fs.copyFileSync(path.join(ORIG, f), copia);
    await agent.trimSkyLetterbox(copia);
    if (agent.skyHasLetterbox(copia)) {
      falsos++;
      const b3 = agent.skyEdgeBands(copia);
      console.log(`  ${f}: sigue marcado tras trim (T${b3.top} B${b3.bottom} L${b3.left} R${b3.right}) <- falso positivo`);
    }
    fs.unlinkSync(copia);
  }
  console.log(`  cielos revisados: ${todos.length}, falsos positivos tras trim: ${falsos}`);

  fs.rmSync(TMP, { recursive: true, force: true });
  console.log(`\n${fallos === 0 && falsos === 0 ? "OK: una pasada limpia todos los casos y ningun cielo sano queda marcado" : `REVISAR: ${fallos} casos sin limpiar, ${falsos} falsos positivos`}`);
})();