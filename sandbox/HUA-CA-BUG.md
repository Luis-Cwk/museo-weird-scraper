# Huaca Cron Bug — Debugging Context

## TL;DR

The huaca-agent-autonomo cron is failing with this error on every sky generation:

```
"API error: HTTP 404 (HTTP 404)"
```

The mmx CLI exits with code 1, no stderr detail, after 0.6s. The cron
retries 5 times with exponential backoff (5s/10s/20s/40s) — total ~75s —
then skips the mint and exits.

The cron is now PAUSED. Resume it only after the bug is fixed.

## What we know (verified facts)

### Direct test works
Calling `mmx image generate` directly with the EXACT same args that
agent.js builds works perfectly:

```bash
node "C:\Program Files\nodejs\node_modules\mmx-cli\dist\mmx.mjs" \
  image generate \
  --prompt "<1299-char prompt>" \
  --width 2048 --height 1024 \
  --seed 4046719885 \
  --out /tmp/sky-5480.png \
  --model image-01-live \
  --quiet
# Exit: 0
# Output: 770 KB PNG, 32s
```

Same prompt, same args, same env, same mmx.mjs path.

### Via agent.js fails
The `agent.js --once --limit 1 --skip-scrape` invocation FAILS every
attempt with `exit 1, no detail` in 0.6s. The mmx process exits almost
immediately.

## The candidate that fails

File: `data/scraper-candidates.json` — `m_477cf35bfebcedc0`:

```json
{
  "id": "m_477cf35bfebcedc0",
  "content": "Este \"periodista\" la acaba de cagar completa. Que trauma tendría de niño con un Bogotano este Sr?",
  "type": "quote",
  "aiImpactScore": 9,
  "aiCategory": "other",
  "approved": true
}
```

- `aiCategory: "other"` is NOT in the SKY_CATEGORY_HINT dict → falls back
  to `"environmental disopia, atmospheric distress"`.
- `aiImpactScore: 9` → `band="high"` → `intensity="violent, overwhelming, apocalyptic, raw power"`.
- The content has unescaped `"` (Spanish quotes around periodista).
- The exact prompt is 1299 chars (under 1500 limit).
- The sky filename hash is `5480` → path `textures/sky-5480.png`.

## Code locations (current state, post-revert)

### `C:\Users\petra\museo-weird-scraper\scripts\agent.js`

- Line 295: `function buildSkyPrompt(candidate)` — builds the prompt.
- Line 303-304: `if (prompt.length > 1450) prompt = ... + avoidShort;`
  (existing length guard from the ago-23 fix).
- Line 383-391: `spawnArgs` array passed to spawnSync:
  ```js
  const spawnArgs = [
    "image", "generate",
    "--prompt", prompt,
    "--width", "2048", "--height", "1024",
    "--seed", String(seed),
    "--out", localPath,
    "--model", "image-01-live",  // CURRENT: was image-01, reverted
    "--quiet",
  ];
  ```
- Line 404: `r = spawnSync("node", [MMX_MJS].concat(spawnArgs), { shell: false, timeout: 300000 })`
- Line 412-413: Retry loop with 5s/10s/20s/40s backoff.

### `C:\Users\petra\museo-weird-scraper\build\llm-client.js`

- MiniMax provider added (4th LLM, working).
- NVIDIA 8b is the working primary (Groq/OpenCode 403).
- Used for content curation (NOT image generation).

### `C:\Users\petra\museo-weird-scraper\.env`

- `MiniMax_API_KEY=sk-cp-...` (Code Plan key, LLM only)
- `MiniMax_BASE_URL=https://api.MiniMax.io/v1` (corrected from .chat)
- `MiniMax_MODEL=MiniMax-M3` (corrected from "MiniMax M3")
- `NVIDIA_MODEL=meta/llama-3.1-8b-instruct`

## What was tried this session (2026-08-25 evening)

