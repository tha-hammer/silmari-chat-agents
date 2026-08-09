"""Closure adapter (STAGED PROPOSAL — not wired into the repo).

Derived from the ClosureMap for: a conversation turn submitted to Run.processStream
reaches a provider LLM and its streamed output becomes assistant content parts the
host reads from its content aggregator.

Pin: 1256cdcb060639b64cdd03891c98702acff1ac6e
Repo: /home/maceo/Dev/silmari-chat-agents

Promote into the repo and complete each TODO(promote) before use.
Speaks the 7-op contract apps/closure-oracle already talks to (mock_adapter.py).
"""
import http.server, json, sys

ASYNC_EDGES = []                                   # no is_async edges in this map
CONNECTOR = {e: True for e in ASYNC_EDGES}
SINK = []                                          # Phase-0 /seed_sink target


def handle(op, p):
    if op == "/reset":
        SINK.clear()
        CONNECTOR.update({e: True for e in ASYNC_EDGES})
        return {"ok": True}
    if op == "/set_connector":
        CONNECTOR[p["edge"]] = p["enabled"]
        return {"ok": True}
    if op == "/seed_sink":
        SINK.append(p["value"])
        return {"ok": True}
    if op == "/seed":
        # TODO(promote): seed the graph `messages` channel via messagesStateReducer
        #                with p["data"].
        #                definition: src/messages/reducer.ts:62
        #                channel wiring: src/graphs/Graph.ts:4644-4656 (outer),
        #                                src/graphs/Graph.ts:4459-4471 (inner subgraph)
        return {"ok": True}
    if op == "/trigger":
        # TODO(promote): call Run.processStream(p["args"])
        #                definition: src/run.ts:802
        #                factory:    src/run.ts:603 (Run.create)
        return {"ok": True}
    if op == "/drive":
        if not CONNECTOR.get(p["edge"], True):
            return {"ok": True}                    # oracle disabled = red-at-seam
        # No async edges in this map: processStream drains its own graph stream
        # inside the for-await loop at src/run.ts:1037-1115, and every handler
        # dispatch inside it is awaited (src/run.ts:1086).
        return {"ok": True}
    if op == "/observe":
        # TODO(promote): return json.dumps(<contentParts from createContentAggregator()>)
        #                definition: src/stream.ts:2056
        #                consumer wiring reference: src/scripts/simple.ts:34
        return {"ok": True, "value": json.dumps(SINK)}
    return {"ok": False, "error": "unknown op"}


class Hn(http.server.BaseHTTPRequestHandler):
    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        out = json.dumps(handle(self.path, json.loads(self.rfile.read(n) or "{}"))).encode()
        self.send_response(200)
        self.send_header("Content-Length", str(len(out)))
        self.end_headers()
        self.wfile.write(out)

    def log_message(self, *a):
        pass


http.server.HTTPServer(("127.0.0.1", int(sys.argv[1])), Hn).serve_forever()
