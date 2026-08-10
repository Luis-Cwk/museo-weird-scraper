from playwright.sync_api import sync_playwright
import os

html_path = r'C:\Users\petra\museo-weird-scraper\dist\weird-museo.html'
out_path = r'C:\Users\petra\Desktop\weird-museo-screenshot.png'

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={'width': 1400, 'height': 2000})
    file_url = 'file:///' + html_path.replace('\\', '/')
    page.goto(file_url, wait_until='domcontentloaded', timeout=30000)
    page.wait_for_timeout(4000)  # let images load
    page.screenshot(path=out_path, full_page=True)
    browser.close()

print('saved:', out_path, 'size:', os.path.getsize(out_path), 'bytes')