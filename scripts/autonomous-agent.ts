import fs from "fs";
import path from "path";
import dotenv from "dotenv";

dotenv.config();

/**
 * MUSEO WEIRD — Autonomous Agent
 *
 * Full pipeline: scrape → guard → generate art → queue for minting
 * Runs autonomously on a schedule.
 *
 * Usage:
 *   npm run agent           # Full autonomous loop (every 12h)
 *   npm run agent:testnet   # Testnet mode
 *   npm run agent:dry       # Dry run — full pipeline, no minting
 *   npm run agent:once      # Single cycle then exit
 */

import { scrape, loadCandidates, saveCandidates, loadQueue, saveQueue, Candidate } from "./scraper";
import { guard } from "./quote-guard";
import { generateArtwork } from "./generate-artwork";
import { generateThreeArtwork } from "./generate-three";

const LOG_PATH = path.join(__dirname, "..", "logs", "agent.log");
const CYCLE_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours
const DAILY_MINT_CAP = 12;

function ensureDir(filePath: string) {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function log(msg: string) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  try {
    ensureDir(LOG_PATH);
    fs.appendFileSync(LOG_PATH, line + "\n");
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function getDailyMintCount(): number {
  const queue = loadQueue();
  const today = new Date().toISOString().slice(0, 10);
  return queue.items.filter((item) => {
    if (item.status !== "done") return false;
    if (!item.lastAttempt) return false;
    return item.lastAttempt.slice(0, 10) === today;
  }).length;
}

/**
 * Process a single candidate through the full pipeline.
 */
async function processCandidate(candidate: Candidate, dryRun = false): Promise<boolean> {
  log(`Processing: "${candidate.content.slice(0, 60)}..."`);

  // Step 1: Security guard
  log("  Running security guard...");
  const guardResult = await guard(candidate.content);

  if (!guardResult.passed) {
    log(`  REJECTED: ${guardResult.reason}`);
    candidate.rejected = true;
    return false;
  }

  log(`  PASSED guard (${guardResult.stage})`);

  if (dryRun) {
    log("  [DRY RUN] Would generate artwork and queue for minting");
    return true;
  }

  // Step 2: Generate artwork (Three.js voxel sculpture — primary format)
  log("  Generating voxel artwork...");
  const artworkResult = await generateThreeArtwork({
    content: guardResult.cleaned,
    category: candidate.aiCategory || "other",
    attribution: candidate.attribution,
    source: candidate.source,
    sourceUrl: candidate.sourceUrl,
    scrapedAt: candidate.scrapedAt,
  });
  log(`  Artwork saved: ${artworkResult.htmlPath}`);
  log(`  Voxels: ${artworkResult.voxelCount}`);
  log(`  Metadata: ${artworkResult.metadataPath}`);

  // Step 3: Add to queue
  const queue = loadQueue();
  const nextId = queue.items.length > 0
    ? Math.max(...queue.items.map((i) => i.id)) + 1
    : 1;

  queue.items.push({
    id: nextId,
    content: guardResult.cleaned,
    type: candidate.type,
    attribution: candidate.attribution,
    source: candidate.source,
    artworkPath: artworkResult.htmlPath, // HTML voxel piece
    listPrice: "0.001",
    status: "pending",
  });

  saveQueue(queue);
  candidate.approved = true;

  log(`  Queued as #${nextId}`);
  return true;
}

/**
 * Run a single cycle of the autonomous pipeline.
 */
async function runCycle(dryRun = false): Promise<{ scraped: number; processed: number; approved: number }> {
  log("\n" + "=".repeat(60));
  log("MUSEO WEIRD — Starting cycle");
  log("=".repeat(60) + "\n");

  // Check daily cap
  if (!dryRun && getDailyMintCount() >= DAILY_MINT_CAP) {
    log(`Daily mint cap reached (${DAILY_MINT_CAP}). Skipping cycle.`);
    return { scraped: 0, processed: 0, approved: 0 };
  }

  // Step 1: Scrape
  log("Step 1: Scraping Bluesky...");
  const newCandidates = await scrape();

  // Merge with existing
  const existing = loadCandidates();
  const existingIds = new Set(existing.candidates.map((c) => c.id));

  let added = 0;
  for (const c of newCandidates) {
    if (!existingIds.has(c.id)) {
      existing.candidates.push(c);
      added++;
    }
  }

  existing.lastScrape = new Date().toISOString();
  existing.totalScraped += newCandidates.length;
  existing.candidates.sort((a, b) => b.score - a.score);
  saveCandidates(existing);

  log(`\nScraped: ${newCandidates.length} new items (${added} unique)\n`);

  // Step 2: Process pending candidates
  log("Step 2: Processing pending candidates...");
  if (!process.env.NVIDIA_API_KEY) {
    log("ERROR: NVIDIA_API_KEY required");
    return { scraped: newCandidates.length, processed: 0, approved: 0 };
  }

  const pending = existing.candidates.filter((c) => !c.approved && !c.rejected && !c.aiLegalRisk);
  log(`  ${pending.length} pending candidates to process\n`);

  let processed = 0;
  let approved = 0;

  for (const candidate of pending) {
    // Check daily cap
    if (!dryRun && getDailyMintCount() >= DAILY_MINT_CAP) {
      log(`  Daily cap reached. Stopping.`);
      break;
    }

    const success = await processCandidate(candidate, dryRun);
    processed++;
    if (success) approved++;

    // Save progress after each candidate
    saveCandidates(existing);

    await sleep(1000); // Rate limit between processing
  }

  log(`\nCycle complete: ${processed} processed, ${approved} approved\n`);
  return { scraped: newCandidates.length, processed, approved };
}

// --- Main ---

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const once = args.includes("--once");
  const testnet = args.includes("--testnet");

  if (testnet) {
    log("Running in TESTNET mode");
  }
  if (dryRun) {
    log("Running in DRY RUN mode — no minting");
  }

  if (once) {
    await runCycle(dryRun);
    return;
  }

  // Autonomous loop
  log("Starting autonomous agent loop...");
  log(`Cycle interval: ${CYCLE_INTERVAL_MS / (1000 * 60 * 60)} hours`);
  log(`Daily mint cap: ${DAILY_MINT_CAP}`);

  while (true) {
    try {
      await runCycle(dryRun);
    } catch (err: any) {
      log(`Cycle error: ${err.message}`);
    }

    log(`\nNext cycle in ${CYCLE_INTERVAL_MS / (1000 * 60 * 60)} hours...`);
    await sleep(CYCLE_INTERVAL_MS);
  }
}

if (require.main === module) {
  main().catch((err) => {
    log(`FATAL: ${err.message}`);
    console.error(err);
    process.exitCode = 1;
  });
}
