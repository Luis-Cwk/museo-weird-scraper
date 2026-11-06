import dotenv from "dotenv";
dotenv.config();

/**
 * MUSEO WEIRD — X (Twitter) API v2 client
 *
 * Uses OAuth 1.0a user context (4-token) for read access.
 * Auth header: HMAC-SHA1 signed with consumer_key + access_token.
 *
 * Endpoints used:
 *   GET /2/tweets/search/recent  — last 7 days, up to 100 per query
 *   GET /2/users/me              — verify credentials
 *
 * Cost: ~10 credits per search query (Basic tier), ~1 per user lookup.
 *       With $5 credit ≈ 50k credits = thousands of queries.
 */

const API_BASE = "https://api.twitter.com";

function getCreds() {
  const ck = process.env.X_API_KEY || "";
  const cs = process.env.X_API_SECRET || "";
  const at = process.env.X_ACCESS_TOKEN || "";
  const ats = process.env.X_ACCESS_SECRET || "";
  if (!ck || !cs || !at || !ats) {
    throw new Error("X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET must be set in .env");
  }
  return { ck, cs, at, ats };
}

function base64UrlEncode(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  // btoa works in Node's webcrypto context
  return Buffer.from(bin, "binary").toString("base64");
}

async function hmacSha1(key: string, msg: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    enc.encode(key),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, enc.encode(msg));
  return base64UrlEncode(sig);
}

function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

async function oauthHeader(method: string, url: string, bodyParams: Record<string, string> = {}): Promise<string> {
  const { ck, cs, at, ats } = getCreds();

  const oauthParams: Record<string, string> = {
    oauth_consumer_key: ck,
    oauth_nonce: Math.random().toString(36).slice(2) + Date.now().toString(36),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: at,
    oauth_version: "1.0",
  };

  // Combine oauth + body params for signature
  const allParams: Record<string, string> = { ...oauthParams, ...bodyParams };
  const sorted = Object.keys(allParams).sort().map((k) => `${percentEncode(k)}=${percentEncode(allParams[k])}`);
  const paramStr = sorted.join("&");
  const baseStr = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramStr)}`;
  const sigKey = `${percentEncode(cs)}&${percentEncode(ats)}`;
  const sig = await hmacSha1(sigKey, baseStr);

  oauthParams.oauth_signature = sig;

  const headerParts = Object.keys(oauthParams).sort().map(
    (k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`
  );
  return `OAuth ${headerParts.join(", ")}`;
}

export interface RawXPost {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  lang?: string;
  public_metrics?: {
    like_count: number;
    retweet_count: number;
    reply_count: number;
    quote_count: number;
  };
  // We populate this from a separate /users lookup if needed
  author_handle?: string;
}

export interface XSearchResult {
  posts: RawXPost[];
  result_count: number;
  next_token?: string;
  cost_credits_estimate: number;
}

/**
 * Verify the credentials are valid. Returns username, or throws.
 */
export async function verifyCredentials(): Promise<{ id: string; username: string; name: string }> {
  const url = `${API_BASE}/2/users/me`;
  const hdr = await oauthHeader("GET", url);
  const res = await fetch(url, { headers: { Authorization: hdr } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`X verifyCredentials failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data: any = await res.json();
  return { id: data.data.id, username: data.data.username, name: data.data.name };
}

/**
 * Search recent tweets (last 7 days). Returns up to `maxResults` (10-100).
 *
 * query: X search query string. Supports operators like:
 *   "violencia medellin lang:es -is:retweet"
 *
 * Cost: ~10 credits per request (results_count doesn't matter for cost).
 */
export async function searchRecent(
  query: string,
  options: { maxResults?: number; lang?: string; nextToken?: string } = {}
): Promise<XSearchResult> {
  const maxResults = Math.min(Math.max(options.maxResults ?? 10, 10), 100);

  const params: Record<string, string> = {
    query: options.lang ? `${query} lang:${options.lang}` : query,
    max_results: String(maxResults),
    "tweet.fields": "created_at,lang,public_metrics,author_id",
  };
  if (options.nextToken) params.next_token = options.nextToken;

  // Para OAuth 1.0a: el query string se incluye en la firma, la URL se construye
  // con los params percent-encoded (cada key=value percent-encoded, joined con &)
  const sortedParamPairs = Object.keys(params).sort().map(k => `${percentEncode(k)}=${percentEncode(params[k])}`);
  const queryString = sortedParamPairs.join("&");
  const url = `${API_BASE}/2/tweets/search/recent`;

  // Firmar incluyendo los query params como bodyParams (asi oauthHeader los mete a la signature)
  const hdr = await oauthHeader("GET", url, params);
  const fullUrl = `${url}?${queryString}`;
  const res = await fetch(fullUrl, { headers: { Authorization: hdr } });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`X searchRecent failed (${res.status}): ${t.slice(0, 300)}`);
  }

  const data: any = await res.json();
  return {
    posts: (data.data || []) as RawXPost[],
    result_count: data.meta?.result_count ?? 0,
    next_token: data.meta?.next_token,
    cost_credits_estimate: 10, // Search recent = ~10 credits per call
  };
}

/**
 * Lookup usernames by ID. Used to enrich posts with author handles.
 * Costs ~1 credit per call (up to 100 IDs).
 */
export async function usersById(ids: string[]): Promise<Record<string, string>> {
  if (ids.length === 0) return {};
  const params: Record<string, string> = { ids: ids.join(","), "user.fields": "username" };
  const sortedParamPairs = Object.keys(params).sort().map(k => `${percentEncode(k)}=${percentEncode(params[k])}`);
  const queryString = sortedParamPairs.join("&");
  const url = `${API_BASE}/2/users`;

  const hdr = await oauthHeader("GET", url, params);
  const fullUrl = `${url}?${queryString}`;
  const res = await fetch(fullUrl, { headers: { Authorization: hdr } });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(`X usersById failed (${res.status}): ${t.slice(0, 200)}`);
  }
  const data: any = await res.json();
  const map: Record<string, string> = {};
  for (const u of data.data || []) map[u.id] = u.username;
  return map;
}

// --- Self-test ---
if (require.main === module) {
  (async () => {
    console.log("X client self-test\n");
    try {
      const me = await verifyCredentials();
      console.log(`✓ Auth OK as @${me.username} (id=${me.id})`);

      const result = await searchRecent("violencia medellin", { maxResults: 10, lang: "es" });
      console.log(`✓ Search returned ${result.posts.length} posts (cost ~${result.cost_credits_estimate} credits)`);

      for (const p of result.posts.slice(0, 3)) {
        console.log(`\n  [${p.created_at}] ${p.text.slice(0, 120)}${p.text.length > 120 ? "..." : ""}`);
      }

      if (result.posts.length > 0) {
        const ids = [...new Set(result.posts.map((p) => p.author_id))];
        const handles = await usersById(ids);
        console.log(`\n✓ Resolved ${Object.keys(handles).length} author handles`);
        for (const p of result.posts.slice(0, 3)) {
          const h = handles[p.author_id] || "unknown";
          console.log(`  @${h}: ${p.text.slice(0, 80)}`);
        }
      }
    } catch (err: any) {
      console.error(`✗ ${err.message}`);
      process.exitCode = 1;
    }
  })();
}
