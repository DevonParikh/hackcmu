#!/usr/bin/env python3
"""A local evidence-relevance judge: a cross-encoder fine-tuned on the pipeline's own verdicts.

  pip install sentence-transformers scikit-learn
  node scripts/export-pairs.mjs          # data/pairs.jsonl from Mongo
  python3 scripts/judge.py train         # ~1–2 min on a laptop CPU → data/judge-ce/ ; prints held-out accuracy vs baseline
  python3 scripts/judge.py serve         # http://127.0.0.1:8787/judge ; then set JUDGE_URL in .env and restart next

Why a cross-encoder: it reads the CLAIM and the QUOTE together, so it can learn the relationship between them.
Frozen embeddings + logistic regression can't (that version scored below the trivial baseline).
"""
import json, sys, pathlib, random
import numpy as np

DATA  = pathlib.Path("data/pairs.jsonl")
MODEL = pathlib.Path("data/judge-ce")
BASE  = "cross-encoder/ms-marco-MiniLM-L-6-v2"
LABELS = ["demonstrates", "suggests", "unrelated"]

def load():
    rows = [json.loads(l) for l in DATA.read_text().splitlines() if l.strip()]
    rows = [r for r in rows if r.get("verdict") in LABELS and r.get("claim") and r.get("quote")]
    random.Random(0).shuffle(rows)
    return rows

def train():
    import torch
    from torch.utils.data import DataLoader
    from sentence_transformers import CrossEncoder, InputExample
    rows = load()
    if len(rows) < 80: sys.exit(f"only {len(rows)} pairs; run the pipeline on more sites first")
    n_eval = max(40, len(rows) // 6)
    ev, tr = rows[:n_eval], rows[n_eval:]
    counts = {l: sum(r["verdict"] == l for r in rows) for l in LABELS}
    baseline = max(sum(r["verdict"] == l for r in ev) for l in LABELS) / len(ev)
    print(f"{len(rows)} pairs {counts} · training on {len(tr)}, holding out {len(ev)}")

    # class weights so 'unrelated' (rare) isn't ignored
    w = torch.tensor([len(tr) / (3 * max(1, sum(r['verdict'] == l for r in tr))) for l in LABELS], dtype=torch.float)
    model = CrossEncoder(BASE, num_labels=3, max_length=256)
    examples = [InputExample(texts=[r["claim"], r["quote"]], label=LABELS.index(r["verdict"])) for r in tr]
    loader = DataLoader(examples, shuffle=True, batch_size=16)
    model.fit(train_dataloader=loader, epochs=4, warmup_steps=10, loss_fct=torch.nn.CrossEntropyLoss(weight=w), show_progress_bar=True)

    pred = model.predict([[r["claim"], r["quote"]] for r in ev]).argmax(axis=1)
    acc = float(np.mean([LABELS[p] == r["verdict"] for p, r in zip(pred, ev)]))
    per = {l: (float(np.mean([LABELS[p] == l for p, r in zip(pred, ev) if r["verdict"] == l])) if any(r["verdict"] == l for r in ev) else None) for l in LABELS}
    print(f"\nheld-out accuracy {acc:.3f} vs majority-class baseline {baseline:.3f} · recall per class {per}")
    if acc <= baseline + 0.05:
        print("!! not clearly better than the baseline — don't set JUDGE_URL. More sites → more pairs → try again.")
    model.save(str(MODEL))
    print("saved", MODEL)

def serve():
    from sentence_transformers import CrossEncoder
    from http.server import BaseHTTPRequestHandler, HTTPServer
    model = CrossEncoder(str(MODEL), num_labels=3, max_length=256)
    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0)) or b"{}"))
            pairs = body.get("pairs", [])
            v = [LABELS[i] for i in model.predict([[p["claim"], p["quote"]] for p in pairs]).argmax(axis=1)] if pairs else []
            out = json.dumps({"verdicts": v}).encode()
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(out)
        def log_message(self, *a): pass
    print("judge listening on http://127.0.0.1:8787/judge — set JUDGE_URL=http://127.0.0.1:8787/judge in .env")
    HTTPServer(("127.0.0.1", 8787), H).serve_forever()

if __name__ == "__main__":
    {"train": train, "serve": serve}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
