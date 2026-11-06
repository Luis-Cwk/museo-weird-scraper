
const path = require("path");
const ROOT = "C:/Users/petra/museo-weird-scraper";
process.chdir(ROOT);

// Load the queue items
const q = JSON.parse(require("fs").readFileSync("data/art-queue.json", "utf-8"));
const items = q.items || q;
const target = items.find(it => it.id === 21) || items.find(it => it.id === 22);
console.log("TARGET_QUEUE_ITEM:");
console.log(JSON.stringify(target, null, 2).slice(0, 1500));

// Build a candidate object from it (mirror what agent.js does)
const candidate = {
  content: target.content || target.title || "",
  sourceUrl: target.sourceUrl || "",
  attribution: target.attribution || "",
  aiCategory: target.aiCategory || null,
  aiImpactScore: target.aiImpactScore || null,
};
console.log("\nCANDIDATE_OBJECT:");
console.log(JSON.stringify(candidate, null, 2));

// We need to read agent.js and extract buildSkyPrompt + dependencies
// Easier: just require agent.js — but it has side effects.
// So: read the source, eval the relevant helpers + function
const src = require("fs").readFileSync("scripts/agent.js", "utf-8");

// Extract SKY_CATEGORY_HINT block
const hintM = src.match(/const SKY_CATEGORY_HINT = (\{[^;]+\});/);
const hintStr = hintM ? hintM[1] : "{}";
const intensityM = src.match(/const SKY_INTENSITY_WORDS = (\{[^;]+\});/);
const intensityStr = intensityM ? intensityM[1] : "{}";
const extractM = src.match(/function extractProperNouns[\s\S]+?\}\n/);
const extractStr = extractM ? extractM[0] : "";
const buildM = src.match(/function buildSkyPrompt\(candidate\) \{[\s\S]+?\n\}/);
const buildStr = buildM ? buildM[0] : "";

const ASCII = "(s) => (s || '').normalize('NFKD').replace(/[\\u0300-\\u036f]/g, '')";

// Evaluate
eval("const SKY_CATEGORY_HINT = " + hintStr + ";");
eval("const SKY_INTENSITY_WORDS = " + intensityStr + ";");
eval(extractStr);
eval(ASCII);
eval(buildStr);

// Now call it
const prompt = buildSkyPrompt(candidate);
console.log("\n===FULL_PROMPT===");
console.log(prompt);
console.log("===END===");
console.log("\nLength:", prompt.length);
