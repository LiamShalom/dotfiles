"""Serves the folder that ios-phone-push fills (index.html, manifest.plist, SideShift.ipa) to the
test iPhone over Tailscale. Listens on 127.0.0.1 only; `tailscale serve` puts HTTPS in front.

    python3 -I ios-phone-push-serve.py <folder> <port> <hours>

Answers byte ranges (iOS fetches the app in parts). Stops by itself <hours> after the newest build
was published, and takes the Tailscale address down with it, so nothing is left serving.
"""
import os
import re
import subprocess
import sys
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(sys.argv[1]).resolve()
PORT = int(sys.argv[2])
HOURS = float(sys.argv[3])
TAILSCALE = "/Applications/Tailscale.app/Contents/MacOS/Tailscale"
HTTPS_PORT = os.environ.get("IOS_PHONE_HTTPS_PORT", "8443")
TYPES = {".html": "text/html; charset=utf-8", ".plist": "text/xml", ".ipa": "application/octet-stream",
         ".json": "application/json"}


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def do_HEAD(self):
        self.reply(body=False)

    def do_GET(self):
        self.reply(body=True)

    def reply(self, body):
        name = self.path.split("?")[0].lstrip("/") or "index.html"
        path = ROOT / name
        if "/" in name or name.startswith(".") or path.suffix not in TYPES or not path.is_file():
            self.send_response(404)
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        size = path.stat().st_size
        start, end, status = 0, size - 1, 200
        match = re.fullmatch(r"bytes=(\d*)-(\d*)", self.headers.get("Range", ""))
        if match and (match.group(1) or match.group(2)):
            if match.group(1):
                start = int(match.group(1))
                end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
            else:
                start = max(size - int(match.group(2)), 0)
            if start > end:
                self.send_response(416)
                self.send_header("Content-Range", f"bytes */{size}")
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
            status = 206
        self.send_response(status)
        self.send_header("Content-Type", TYPES[path.suffix])
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(end - start + 1))
        if status == 206:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.end_headers()
        if not body:
            return
        with path.open("rb") as stream:
            stream.seek(start)
            left = end - start + 1
            while left > 0:
                chunk = stream.read(min(left, 1 << 20))
                if not chunk:
                    break
                try:
                    self.wfile.write(chunk)
                except (BrokenPipeError, ConnectionResetError):
                    return
                left -= len(chunk)

    def log_message(self, fmt, *args):
        print(time.strftime("%H:%M:%S"), self.command, self.path, args[1] if len(args) > 1 else "",
              self.headers.get("Range", ""), flush=True)


def expire(server):
    marker = ROOT / "build.json"
    while True:
        time.sleep(60)
        newest = marker.stat().st_mtime if marker.exists() else 0
        if time.time() - newest > HOURS * 3600:
            print("no new build for", HOURS, "h: stopping", flush=True)
            subprocess.run([TAILSCALE, "serve", f"--https={HTTPS_PORT}", "off"], capture_output=True)
            server.shutdown()
            return


server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
threading.Thread(target=expire, args=(server,), daemon=True).start()
server.serve_forever()
