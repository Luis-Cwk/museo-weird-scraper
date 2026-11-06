// Prueba de generación de imagen con NVIDIA DiffusionGemma (fallback sky).
require("dotenv").config();
const fs = require("fs");
const path = require("path");

const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;
const OUT_DIR = "C:/Users/petra/museo-weird-scraper/sandbox";

const prompt = "wide landscape photograph, 16:9 aspect ratio, dramatic storm sky over distant Colombian mountain range, atmospheric depth, no black bars, full-frame";

async function tryBody(endpoint, body, label) {
  const res = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${NVIDIA_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
  if (!res.ok) return { label, ok: false, status: res.status, body: json };
  const artifacts = json.artifacts || json.data;
  const b64 = artifacts && (artifacts[0]?.base64 || artifacts[0]?.b64_json || artifacts.base64 || artifacts.b64_json);
  if (!b64) return { label, ok: false, status: res.status, body: { keys: Object.keys(json), slice: text.slice(0, 200) } };
  return { label, ok: true, b64 };
}

async function main() {
  const endpoint = "https://integrate.api.nvidia.com/v1/google/diffusiongemma-26b-a4b-it";

  // Intento A: formato simple (prompt, width, height, seed, steps)
  let r = await tryBody(endpoint, { prompt, width: 1024, height: 576, seed: 0, steps: 50 }, "A-simple");
  if (!r.ok) console.log(`Intento A falló (${r.status}):`, JSON.stringify(r.body).slice(0, 250));

  // Intento B: formato SDXL (text_prompts)
  if (!r.ok) {
    r = await tryBody(endpoint, { text_prompts: [{ text: prompt, weight: 1 }], width: 1024, height: 576, seed: 0, steps: 50 }, "B-sdxl");
    if (!r.ok) console.log(`Intento B falló (${r.status}):`, JSON.stringify(r.body).slice(0, 250));
  }

  // Intento C: formato OpenAI images (prompt, size, n)
  if (!r.ok) {
    r = await tryBody(endpoint, { prompt, size: "1024x576", n: 1 }, "C-openai");
    if (!r.ok) console.log(`Intento C falló (${r.status}):`, JSON.stringify(r.body).slice(0, 250));
  }

  if (!r.ok) {
    console.error("DiffusionGemma no respondió con ningún formato conocido.");
    process.exit(1);
  }

  const outPath = path.join(OUT_DIR, `nvidia-diffusiongemma-test.png`);
  fs.writeFileSync(outPath, Buffer.from(r.b64, "base64"));
  console.log("MODELO OK:", r.label, "-> diffusiongemma-26b-a4b-it");
  console.log("IMAGEN GUARDADA EN:", outPath);
  console.log("tamaño:", (fs.statSync(outPath).size / 1024).toFixed(1), "KB");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
