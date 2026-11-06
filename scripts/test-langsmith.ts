/* eslint-disable no-console */
/**
 * test-langsmith.ts — Minimal smoke test for LangSmith tracing.
 *
 * Sends ONE prompt to Groq with `traceable()` wrapper.
 * After running, check https://smith.langchain.com → project "huaca"
 * to see if the trace appears.
 *
 * Run:  npx ts-node scripts/test-langsmith.ts
 */

import * as dotenv from "dotenv";
dotenv.config();

import { traceable } from "langsmith/traceable";

async function callGroq(prompt: string): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_MODEL || "llama-3.1-8b-instant";
  if (!apiKey) throw new Error("GROQ_API_KEY missing in .env");

  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: "Eres un asistente que responde en una sola frase corta." },
        { role: "user", content: prompt },
      ],
      max_tokens: 60,
      temperature: 0.2,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Groq HTTP ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { choices: Array<{ message: { content: string } }> };
  return data.choices[0].message.content;
}

// The traceable wrapper tells LangSmith: "this function is a run".
// Whatever LangSmith metadata you put on it shows up on the dashboard.
const tracedCall = traceable(callGroq, {
  name: "groq.smoke-test",
  tags: ["smoke", "huaca-agent", "groq"],
  metadata: {
    triggered_by: "petra-cli",
    purpose: "verify langsmith tracing works",
  },
});

async function main() {
  console.log("=== LangSmith smoke test ===");
  console.log(`LANGSMITH_TRACING: ${process.env.LANGSMITH_TRACING}`);
  console.log(`LANGSMITH_PROJECT: ${process.env.LANGSMITH_PROJECT}`);
  console.log(`GROQ_MODEL:        ${process.env.GROQ_MODEL}`);
  console.log("");

  const start = Date.now();
  const output = await tracedCall("Di hola en español. Una sola frase.");
  const elapsed = Date.now() - start;

  console.log(`--- response (${elapsed}ms) ---`);
  console.log(output);
  console.log("");
  console.log("=== Now check https://smith.langchain.com → project 'huaca' ===");
  console.log("You should see a run named 'groq.smoke-test' with timestamp now.");
}

main().catch((e) => {
  console.error("FAIL:", e.message);
  process.exit(1);
});
