import dotenv from "dotenv";
dotenv.config();

let traceable: any;
try {
  traceable = require("langsmith/traceable").traceable;
} catch {
  traceable = (fn: any) => fn;
}

type Provider = "groq" | "groq-backup" | "ollama" | "nvidia" | "opencode";

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
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    label: "groq",
  };
}

function groqBackupConfig(): ProviderConfig | null {
  if (process.env.GROQ_API_KEY_BACKUP_DISABLE === "1") return null;
  const apiKey = process.env.GROQ_API_KEY_BACKUP;
  if (!apiKey) return null;
  return {
    baseUrl: (process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1").replace(/\/$/, ""),
    apiKey,
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
    label: "groq-backup",
  };
}

function ollamaConfig(): ProviderConfig | null {
  const model = process.env.OLLAMA_MODEL;
  if (!model) return null;
  return {
    baseUrl: (process.env.OLLAMA_BASE_URL || "http://localhost:11434").replace(/\/$/, ""),
    apiKey: "ollama",
    model,
    label: "ollama",
  };
}

function nvidiaConfig(): ProviderConfig | null {
  const apiKey = process.env.NVIDIA_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: (process.env.NVIDIA_BASE_URL || "https://integrate.api.nvidia.com/v1").replace(/\/$/, ""),
    apiKey,
    model: process.env.NVIDIA_MODEL || "meta/llama-3.2-90b-vision-instruct",
    label: "nvidia",
  };
}

function opencodeConfig(): ProviderConfig | null {
  const apiKey = process.env.OPENCODE_API_KEY;
  if (!apiKey) return null;
  return {
    baseUrl: (process.env.OPENCODE_BASE_URL || "https://opencode.ai/zen/v1").replace(/\/$/, ""),
    apiKey,
    model: process.env.OPENCODE_MODEL || "deepseek-v4-flash",
    label: "opencode",
  };
}

function providerChain(): ProviderConfig[] {
  const chain: ProviderConfig[] = [];
  const l = ollamaConfig();
  const g = groqConfig();
  const gb = groqBackupConfig();
  const n = nvidiaConfig();
  const o = opencodeConfig();
  if (l) chain.push(l);
  if (g) chain.push(g);
  if (gb) chain.push(gb);
  if (n) chain.push(n);
  if (o) chain.push(o);
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
  const safeConfig = {
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    label: cfg.label,
  };

  const tracedHttpCall = traceable(
    async ({
      baseUrl,
      model,
      label,
      messages,
      temperature,
      topP,
      maxTokens,
      responseFormat,
      stop,
    }: {
      baseUrl: string;
      model: string;
      label: string;
      messages: ChatMessage[];
      temperature: number;
      topP: number;
      maxTokens: number;
      responseFormat?: string;
      stop?: string[];
    }) => {
      const body: Record<string, any> = {
        model,
        messages,
        temperature,
        top_p: topP,
        max_tokens: maxTokens,
        stream: false,
      };
      if (responseFormat === "json_object") body.response_format = { type: "json_object" };
      if (stop && stop.length > 0) body.stop = stop;

      const res = await fetch(`${baseUrl}/chat/completions`, {
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
        throw new Error(`[${label}] HTTP ${res.status}: ${errText.slice(0, 300)}`);
      }
      const data = (await res.json()) as any;
      const choice = data.choices?.[0];
      if (!choice) throw new Error(`[${label}] no choices returned: ${JSON.stringify(data).slice(0, 200)}`);
      return {
        text: (choice.message?.content || "").toString(),
        model: data.model || model,
        provider: label,
        usage: data.usage
          ? {
              promptTokens: data.usage.prompt_tokens,
              completionTokens: data.usage.completion_tokens,
              totalTokens: data.usage.total_tokens,
            }
          : undefined,
      };
    },
    {
      name: "llm.chat",
      tags: [safeConfig.label, `model:${safeConfig.model}`],
      metadata: {
        provider: safeConfig.label,
        model: safeConfig.model,
        baseUrl: safeConfig.baseUrl,
      },
    }
  );

  return tracedHttpCall({
    baseUrl: safeConfig.baseUrl,
    model: safeConfig.model,
    label: safeConfig.label,
    messages,
    temperature: options.temperature ?? 0.2,
    topP: options.topP ?? 0.9,
    maxTokens: options.maxTokens ?? 4000,
    responseFormat: options.responseFormat,
    stop: options.stop,
  });
}

export async function chat(
  messages: ChatMessage[],
  options: ChatOptions = {}
): Promise<ChatResponse> {
  const chain = providerChain();
  if (chain.length === 0) {
    throw new Error("No LLM provider configured");
  }

  const targets = options.provider
    ? chain.filter((c) => c.label === options.provider)
    : chain;

  if (targets.length === 0) {
    throw new Error(`Requested provider "${options.provider}" not configured`);
  }

  const TIMEOUTS_MS: Record<Provider, number> = {
    groq: 12000,
    "groq-backup": 12000,
    ollama: 60000,
    nvidia: 25000,
    opencode: 20000,
  };

  const errors: string[] = [];
  for (const cfg of targets) {
    const timeoutMs = TIMEOUTS_MS[cfg.label];
    const start = Date.now();
    try {
      const result = await Promise.race([
        callProvider(cfg, messages, { ...options, maxTokens: options.maxTokens || 4000 }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
        ),
      ]);
      const elapsed = Date.now() - start;
      (result as any).latencyMs = elapsed;
      console.log(`[llm] used ${cfg.label} (${elapsed}ms)`);
      return result;
    } catch (err: any) {
      const elapsed = Date.now() - start;
      const msg = `[${cfg.label}] (${elapsed}ms) ${err.message}`;
      errors.push(msg);
      console.log(`[llm] ${cfg.label} failed, falling back: ${err.message}`);
    }
  }

  throw new Error(`All LLM providers failed:\n${errors.join("\n")}`);
}

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

export async function healthCheck(): Promise<Array<{ provider: Provider; ok: boolean; model: string; latencyMs?: number; error?: string }>> {
  const chain = providerChain();
  const results: Array<{ provider: Provider; ok: boolean; model: string; latencyMs?: number; error?: string }> = [];

  for (const cfg of chain) {
    const start = Date.now();
    try {
      await callProvider(cfg, [{ role: "user", content: "Reply with exactly: PONG" }], {
        temperature: 0,
        maxTokens: 800,
        provider: cfg.label,
      });
      results.push({ provider: cfg.label, ok: true, model: cfg.model, latencyMs: Date.now() - start });
    } catch (err: any) {
      results.push({ provider: cfg.label, ok: false, model: cfg.model, error: err.message });
    }
  }

  return results;
}

if (require.main === module) {
  (async () => {
    console.log("Multi-provider LLM client self-test\n");
    console.log("Provider health:");
    const health = await healthCheck();
    for (const h of health) {
      console.log(`  ${h.ok ? "✓" : "✗"} ${h.provider.padEnd(8)} ${h.model.padEnd(35)} ${h.latencyMs ? h.latencyMs + "ms" : h.error}`);
    }
    console.log();
    try {
      const json = await chatJson<{ ok: boolean; echo: string }>('You are a JSON responder. Reply with {\"ok\": true, \"echo\": \"<user input>\"}', "hello world");
      console.log(`✓ JSON test: ${JSON.stringify(json)}`);
    } catch (err: any) {
      console.error(`✗ JSON test: ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
