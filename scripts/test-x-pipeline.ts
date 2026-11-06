
import dotenv from "dotenv";
dotenv.config();
import { searchRecent, usersById } from "./x-client";

(async () => {
  const query = "(violencia OR deslizamiento) (medellin OR antioquia) lang:es -is:retweet";
  console.log("=== X API test (query real) ===");
  console.log("Query:", query);
  console.log("");

  const r = await searchRecent(query, { maxResults: 15 });
  console.log(`Posts: ${r.posts.length} (cost ~${r.cost_credits_estimate} credits)`);

  if (r.posts.length > 0) {
    const ids = [...new Set(r.posts.map(p => p.author_id))];
    const handles = await usersById(ids);
    console.log(`Handle lookups: ${ids.length} (cost ~1 credit)`);

    let totalCredits = 11;
    for (const p of r.posts.slice(0, 5)) {
      const h = handles[p.author_id] || "?";
      console.log(`  @${h}: ${p.text.slice(0, 100)}`);
    }
    console.log("...");
    console.log(`ESTIMATED total credits: ${totalCredits}`);
  }
})().catch(e => { console.error("FAIL:", e.message); process.exit(1); });
