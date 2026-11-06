import dotenv from "dotenv";
dotenv.config();

/**
 * MUSEO WEIRD — Multi-Provider LLM Client
 *
 * Routes chat completions across providers with automatic fallback:
 *   1. Groq (primary)  — llama-3.3-70b-versatile, ~10ms responses
 *   2. NVIDIA NIM (fallback) — meta/llama-3.1-70b-instruct, ~50s responses
 *
 * Both expose an OpenAI-compatible /chat/completions endpoint, so the
 * underlying fetch logic is shared. We just swap base URL + auth header.
 *
 * Used by:
 *   - scripts/scraper.ts (extraction agent)
 *   - scripts/quote-guard.ts (verification layer)
 */

type Provider = "groq" | "nvidia";

interface ProviderConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  label: Provider;
}

function groqConfig(): ProviderConfig | null {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
    apiKey,
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile",
    label: "groq",
  };
}

function nvidiaConfig(): ProviderConfig | null {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""),
    apiKey,
    model: process.env.NVIDIA_MODEL || "meta/llama-3.1-70b-instruct",
    label: "nvidia",
  };
}

/**
 * Build the ordered provider chain. Groq first (fast), NVIDIA as fallback.
 * Skips providers with no API key configured.
 */
function providerChain(): ProviderConfig[] {
  const chain: ProviderConfig[] = [];
  const g = groqConfig();
  const n = nvidiaConfig();
  if (g) chain.push(g);
  if (n) chain.push(n);
  return chain;
}

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  responseFormat?: "json_object" | "text";
  stop?: string[];
  /** Restrict to a specific provider; useful for tests. */
  provider?: Provider;
}

export interface ChatResponse {
  text: string;
  model: string;
  provider: Provider;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

async function callProvider(
  cfg: ProviderConfig,
  messages: ChatMessage[],
  options: ChatOptions
): Promise<ChatResponse> {
  const body: Record<string, any> = {
    model: cfg.model,
    messages,
    temperature: options.temperature ?? 0.2,
    top_p: options.topP ?? 0.9,
    max_tokens: options.maxTokens ?? 2048,
    stream: false,
  };

  if (options.responseFormat === "json_object") {
    body.response_format = { type: "json_object" };
  }

  if (options.stop && options.stop.length > 0) {
    body.stop = options.stop;
  }

  const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${cfg.apiKey}`,
      Accept: "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`[${cfg.label}] HTTP ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = (await res.json()) as any;
  const choice = data.choices?.[0];
  if (!choice) {
    throw new Error(`[${cfg.label}] no choices returned: ${JSON.stringify(data).slice(0, 200)}`);
  }

  return {
    text: (choice.message?.content || "").toString(),
    model: data.model || cfg.model,
    provider: cfg.label,
    usage: data.usage
      ? {
          promptTokens: data.usage.prompt_tokens,
          completionTokens: data.usage.completion_tokens,
          totalTokens: data.usage.total_tokens,
        }
      : undefined,
  };
}

/**
 * Send a chat completion request. Tries providers in order until one succeeds.
 * Each provider has its own timeout — if it exceeds, we immediately fall
 * back to the next provider instead of waiting indefinitely.
 *
 * Throws the last error if all providers fail.
 */
export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const chain = providerChain();
  if (chain.length === 0) {
    throw new Error("No LLM provider configured — set GROQ_API_KEY and/or NVIDIA_API_KEY in .env");
  }

  // If a specific provider is requested, restrict to that one (no fallback).
  const targets = options.provider
    ? chain.filter((c) => c.label === options.provider)
    : chain;

  if (targets.length === 0) {
    throw new Error(`Requested provider "${options.provider}" not configured`);
  }

  // Per-provider timeout. Groq is fast (~1s typical) so 12s is plenty; NVIDIA
  // is slow (~50s typical) but if it can't respond in 25s it's likely hung.
  const TIMEOUTS_MS: Record<Provider, number> = {
    groq: 12000,
    nvidia: 25000,
  };

