
const path = require("path");
process.chdir("C:/Users/petra/museo-weird-scraper");
const src = require("fs").readFileSync("scripts/agent.js", "utf-8");
// Extract fixSkySeam function
const m = src.match(/async function fixSkySeam[\s\S]+?
\}
/);
if (!m) { console.error("fixSkySeam not found"); process.exit(1); }
eval(m[0].replace("async function fixSkySeam", "async function _fixSkySeam"));
const fs = require("fs");

(async () => {
  for (const fname of ["sky-3143.png", "sky-9775.png"]) {
    const inPath = path.join("deploy/huaca/textures", fname);
    const outPath = inPath + ".fixed.png";
    const result = await _fixSkySeam(inPath, outPath, 192);
    console.log(fname, "->", outPath, fs.statSync(outPath).size, "bytes");
  }
})();