1. **Added MiniMax as 4th LLM provider** → works, not the issue here.
2. **Changed `--model image-01-live` → `--model image-01`** thinking the
   model was the issue (image-01-live doesn't support width/height per
   mmx-cli docs). Direct test worked, agent.js still failed. **Reverted.**
3. **Debug patch with full spawnSync logging** → wrote to
   `logs/mmx-debug.log`, showed `r.status=1, r.error=null, r.stderr`
   contains `{"error":{"code":1,"message":"API error: HTTP 404 (HTTP 404)"}}`.
   Same command directly doesn't produce this error. **Reverted patch.**
4. **Cleaned up debug log and stray sky-5480.png from sandbox tests** →
   clean state.

## The mystery

Same command, same prompt, same env, same binary, same args. Works
direct, fails via `spawnSync` from agent.js in 0.6s. The mmx-cli's
HTTP 404 is misleading (server returns HTTP 200 with
`base_resp.status_code: 2013` internally; mmx-cli formats it as "HTTP 404").

## Hypotheses to test

1. **stdin/stdout inheritance**: spawnSync with shell:false inherits
   stdio by default. mmx-cli might be reading stdin and exiting on EOF
   or some interactive prompt.

2. **Path with spaces**: `C:\Program Files\nodejs\...` has a space.
   Could mmx-cli mishandle it when invoked via spawnSync vs direct?

3. **Buffer size on stdout/stderr**: maybe mmx-cli is writing a large
   JSON to stdout that gets truncated, and mmx is parsing the truncated
   result as an error.

4. **Working directory difference**: when invoked from agent.js cwd is
   the project root; when invoked directly the cwd might be different
   (especially if I run via subprocess with explicit cwd).

5. **Race condition on temp files**: out file path could be in use
   by another process (we saw this earlier — agent.js had a leftover
   sky-5480.png from a test that caused `mmx` to maybe error).

## Diagnostic request

Please debug this issue:

1. Read `scripts/agent.js` (the spawnSync block is at L404).
2. Read `logs/huaca-run-2026-08-25T21-14-45-629Z.log` for the exact
   failing run output.
3. Read `logs/huaca-run-2026-08-25T21-26-04.log` (the one I just ran
   with debug instrumentation).
4. Try running `agent.js --once --limit 1 --skip-scrape` with
   `stdio: 'inherit'` patched in to see the real stderr.
5. Try invoking mmx with the EXACT argv that agent.js builds (use
   `console.log(JSON.stringify(spawnArgs))` before spawnSync).
6. Compare environment: spawn a child process from Node that does
   `console.log(process.env)` and see if it differs from terminal.
7. Check if mmx-cli has any debug/verbose flag (--verbose maybe).
8. Once you find the root cause, fix it and verify with a manual run.

## End state expected

- agent.js invokes mmx successfully
- Sky generated and uploaded
- Cron can be re-enabled (Petra will do this manually)

## Files to read

- `C:\Users\petra\museo-weird-scraper\scripts\agent.js` (main)
- `C:\Users\petra\museo-weird-scraper\build\llm-client.js` (LLM)
- `C:\Users\petra\museo-weird-scraper\data\scraper-candidates.json`
- `C:\Users\petra\museo-weird-scraper\.env`
- `C:\Users\petra\museo-weird-scraper\logs\huaca-run-2026-08-25T21-14-45-629Z.log`
- `C:\Users\petra\museo-weird-scraper\logs\mmx-debug.log` (created by debug patch, may be empty after revert)
- `C:\Program Files\nodejs\node_modules\mmx-cli\dist\mmx.mjs`
  (the mmx CLI source, ~600 lines minified, search for "image_generation"
  and "image-01")

## DO NOT

- Do NOT commit any changes yet (Petra will review).
- Do NOT re-enable the cron (paused state must remain).
- Do NOT delete the mmx-debug.log if it exists.
- Do NOT modify .env or credentials.
