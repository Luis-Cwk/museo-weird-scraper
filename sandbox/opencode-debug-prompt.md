You are debugging a broken p5.js flower-rain overlay on `petrasynthetic.com/huaca/`. The overlay is supposed to show real PNG flowers (12 distinct images) falling across the viewport with rotation and wind drift. **None of the flowers ever appear** in production. The browser console throws the same error every frame at 60fps:

```
Uncaught TypeError: Cannot read properties of undefined (reading 'width')
    value  p5.min.js:2
    image  p5.min.js:2
    draw   petrasynthetic.com/huaca/:937
    draw   petrasynthetic.com/huaca/:958
    _draw  p5.min.js:2   ← loops every frame, indefinitamente
    <anonymous>  petrasynthetic.com/huaca/:968
```

The error happens **only after a few frames**, not on the first draw. Network tab shows all 12 PNGs returning 200 OK with `image/png`. Canvas is created correctly (1262×624 px). Yet the canvas body only renders ~17KB of PNG data → essentially blank.

## Your task

Find the **root cause** of the `width` error and the missing flowers. Don't just describe the bug — pinpoint the line, the condition that triggers it, and a CONCRETE FIX (1–5 lines if possible). Output a bullet list with:
- WHERE (file + line number) the trigger lives
- WHY it fails (what condition/state)
- HOW to fix (concrete edit, not a 30-line rewrite)

## Files to read (in order)

1. `C:/Users/petra/museo-weird-scraper/deploy/huaca/index.html` — the deployed production HTML (54,366 bytes, SHA `0816e6c5...ce3`)
2. Inside, find:
   - The `FLORES_FILES` array (~line 855) — list of 12 PNG paths
   - The `const sketch = (p) => { ... }` block — the p5 instance mode factory
   - `loadAllFlowers()` — the Promise.allSettled loader
   - `class FlowerFlake` — the per-flake class with `init()`, `update()`, `draw()`
   - `p.setup()` and `p.draw()` — the lifecycle hooks
   - `new p5(sketch, document.getElementById('floresCanvas'))` — the instantiation line at the bottom (~line 984)
3. The CSS block around line 119–135 (the `.ob-overlay`, `#floresCanvas`, `.ob-section`, `.ob-hero` rules).

## Known facts (already verified, do NOT re-investigate)

- All 12 PNGs are reachable: HTTP 200, Content-Type: image/png (curl -sI on each returned proper values).
- The HTML container `<div id="floresCanvas">` exists.
- `validateStructure()` from `lib/validations.js` accepts the file (DOCTYPE, >50 bytes, scripts on cdn.jsdelivr.net allowlist).
- The deployed HTML is identical to the local file (same SHA, 54,366 bytes).
- A "fix" was attempted at lines 881–895 (loadAllFlowers) and lines 941–957 (draw) — added `naturalWidth > 0` guards — but it didn't resolve the runtime error.
- `p.preload()` is NOT used (comment confirms, and there's no preload assignment).
- `p.images[]` and `p.flakes[]` are stored as instance properties of p, not closure locals.
- `p.clear()` is used for transparency; `pixelDensity(1)` is set.

## Things to investigate

Focus on these specifically (they're the most likely culprits):

1. **The flake lifecycle**: In `draw()`, `p.flakes[i].draw()` is called before `p.flakes[i].update()`. Does the `imgIdx` get re-initialized correctly when a flake goes off-screen (the `init()` at the end of `update()`)?
2. **Timing**: When `p.setup()` calls `new FlowerFlake(p)`, `p.images` is empty (Promise hasn't resolved). All flakes get `imgIdx = -1`. After `loadAllFlowers().then(...)`, all flakes re-init. But between those two moments, `draw()` runs every frame, calling `draw()` on flakes with `imgIdx = -1`. Does the early-return actually protect against the empty-state condition?
3. **The error mentions `draw :937` AND `draw :958`.** Line 937 is the `p.image()` call. Line 958 is the `for` loop in `p.draw()`. Between them could be an intermediate frame where the flake goes off-screen, re-inits with `imgIdx = -1`... but the next `draw()` call before the next re-init hits `p.image(-1 → undefined)`. Verify this theory.
4. **`update()` calls `this.init()` when the flake goes off-screen** (lines 924–927). But `init()` runs synchronously and immediately reassigns `this.imgIdx` based on `p.images[loadedIdx]`. What if `p.images[i]` is the `HTMLImageElement` for which `onload` hasn't fired yet? The current `onload` guard (`if (naturalWidth > 0)`) only sets `p.images[i] = null` for empty images — but for pending images, `p.images[i]` stays `undefined` until `onload` fires. So `p.images[loadedIdx]` could be `undefined` (not null, not the image). The flake's `imgIdx` then points to an undefined slot.
5. **Alternative theory**: p5 v1.11's `p.image()` may behave differently when given a raw HTMLImageElement vs a p5.Image. The error message "u is undefined" suggests p5 is trying to access `img.width` (not `img.naturalWidth`) and the `img.width` getter requires the DOM image to have completed layout. Does the documentation for p5 v1.11 say anything about pre-loading before draw?

## Constraints

- Do NOT rewrite the file. Output ONLY a bullet-point diagnosis.
- Be precise about line numbers (use them from the deployed index.html, not line counts).
- If your fix needs new code, paste the exact replacement (≤5 lines).
- If the root cause is outside the JS (e.g., CSS z-index, container visibility, opacity), say so explicitly.

## Output format

```
## Root cause
WHERE: file:line
WHY: …
FIX:
```js
// exact replacement
```
```

You may also add "secondary issues" or "warnings" but the lead bullet must answer the question "why don't the flowers render?". Keep total output under ~600 words.