  const errors: string[] = [];
  for (const cfg of targets) {
    const timeoutMs = TIMEOUTS_MS[cfg.label];
    const start = Date.now();
    try {
      const result = await Promise.race([
        callProvider(cfg, messages, options),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      const elapsed = Date.now() - start;
      // Tag with elapsed for observability (callers can inspect)
      (result as any).latencyMs = elapsed;
      console.log(`[llm] used ${cfg.label} (${elapsed}ms)`);
      return result;
    } catch (err: any) {
      const elapsed = Date.now() - start;
      const msg = `[${cfg.label}] (${elapsed}ms) ${err.message}`;
      errors.push(msg);
      console.log(`[llm] ${cfg.label} failed, falling back: ${err.message}`);

      // If Groq hit a rate limit, wait before allowing the next call (caller
      // will retry via the outer loop or next request). We don't sleep here
      // because the next provider in the chain should be tried immediately.
      // The caller is responsible for backoff between batches.
    }
  }

  throw new Error(`All LLM providers failed:\n${errors.join("\n")}`);
}

/**
 * Convenience: chat with just a system + user prompt, get text back.
 */
export async function chatText(
  systemPrompt: string,
  userPrompt: string,
  options: ChatOptions = {}
): Promise<string> {
  const res = await chat(
    [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt },
    ],
    options
  );
  return res.text;
}

/**
 * Convenience: chat and parse JSON response.
 * Handles markdown fences and common Llama quirks (bare objects instead of arrays,
 * wrapper keys, trailing commas).
 */
export async function chatJson<T = any>(
  systemPrompt: string,
  userPrompt: string,
  options: ChatOptions = {}
): Promise<T> {
  const res = await chatText(systemPrompt, userPrompt, {
    ...options,
    responseFormat: options.responseFormat ?? "json_object",
  });

  let text = res.trim();
  text = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?\s*```$/i, "").trim();

  try {
    return JSON.parse(text) as T;
  } catch {
    // Try to extract first JSON object/array from the text (Llama sometimes
    // adds chatter before/after the JSON).
    const firstBrace = text.indexOf("{");
    const firstBracket = text.indexOf("[");
    let start = -1;
    let open = "";
    let close = "";

    if (firstBracket !== -1 && (firstBrace === -1 || firstBracket < firstBrace)) {
      start = firstBracket;
      open = "[";
      close = "]";
    } else if (firstBrace !== -1) {
      start = firstBrace;
      open = "{";
      close = "}";
    }

    if (start !== -1) {
      let depth = 0;
      let inStr = false;
      let escape = false;
      for (let i = start; i < text.length; i++) {
        const c = text[i];
        if (escape) { escape = false; continue; }
        if (c === "\\") { escape = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (!inStr) {
          if (c === open) depth++;
          else if (c === close) {
            depth--;
            if (depth === 0) {
              const candidate = text.slice(start, i + 1);
              try {
                return JSON.parse(candidate) as T;
              } catch {
                break;
              }
            }
          }
        }
      }
    }

    throw new Error(`Failed to parse JSON from LLM response: ${text.slice(0, 200)}`);
  }
}

/**
 * Diagnostics: ping every configured provider. Returns a status per provider.
 */
export async function healthCheck(): Promise<Array<{ provider: Provider; ok: boolean; model: string; latencyMs?: number; error?: string }>> {
  const chain = providerChain();
  const results: Array<{ provider: Provider; ok: boolean; model: string; latencyMs?: number; error?: string }> = [];

  for (const cfg of chain) {
    const start = Date.now();
    try {
      await callProvider(cfg, [{ role: "user", content: "Reply with exactly: PONG" }], {
        temperature: 0,
        maxTokens: 10,
        provider: cfg.label,
      });
      results.push({ provider: cfg.label, ok: true, model: cfg.model, latencyMs: Date.now() - start });
    } catch (err: any) {
      results.push({ provider: cfg.label, ok: false, model: cfg.model, error: err.message });
    }
  }

  return results;
}

// --- Self-test ---
if (require.main === module) {
  (async () => {
    console.log("Multi-provider LLM client self-test\n");

    // Health check across all configured providers
    console.log("Provider health:");
    const health = await healthCheck();
    for (const h of health) {
      console.log(`  ${h.ok ? "✓" : "✗"} ${h.provider.padEnd(8)} ${h.model.padEnd(35)} ${h.latencyMs ? h.latencyMs + "ms" : h.error}`);
    }
    console.log();

    // JSON test
    try {
      const json = await chatJson<{ ok: boolean; echo: string }>(
        'You are a JSON responder. Reply with {"ok": true, "echo": "<user input>"}',
        "hello world"
      );
      console.log(`✓ JSON test: ${JSON.stringify(json)}`);
    } catch (err: any) {
      console.error(`✗ JSON test: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}