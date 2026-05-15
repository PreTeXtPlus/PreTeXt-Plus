import json
import os
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from urllib.parse import parse_qs


class Handler(BaseHTTPRequestHandler):
    def _send_json(self, status_code, payload):
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            return self._send_json(200, {"status": "ok"})

        return self._send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/build":
            return self._send_json(404, {"error": "not found"})

        content_length = int(self.headers.get("Content-Length", "0"))
        raw = self.rfile.read(content_length).decode("utf-8")
        data = parse_qs(raw)

        token = data.get("token", [""])[0]
        expected_token = os.environ.get("BUILD_TOKEN", "")

        if not expected_token or token != expected_token:
            return self._send_json(401, {"error": "unauthorized"})

        source = data.get("source", [""])[0]
        build_id = f"local-{abs(hash(source)) % 1000000}"

        payload = {
            "status": "succeeded",
            "build_id": build_id,
            "manifest": {
                "version": 1,
                "build_id": build_id,
                "generated_at": datetime.now(timezone.utc).isoformat(),
                "entrypoint": "index.html",
                "files": [
                    {"path": "index.html", "content_type": "text/html"},
                    {"path": "assets/site.css", "content_type": "text/css"},
                    {"path": "assets/site.js", "content_type": "application/javascript"},
                ],
                "inline_files": {
                    "index.html": "<html><head><link rel='stylesheet' href='assets/site.css'></head><body><h1>Local Builder</h1><script src='assets/site.js'></script></body></html>",
                    "assets/site.css": "body { color: rgb(17, 24, 39); background: rgb(248, 250, 252); }",
                    "assets/site.js": "window.__pretextLocalBuilder = true;",
                },
            },
            "html": "<html><head><link rel='stylesheet' href='assets/site.css'></head><body><h1>Local Builder</h1><script src='assets/site.js'></script></body></html>",
        }

        return self._send_json(200, payload)


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", 4010), Handler)
    server.serve_forever()