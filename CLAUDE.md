# HackCMU 2026 — project context

## What this is
A voice-controlled Solana wallet agent whose spending authority is capped
ON-CHAIN, not in a system prompt. The demo climax is a live jailbreak attempt
that the agent obeys and the chain rejects.

## The floor — protect this above everything
SPL token `approve` delegation on devnet, fixed allowance to an agent keypair.
An over-limit transfer must fail on-chain, reproducibly, from the command line.
While that works, we have a submittable project. Never break it for a feature.

## Judging rubric — score every change against this
- Originality: a genuinely fresh approach, not a new coat of paint
- Technical Difficulty: real systems work vs. a "ChatGPT wrapper" (organizers' words)
- Demo Quality: clear, understandable, UNDER 3 MINUTES
- Usefulness: fulfills a real need
- Relevance: how well it fits the track it was submitted to

## Sponsor integrations — each must be load-bearing, never bolted on
- Solana: the on-chain spending cap IS the thesis of the project
- ElevenLabs: voice in/out; spoken confirmation of the parsed tx is a real safety feature
- Auth0: login determines which delegate key the session receives
- MongoDB Atlas: audit log of every attempted tx, including the blocked ones
- Vultr: hosts the agent service and the webhook listener
- Gemini: intent parser, one line in the README

## Hard rules
- DEVNET ONLY. Never mainnet. Never a keypair holding real funds.
- Never commit keypairs, .env files, or API keys. Check before every commit.
- Demo reliability beats feature count. Anything that risks the live demo is a bug.
- The Anchor/PDA program is a stretch goal. Cut it without hesitation if it is not
  finished by the deadline; the SPL `approve` version already tells the whole story.
- Every voice path needs a typed fallback. A failed live voice demo is worse than
  no voice demo.

## Demo script (3:00 hard cap)
0:00 problem · 0:20 happy path · 1:00 jailbreak, chain rejects ·
1:45 MongoDB audit log showing the blocked attempt · 2:20 architecture, what's next
Say the track name in the first sentence and in the README.
