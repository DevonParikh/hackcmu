---
description: Audit this repo against the HackCMU rubric and fix what pays off fastest
---
ultrathink.

You are triaging a hackathon project against a hard code freeze. Time is the only
scarce resource. Write NO code until Phase 1 is complete.

## Phase 1 — Audit, read-only
1. Read CLAUDE.md, the README, the package manifests, and every source file.
2. Run `git log --oneline -30`, `git status`, and `git branch -a` to see what
   actually landed versus what is half-finished or stranded on a branch.
3. Verify by EXECUTION, not by reading. Actually run things:
   - Does the SPL `approve` delegation cap exist, and is it enforced on devnet?
   - Does an over-limit transfer get rejected by the chain? Capture the real error text.
   - Does every attempt, success and failure, write to MongoDB?
   - Is the transaction simulated and read back in plain language before signing?
   - Auth0 login to delegate-key mapping: real, or stubbed?
   - Is anything actually deployed on Vultr and reachable from outside?
4. Grep for committed secrets, keypairs, .env files, and any mainnet RPC URL.

## Phase 2 — Report, then STOP
Produce one table: each gap, which rubric column or sponsor prize it costs us,
estimated minutes to close, and points-per-minute. Sort by points-per-minute.
List separately, ABOVE that table, anything that could make the live demo fail.
Those outrank everything regardless of scoring impact.
Then stop and wait for me to choose. Do not start fixing.

## Phase 3 — Execute only what I approve
- Smallest change that closes the gap. No refactors, no renames, no dependency bumps.
- Commit after each fix, naming the rubric column or prize it serves.
- Re-run the end-to-end demo path after every commit and confirm it still passes.
- If any change breaks the floor (the chain rejecting an over-limit transfer),
  revert it immediately and tell me.
