#!/usr/bin/env node
/**
 * Huaca cron wrapper — para disparar el agente desde un cron job a las 12:30pm.
 * NO modifica el código de huaca. Solo orquesta + reporta.
 *
 * Comportamiento:
 *   1. Lock file anti-overlap (si ya hay un ciclo corriendo, aborta)
 *   2. Lanza scripts/agent.js --once --limit 1
 *   3. Captura output, exit code, tiempo
 *   4. Escribe a logs/huaca-cron.log (append)
 *   5. Emite resumen a stdout (el cron job lo entrega a Telegram si hubo mint o error)
 *
 * Exit codes:
 *   0 = éxito (puede ser 0 obras nuevas, sin error)
 *   1 = error duro (mint falló, FTP cayó, etc)
 *   2 = ya había otro ciclo corriendo (skip silencioso)
 */
const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");

const ROOT = path.resolve(__dirname, "..");
const LOCK_FILE = path.join(ROOT, "logs", "huaca-cron.lock");
const LOG_FILE = path.join(ROOT, "logs", "huaca-cron.log");
const STALE_LOCK_MINUTES = 30; // si el lock tiene >30min, se considera huérfano

// ─── LOCK ANTI-OVERLAP ────────────────────────────────────────────
function acquireLock() {
  if (fs.existsSync(LOCK_FILE)) {
    const stat = fs.statSync(LOCK_FILE);
    const ageMin = (Date.now() - stat.mtimeMs) / 1000 / 60;
    if (ageMin < STALE_LOCK_MINUTES) {
      return { ok: false, reason: "active", pid: fs.readFileSync(LOCK_FILE, "utf-8") };
    }
    console.warn(`[huaca-cron] Removing stale lock (${ageMin.toFixed(1)}min old)`);
    fs.unlinkSync(LOCK_FILE);
  }
  fs.writeFileSync(LOCK_FILE, String(process.pid));
  return { ok: true };
}

function releaseLock() {
  try {
    if (fs.existsSync(LOCK_FILE)) {
      const owner = fs.readFileSync(LOCK_FILE, "utf-8");
      if (owner === String(process.pid)) fs.unlinkSync(LOCK_FILE);
    }
  } catch (e) {
    // best-effort
  }
}

// ─── LOG HELPER ────────────────────────────────────────────────────
function log(line) {
  const ts = new Date().toISOString();
  const out = `[${ts}] ${line}`;
  console.log(out);
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.appendFileSync(LOG_FILE, out + "\n");
}

// ─── PARSER DE OUTPUT ──────────────────────────────────────────────
// Busca en el output del agent.js los eventos clave para el resumen
function parseSummary(stderr, stdout) {
  const combined = (stderr || "") + (stdout || "");
  const summary = {
    scraped: 0,
    generated: 0,
    minted: 0,
    uploadOk: false,
    txHashes: [],
    urgentHits: [],
    errors: [],
  };

  const lines = combined.split("\n");
  for (const line of lines) {
    const txMatch = line.match(/tx[:\s]+(0x[a-fA-F0-9]{64})/);
    if (txMatch) summary.txHashes.push(txMatch[1]);
    const urgentMatch = line.match(/URGENT:\s*candidate\s*\d+\s*matches\s*"([^"]+)"/);
    if (urgentMatch) summary.urgentHits.push(urgentMatch[1]);
    const errMatch = line.match(/(?:error|Error|failed|FAIL):\s*(.{0,200})/);
    if (errMatch) summary.errors.push(errMatch[1].trim().slice(0, 150));
    const genMatch = line.match(/Generated voxel:.*\((\d+)\s*voxels/);
    if (genMatch) summary.generated++;
  }

  summary.scraped = (combined.match(/Batch \d+:/g) || []).length;
  summary.minted = summary.txHashes.length;
  summary.uploadOk = combined.includes("=== gallery uploaded") || combined.includes("Step 5");
  return summary;
}

