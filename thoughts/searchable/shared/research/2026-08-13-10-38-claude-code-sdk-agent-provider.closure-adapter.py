"""Closure adapter (STAGED PROPOSAL — not wired into the repo).
Derived from the ClosureMap for: provider registration -> invocation -> tool loop -> observable run step.
Pin: 3f5dc561fc07fe710e9183de7f8a5015bda0751c.
Promote into silmari-chat-agents and complete each TODO(promote) before use.
Speaks the 7-op contract apps/closure-oracle already talks to (mock_adapter.py).
"""
import http.server, json, sys
ASYNC_EDGES = []                                   # no async edges in this chain (all in-process)
CONNECTOR = {e: True for e in ASYNC_EDGES}
SINK = []                                          # Phase-0 /seed_sink target

def handle(op, p):
    if op == "/reset":        SINK.clear(); CONNECTOR.update({e: True for e in ASYNC_EDGES}); return {"ok": True}
    if op == "/set_connector": CONNECTOR[p["edge"]] = p["enabled"]; return {"ok": True}
    if op == "/seed_sink":     SINK.append(p["value"]); return {"ok": True}
    if op == "/seed":
        # TODO(promote): populate llmProviders via registerChatModel(provider, ctor) with p["data"]
        #                (src/llm/providers.ts:48-61, src/llm/baml/index.ts:10)
        return {"ok": True}
    if op == "/trigger":
        # TODO(promote): call initializeModel({ provider, clientOptions, tools }) with p["args"]
        #                (src/llm/init.ts:18-63)
        return {"ok": True}
    if op == "/drive":
        if not CONNECTOR.get(p["edge"], True): return {"ok": True}  # oracle disabled = red-at-seam
        # No async driver required — chain is fully synchronous within attemptInvoke/streamEvents.
        return {"ok": True}
    if op == "/observe":
        # TODO(promote): return json.dumps(<host's ON_RUN_STEP/CHAT_MODEL_STREAM handler capture>())
        #                (src/run.ts:1024,1037-1087)
        return {"ok": True, "value": json.dumps(SINK)}
    return {"ok": False, "error": "unknown op"}

class Hn(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        out = json.dumps(handle(self.path, json.loads(self.rfile.read(n) or "{}"))).encode()
        self.send_response(200); self.send_header("Content-Length", str(len(out))); self.end_headers(); self.wfile.write(out)
    def log_message(self, *a): pass
http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), Hn).serve_forever()
