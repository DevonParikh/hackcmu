#!/usr/bin/env python3
"""A local evidence judge with NO pretrained weights: lexical features + logistic regression, trained on the
pipeline's own verdicts (data/pairs.jsonl). It runs inside the Next app (lib/judge-local.ts) with no Python, no
network, no API key — as the fallback when every LLM provider is out, or on demand with JUDGE_LOCAL=1.

  pip install scikit-learn numpy
  node scripts/export-pairs.mjs             # data/pairs.jsonl from Mongo (already in the repo)
  python3 scripts/train-judge-local.py      # → data/judge-local.json  (only marked ship:true if it beats the baseline)

Honesty rules: cross-validation is grouped by SITE (pairs from one business never straddle a fold), the trivial
baseline is "always say the commonest verdict", and the model ships only if it clears that by 5 points.
"""
import json, pathlib, re, sys, datetime, collections
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import GroupKFold
from sklearn.metrics import f1_score

DATA = pathlib.Path("data/pairs.jsonl"); OUT = pathlib.Path("data/judge-local.json")
LABELS = ["demonstrates", "suggests", "unrelated"]
TOKEN = re.compile(r"[a-z0-9]+(?:'[a-z]+)?")
STOP = set("the a an and or of to in on for with at by from is are was were be been it its this that these those we our us you your they their i my me he she his her as if so than then there here into out up down over under about after before while not no".split())

# The mirror of these functions lives in lib/judge-local.ts. Change one, change the other.
def toks(s): return [t for t in TOKEN.findall(s.lower()) if t not in STOP]
def grams(ts): return ts + [f"{a}_{b}" for a, b in zip(ts, ts[1:])]

# lexical cues that separate "shows it happening" from "the topic exists"
CUES = {
  "firstPerson": r"\b(i|we|my|our|me|us)\b",
  "actionVerb":  r"\b(called|call(ed|ing)?|phone[ds]?|emailed|email(ing)?|messaged|texted|had to|have to|waited|wait(ing)?|asked|ask(ed|ing)?|booked|book(ed|ing)?|contacted|reached out|dm'?d|left a (message|voicemail))\b",
  "imperative":  r"\b(call us|email us|contact us|please call|give us a call|text us|message us|reach out|dm us|call or text|to book|to order|to schedule|for (a )?(quote|appointment|reservation)s?)\b",
  "listing":     r"\b(mon|tue|wed|thu|fri|sat|sun)[a-z]*\.?\s*[:\-–]?\s*\d|\$\s?\d|\d{1,2}(:\d{2})?\s?(am|pm)\b|\bmenu\b",
  "complaint":   r"\b(never|no (one|reply|response|answer)|didn'?t|did not|nobody|unanswered|ignored|rude|slow|late|wrong|refund|charged)\b",
  "reviewVoice": r"\b(review|stars?|recommend|experience|visited|ordered|came in|went in|highly)\b",
  "phoneEmail":  r"\(?\b\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}\b|[\w.+-]+@[\w-]+\.[a-z]{2,}",
  "quoteMarks":  r"[\"“”]",
}
def cue_feats(claim, quote):
    q = quote.lower(); cl = claim.lower()
    ct, qt = set(toks(claim)), set(toks(quote))
    inter = len(ct & qt); union = len(ct | qt) or 1
    f = [
      inter / union,                                  # jaccard overlap
      inter / (len(ct) or 1),                          # share of the claim's words found in the quote
      min(len(quote), 400) / 400,                      # quote length
      min(len(claim), 200) / 200,                      # claim length
      1.0 if len(quote) < 40 else 0.0,                 # very short quote
    ]
    f += [1.0 if re.search(p, q) else 0.0 for p in CUES.values()]
    f += [len(re.findall(CUES["actionVerb"], q)) / 5.0, len(re.findall(CUES["firstPerson"], q)) / 5.0]
    return f
CUE_NAMES = ["jaccard", "claimCovered", "quoteLen", "claimLen", "tinyQuote"] + [f"cue_{k}" for k in CUES] + ["actionCount", "firstPersonCount"]

rows = [json.loads(l) for l in DATA.read_text().splitlines() if l.strip()]
rows = [r for r in rows if r.get("verdict") in LABELS and r.get("claim") and r.get("quote")]
if len(rows) < 80: sys.exit(f"only {len(rows)} pairs; run the pipeline on more sites first")
y = np.array([LABELS.index(r["verdict"]) for r in rows]); groups = [r.get("site", "?") for r in rows]
counts = collections.Counter(r["verdict"] for r in rows)
baseline = max(counts.values()) / len(rows)

