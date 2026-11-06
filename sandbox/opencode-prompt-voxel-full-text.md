# OpenCode task: Fix Huaca voxel pipeline to show COMPLETE curated text

## Context
Working directory: `C:\Users\petra\museo-weird-scraper`
Branch: agent-main
Last iteration: We increased the text budget from 8×20=160 chars to 14×25=350 chars in `wrappedLines()`. The META.content now contains the FULL curated text. But the voxel still gets visually clipped — the camera cuts off the bottom 1-3 lines of any text longer than ~160 chars.

I've already identified the root cause: when text is long (>100 chars), the voxel mesh has 16+ lines (height ≈ 172 pixels). With cellSize=0.26 (the current default for ≥60 chars), the resulting 3D sculpture is too big for the camera frustum at common aspect ratios (16:9, 21:9, etc.), and the camera clips off the bottom.

## Goal
Make the voxel render COMPLETELY (all lines visible) for ANY text length up to the 350-char budget. Text must never be cut off mid-phrase.

## Constraints
- DO NOT touch `scripts/agent.js`, `scripts/huaca-cron.js`, `scripts/agent-renew.js`, `scripts/llm-client.ts`, `scripts/mint-and-list.ts`, `scripts/scraper.ts`, `scripts/bluesky-client.ts`, `scripts/x-client.ts`, `scripts/quote-guard.ts`
- DO NOT touch `smart-contracts/`
- DO NOT touch `deploy/huaca/.ftp_stash.json`, `deploy/huaca/.upload_stash.json`
- DO NOT touch `.env`
- DO NOT regenerate any skies (no API calls)
- DO NOT upload anything to FTP
- DO NOT re-mint any tokens
- DO NOT touch gallery HTML/CSS
- Only modify `scripts/generate-three.ts` (the voxel generator)
- Backup naming: `generate-three.ts.bak-voxel-fit-<YYYYMMDD>`

## Files to read first
1. `scripts/generate-three.ts` — the voxel generator. Look specifically at:
   - `planVoxelLayout()` around line 333: assigns `cellSize`, `depth`, `centerZ` based on text length
   - `fitToViewport()` in the HTML body: computes camera distance from `sculptureWidth × sculptureHeight`
   - `wrappedLines()` around line 146: now allows up to 22 lines (soft cap)
   - `sampleTextToVoxelsMultiline()` around line 320: stacks lines vertically
2. `scripts/post-generate-patch.py` to understand what gets uploaded to deploy
3. An example voxel HTML in `build/data/runs/2026-08-28T04-31-55_Petra_2026/t_3decaa2ba921d06c.html`

## Reference data
Test text: "Seis especies de árboles serían claves para combatir la contaminación del aire en Medellín, según estudio de la UdeA. Investigadores de la UdeA estudiaron seis especies que tienen cualidades relacionadas con la calidad del aire." (228 chars)

Expected behavior after fix:
- The voxel HTML should contain 16 lines of pixels (y from 0 to 172)
- The render in any 16:9 viewport (e.g. 1920×1080) should show ALL 16 lines
- The sky background should still cover the viewport without distortion
- Short texts (≤60 chars) should remain visually unchanged (same cellSize 0.30 or 0.45)

## Recommended approach (NOT MANDATORY — your call)
The simplest fix is to make `planVoxelLayout()` shrink `cellSize` for long texts so the resulting voxel mesh fits inside the camera frustum. The current branch thresholds are:
- `<30 chars` → cellSize 0.45
- `<60 chars` → cellSize 0.30
- `≥60 chars` → cellSize 0.26 (TOO BIG for >100-char texts)

A good rule of thumb: for a text of length L, pick cellSize so that `(L/25) * cellSize * 1.5 ≤ viewport_height_unit`. For a typical 1080p viewport at 16:9, viewport_height_unit ≈ 5 world units, so cellSize ≈ 5 / ((L/25) × 1.5) ≈ 83 / L.

But instead of computing exact viewport math, just empirically pick safe cellSize values for each length bracket (e.g. 0.20 for 100-180 chars, 0.16 for 180-260 chars, 0.13 for >260 chars).

You could also fix it from the camera side: in `fitToViewport()`, compute the camera distance differently for tall sculptures (use `Math.max(distForWidth, distForHeight, baseDist)` instead of the current logic if needed). Pick whichever approach feels cleaner.

## Verification steps
After your changes:

1. Build: `cd "C:\Users\petra\museo-weird-scraper" && npm run build` (should pass without TS errors)
2. Test pipeline:
   ```bash
   cd "C:\Users\petra\museo-weird-scraper"
   node -e 'const {generateThreeArtwork} = require("./build/scripts/generate-three.js"); (async()=>{const out=await generateThreeArtwork({content:"Seis especies de árboles serían claves para combatir la contaminación del aire en Medellín, según estudio de la UdeA. Investigadores de la UdeA estudiaron seis especies que tienen cualidades relacionadas con la calidad del aire.",category:"other",attribution:"Anonymous",source:"test",sourceUrl:"about:test"}); console.log("voxelCount:",out.voxelCount); const fs=require("fs"); const html=fs.readFileSync(out.htmlPath,"utf-8"); const m=html.match(/"pixels":\[(.*?)\]/); if(m){const coords=[...m[1].matchAll(/\{"x":(-?\d+),"y":(-?\d+)\}/g)]; const ys=coords.map(c=>parseInt(c[2])); console.log("Lines (y range):", Math.min(...ys), "to", Math.max(...ys)); console.log("Total pixels:", coords.length);}})().catch(e=>console.error(e));'
   ```
   Expected output: voxelCount > 5000, y range 0 to 172 (16 lines worth of pixels).
3. Run the agent self-test if applicable:
   ```bash
   cd "C:\Users\petra\museo-weird-scraper" && npx ts-node scripts/generate-three.ts
   ```

4. Report:
   - Exact lines of code changed in `planVoxelLayout()` (or wherever)
   - Build output (success or error)
   - Test output from step 2
   - Any concerns about viewport math (different aspect ratios)

When done, just commit your changes. Don't touch git config. Don't push. Don't merge.

## What NOT to do
- Do NOT add any new API calls
- Do NOT change the prompt logic in `quote-guard.ts`
- Do NOT change the SmartTruncate behavior (it's already at 350 chars)
- Do NOT regenerate skies
- Do NOT upload to FTP
- Do NOT modify the gallery HTML
