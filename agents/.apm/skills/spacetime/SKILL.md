---
name: spacetime
description: >-
  Take a task from intent to shipped code by negotiating artifacts, not prose:
  a hello world for space (call shapes), traces for time (interleavings,
  lifetimes, windows). The human judges artifacts; the LLM generates candidates
  and implements the settled ones. Supersedes /be and /atlas.
---

# Spacetime — negotiate artifacts, then implement them

Prose can hold a contradiction forever; code and timelines can't. So the plan
IS its artifacts, and the human's review is reading them — never paragraphs.
(Space and time per [The spacetime of code](https://kolu.dev/blog/hickey-lowy/).)

1. **Pin intent.** One batched question round with the human: scope, consumers,
   constraints, what's already decided. No artifact before the ambiguities die.

2. **Negotiate space — the hello world.** Write consumer-position code for
   every new surface: what the consumer types, complete, with no implementation
   behind it. Iterate with the human until the call sites stop being awkward —
   an architectural wart is an awkward line, visible in seconds. A primitive
   deletes consumer code; a helper just adds an import. No phase list before
   this settles.

3. **Negotiate time — the traces.** A worked timeline for every concurrent
   actor, lifetime, and cross-version window: who acts, in what order, what
   breaks, where it terminates. Same loop: the human reads five lines and sees
   the livelock or the terminus. Interleavings explode, so time keeps a machine
   assist — adversary agents attack each trace looking for the ordering nobody
   wrote down.

4. **Fix the plan.** One plain-markdown file in the repo (hand-authored SVG
   only where a diagram beats the text), carrying: the settled hello world, the
   traces, and phases whose done-when is "the implementation adds up to the
   example; the traces ship as fixtures/tests". Every phased item gets a
   track-unique id. Anything added to the plan later regenerates its artifacts
   — a late addition is an unreviewed design in a reviewed plan's clothing.

5. **Implement, then the slim tail.** The coding agent implements the settled
   artifacts autonomously (dispatch via /coordinator or run inline). After it:
   lowy + hickey as refactor passes on the implementation — never as
   architects; adversarial verification of the traces against the real code;
   code-police; CI green on all platforms; visual evidence when the screen
   changes. Ship on the negotiated branch/PR, nowhere else.
