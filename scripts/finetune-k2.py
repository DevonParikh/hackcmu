#!/usr/bin/env python3
"""Fine-tune IFM K2-Horizon-0.9B (Apache 2.0) as Tailor's evidence judge, on verdicts distilled from the pipeline.

The task: given a CLAIM about a small business and a QUOTE from its site or reviews, answer one word —
demonstrates / suggests / unrelated. Training data is data/pairs.jsonl (node scripts/export-pairs.mjs).

  TRAIN (free Colab or Kaggle GPU; a T4 does 300 pairs × 3 epochs in ~10 minutes):
      upload data/pairs.jsonl, then in a cell:
      !pip -q install "transformers>=4.45" peft datasets accelerate
      !python finetune-k2.py train                     # writes ./k2-judge/ (merged weights + tokenizer)
      optional: !huggingface-cli login && python finetune-k2.py push your-hf-username/k2-horizon-tailor-judge

  SERVE (on the laptop, CPU or Apple GPU; a 1B model answers a batch of pairs in a second or two):
      pip install "transformers>=4.45" torch
      python3 scripts/finetune-k2.py serve ./k2-judge   # http://127.0.0.1:8787/judge  → set JUDGE_URL in .env
"""
import json, sys, pathlib, random

BASE = "IFM/K2-Horizon-0.9B"
LABELS = ["demonstrates", "suggests", "unrelated"]
SYSTEM = ("You judge evidence for claims about small businesses. Answer with exactly one word: "
          "demonstrates (the quote shows the claim happening), suggests (related, but does not show it happening), "
          "or unrelated.")

def fmt(claim, quote):
    return f"CLAIM: {claim}\nQUOTE: {quote}\nVERDICT:"

def load_pairs(path="data/pairs.jsonl"):
    rows = [json.loads(l) for l in pathlib.Path(path).read_text().splitlines() if l.strip()]
    rows = [r for r in rows if r.get("verdict") in LABELS and r.get("claim") and r.get("quote")]
    random.Random(0).shuffle(rows)
    return rows

# ------------------------------------------------------------------ train
def train():
    import torch
    from datasets import Dataset
    from transformers import AutoTokenizer, AutoModelForCausalLM, TrainingArguments, Trainer, DataCollatorForLanguageModeling
    from peft import LoraConfig, get_peft_model

    rows = load_pairs()
    if len(rows) < 80:
        sys.exit(f"only {len(rows)} pairs; run the batch on more sites first (aim for 300)")
    counts = {l: sum(r["verdict"] == l for r in rows) for l in LABELS}
    print(f"{len(rows)} pairs {counts}")
    n_eval = max(20, len(rows) // 10)
    eval_rows, train_rows = rows[:n_eval], rows[n_eval:]

    tok = AutoTokenizer.from_pretrained(BASE, trust_remote_code=True)
    if tok.pad_token is None: tok.pad_token = tok.eos_token
    model = AutoModelForCausalLM.from_pretrained(BASE, trust_remote_code=True, torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32)
    model = get_peft_model(model, LoraConfig(r=16, lora_alpha=32, lora_dropout=0.05, target_modules="all-linear", task_type="CAUSAL_LM"))
    model.print_trainable_parameters()

    def to_text(r):
        return {"text": f"{SYSTEM}\n\n{fmt(r['claim'], r['quote'])} {r['verdict']}{tok.eos_token}"}
    def tokenize(b):
        return tok(b["text"], truncation=True, max_length=512)
    ds = Dataset.from_list([to_text(r) for r in train_rows]).map(tokenize, remove_columns=["text"])

    args = TrainingArguments(output_dir="./k2-judge-ckpt", num_train_epochs=3, per_device_train_batch_size=8,
                             gradient_accumulation_steps=2, learning_rate=2e-4, warmup_ratio=0.05, lr_scheduler_type="cosine",
                             logging_steps=10, save_strategy="no", bf16=torch.cuda.is_available(), report_to=[])
    Trainer(model=model, args=args, train_dataset=ds, data_collator=DataCollatorForLanguageModeling(tok, mlm=False)).train()

    model = model.merge_and_unload()
    model.save_pretrained("./k2-judge"); tok.save_pretrained("./k2-judge")

    # held-out accuracy — the number to quote
    model.eval(); correct = 0
    for r in eval_rows:
        correct += predict(model, tok, [r])[0] == r["verdict"]
    majority = max(counts.values()) / len(rows)
    print(f"\nheld-out accuracy {correct/len(eval_rows):.3f} on {len(eval_rows)} pairs (majority-class baseline {majority:.3f})")
    print("saved ./k2-judge — copy the folder to the laptop and run: python3 scripts/finetune-k2.py serve ./k2-judge")

# ------------------------------------------------------------------ inference
def predict(model, tok, pairs):
    """Score the three labels by log-likelihood of their first token; no free-form generation, so it can't answer off-list."""
    import torch
    dev = next(model.parameters()).device
    first = [tok(" " + l, add_special_tokens=False).input_ids[0] for l in LABELS]
    prompts = [f"{SYSTEM}\n\n{fmt(p['claim'], p['quote'])}" for p in pairs]
    out = []
    with torch.no_grad():
        for pr in prompts:
            ids = tok(pr, return_tensors="pt", truncation=True, max_length=512).to(dev)
            logits = model(**ids).logits[0, -1]
            out.append(LABELS[int(torch.argmax(logits[first]))])
    return out

def serve(path="./k2-judge"):
    import torch
    from transformers import AutoTokenizer, AutoModelForCausalLM
    from http.server import BaseHTTPRequestHandler, HTTPServer
    dev = "mps" if torch.backends.mps.is_available() else ("cuda" if torch.cuda.is_available() else "cpu")
    tok = AutoTokenizer.from_pretrained(path, trust_remote_code=True)
    model = AutoModelForCausalLM.from_pretrained(path, trust_remote_code=True).to(dev).eval()
    class H(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0)) or b"{}"))
            pairs = body.get("pairs", [])
            verdicts = predict(model, tok, pairs) if pairs else []
            out = json.dumps({"verdicts": verdicts}).encode()
            self.send_response(200); self.send_header("content-type", "application/json"); self.end_headers(); self.wfile.write(out)
        def log_message(self, *a): pass
    print(f"K2 judge on {dev} — http://127.0.0.1:8787/judge  (set JUDGE_URL=http://127.0.0.1:8787/judge in .env)")
    HTTPServer(("127.0.0.1", 8787), H).serve_forever()

def push(repo):
    from transformers import AutoTokenizer, AutoModelForCausalLM
    AutoModelForCausalLM.from_pretrained("./k2-judge", trust_remote_code=True).push_to_hub(repo)
    AutoTokenizer.from_pretrained("./k2-judge", trust_remote_code=True).push_to_hub(repo)
    print(f"pushed to https://huggingface.co/{repo}")

if __name__ == "__main__":
    cmd = sys.argv[1] if len(sys.argv) > 1 else ""
    if cmd == "train": train()
    elif cmd == "serve": serve(*sys.argv[2:3])
    elif cmd == "push": push(sys.argv[2])
    else: sys.exit(__doc__)
