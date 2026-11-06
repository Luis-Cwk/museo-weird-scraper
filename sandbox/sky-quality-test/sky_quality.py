"""
Sky quality tools for huaca per-piece sky pipeline.
- measure_seam_diff(path): returns numerical seam error (0 = perfect wrap, >1 = bad)
- fix_seam(path, mode="blend"): writes a seam-fixed copy, returns new path
"""
import sys, os, math
from PIL import Image
import numpy as np

def measure_seam_diff(path):
    """Measure how different the leftmost and rightmost columns of an equirectangular PNG are.
    Returns a dict with metrics. Smaller = better wrap continuity."""
    img = Image.open(path).convert("RGB")
    arr = np.array(img)
    h, w, _ = arr.shape
    left = arr[:, 0, :].astype(np.float32)
    right = arr[:, -1, :].astype(np.float32)
    # Direct column diff (raw)
    raw_diff = float(np.mean(np.abs(left - right)))
    # Avg pooled diff (5px taper — what the eye sees at the seam)
    left_taper = np.mean(arr[:, :5, :].astype(np.float32), axis=1)
    right_taper = np.mean(arr[:, -5:, :].astype(np.float32), axis=1)
    taper_diff = float(np.mean(np.abs(left_taper - right_taper)))
    return {
        "path": path,
        "size": [w, h],
        "raw_col_diff": round(raw_diff, 3),
        "tapered_diff": round(taper_diff, 3),
        "verdict": "OK" if taper_diff < 15 else ("WARN" if taper_diff < 35 else "BAD"),
    }


def fix_seam(path, out_path=None, mode="blend", feather=24):
    """Post-process the equirectangular PNG to fix the seam.
    mode='blend': force left and right edge columns to be the same by averaging them,
                  then feather the blend inward over `feather` pixels.
    mode='mirror': mirror-copy left edge into right edge (and vice versa).
    Returns out_path.
    """
    img = Image.open(path).convert("RGB")
    arr = np.array(img)
    h, w, _ = arr.shape
    left_col = arr[:, 0:1, :].astype(np.float32)
    right_col = arr[:, -1:, :].astype(np.float32)
    avg = (left_col + right_col) / 2.0
    target = np.broadcast_to(avg, (h, 1, 3))  # column vector of avg color
    arr2 = arr.astype(np.float32).copy()
    if mode == "blend":
        # Overwrite both edges with avg, then blend with the original image
        # moving inward by `feather` pixels.
        f = feather
        # Left edge: column 0 gets fully replaced; feathered blend for cols 1..f
        for col in range(0, f + 1):
            t = col / f if col > 0 else 1.0  # weight of the target color
            arr2[:, col, :] = (1 - t) * arr[:, col, :] + t * target[:, 0, :]
        # Right edge: column w-1 gets fully replaced; blend for cols w-f-1..w-2
        for i, col in enumerate(range(w - f - 1, w - 1)):
            t = (i + 1) / f
            arr2[:, col, :] = (1 - t) * arr[:, col, :] + t * target[:, 0, :]
        arr2[:, w - 1, :] = target[:, 0, :]
    elif mode == "mirror":
        arr2[:, 0, :] = target[:, 0, :]
        arr2[:, w - 1, :] = target[:, 0, :]
        # Mirror right-edge inward for `feather` cols
        for i in range(1, feather + 1):
            arr2[:, i, :] = arr2[:, 0, :]
            arr2[:, w - 1 - i, :] = arr2[:, w - 1, :]
    else:
        raise ValueError(f"unknown mode: {mode}")
    out = out_path or (os.path.splitext(path)[0] + ".seamfixed.png")
    Image.fromarray(np.clip(arr2, 0, 255).astype(np.uint8)).save(out)
    return out


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "measure" and len(sys.argv) >= 3:
        print(measure_seam_diff(sys.argv[2]))
    elif cmd == "fix" and len(sys.argv) >= 3:
        out = fix_seam(sys.argv[2])
        print(out)
    else:
        print(__doc__)
