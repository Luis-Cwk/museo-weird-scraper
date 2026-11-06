"""Build a 360-aware panorama prompt for mmx image-01.

Per Petra's QA (2026-08-19): the previous prompt was plain and let mmx
generate a non-equirectangular image, breaking the wrap continuity.
This one explicitly asks for seamless 360 equirectangular continuity.

Tokens for negative space are inlined as "avoid: …" because the mmx
CLI on this machine does not expose --negative_prompt (verified 2026-08-19:
`mmx image generate --help` lists --prompt, --width/height, --seed,
--prompt-optimizer, but no negative-prompt flag).
"""
import re

# Tokens to bake in for seam + continuity + 360 authenticity
_SEAM_TOKENS = [
    "seamless 360 degree equirectangular panorama",
    "perfect horizontal wrap continuity",
    "left edge and right edge of the frame must match seamlessly when wrapped to a sphere",
    "no visible seam line at the wrap point",
    "single continuous 360 photograph taken with a 360 camera in one take",
    "no horizon line crossing the upper third or lower third",
    "the nadir and zenith are blurred gradient without recognizable landscape detail",
]

# Tokens to AVOID — mmx doesn't support negative_prompt, so we use "avoid: …"
_AVOID_TOKENS = [
    "no visible stitch seam",
    "no distorted or stretched subject near the edges",
    "no mismatch between left edge and right edge",
    "no double exposure, no ghosting, no blurred horizon",
    "no low resolution stretching artifacts at the wrap point",
    "no hard transition at the seam between left-most and right-most columns",
]


def _strip_accents(s):
    nfkd = s.encode("ascii", "ignore").decode("ascii")
    return nfkd


def build_sky_prompt_v2(content, category="other", impact=5, attribution="", source=""):
    """Return the new A+D prompt for one candidate.

    Args:
        content: the curated LLM text about the climate/urban anomaly
        category: one of PALETTES keys (or "other")
        impact: 1..10 (drives intensity word)
        attribution: reporter/source name
        source: source label (bsky, twitter, etc.)
    """
    # Reuse the agent.js's anchor + intensity logic (kept in spirit; lets the new
    # prompt inherit the curated content choice).
    band = "high" if impact >= 8 else "medium" if impact >= 6 else "low"
    intensity = {
        "high": "high intensity, dramatic sky, oppressive atmosphere",
        "medium": "medium intensity, overcast sky, uneasy atmosphere",
        "low": "low intensity, pale sky, lingering unease",
    }[band]
    nouns = re.findall(r"[A-Z][a-zA-Záéíóúñü]{2,}", content or "")
    nouns = [n for n in nouns if n not in {"The", "This", "That", "With", "From", "Una", "Un", "El", "La", "Los", "Las"}]
    scene_features = ", ".join(nouns[:6]) if nouns else (category or "rare climate anomaly")
    cue = (content or "").strip()[:140]

    parts = []
    parts.extend(_SEAM_TOKENS)
    parts.append(f"scene features: {scene_features}")
    parts.append(f"environment reference: {scene_features}")
    parts.append(intensity)
    parts.append("panoramic 2:1 equirectangular photograph, 360 degrees, full sphere")
    parts.append("no human figures, no text or labels, no logos")
    parts.append("clean zenith gradient to pale haze")
    parts.append("clean nadir gradient to soft blur")
    parts.append("asymmetric composition: subject of interest offset from center, NOT centered")
    parts.append("single frame photograph, cinematic detail")
    parts.append(f"atmospheric context: '{cue}'")
    # Negative space inlined — mmx CLI has no --negative_prompt
    parts.append("avoid: " + ", ".join(_AVOID_TOKENS))

    prompt = ", ".join(parts)
    return _strip_accents(prompt)


if __name__ == "__main__":
    sample = ("Un deslizamiento en el barrio Granizal de Medellín dejó 8 muertos y daños "
              "estructurales en al menos 25 viviendas, ciudad rodeada de montañas andinas, "
              "trasladaron a los heridos a centros hospitalarios, vía cerrada totalmente")
    p = build_sky_prompt_v2(sample, category="deslizamiento", impact=9,
                           attribution="Redactor", source="bsky:redactor")
    print(p)
