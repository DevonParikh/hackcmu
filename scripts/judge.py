#!/usr/bin/env python3
"""A local evidence-relevance judge, distilled from Gemini's own verdicts.

  pip install sentence-transformers scikit-learn joblib
  node scripts/export-pairs.mjs          # data/pairs.jsonl from Mongo (needs ~200+ pairs; more sites = better)
  python3 scripts/judge.py train         # → data/judge.pkl, prints cross-validated accuracy
  python3 scripts/judge.py serve         # http://127.0.0.1:8787/judge ; then set JUDGE_URL in .env and restart next

Features: MiniLM embeddings of claim and quote, plus their product and absolute difference (the standard pair
representation). Classifier: logistic regression. Tiny, fast, and it inherits Gemini's judgment on the pairs it has seen.
"""
import json, sys, pathlib
import numpy as np

DATA  = pathlib.Path("data/pairs.jsonl")
MODEL = pathlib.Path("data/judge.pkl")
LABELS = ["demonstrates", "suggests", "unrelated"]

def encoder():
    from sentence_transformers import SentenceTransformer
    return SentenceTransformer("all-MiniLM-L6-v2")

def feats(enc, pairs):
    c = enc.encode([p["claim"] for p in pairs], normalize_embeddings=True)
    q = enc.encode([p["quote"] for p in pairs], normalize_embeddings=True)
    return np.hstack([c, q, c * q, np.abs(c - q)])

def train():
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import cross_val_score
    import joblib
    rows = [json.loads(l) for l in DATA.read_text().splitlines() if l.strip()]
    rows = [r for r in rows if r.get("verdict") in LABELS]
    if len(rows) < 60:
        sys.exit(f"only {len(rows)} pairs; run the pipeline on more sites first (aim for 200+)")
    enc = encoder()
    X, y = feats(enc, rows), [r["verdict"] for r in rows]
    clf = LogisticRegression(max_iter=3000, class_weight="balanced")
    acc = cross_val_score(clf, X, y, cv=5).mean()
    print(f"{len(rows)} pairs, 5-fold accuracy {acc:.3f} (majority-class baseline {max(y.count(l) for l in LABELS)/len(y):.3f})")
    clf.fit(X, y)
    joblib.dump(clf, MODEL)
    print("saved", MODEL)

def serve():
    import joblib
    from http.server import BaseHTTPRequestHandler, HTTPServer
    clf, enc = joblib.load(MODEL), encoder()
    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0)) or b"{}"))
            pairs = body.get("pairs", [])
            verdicts = clf.predict(feats(enc, pairs)).tolist() if pairs else []
            out = json.dumps({"verdicts": verdicts}).encode()
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(out)
        def log_message(self, *a): pass
    print("judge listening on http://127.0.0.1:8787/judge — set JUDGE_URL=http://127.0.0.1:8787/judge in .env")
    HTTPServer(("127.0.0.1", 8787), H).serve_forever()

if __name__ == "__main__":
    {"train": train, "serve": serve}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
