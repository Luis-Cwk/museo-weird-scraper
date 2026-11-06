
const { spawnSync } = require("child_process");
const path = require("path");

const MMX_MJS = 'C:\\Program Files\\nodejs\\node_modules\\mmx-cli\\dist\\mmx.mjs';
const prompt = "test prompt for sky gen with spaces in path";
const localPath = "C:/Users/petra/museo-weird-scraper/deploy/huaca/textures/sky-test-spawn.png";
const spawnArgs = [
  "image", "generate",
  "--prompt", prompt,
  "--width", "2048", "--height", "1024",
  "--seed", "88888",
  "--out", localPath,
  "--model", "image-01-live",
  "--quiet",
];
console.log("Spawning:", MMX_MJS, spawnArgs);
const r = spawnSync("node", [MMX_MJS].concat(spawnArgs), {
  encoding: "utf-8",
  timeout: 60000,
  shell: false,
});
console.log("status:", r.status);
console.log("error:", r.error ? r.error.message : null);
console.log("stdout:", (r.stdout || "").slice(0, 300));
console.log("stderr:", (r.stderr || "").slice(0, 500));
