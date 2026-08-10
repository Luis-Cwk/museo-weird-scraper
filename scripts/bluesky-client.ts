import dotenv from "dotenv";
dotenv.config();

/**
 * MUSEO WEIRD — Bluesky AT Protocol Client
 *
 * Minimal client for the public Bluesky API (app.bsky).
 * Auth via handle + app password (no OAuth flow needed).
 *
 * Endpoints used:
 *   POST /xrpc/com.atproto.server.createSession   — login
 *   GET  /xrpc/app.bsky.actor.searchActors        — find handles
 *   GET  /xrpc/app.bsky.feed.searchPosts          — public post search
 *
 * Notes:
 *   - Search is public, no auth strictly required, but authenticated
 *     requests get higher rate limits (1500 vs 50 per 5 min on some PDS).
 *   - We persist the accessJwt for the lifetime of the session.
 */

const SERVICE_URL = (process.env.BLUESKY_SERVICE_URL || "https://bsky.social").replace(/\/$/, "");
const HANDLE = process.env.BLUESKY_HANDLE || "";
const APP_PASSWORD = process.env.BLUESKY_APP_PASSWORD || "";

let cachedJwt: string | null = null;
let cachedHandle: string | null = null;
let cachedDid: string | null = null;
let jwtExpiresAt = 0;

export interface BlueskySession {
  accessJwt: string;
  refreshJwt: string;
  handle: string;
  did: string;
}

export interface RawBlueskyPost {
  uri: string;
  cid: string;
  author: {
    did: string;
    handle: string;
    displayName?: string;
  };
  text: string;
  indexedAt: string;
  likeCount?: number;
  repostCount?: number;
  replyCount?: number;
  langs?: string[];
  embed?: any;
  record?: any;
}

/**
 * Authenticate against Bluesky using handle + app password.
 * Tokens last ~2 hours; we refresh when within 60s of expiry.
 */
export async function createSession(forceRefresh = false): Promise<BlueskySession> {
  if (!forceRefresh && cachedJwt && Date.now() < jwtExpiresAt) {
    return {
      accessJwt: cachedJwt,
      refreshJwt: "",
      handle: cachedHandle!,
      did: cachedDid!,
    };
  }

  if (!HANDLE || !APP_PASSWORD) {
    throw new Error("BLUESKY_HANDLE and BLUESKY_APP_PASSWORD must be set in .env");
  }

  const res = await fetch(`${SERVICE_URL}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ identifier: HANDLE, password: APP_PASSWORD }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bluesky auth failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as any;
  cachedJwt = data.accessJwt;
  cachedHandle = data.handle;
  cachedDid = data.did;
  // Sessions on bsky.social last ~2h; refresh buffer 60s early.
  jwtExpiresAt = Date.now() + (120 - 1) * 60 * 1000;

  return {
    accessJwt: data.accessJwt,
    refreshJwt: data.refreshJwt,
    handle: data.handle,
    did: data.did,
  };
}

async function authedFetch(path: string, params: Record<string, string | number> = {}): Promise<any> {
  const session = await createSession();
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) qs.set(k, String(v));
  const url = `${SERVICE_URL}${path}?${qs.toString()}`;

  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${session.accessJwt}` },
  });

  if (res.status === 401) {
    // Token expired or revoked mid-flight — refresh once and retry.
    await createSession(true);
    const retry = await fetch(url, {
      headers: { Authorization: `Bearer ${cachedJwt}` },
    });
    if (!retry.ok) {
      throw new Error(`Bluesky ${path} failed after refresh (${retry.status})`);
    }
    return retry.json();
  }

  if (!res.ok) {
    throw new Error(`Bluesky ${path} failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Public post search. Returns up to `limit` posts (max 100 per call).
 * `sort`: "top" | "latest" — we default to "top" for quality.
 */
export async function searchPosts(
  query: string,
  options: { limit?: number; sort?: "top" | "latest"; lang?: string } = {}
): Promise<RawBlueskyPost[]> {
  const limit = Math.min(options.limit ?? 25, 100);
  const sort = options.sort ?? "top";

  const data = await authedFetch("/xrpc/app.bsky.feed.searchPosts", {
    q: query,
    limit,
    sort,
    ...(options.lang ? { lang: options.lang } : {}),
  });

  return (data.posts || []) as RawBlueskyPost[];
}

/**
 * Extract clean text from a Bluesky post, including embeds (images have alt text,
 * external links have titles/descriptions). Falls back to plain post text.
 */
export function extractPostText(post: RawBlueskyPost): string {
  const parts: string[] = [];

  if (post.text) parts.push(post.text.trim());

  if (Array.isArray(post.embed?.images)) {
    for (const img of post.embed.images) {
      if (img.alt) parts.push(`[image alt: ${img.alt}]`);
    }
  }

  if (post.embed?.external) {
    const ext = post.embed.external;
    if (ext.title) parts.push(`[link title: ${ext.title}]`);
    if (ext.description) parts.push(`[link desc: ${ext.description}]`);
  }

  if (post.embed?.record?.value?.text) {
    parts.push(`[quoted: ${post.embed.record.value.text}]`);
  }

  return parts.join("\n").trim();
}

/**
 * Lightweight lang detector — Bluesky tags langs but they're user-declared.
 * Falls back to checking for Spanish-specific chars if no lang tag.
 */
export function isLikelySpanish(text: string): boolean {
  if (!text) return false;
  const spanishHints = /\b(que|para|con|los|las|del|por|muy|más|sí|está|esto|esa|este|mexic|museo|arte)\b/i;
  const spanishChars = /[ñáéíóú¿¡]/i;
  return spanishHints.test(text) || spanishChars.test(text);
}

// --- Self-test ---
if (require.main === module) {
  (async () => {
    console.log("Bluesky client self-test\n");
    try {
      const session = await createSession(true);
      console.log(`✓ Auth OK as ${session.handle} (${session.did})`);

      const posts = await searchPosts("museo", { limit: 5, sort: "top" });
      console.log(`✓ Search returned ${posts.length} posts for "museo"`);

      for (const p of posts.slice(0, 3)) {
        const text = extractPostText(p);
        console.log(`\n  @${p.author.handle}: ${text.slice(0, 120)}${text.length > 120 ? "..." : ""}`);
      }
    } catch (err: any) {
      console.error(`✗ ${err.message}`);
      process.exitCode = 1;
    }
  })();
}