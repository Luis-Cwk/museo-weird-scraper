"""Tiny HTTP server that accepts POST with a base64 PNG and saves it."""
import http.server
import os
import base64
import json
from urllib.parse import urlparse

OUT_DIR = r'C:\Users\petra\museo-weird-scraper\data\prototypes-capture'
os.makedirs(OUT_DIR, exist_ok=True)

class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body = self.rfile.read(length).decode('utf-8')
        try:
            payload = json.loads(body)
            b64 = payload.get('data', '').split(',', 1)[-1]
            fname = payload.get('filename', 'capture.png')
            out = os.path.join(OUT_DIR, fname)
            with open(out, 'wb') as f:
                f.write(base64.b64decode(b64))
            self.send_response(200)
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(f'saved:{out}'.encode())
            print(f'saved {out} ({os.path.getsize(out)} bytes)', flush=True)
        except Exception as e:
            self.send_response(400)
            self.end_headers()
            self.wfile.write(str(e).encode())

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def log_message(self, *args):
        pass  # silent

print(f'saving PNGs to {OUT_DIR}', flush=True)
http.server.HTTPServer(('localhost', 8769), Handler).serve_forever()
