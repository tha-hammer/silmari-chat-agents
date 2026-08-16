"""Closure adapter (STAGED PROPOSAL — not wired into the repo).

Derived from the AF-7bv ClosureMap at commit 2b41826d40d36af36c43150af497f8c1ebfe57aa.
Promote deliberately and complete each TODO(promote) before use.
"""

import http.server
import json
import sys

ASYNC_EDGES = []
CONNECTOR = {edge: True for edge in ASYNC_EDGES}
SINK = []


def handle(operation, payload):
    if operation == "/reset":
        SINK.clear()
        CONNECTOR.update({edge: True for edge in ASYNC_EDGES})
        return {"ok": True}
    if operation == "/set_connector":
        CONNECTOR[payload["edge"]] = payload["enabled"]
        return {"ok": True}
    if operation == "/seed_sink":
        SINK.append(payload["value"])
        return {"ok": True}
    if operation == "/seed":
        # TODO(promote): stage source declarations selected by tsconfig.build.json:11.
        return {"ok": True}
    if operation == "/trigger":
        # TODO(promote): invoke package.json build at package.json:129.
        return {"ok": True}
    if operation == "/drive":
        return {"ok": True}
    if operation == "/observe":
        # TODO(promote): return the NodeNext result produced by run at test/package/run.mjs:58.
        return {"ok": True, "value": json.dumps(SINK)}
    return {"ok": False, "error": "unknown op"}


class Handler(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        payload = json.loads(self.rfile.read(length) or "{}")
        output = json.dumps(handle(self.path, payload)).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(output)))
        self.end_headers()
        self.wfile.write(output)

    def log_message(self, *_args):
        pass


http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), Handler).serve_forever()