// ─── MAIN ──────────────────────────────────────────────────────────
async function main() {
  const start = Date.now();
  log("=== huaca-cron: cycle start ===");

  const lock = acquireLock();
  if (!lock.ok) {
    log(`SKIP: another cycle active (pid ${lock.pid})`);
    process.exit(2);
  }

  // Cleanup on exit
  process.on("exit", releaseLock);
  process.on("SIGINT", () => { releaseLock(); process.exit(130); });
  process.on("SIGTERM", () => { releaseLock(); process.exit(143); });

  // Generar nombre de log único para este run
  const runLog = path.join(ROOT, "logs", `huaca-run-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);

  // Skip scrape ONLY if scraper-candidates.json exists and has approved
  // candidates. Otherwise let Step 1 do the full scrape (this protects
  // us when the data files get wiped or after a fresh deploy). Saves 5-10min
  // per cycle and avoids burning LLM rate limits on re-extraction.
  // Override with HUACA_FORCE_SCRAPE=1 if you want a fresh scrape.
  const candidatesFile = path.join(ROOT, "data", "scraper-candidates.json");
  let hasCandidates = false;
  try {
    const raw = fs.readFileSync(candidatesFile, "utf-8");
    const parsed = JSON.parse(raw);
    const list = parsed.candidates || parsed;
    hasCandidates = Array.isArray(list) && list.some((c) => !c.approved && !c.rejected && !c.aiLegalRisk);
  } catch (_) {
    hasCandidates = false;
  }
  const agentArgs = ["scripts/agent.js", "--once", "--limit", "1"];
  if (hasCandidates && !process.env.HUACA_FORCE_SCRAPE) {
    agentArgs.push("--skip-scrape");
  }
  const child = spawn("node", agentArgs, {
    cwd: ROOT,
    env: process.env,
  });

  const out = fs.openSync(runLog, "w");
  const stdoutChunks = [];
  const stderrChunks = [];

  child.stdout.on("data", (d) => {
    stdoutChunks.push(d);
    fs.writeSync(out, d);
    process.stdout.write(d); // tee al log del cron para diagnóstico en vivo
  });
  child.stderr.on("data", (d) => {
    stderrChunks.push(d);
    fs.writeSync(out, d);
    process.stderr.write(d);
  });

  // Timeout duro: 25 min. Cron job timeout = 30 min, dejamos margen.
  const TIMEOUT_MS = 25 * 60 * 1000;
  const timeoutHandle = setTimeout(() => {
    log(`!!! TIMEOUT after 25min — killing agent.js (pid ${child.pid})`);
    try { child.kill("SIGTERM"); } catch (e) {}
    setTimeout(() => { try { child.kill("SIGKILL"); } catch (e) {} }, 5000);
  }, TIMEOUT_MS);

  const exitCode = await new Promise((resolve) => {
    child.on("close", (code, signal) => {
      clearTimeout(timeoutHandle);
      resolve({ code, signal });
    });
  });

  fs.closeSync(out);
  releaseLock();

  const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
  const stderr = Buffer.concat(stderrChunks).toString("utf-8");
  const elapsed = ((Date.now() - start) / 1000 / 60).toFixed(1);

  const summary = parseSummary(stderr, stdout);
  log(`cycle finished in ${elapsed}min, exit=${JSON.stringify(exitCode)}`);
  log(`summary: scraped=${summary.scraped} generated=${summary.generated} minted=${summary.minted} uploadOk=${summary.uploadOk}`);

  // ─── DECISIÓN DE QUÉ REPORTAR ───────────────────────────────────
  const hardFail = exitCode.code !== 0;
  const noWorks = summary.generated === 0 && summary.minted === 0;

  // Para el delivery del cron: reportar siempre un resumen breve.
  // El usuario pidió: "log local + resumen corto a TG solo si hubo mint o error"
  // → Emitimos SIEMPRE una línea corta de una sola línea a stdout (el cron la entrega),
  //   el usuario decide si filtrar el ruido en TG. La info completa queda en log local.

  const txList = summary.txHashes.length
    ? summary.txHashes.map(t => `https://sepolia.etherscan.io/tx/${t}`).join("\n")
    : "(ninguno)";

  const report = [
    `🪶 Huaca cron · ${new Date().toISOString().slice(0, 16).replace("T", " ")} · ${elapsed}min`,
    `scrapeados: ${summary.scraped} batches · generados: ${summary.generated} · minteados: ${summary.minted}`,
    summary.urgentHits.length ? `🔴 urgentes: ${summary.urgentHits.join(", ")}` : null,
    `tx: ${txList}`,
    summary.uploadOk ? "✅ gallery subida" : "⚠️ gallery NO subida",
    summary.errors.length ? `errores: ${summary.errors.slice(0, 3).join(" | ")}` : null,
    hardFail ? `❌ exit code: ${exitCode.code} ${exitCode.signal || ""}` : null,
    `log: ${path.relative(ROOT, runLog)}`,
  ].filter(Boolean).join("\n");

  console.log("\n=== HUACA CRON REPORT ===");
  console.log(report);
  console.log("=== END ===\n");

  // Exit code del wrapper
  if (hardFail) process.exit(1);
  process.exit(0);
}

main().catch((e) => {
  log(`FATAL: ${e.message}\n${e.stack}`);
  releaseLock();
  process.exit(1);
});
