#!/usr/bin/env python3
"""Train the instant estimator from site features, distilled from the pipeline's own assessments.

  pip install scikit-learn numpy
  node scripts/export-training.mjs
  python3 scripts/train-estimator.py        # → data/estimator.json ; the app picks it up on next restart

Two models, each shipped only if it beats the trivial baseline in cross-validation:
  template  logistic regression → which tool the full read will pick   (stable label; the one to demo)
  hours     ridge regression    → hours/week                            (noisy label; usually doesn't ship)
"""
import json, pathlib, sys, datetime
import numpy as np
from sklearn.linear_model import Ridge, LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import cross_val_predict, KFold, StratifiedKFold

FEATURES = ["pages","kchars","thin","hasFaq","hasHours","hasPhone","hasEmail","hasOnlineBooking","hasOnlineOrdering","hasPricing","hasReviews",
            "revCalled","revEmail","revNoReply","revWaited","revRefund","revBooking",
            "indRestaurant","indSalon","indMedical","indFitness","indTrades","indRetail"]
LABEL = {"hasFaq":"an FAQ page","hasOnlineBooking":"online booking","hasOnlineOrdering":"online ordering","hasPhone":"a phone number","hasEmail":"an email address",
         "hasHours":"hours listed","hasPricing":"prices listed","hasReviews":"reviews found","revCalled":"reviews mention calling","revNoReply":"reviews mention no reply",
         "revEmail":"reviews mention email","revWaited":"reviews mention waiting","revRefund":"reviews mention refunds","revBooking":"reviews mention booking",
         "indRestaurant":"restaurant","indSalon":"salon","indMedical":"clinic","indFitness":"gym/studio","indTrades":"trades","indRetail":"retail",
         "pages":"site size","kchars":"amount of text","thin":"JavaScript-built site"}

rows = [json.loads(l) for l in pathlib.Path("data/training.jsonl").read_text().splitlines() if l.strip()]
if len(rows) < 20: sys.exit(f"only {len(rows)} rows; run scripts/batch.mjs on more sites first")
X_all = np.array([[float(r["features"].get(f, 0)) for f in FEATURES] for r in rows])
scaler = StandardScaler().fit(X_all)
scale = np.where(scaler.scale_ == 0, 1.0, scaler.scale_)
Xs_all = (X_all - scaler.mean_) / scale
out = {"features": FEATURES, "mean": scaler.mean_.tolist(), "scale": scale.tolist(), "n": len(rows),
       "trainedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}

# ---------------------------------------------------------------- which tool (classification)
tpl_rows = [(i, r["topTemplate"]) for i, r in enumerate(rows) if r.get("topTemplate")]
if len(tpl_rows) >= 20:
    idx = [i for i, _ in tpl_rows]; y = [t for _, t in tpl_rows]; X = Xs_all[idx]
    classes = sorted(set(y)); counts = {c: y.count(c) for c in classes}
    baseline = max(counts.values()) / len(y)
    folds = max(2, min(5, min(counts.values())))
    clf = LogisticRegression(max_iter=3000, C=0.5, class_weight="balanced")
    try:
        pred = cross_val_predict(clf, X, y, cv=StratifiedKFold(folds, shuffle=True, random_state=0))
    except ValueError:
        pred = cross_val_predict(clf, X, y, cv=KFold(folds, shuffle=True, random_state=0))
    acc = float(np.mean([p == t for p, t in zip(pred, y)]))
    ship = acc > baseline + 0.05
    clf.fit(X, y)
    print(f"WHICH TOOL · {len(y)} businesses · classes {counts}")
    print(f"  cross-validated accuracy {acc:.2f} vs always-guess-the-commonest {baseline:.2f}  →  {'SHIP' if ship else 'not better than baseline, not shipped'}")
    out["template"] = {"classes": list(clf.classes_), "coef": clf.coef_.tolist(), "intercept": clf.intercept_.tolist(),
                       "acc": round(acc, 2), "baseline": round(baseline, 2), "ship": bool(ship)}
    if ship:
        print("  what points at each tool (strongest feature per class):")
        for k, c in enumerate(clf.classes_):
            top = sorted(zip(FEATURES, clf.coef_[k]), key=lambda t: -t[1])[:3]
            print(f"    {c:<16} " + ", ".join(f"{LABEL.get(f, f)} {w:+.1f}" for f, w in top))
else:
    print("WHICH TOOL · too few rows with a template label")

# ---------------------------------------------------------------- hours (regression; noisy label)
y = np.array([min(float(r["hoursTotal"]), 40.0) for r in rows])
model = Ridge(alpha=3.0 if len(rows) < 60 else 1.0)
pred = cross_val_predict(model, Xs_all, y, cv=KFold(min(5, len(rows)), shuffle=True, random_state=0))
mae = float(np.abs(y - pred).mean()); base_mae = float(np.abs(y - y.mean()).mean())
ss_res, ss_tot = float(((y - pred) ** 2).sum()), float(((y - y.mean()) ** 2).sum())
r2 = 1 - ss_res / ss_tot if ss_tot else 0.0
ship_hours = mae < 0.8 * base_mae
model.fit(Xs_all, y)
print(f"HOURS · label mean {y.mean():.1f} hrs/wk")
print(f"  cross-validated MAE {mae:.1f} vs guess-the-average {base_mae:.1f} (R² {r2:.2f})  →  {'SHIP' if ship_hours else 'not shipped; the label is too noisy at this size'}")
out.update({"coef": model.coef_.tolist(), "intercept": float(model.intercept_), "r2": round(r2, 2), "mae": round(mae, 1), "shipHours": bool(ship_hours)})

pathlib.Path("data/estimator.json").write_text(json.dumps(out, indent=1))
print("saved data/estimator.json — restart the app to use it")
