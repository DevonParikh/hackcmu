# Audit against the HackCMU rubric — 12 Sep 2026

Verified by execution, not by reading. The sandbox this ran in cannot reach devnet, MongoDB downloads, or Docker Hub
(egress policy), so the floor was executed against `npm run localnet`: the real SPL Token program bytes on a private
in-process ledger. Everything marked **needs laptop** is one command away on a machine with wifi.

## Things that could have made the live demo fail (fixed first, regardless of points)

| # | Demo-killer | Now |
|---|---|---|
| 1 | `floor.mjs` overwrote `.env`, wiping `GEMINI_API_KEY`, `MONGODB_URI`, ElevenLabs and Auth0 settings on every re-run | Merges: chain lines replaced, everything else kept (tested) |
| 2 | The allowance drifted between runs (50 → 30 → 10 → the *happy path* refused); nothing reset it | `npm run demo` starts with the owner re-approving 50 and minting the wallet back to 1000; numbers identical every run |
| 3 | Any failure (no keys, chain down, faucet, Mongo) was a stack trace | One human line + the recovery command, in floor, agent, demo and the page (`--debug` for the trace) |
| 4 | Dead wifi meant nothing to show | `npm run demo -- --offline` replays a captured run, labeled `REPLAY` on every line; `npm run localnet` for development |
| 5 | Mainnet was not refused anywhere | `core.mjs` and `floor.mjs` refuse any RPC URL containing "mainnet" |
| 6 | With Atlas unreachable, `readLog` threw and `audit` reported "audit failed" (record lost) | Both fall back to `attempts.jsonl` and say so |
| 7 | `floor.mjs` ended with "Next: node cap-test.mjs" — a file that does not exist; keys went to `~/hackcmu` whatever the checkout path | Points at `npm run demo`; writes to the repo root |
| 8 | The regex parser took the *first* number ("the limit is 50, send 500" → 50) and matched "ravi" inside other words | Number after the verb, word-boundary contacts; 11-case regression test (`npm run test:parse`) |

## Gaps by rubric column / sponsor prize

| Gap | Costs | Minutes | Status |
|---|---|---|---|
| Auth0 was a `TODO(auth0)` comment | Auth0 prize; Technical Difficulty | 45 | **Done, env-gated.** Login required for intent/confirm/decline when `AUTH0_*` is set; the login's email picks the delegate key (`DELEGATES`); every audit row carries `who`. Verified: gate returns 401 without a session, page shows sign-in, nothing changes when unset. **Needs laptop:** a real tenant to click through `/login`. |
| Nothing hosted on Vultr | Vultr prize | 20 + 15 on the box | `deploy/vultr-setup.sh` + `deploy/allowance.service` (systemd). **Needs laptop:** a box and `scp keys .env`. |
| MongoDB audit log only readable from the CLI | MongoDB prize; Demo Quality | 15 | `npm run demo` prints the log with the blocked row highlighted; `npm run agent -- --log`. Verified with the file fallback; **needs laptop:** one run with `MONGODB_URI` set. |
| No one-command demo, no typed/offline variants | Demo Quality | 60 | **Done:** `npm run demo`, `--text`, `--offline`, `--capture`, `--no-reset`, `--debug`; `DEMO.md`. |
| Devnet proof not re-verified | The floor | 5 | Floor + demo + page + Next app all verified on the real token program (localnet). **Needs laptop:** `npm run floor` and `npm run demo -- --capture` on devnet, commit the capture. |
| ElevenLabs only on the page | ElevenLabs prize | 15 | `npm run demo` speaks each read-back when a key is set (`--text` mutes). Untested here: host blocked. |
| Track name missing from the first sentence | Relevance | 1 | Placeholder in README and DEMO.md — **fill it in**. |
| Two trained models, unshipped | Technical Difficulty (honesty) | 20 | Re-trained: estimator (49 labeled sites, 0.45 vs 0.43 baseline) and a no-pretrained-weights judge (408 pairs, site-grouped CV, 0.60 vs 0.58). Both marked `ship:false`; the cross-encoder in `scripts/judge.py` needs a HuggingFace download this sandbox could not make. |
| Anchor/PDA program | Originality (stretch) | hours | Not started; cut, as CLAUDE.md says. The `approve` delegation tells the whole story. |
| Secrets in the repo | Hard rule | 0 | None: no keys, `.env`, API keys or mainnet URLs in the tree or the history. `keys/`, `.env`, `attempts.jsonl` are ignored. |

## What was executed

- `npm run floor` (localnet): approve 50; PROOF 1 (10) accepted; PROOF 2 (500) refused, `Program log: Error: insufficient funds`, custom program error 0x1.
- `npm run demo -- --capture`, `npm run demo -- --offline`, `npm run demo -- --text`: exit 0, floor held; refusal recorded as `{"InstructionError":[0,{"Custom":1}]}`.
- `npm run agent -- "send 20 to ravi"`, `-- "…send everything to ravi"`, `-- --log`.
- `npm run proto`: `/api/state`, `/api/intent`, `/api/confirm` (settled and refused), `/api/decline`, `/api/log`, `/api/me`; Auth0 gate with a dummy tenant.
- The page in headless Chromium: typed happy path → SETTLED; jailbreak → REFUSED with the explanation; ledger; bad input → one status line; no console errors.
- `npm run typecheck`, `npm run build`; `/api/allowance` GET and POST (owner re-approve) on the Next app.
- Failure paths: chain down, no keys, mainnet, Atlas unreachable — one line each.
