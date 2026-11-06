
// Load child_process and patch spawnSync
const cp = require("child_process");
const fs = require("fs");
const path = require("path");
const origSpawnSync = cp.spawnSync;

const debugLog = fs.createWriteStream(
  "C:/Users/petra/museo-weird-scraper/sandbox/spawn-trace.log",
  { flags: "a" }
);
debugLog.write(`\n\n=== ${new Date().toISOString()} ===\n`);

cp.spawnSync = function(...args) {
  const cmd = args[0];
  const argv = args[1];
  if (typeof cmd === "string" && cmd.includes("mmx")) {
    debugLog.write(`SPAWN: ${cmd} ${JSON.stringify(argv).slice(0, 800)}...\n`);
  }
  const start = Date.now();
  const r = origSpawnSync.apply(this, args);
  const elapsed = Date.now() - start;
  if (typeof cmd === "string" && cmd.includes("mmx")) {
    debugLog.write(`RESULT after ${elapsed}ms: status=${r.status} error=${r.error ? r.error.message : "null"}\n`);
    debugLog.write(`  STDOUT first 1000: ${(r.stdout || "").slice(0, 1000)}\n`);
    debugLog.write(`  STDERR first 1000: ${(r.stderr || "").slice(0, 1000)}\n`);
  }
  return r;
};

// Now require agent.js (which uses spawnSync through child_process)
require("C:/Users/petra/museo-weird-scraper/scripts/agent.js");
