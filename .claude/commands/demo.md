---
description: Harden the 3-minute demo against every way it can fail on stage
---
ultrathink.

Demo quality is one fifth of the score and the most likely way we lose this.
Build, in this order:

1. `npm run demo` — one command that runs the whole 3-minute path with no typing:
   happy-path payment, then the jailbreak attempt, then print the MongoDB audit log
   with the blocked attempt highlighted. Idempotent, re-runnable from clean state,
   as many times as I want.
2. A `--text` flag driving the identical path from typed input instead of the mic,
   so a loud room cannot kill the demo.
3. An `--offline` flag that replays a real captured devnet response. Label it in the
   code and on screen as a replay. It exists for dead venue wifi. If I have to use
   it on stage I will say out loud that it is a replay, so do not make it look live.
4. Fail loudly and legibly. If devnet rate-limits or an airdrop fails, print one
   human-readable line on screen, not a stack trace.
5. Pin the agent keypair, the delegate allowance, and the recipient addresses in a
   demo fixture so the numbers on screen are identical every run and I can narrate
   them from memory.

Then write DEMO.md: the exact commands I type in order, the sentence I say over each
one, and the recovery move if that step fails.
