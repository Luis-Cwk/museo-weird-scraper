"""
Generate a test HDRI for Huaca using ComfyUI with the realismEngineSDXL_v30VAE checkpoint.
Outputs to sandbox/2026-08-28-comfy-hdri-fallback/.

Workflow (minimal txt2img):
  CheckpointLoaderSimple -> CLIPTextEncode(+) -> KSampler -> VAEDecode -> SaveImage
                            CLIPTextEncode(-)
                            EmptyLatentImage
"""

import json
import time
import urllib.request
import urllib.error
import os
import sys
import shutil

BASE = "http://127.0.0.1:8188"
CHECKPOINT = "realismEngineSDXL_v30VAE.safetensors"
PROMPT = (
    "cinematic landscape photograph, blood-red sky, towering cumulus clouds, "
    "single jagged lightning bolt in the upper left, dramatic storm core, "
    "horizon glowing with warm orange sunset, deep crimson heavens, "
    "ominous apocalyptic mood, vast grassland in the foreground with "
    "silhouetted dry grasses, ultra-detailed, photographic, 16:9 aspect ratio"
)
NEGATIVE = (
    "panoramic, equirectangular, 360, fisheye, distorted, warped, "
    "blurry, low quality, watermark, text, logo, people, "
    "cartoon, illustration, painting, anime"
)
WIDTH = 1152   # 16:9 SDXL-native friendly
HEIGHT = 640   # (W*H = 737,280 px, fits 8GB VRAM with room for KSampler)
STEPS = 25
CFG = 7.0
SEED = 796730416   # same as the Huaca SEED for a piece — deterministic
SAMPLER = "euler_ancestral"
SCHEDULER = "normal"

OUT_DIR = r"C:\Users\petra\museo-weird-scraper\sandbox\2026-08-28-comfy-hdri-fallback"
os.makedirs(OUT_DIR, exist_ok=True)


def post(path, body):
    req = urllib.request.Request(
        BASE + path,
        data=json.dumps(body).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def get(path):
    with urllib.request.urlopen(BASE + path, timeout=30) as r:
        return json.loads(r.read().decode("utf-8"))


def main():
    workflow = {
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": SEED,
                "steps": STEPS,
                "cfg": CFG,
                "sampler_name": SAMPLER,
                "scheduler": SCHEDULER,
                "denoise": 1.0,
                "model": ["4", 0],
                "positive": ["6", 0],
                "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "4": {
            "class_type": "CheckpointLoaderSimple",
            "inputs": {"ckpt_name": CHECKPOINT},
        },
        "5": {
            "class_type": "EmptyLatentImage",
            "inputs": {"width": WIDTH, "height": HEIGHT, "batch_size": 1},
        },
        "6": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": PROMPT, "clip": ["4", 1]},
        },
        "7": {
            "class_type": "CLIPTextEncode",
            "inputs": {"text": NEGATIVE, "clip": ["4", 1]},
        },
        "8": {
            "class_type": "VAEDecode",
            "inputs": {"samples": ["3", 0], "vae": ["4", 2]},
        },
        "9": {
            "class_type": "SaveImage",
            "inputs": {"filename_prefix": "huaca_hdri", "images": ["8", 0]},
        },
    }

    print(f"Submitting workflow: checkpoint={CHECKPOINT}")
    print(f"  prompt: {PROMPT[:120]}...")
    print(f"  size: {WIDTH}x{HEIGHT}, steps={STEPS}, cfg={CFG}, seed={SEED}, sampler={SAMPLER}")

    r = post("/prompt", {"prompt": workflow, "client_id": "opencode-test"})
    prompt_id = r.get("prompt_id")
    if not prompt_id:
        print("ERROR: no prompt_id returned:", r)
        sys.exit(1)
    print(f"  prompt_id = {prompt_id}")

    # Poll history until done
    for attempt in range(180):  # up to 6 min
        time.sleep(2)
        try:
            h = get(f"/history/{prompt_id}")
        except Exception as e:
            print(f"  poll {attempt}: {e}")
            continue
        if prompt_id in h:
            entry = h[prompt_id]
            status = entry.get("status", {})
            if status.get("completed", False):
                outputs = entry.get("outputs", {})
                images = outputs.get("9", {}).get("images", [])
                if not images:
                    print("ERROR: completed but no image output")
                    print(json.dumps(entry, indent=2)[:1000])
                    sys.exit(1)
                print(f"  done in {attempt * 2}s, {len(images)} image(s)")
                return images
            if status.get("status_str") == "error":
                print("ERROR: workflow failed")
                print(json.dumps(entry, indent=2)[:2000])
                sys.exit(1)
        if attempt % 5 == 0:
            print(f"  poll {attempt}: still running...")

    print("ERROR: timed out after 6 min")
    sys.exit(1)


if __name__ == "__main__":
    images = main()
    # Download each image to OUT_DIR
    for i, img in enumerate(images):
        filename = img["filename"]
        subfolder = img.get("subfolder", "")
        src_url = f"{BASE}/view?filename={filename}&type=output&subfolder={subfolder}"
        out_path = os.path.join(OUT_DIR, filename)
        with urllib.request.urlopen(src_url, timeout=60) as r:
            with open(out_path, "wb") as f:
                shutil.copyfileobj(r, f)
        size_kb = os.path.getsize(out_path) / 1024
        print(f"saved :: {out_path}  ({size_kb:.1f} KB)")