# vocabulary: unigrams + bigrams from the QUOTE (q:) and the CLAIM (c:), each seen in at least 3 pairs
def bag(r): return ["q:" + g for g in grams(toks(r["quote"]))] + ["c:" + g for g in grams(toks(r["claim"]))]
df = collections.Counter(); [df.update(set(bag(r))) for r in rows]
vocab = sorted(t for t, n in df.items() if n >= 3)
vid = {t: i for i, t in enumerate(vocab)}
idf = {t: float(np.log((1 + len(rows)) / (1 + df[t])) + 1) for t in vocab}

def featurize(r):
    v = np.zeros(len(vocab) + len(CUE_NAMES))
    tf = collections.Counter(t for t in bag(r) if t in vid)
    for t, n in tf.items(): v[vid[t]] = (1 + np.log(n)) * idf[t]
    norm = np.linalg.norm(v[: len(vocab)]); 
    if norm: v[: len(vocab)] /= norm
    v[len(vocab):] = cue_feats(r["claim"], r["quote"])
    return v
X = np.array([featurize(r) for r in rows])
# cue features on a comparable scale to the tf-idf block
cue_scale = X[:, len(vocab):].std(axis=0); cue_scale[cue_scale == 0] = 1.0
X[:, len(vocab):] /= cue_scale

print(f"{len(rows)} pairs from {len(set(groups))} sites {dict(counts)} · vocab {len(vocab)} · baseline (always '{counts.most_common(1)[0][0]}') {baseline:.3f}")
best = None
for cw in [None, "balanced"]:
    for C in [0.3, 1.0, 3.0, 10.0]:
        pred = np.zeros_like(y)
        for tr, te in GroupKFold(n_splits=5).split(X, y, groups):
            m = LogisticRegression(C=C, max_iter=5000, class_weight=cw).fit(X[tr], y[tr])
            pred[te] = m.predict(X[te])
        acc = float((pred == y).mean()); f1 = float(f1_score(y, pred, average="macro"))
        recall = {l: float((pred[y == i] == i).mean()) for i, l in enumerate(LABELS)}
        print(f"  C={C:<4} weights={str(cw):<9} grouped-CV accuracy {acc:.3f}  macro-F1 {f1:.3f}  recall {', '.join(f'{k} {v:.2f}' for k, v in recall.items())}")
        if best is None or acc > best[2]: best = (C, cw, acc, f1, recall)
C, cw, acc, f1, recall = best
ship = acc > baseline + 0.05
print(f"\nbest C={C} weights={cw}: accuracy {acc:.3f} vs baseline {baseline:.3f} → {'SHIP' if ship else 'not clearly better than the baseline; saved but NOT shipped'}")
if not ship:
    print("  (A cross-encoder with pretrained weights — scripts/judge.py — is the version that can learn the claim↔quote relation;")
    print("   this lexical model is the no-download fallback and, at this data size, it does not earn a place in the pipeline.)")

final = LogisticRegression(C=C, max_iter=5000, class_weight=cw).fit(X, y)
# keep the JSON small: drop vocabulary entries whose weight is ~0 for every class
keep = [i for i in range(len(vocab)) if np.abs(final.coef_[:, i]).max() > 1e-4]
model = {
  "trainedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "n": len(rows), "sites": len(set(groups)),
  "labels": LABELS, "baseline": round(baseline, 3), "acc": round(acc, 3), "macroF1": round(f1, 3), "recall": {k: round(v, 2) for k, v in recall.items()},
  "ship": bool(ship), "C": C, "classWeight": cw,
  "vocab": [vocab[i] for i in keep], "idf": [round(idf[vocab[i]], 4) for i in keep],
  "vocabCoef": [[round(float(final.coef_[k, i]), 4) for i in keep] for k in range(3)],
  "cueNames": CUE_NAMES, "cueScale": [round(float(s), 4) for s in cue_scale],
  "cueCoef": [[round(float(final.coef_[k, len(vocab) + j]), 4) for j in range(len(CUE_NAMES))] for k in range(3)],
  "intercept": [round(float(b), 4) for b in final.intercept_],
  "stop": sorted(STOP), "cues": CUES,
}
OUT.write_text(json.dumps(model))
print(f"saved {OUT} ({OUT.stat().st_size // 1024} KB, {len(keep)} vocabulary weights)")
if ship:
    print("strongest cues per verdict:")
    for k, l in enumerate(LABELS):
        top = sorted(zip(CUE_NAMES, final.coef_[k, len(vocab):]), key=lambda t: -t[1])[:3]
        print(f"  {l:<13} " + ", ".join(f"{n} {w:+.2f}" for n, w in top))
