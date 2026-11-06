import fs from "fs";
import path from "path";

const CANDIDATES_PATH = path.join(__dirname, "..", "data", "scraper-candidates.json");

function present() {
  try {
    if (!fs.existsSync(CANDIDATES_PATH)) {
      console.log("No candidates found yet. Run scrape first.");
      return;
    }

    const data = JSON.parse(fs.readFileSync(CANDIDATES_PATH, "utf-8"));
    const candidates = data.candidates || [];

    if (candidates.length === 0) {
      console.log("No candidates in the pool.");
      return;
    }

    // Filter for candidates that haven't been approved/rejected yet
    const newOnes = candidates.filter(c => !c.approved && !c.rejected);

    if (newOnes.length === 0) {
      console.log("No new candidates to present.");
      return;
    }

    const date = new Date().toLocaleDateString("es-MX", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });

    console.log(`\\n✨ NUEVOS HALLAZGOS — ${date}\\n`);
    console.log(`${newOnes.length} resultados encontrados:\\n`);

    newOnes.forEach((c, i) => {
      console.log(`${i + 1}. **${c.content.slice(0, 100)}${c.content.length > 100 ? "..." : ""}**`);
      console.log(`🔗 ${c.sourceUrl}`);
      console.log(`🏷️ Tipo: ${c.type} | Score: ${c.score}`);
      console.log(`Fuente: ${c.attribution}\\n`);
    });

    console.log("---");
    console.log("Usa `npm run scrape:approve` para revisar y promover estos candidatos al queue de arte.");

  } catch (e) {
    console.error("Error presenting candidates:", e);
  }
}

present();
