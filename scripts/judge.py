#!/usr/bin/env python3
"""Local evidence judge: a small cross-encoder fine-tuned on the pipeline's own verdicts (plain PyTorch, no wrappers).

  node scripts/export-pairs.mjs
  python3 scripts/judge.py train      # ~2 min on a laptop → data/judge-ce/ ; prints held-out accuracy vs baseline
  python3 scripts/judge.py serve      # http://127.0.0.1:8787/judge → set JUDGE_URL in .env and restart next
"""
import json, sys, pathlib, random
import numpy as np, torch
from transformers import AutoTokenizer, AutoModelForSequenceClassification

DATA, MODEL = pathlib.Path("data/pairs.jsonl"), pathlib.Path("data/judge-ce")
BASE = "cross-encoder/ms-marco-MiniLM-L-6-v2"
LABELS = ["demonstrates", "suggests", "unrelated"]
dev = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")

def load():
    rows = [json.loads(l) for l in DATA.read_text().splitlines() if l.strip()]
    rows = [r for r in rows if r.get("verdict") in LABELS and r.get("claim") and r.get("quote")]
    random.Random(0).shuffle(rows); return rows

def batches(tok, rows, bs):
    for i in range(0, len(rows), bs):
        b = rows[i:i + bs]
        enc = tok([r["claim"] for r in b], [r["quote"] for r in b], truncation=True, max_length=256, padding=True, return_tensors="pt").to(dev)
        yield enc, torch.tensor([LABELS.index(r["verdict"]) for r in b], device=dev)

def predict(model, tok, pairs):
    model.eval(); out = []
    with torch.no_grad():
        for i in range(0, len(pairs), 32):
            b = pairs[i:i + 32]
            enc = tok([p["claim"] for p in b], [p["quote"] for p in b], truncation=True, max_length=256, padding=True, return_tensors="pt").to(dev)
            out += [LABELS[k] for k in model(**enc).logits.argmax(-1).tolist()]
    return out

def train():
    rows = load()
    if len(rows) < 80: sys.exit(f"only {len(rows)} pairs; run the pipeline on more sites first")
    n_eval = max(40, len(rows) // 6); ev, tr = rows[:n_eval], rows[n_eval:]
    counts = {l: sum(r["verdict"] == l for r in rows) for l in LABELS}
    baseline = max(sum(r["verdict"] == l for r in ev) for l in LABELS) / len(ev)
    print(f"{len(rows)} pairs {counts} · training on {len(tr)}, holding out {len(ev)} · device {dev}")
    tok = AutoTokenizer.from_pretrained(BASE)
    model = AutoModelForSequenceClassification.from_pretrained(BASE, num_labels=3, ignore_mismatched_sizes=True).to(dev)
    w = torch.tensor([len(tr) / (3 * max(1, sum(r["verdict"] == l for r in tr))) for l in LABELS], dtype=torch.float, device=dev)
    opt = torch.optim.AdamW(model.parameters(), lr=3e-5, weight_decay=0.01)
    loss_fn = torch.nn.CrossEntropyLoss(weight=w)
    for epoch in range(4):
        model.train(); random.Random(epoch).shuffle(tr); tot = 0.0
        for enc, y in batches(tok, tr, 16):
            opt.zero_grad(); loss = loss_fn(model(**enc).logits, y); loss.backward(); opt.step(); tot += loss.item()
        pred = predict(model, tok, ev)
        acc = np.mean([p == r["verdict"] for p, r in zip(pred, ev)])
        print(f"  epoch {epoch + 1}: loss {tot / max(1, len(tr) // 16):.3f} · held-out accuracy {acc:.3f}")
    pred = predict(model, tok, ev)
    acc = float(np.mean([p == r["verdict"] for p, r in zip(pred, ev)]))
    per = {l: (round(float(np.mean([p == l for p, r in zip(pred, ev) if r["verdict"] == l])), 2) if any(r["verdict"] == l for r in ev) else None) for l in LABELS}
    print(f"\nheld-out accuracy {acc:.3f} vs majority-class baseline {baseline:.3f} · recall per class {per}")
    print("SHIP: run `python3 scripts/judge.py serve` and set JUDGE_URL" if acc > baseline + 0.05 else "!! not clearly better than the baseline — don't set JUDGE_URL; the K2 route stays the judge")
    model.save_pretrained(MODEL); tok.save_pretrained(MODEL); print("saved", MODEL)

def serve():
    from http.server import BaseHTTPRequestHandler, HTTPServer
    tok = AutoTokenizer.from_pretrained(MODEL); model = AutoModelForSequenceClassification.from_pretrained(MODEL).to(dev)
    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0)) or b"{}")); pairs = body.get("pairs", [])
            out = json.dumps({"verdicts": predict(model, tok, pairs) if pairs else []}).encode()
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(out)
        def log_message(self, *a): pass
    print(f"judge on {dev} — http://127.0.0.1:8787/judge  (set JUDGE_URL=http://127.0.0.1:8787/judge in .env)")
    HTTPServer(("127.0.0.1", 8787), H).serve_forever()

if __name__ == "__main__":
    {"train": train, "serve": serve}.get(sys.argv[1] if len(sys.argv) > 1 else "", lambda: sys.exit(__doc__))()
