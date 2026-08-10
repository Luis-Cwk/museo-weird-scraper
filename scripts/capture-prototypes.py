from playwright.sync_api import sync_playwright
import os
import sys

# Capture each generated prototype as PNG so we can inspect visually
RUN_DIR = r'C:\Users\petra\museo-weird-scraper\data\runs\2026-08-09T18-02-25_Petra_2026'
OUT_DIR = r'C:\Users\petra\museo-weird-scraper\data\prototypes-capture'
os.makedirs(OUT_DIR, exist_ok=True)

htmls = [f for f in os.listdir(RUN_DIR) if f.endswith('.html')]

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 800, 'height': 600})
    for h in htmls:
        path = os.path.join(RUN_DIR, h).replace('\\', '/')
        page.goto(f'http://localhost:8765/{h}', wait_until='domcontentloaded', timeout=30000)
        # Let the animation breathe a bit so the capture shows non-initial state
        page.wait_for_timeout(2000)
        out = os.path.join(OUT_DIR, h.replace('.html', '.png'))
        page.screenshot(path=out, full_page=False)
        print(f'  {h} -> {out} ({os.path.getsize(out)} bytes)')
    browser.close()
print('done')
