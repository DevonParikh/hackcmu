#!/usr/bin/env python3
"""Train the instant estimator: ridge regression from site features → hours/week, distilled from Gemini's assessments.

  pip install scikit-learn numpy
  node scripts/export-training.mjs
  python3 scripts/train-estimator.py        # → data/estimator.json ; the app picks it up on next restart

Prints cross-validated R² and MAE (the numbers to quote), then the coefficients in owner language.
"""
import json, pathlib, sys, datetime
import numpy as np
from sklearn.linear_model import Ridge
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import cross_val_predict, KFold

FEATURES = ["pages","kchars","thin","hasFaq","hasHours","hasPhone","hasEmail","hasOnlineBooking","hasOnlineOrdering","hasPricing","hasReviews",
            "revCalled","revEmail","revNoReply","revWaited","revRefund","revBooking",
            "indRestaurant","indSalon","indMedical","indFitness","indTrades","indRetail"]
LABEL = {"hasFaq":"an FAQ page","hasOnlineBooking":"online booking","hasOnlineOrdering":"online ordering","hasPhone":"a phone number","hasEmail":"an email address",
         "hasHours":"hours listed","hasPricing":"prices listed","hasReviews":"reviews found","revCalled":"reviews mention calling","revNoReply":"reviews mention no reply",
         "revEmail":"reviews mention email","revWaited":"reviews mention waiting","revRefund":"reviews mention refunds","revBooking":"reviews mention booking",
         "indRestaurant":"restaurant","indSalon":"salon","indMedical":"clinic","indFitness":"gym/studio","indTrades":"trades","indRetail":"retail",
         "pages":"site size","kchars":"amount of text","thin":"JavaScript-built site"}

rows = [json.loads(l) for l in pathlib.Path("data/training.jsonl").read_text().splitlines() if l.strip()]
rows = [r for r in rows if r.get("hoursTotal") is not None]
if len(rows) < 20: sys.exit(f"only {len(rows)} rows; run scripts/batch.mjs on more sites first")

X = np.array([[float(r["features"].get(f, 0)) for f in FEATURES] for r in rows])
y = np.array([min(float(r["hoursTotal"]), 40.0) for r in rows])          # same cap the app applies

scaler = StandardScaler().fit(X)
Xs = scaler.transform(X)
alpha = 3.0 if len(rows) < 60 else 1.0                                    # more shrinkage on small data
model = Ridge(alpha=alpha)
folds = min(5, len(rows))
pred = cross_val_predict(model, Xs, y, cv=KFold(folds, shuffle=True, random_state=0))
ss_res, ss_tot = float(((y - pred) ** 2).sum()), float(((y - y.mean()) ** 2).sum())
r2 = 1 - ss_res / ss_tot if ss_tot else 0.0
mae = float(np.abs(y - pred).mean())
base_mae = float(np.abs(y - y.mean()).mean())
print(f"{len(rows)} businesses · label mean {y.mean():.1f} hrs/wk")
print(f"cross-validated: R² {r2:.2f} · MAE {mae:.1f} hrs (guessing the average would give MAE {base_mae:.1f})")
if mae >= base_mae: print("\n!! not better than guessing the average. Don't ship this yet; run more sites.\n")

model.fit(Xs, y)
scale = np.where(scaler.scale_ == 0, 1.0, scaler.scale_)                  # constant features contribute 0
out = {"features": FEATURES, "mean": scaler.mean_.tolist(), "scale": scale.tolist(), "coef": model.coef_.tolist(),
       "intercept": float(model.intercept_), "n": len(rows), "r2": round(r2, 2), "mae": round(mae, 1),
       "trainedAt": datetime.datetime.now(datetime.timezone.utc).isoformat()}
pathlib.Path("data/estimator.json").write_text(json.dumps(out, indent=1))
print("saved data/estimator.json — restart the app to use it\n")
print("what moves the estimate (hours per one standard deviation of the feature):")
for f, c in sorted(zip(FEATURES, model.coef_), key=lambda t: -abs(t[1]))[:10]:
    print(f"  {LABEL.get(f, f):<28} {c:+.1f}")
