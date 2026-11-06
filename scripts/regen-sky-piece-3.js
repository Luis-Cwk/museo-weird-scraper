// Regenera sky-9171.png (pieza 3) con mmx + fix del flujo (JPEG→PNG + letterbox guard).
const { generateSkyForCandidate } = require("./agent.js");

const candidate = {
  content:
    "De la Espiella y la mafia de Miami están desesperados por hacernos creer que la violencia en Colombia es culpa de un pelao que vive una historia de amor y poder en los pueblos desérticos de la Guajira.",
  aiCategory: "other",
  aiImpactScore: 7,
  attribution: "Anonymous",
  source: 'x:"(violencia OR deslizamiento) (medellin OR antioquia) lang:es -is:retweet"',
  sourceUrl: "",
};

async function main() {
  console.log("Regenerando sky-9171.png (pieza 3)...");
  const result = await generateSkyForCandidate(candidate, 9171);
  if (result) {
    console.log("SKY REGEN OK:", JSON.stringify(result));
  } else {
    console.log("SKY REGEN FAILED (returned null)");
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error("ERROR:", e.message);
  process.exit(1);
});
