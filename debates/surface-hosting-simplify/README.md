# Simplifying the surface framework's hosting side — a three-AI debate

| | |
|---|---|
| **Question** | Can the machinery that connects kolu to daemons on other machines be made smaller and clearer? |
| **Participants** | claude (judge, arguing from the repo's two design doctrines) · codex and grok (both assigned: *radical simplifier*) |
| **Mode** | Open-ended — no forced agreement. They agreed anyway. |
| **Result** | **8 simplifications ratified unanimously** ([conclusion.md](conclusion.md)) + 2 findings + 1 open question |
| **Reading order** | [topic.md](topic.md) → `01.*` (independent openings) → `02.*` (cross-examination) → `03.*` (confirmations) → [conclusion.md](conclusion.md) |

## What happened, in plain words

Three AIs each read the same code independently, then argued. Two were told to shrink the API as hard as they could defend; one defended the house rules (fail loud, make illegal states impossible to write, don't build shared machinery until two real users exist).

> [!NOTE]
> Mid-debate, srid added a game-changing fact: **drishti (the other app using this framework) is ours and can be changed freely.** Several deeper cuts became possible the moment the "don't break the neighbor" assumption fell.

The surprises:

1. **The judge's own proposal died first.** claude came in defending a "widen the slot to the role" fix (`PoolableSession`) — codex showed the registry only ever calls one method (`destroy()`), so the honest slot is even smaller. claude withdrew.
2. **Two debaters swapped positions mid-air.** On whether to unify the "replace the daemon" verb now or later, codex convinced claude "now" while claude convinced codex "later" — in the same round, without seeing each other's reply. The final answer takes both halves: rename the verb now (cheap, makes "do my programs survive?" part of the type), build the shared interface later (when a second daemon actually needs it).
3. **A dead export with a lying comment was caught.** `evictHostSession` claims the registry uses it; nothing in production calls it at all.
4. **The house rules survived two radicals.** All four doctrine defenses (loud failures, per-item relay policy, role-vs-class split, prove-then-extract) were explicitly upheld by both simplifiers — the "irreducible core."

## What changes because of this

- The W4 "switch" PRs get **smaller**: the server pool consumes a leaner registry; the browser side becomes a one-prop change (`Accessor`) instead of a new concept.
- The framework loses a false name (`RemoteMirrorSession` → `MirrorSession`), a dead generic, three duplicate readout methods, one dead export, and gains one honest identity value shared by all daemons.
- Every daemon's identity (when it started, what build, what contract) becomes **one universal value** — with the build-currency and the human-navigable commit kept as deliberately distinct fields.

## The question that didn't survive the owner's review

The debate parked "should *every* server answer 'who are you?'" as a someday question. **srid ruled it immediately: of course — no exceptions.** The framework will answer it automatically for every server (no author writes anything), identity moves to the base role, and only *supervision* (convergence, drain) stays daemon-specific. The parked assumption turned out to be scope-timidity, not architecture.
