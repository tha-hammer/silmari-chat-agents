"""Closure adapter (STAGED PROPOSAL — not wired into the repo).

Derived from the ClosureMap for: the packed @librechat/agents/baml entry exposes
its public types to a real NodeNext TypeScript consumer.
Pin: 2b41826d40d36af36c43150af497f8c1ebfe57aa.
Promote into /home/maceo/ntm_Dev/nodenext-library-2026-08-16-12-15 and complete
each TODO(promote) before use.
"""

import http.server
import json
import sys

ASYNC_EDGES = []
CONNECTOR = {edge: True for edge in ASYNC_EDGES}
SINK = []


def handle(op, payload):
    if op == "/reset":
        SINK.clear()
        CONNECTOR.update({edge: True for edge in ASYNC_EDGES})
        return {"ok": True}
    if op == "/set_connector":
        CONNECTOR[payload["edge"]] = payload["enabled"]
        return {"ok": True}
    if op == "/seed_sink":
        SINK.append(payload["value"])
        return {"ok": True}
    if op == "/seed":
        # TODO(promote): seed src/llm/baml/index.ts and reachable declarations (src/llm/baml/index.ts:1)
        return {"ok": True}
    if op == "/trigger":
        # TODO(promote): invoke package.json build script (package.json:129)
        return {"ok": True}
    if op == "/drive":
        if not CONNECTOR.get(payload["edge"], True):
            return {"ok": True}
        return {"ok": True}
    if op == "/observe":
        # TODO(promote): call run() for the NodeNext consumer (test/package/run.mjs:57,161)
        return {"ok": True, "value": json.dumps(SINK)}
    return {"ok": False, "error": "unknown op"}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        size = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(size) or "{}")
        output = json.dumps(handle(self.path, payload)).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(output)))
        self.end_headers()
        self.wfile.write(output)

    def log_message(self, *_args):
        pass


http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
