#!/usr/bin/env python3
"""
Regenera preview-N.png de forma ROBUSTA.

Problema: el voxel-N.html carga su cielo desde
  https://petrasynthetic.com/huaca/textures/sky-NNNN.png
y three.js desde jsdelivr. Con `--virtual-time-budget` el reloj virtual de Chrome
avanza mientras la textura de ~1.2 MB sigue en vuelo -> el screenshot captura el
render ANTES de que la textura se aplique y sale una imagen PLANA (un solo color,
35-60 KB en vez de ~1 MB).

Fix: para la captura se inyecta el cielo como data: URI base64, asi el render no
depende de la red. La textura queda disponible antes del primer frame.

Uso:
  python scripts/regen-previews.py 37 33 34          # piezas especificas
  python scripts/regen-previews.py --all             # las 28 de la galeria
  python scripts/regen-previews.py --all --dry-run   # solo reporta
"""
import base64
import os
import re
import subprocess
import sys

D = os.path.dirname(os.path.abspath(__file__))
D = os.path.dirname(D)  # raiz del repo
DEPLOY = os.path.join(D, "deploy", "huaca")

CHROME = next(
    (p for p in (
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ) if os.path.exists(p)),
    None,
)

FLAGS = [
    "--headless=new", "--disable-gpu", "--enable-unsafe-swiftshader",
    "--use-angle=swiftshader", "--hide-scrollbars",
    "--window-size=1280,800", "--virtual-time-budget=30000",
    "--no-sandbox", "--disable-dev-shm-usage",
]


def inline_sky(html):
    """Reemplaza la URL absoluta del cielo por un data: URI base64. Devuelve (html, nombre)."""
    m = re.search(r"https://petrasynthetic\.com/huaca/textures/([A-Za-z0-9_.-]+)", html)
    if not m:
        return html, None
    name = m.group(1)
    local = os.path.join(DEPLOY, "textures", name)
    if not os.path.exists(local):
        # intento con mayusculas/otras extensiones
        alt = [f for f in os.listdir(os.path.join(DEPLOY, "textures"))
               if f.lower() == name.lower()]
        if not alt:
            return html, None
        local = os.path.join(DEPLOY, "textures", alt[0])
        name = alt[0]
    raw = open(local, "rb").read()
    ext = os.path.splitext(local)[1].lower()
    mime = {".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
            ".webp": "image/webp", ".hdr": "image/vnd.radiance"}.get(ext, "image/png")
    data = "data:%s;base64,%s" % (mime, base64.b64encode(raw).decode())
    return html.replace(m.group(0), data), name


def looks_flat(path):
    """True si el PNG es un render fallido (nada dibujado).

    Mide el desvio estandar de la LUMINANCIA sobre una muestra de la imagen, con
    la misma metrica que usa agent.js (previewLuminanceStdDev). Calibrado con los
    60 previews del repo: el unico roto daba 9.1 y el valido mas bajo 26.5, asi
    que el corte en 18 separa limpio en ambos lados.

    OJO: no sirve mirar "fraccion de pixeles no-fondo" — las piezas 33-40 tienen
    cielo fallback (gradiente casi plano) y su imagen entera queda "viva" aunque
    el voxel si este dibujado; esa metrica las marcaba como rotas sin serlo.
    """
    try:
        from PIL import Image
    except ImportError:
        return None
    try:
        im = Image.open(path).convert("L")
        w, h = im.size
        step = max(1, int((w * h / 40000) ** 0.5))
        im = im.resize((max(1, w // step), max(1, h // step)))
        px = list(im.getdata())
        n = len(px)
        mean = sum(px) / n
        var = sum((p - mean) ** 2 for p in px) / n
        sd = var ** 0.5
        print("      sd luminancia = %.1f (corte 18)" % sd)
        return sd < 18.0
    except Exception:
        return None


def regen(num, dry_run=False):
    voxel = os.path.join(DEPLOY, "voxel-%s.html" % num)
    if not os.path.exists(voxel):
        print("  [%s] FALTA el voxel HTML" % num)
        return False
    html = open(voxel, encoding="utf-8", errors="replace").read()
    inlined, sky = inline_sky(html)
    if inlined == html:
        print("  [%s] sin cielo absoluto que inline (se captura igual)" % num)
    if dry_run:
        print("  [%s] dry-run: cielo=%s  bytes_html=%d" % (num, sky, len(inlined)))
        return True

    tmp = os.path.join(DEPLOY, "_cap-%s.html" % num)
    out = os.path.join(DEPLOY, "preview-%s.png" % num)
    open(tmp, "w", encoding="utf-8").write(inlined)
    try:
        url = "file:///" + tmp.replace("\\", "/")
        tmp_shot = os.path.join(DEPLOY, "_shot-%s.png" % num)
        if os.path.exists(tmp_shot):
            os.remove(tmp_shot)
        subprocess.run(
            [CHROME] + FLAGS + ["--screenshot=" + tmp_shot, url],
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=150,
        )
        if not os.path.exists(tmp_shot):
            print("  [%s] Chrome no genero screenshot" % num)
            return False
        size = os.path.getsize(tmp_shot)
        flat = looks_flat(tmp_shot)
        if flat:
            print("  [%s] render PLANO (%.0f KB, stddev bajo) — se descarta" % (num, size / 1024))
            os.remove(tmp_shot)
            return False
        if size < 20000:
            print("  [%s] demasiado chico (%.0f KB) — se descarta" % (num, size / 1024))
            os.remove(tmp_shot)
            return False
        os.replace(tmp_shot, out)
        print("  [%s] OK  preview-%s.png  %.0f KB  cielo=%s  stddev=%s"
              % (num, num, size / 1024, sky, flat))
        return True
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def gallery_pieces():
    """Numeros de pieza referenciados por las tarjetas de index.html."""
    h = open(os.path.join(DEPLOY, "index.html"), encoding="utf-8").read()
    nums = re.findall(r'<iframe[^>]*src="voxel-(\d+)\.html', h)
    if not nums:
        nums = re.findall(r'data-voxel="voxel-(\d+)\.html', h)
    return sorted(set(nums), key=int)


if __name__ == "__main__":
    args = [a for a in sys.argv[1:]]
    dry = "--dry-run" in args
    args = [a for a in args if not a.startswith("--")]
    nums = gallery_pieces() if "--all" in sys.argv else args
    if not CHROME:
        print("No se encontro Chrome/Edge"); sys.exit(1)
    print("Chrome: %s" % CHROME)
    print("Piezas a procesar: %d -> %s" % (len(nums), ",".join(nums)))
    ok = bad = 0
    for n in nums:
        if regen(n, dry_run=dry):
            ok += 1
        else:
            bad += 1
    print("\nresultado: %d regenerados, %d fallidos" % (ok, bad))