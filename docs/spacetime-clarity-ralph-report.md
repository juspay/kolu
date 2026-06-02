# Clarity Ralph: "The spacetime of code"

Iterative, measurement-driven clarity improvement of
`website/src/content/blog/hickey-lowy.mdx`, run with the `/ralph` loop and
Paul Graham's standard as the objective:

> The most important component of writing clearly is simply to have high
> standards for clarity. Then if you write something unclear, you notice, and
> ask: what did I mean to say? You can just keep doing this over and over. And
> if you have high standards for clarity, you will.
> — Paul Graham

The loop operationalises "notice when it's unclear" as a **panel of independent
reader-judges**, and "what did I mean to say?" as a **rewrite + adversarial
verification** step that only keeps a change if a careful reader's stumble
clears *and* meaning, facts, the physics metaphors, and voice survive intact.

## Methodology

**Metric.** There is no clean benchmark command for prose, so clarity is
measured by an LLM-judge panel. Each *judge* is a Claude subagent reading the
full post in a distinct reading stance (newcomer, anti-hand-waving architect,
copy editor, physicist checking the metaphor, phone-skimmer, non-native
reader). Each scores every section 1–10 (10 = a careful reader never stumbles)
and logs every passage where it actually stumbled, with a verbatim quote, the
cause, and the meaning it inferred. A *synthesizer* dedupes across judges into a
consensus inventory; passages flagged by multiple judges rank higher
(cross-judge agreement = stronger signal).

**Baseline.** 6 independent judges (the ">= 5 runs, report the median" rule
applied to a panel). We report median and min section scores so a single
generous judge can't mask a real stumble.

**A cycle (pass).**
1. **Profile** — re-run / consult the panel inventory; rank unclear passages
   worst-first.
2. **Classify** — name the failure mode (ambiguous referent, sentence doing two
   jobs, buried subject, undefined term, strained/​unpaid-off metaphor, missing
   logical connective, dangling abstraction).
3. **Mutate** — apply the paulg question ("what did I mean to say?") to the
   single worst passage; produce a rewrite.
4. **Re-measure** — an adversarial skeptic verifies the rewrite: did the stumble
   clear? Is meaning preserved? Are facts, the physics metaphors, the code
   blocks, and the author's voice untouched? Reject (document as a dead end) if
   any check fails.
5. **Commit** — only verified improvements. Each commit names the passage and
   the failure mode it fixed.

**Stop condition.** Loop until two consecutive panel passes surface no clarity
defect above noise (loop-until-dry).

**Constraints (must NOT change).**
- Fenced **code blocks** stay byte-identical (real committed code).
- **Technical claims/facts** stay exactly true (commit hashes, PR #623, what
  Hickey/Löwy/Parnas said, the three defect stories).
- The **physics metaphors** (spacetime, four-dimensional manifold, space-like /
  time-like observers, world-line, the actuary and lockpicker footnotes) stay.
- **Behaviour:** `just website::build` must keep compiling the MDX.

Latitude granted: clarity + restructure (reorder/merge/split sentences within a
section), clarifying *within* the author's voice rather than flattening it.

## Behaviour-preservation gate

`just website::build` — baseline: **PASS** (6 pages, 2.53s, exit 0) before any
edit. Re-run after every pass.

## My own independent read (cross-check)

Applying the paulg standard myself before seeing the panel, these passages made
me stumble (held aside to compare against the panel's consensus, not yet acted
on):

- **"seams that aren't really seams"** (intro) — evocative but a newcomer has no
  referent for "seam" yet.
- **"The framing I'll use to justify it is that code has a _spacetime_"** — meta
  and slightly clunky; the subject is buried behind the scaffolding.
- **The invariant is introduced but never cashed out** — "the interval between
  events is the same in every frame… The structure is real, prior to any
  observer's view of it." The physics invariant is stated, then "both
  projections of the invariant" is invoked later as if the reader mapped it to
  code; the mapping (invariant = the real complexity structure) is left
  implicit.
- **"temporal in origin… but spatial in eventual manifestation"** — dense
  nominal phrasing for a simple idea (it starts as a timing problem, shows up
  later as tangle).
- **"the defects both lenses catch together"** (binocular aside) — awkward;
  re-read required.

## Baseline measurement

6-judge panel, 2026-06-02. **Overall median clarity: 8 / 10.** The post is
already solid everywhere; clarity is concentrated-loss, not spread-thin.

| Section | Median | Min | Judges flagging |
| --- | --- | --- | --- |
| Intro | 8 | 7 | 5 |
| What the two lenses are | 9 | 9 | 2 |
| The spacetime of code | 8 | 6 | 4 |
| A spatial defect: `borderClass` | 9 | 8 | 2 |
| A temporal defect: `displaySuffix` | 9 | 8 | 2 |
| **When both lenses fire: an aside** | **7** | 7 | **6** |
| **Why the two passes catch different things** | 8 | 7 | **6** |
| When to trust a single-lens finding | 9 | 9 | 0 |
| How to run them | 9 | 8 | 2 |
| In a line | 8.5 | 8 | 2 |
| Further reading + footnotes | 9 | 9 | 0 |

**Consensus confusion inventory (worst first).** Agreement = # of 6 judges who
independently flagged the passage.

| # | Sev | Agree | Section | Passage | Failure mode |
| --- | --- | --- | --- | --- | --- |
| 1 | high | 5 | both-fire | "both projections of **the invariant**" | undefined term on a definite article — "invariant" never named in the physics section |
| 2 | high | 6 | both-fire | "revisions keep introducing **the defects both lenses catch together**" | near-circular causation; scope-ambiguous; seems to undercut the "deep defect" framing |
| 3 | med | 6 | why-passes | "implementation has **taste-decided its way through** twenty design micro-choices" | coined verb + personified subject force a re-parse |
| 4 | med | 4 | intro | "**volatilities that got bound** when they should have stayed apart" | 3 undefined terms in the lede; one judge read "bound" as the opposite (good) meaning |
| 5 | med | 1 | spacetime | "A defect can live in one projection without registering in the other" | physicist: relativistic *mixing* setup logically contradicts the one-axis claim the post rests on |
| 6 | med | 3 | intro | "structural review **has.**" | elliptical gapping after a negative clause → reader carries "stopped being," the opposite |
| 7 | med | 3 | spacetime | "temporal in origin … but **spatial in eventual manifestation**" | abstract pivot stated before the concrete gloss that explains it |
| 8 | low | 2 | intro | "perfectly satisfied with **the diff**" | definite article forward-refs a diff not yet introduced |
| 9 | low | 2 | in-a-line | "seven refactor commits **past the point I would have merged on taste**" | stacked idiom + spatial metaphor |
| 10 | med | 1 | displaySuffix | "O(N) sweep, **delta gate, fan-out republish**" | telegraphic undefined jargon |
| 11 | low | 1 | how-to-run | "They agree on _locations_, **occasionally**" | two frequency qualifiers stack and force a re-read |
| 12 | low | 1 | spacetime | "**space-like observer** … **time-like observer**" | physics: observers travel time-like world-lines; "space-like observer" isn't a thing |
| 13 | low | 1 | both-fire | "a careful `maxHydrated` **sequencing flag**" | "sequencing flag" vague |
| 14 | low | 1 | how-to-run | "the **third**, synthesizing read — yours" | ordinal "third" before reads were being counted |

Dominant patterns: (a) **undefined-term-on-a-definite-article** (#1, #4, #8,
#10), and (b) **compressed/coined constructions that force a re-parse** (#2, #3,
#6, #7). The fix pattern is uniform: introduce/gloss the load-bearing term
before leaning on it, and front the concrete restatement ahead of the abstract
pivot.

## Optimization log

Each row = one flagged passage. "Verified by" = the adversarial skeptic's
verdict. Edits marked _skeptic-tweak_ were rewritten by the rewriter, rejected
by the skeptic, and replaced with the skeptic's own endorsed fix.

| Pass | # | Passage | Failure mode | Action | Verdict |
| --- | --- | --- | --- | --- | --- |
| 1 | #1 | "both projections of **the invariant**" | undefined term on definite article | named it: "the code's analogue of that frame-invariant interval" | ✅ skeptic-tweak |
| 1 | #3 | "implementation has **taste-decided its way through**…" | coined verb + personified subject | "after the implementer has made twenty design micro-choices by taste" | ✅ approved |
| 1 | #4 | "**volatilities that got bound**…" | 3 undefined lede terms; "bound" misread as "limited" | "fast-moving and slow-moving parts coupled when they should have stayed apart" | ✅ skeptic-tweak |
| 1 | #6 | "structural review **has.**" | elliptical gapping inverts meaning | "structural review **has become that.**" | ✅ approved |
| 1 | #7 | "temporal in origin … **spatial in eventual manifestation**" | abstract pivot before its gloss | fronted the concrete sentence; "starts on the time axis … surfaces on the space axis, as tangle" | ✅ approved |
| 1 | #8 | "satisfied with **the diff**" | definite article forward-ref | "signed off on code the other lens would have stopped" | ✅ approved |
| 1 | #9 | "**merged on taste**" | stacked idiom + spatial metaphor | "past where my taste would have called it done and merged" | ✅ skeptic-tweak |
| 1 | #10 | "**delta gate, fan-out republish**" | telegraphic undefined jargon | "pushes only the ids whose suffix actually changed, and the server republishes those" | ✅ approved |
| 1 | #11 | "**occasionally**" + "rarely" stacked | two frequency qualifiers collide | "agree on a location only occasionally — and even when they do, they rarely prescribe…" | ✅ approved |
| 1 | #12 | "**space-like observer**" | physics: observers aren't space-like | adjective moved onto the slice/reading: "a space-like slice" / "the time-like reading" | ✅ skeptic-tweak |
| 1 | #14 | "the **third**, synthesizing read" | ordinal before reads were counted | "a third read … yours, after theirs, synthesizing the two" | ✅ approved |
| 2 | #2 | "revisions keep introducing **the defects both lenses catch together**" | near-circular causation; scope-ambiguous | dropped the circular clause: "the few that surfaced clustered in the later passes, after the revisions went in" | ✅ 3/3 lenses |
| 3 | R1 | binocular-stats sentence: ratio + 3-pass scope + later-skew jammed into one dash-spliced run-on; "the few that surfaced" anchored to the wrong noun | overloaded sentence / under-anchored referent | split into two beats; re-named subject "binocular ones" so the skew can't attach to single-axis | ✅ kept (6/6→3/6) |
| 3 | R2 | "the factoring … the real structure … the code's analogue of **that frame-invariant interval**" | over-stuffed triple appositive (self-inflicted in pass 1 #1); physics callback overclaims | defined factoring inline ("the way the code is carved into parts"), cut to one appositive, dropped the overclaiming callback (metaphor stays in its home section) | ✅ kept (drops overclaim) |
| 3 | R4 | "two **orthogonal** agent reviewers" | "orthogonal" parses as "reviewers perpendicular to each other" | tried "two agent reviewers — one per axis —" | ↩︎ **reverted** |

**R4 reverted — the loop catching its own regression.** R4 passed all three
pass-3 skeptics (3/3) and *did* clear the "orthogonal" misparse. But the final
re-measure (a fresh panel that never saw the edit) flagged the new wording
**5/6**: the em-dash aside I inserted stranded the subject "two agent reviewers"
from its verb "are good at," and "run in parallel" garden-paths as an
imperative. It traded a 2-judge stumble for a 5-judge one. Skeptics gate the
*specific* fix; only a fresh measurement catches the *new* stumble the new
wording creates. Reverted to the original wording, which scored better. This is
the single most useful artifact of the run: a 3/3-approved edit, undone by
measurement.

**Pass 3 method.** Re-measure (same 6-judge panel) → three targeted rewrites of
the new top defects, each gated 3/3 by meaning+facts+metaphor / clarity / voice
skeptics → apply → final re-measure. R1 and R2 held; R4 regressed and was
reverted.

**Pass 2 method.** Three candidate rewrites of #2 from different angles
(depth-mechanism, minimal, drop-causal), each vetted by a perspective-diverse
skeptic panel (meaning+thesis / voice / clarity). Only **drop-causal** passed
all three lenses. The other two cleared the *clarity* lens but were rejected on
meaning+thesis for re-introducing a depth-accretion mechanism that implies
single-axis defects are shallower — the same thesis violation that sank the
pass-1 attempt — and on voice for bloating the terse aside. The clean
observation beat every clever explanation, exactly as the rewrite brief
anticipated.

## Dead ends

Rewrites the adversarial skeptic rejected with no safe alternative — kept as-is.
The over-fixing the post itself warns against, caught in the act.

- **#5 — "A defect can live in one projection…" (physics "contradiction").** A
  physicist judge argued the relativistic-*mixing* setup contradicts the
  one-axis claim. The proposed fix ("fix two observers and hold them there")
  was rejected: two *different* observers give two *different* mixings, so "pin
  two frames and the projections come apart cleanly" is itself bad physics, and
  it pre-empts the next paragraph. The original already neutralises the worry —
  "the interval between events is the same in every frame… prior to any
  observer's view of it." **Deliberate keep.**
- **#13 — "`maxHydrated` sequencing flag".** Glossing the flag inline "steals
  the reveal": the very next paragraph deliberately unpacks it into three
  braided concerns (what's maximized / when the client is caught up / how to
  avoid a flash). Explaining early would make that paragraph read as redundant.
  **Deliberate keep.**
- **#2 — the near-circular binocular sentence (6/6 judges).** Real defect; the
  pass-1 rewrite was rejected for introducing a "shallow slip = single-axis"
  taxonomy that contradicts the post's own thesis (its two centerpieces are
  *single-axis* defects, emphatically not shallow). **Fixed in pass 2** by
  dropping the causal clause entirely. Two pass-2 candidates that tried to
  supply a real mechanism (depth-accretion) re-committed the same thesis
  violation and were rejected — logged here as the dead end they were: there is
  no honest non-circular *cause* to state, so the clean observation is the fix.

## Final measurement

Three identical 6-judge panels (same personas, same rubric), run on the post
after each milestone. Per-section median clarity:

| Section | Baseline | After P1+P2 | Final (P3) | Δ |
| --- | --- | --- | --- | --- |
| Intro | 8 | 8 | 8 | — |
| What the two lenses are | 9 | 9 | 9 | — |
| The spacetime of code | 8 | 7.5 | 8 | — |
| A spatial defect: `borderClass` | 9 | 9 | 9 | — |
| A temporal defect: `displaySuffix` | 9 | 9 | 9 | — |
| When both lenses fire: an aside | 7 | 7 | 7 | — |
| **Why the two passes catch different things** | 8 | **9** | **9** | **+1** |
| When to trust a single-lens finding | 9 | 8.5 | 9 | — |
| How to run them | 9 | 9 | 9 | — |
| In a line | 8.5 | 8 | 8.5 | — |
| Further reading + footnotes | 9 | 9 | 9 | — |
| **Overall median** | **8** | **8** | **8** | **—** |

**The median didn't move — and that's the honest headline.** The post was
already 8/10; this loop didn't raise a ceiling, it removed specific, nameable
stumbles under that ceiling. The measurable wins are in the *distribution*, not
the median:

- **"Why the two passes" rose 8 → 9** and held — the `taste-decided` fix (#3)
  is a durable, attributable gain.
- **`borderClass`, "Why the two passes", and "Further reading" drew zero
  flags** in the final panel.
- **Of 14 baseline defects, 11 are durably cleared** and not re-flagged in any
  later panel (#3, #4, #6, #8, #11, #14, plus the de-jargoned #10, #12). The
  three that resisted are the frontier (below).

## Loop termination — the clarity frontier

Stopped after pass 3 + a confirming re-measure. Not because the post is
"perfect," but because the residual friction is no longer the kind a
behaviour-preserving clarity pass can remove. Two reasons, both decisive:

1. **The residual is constraint-protected.** The most-flagged section after the
   loop is still "The spacetime of code" — and the flag is the physicist judge's
   recurring point that the *relativistic-mixing* image ("different observers
   measure different mixes") fights the post's "orthogonal, non-overlapping
   axes" thesis. That tension is inherent to the physics metaphor, which the
   brief locks as must-not-change. Every attempt to "fix" it (pass 1 #5) made
   the physics *worse*. It is a deliberate authorial flourish, not a clarity
   bug we're allowed to remove.

2. **The rest is whack-a-mole at the frontier.** The binocular-agreement
   explanation has been flagged ~5–6/6 in *every* phrasing — the original
   ("the invariant"), pass 1 ("frame-invariant interval"), and pass 3 ("the
   real structure underneath both projections"). Each rewrite clears its
   predecessor's stumble and a fresh panel finds a new one in the new wording.
   R4 is the clean proof: a 3/3-approved edit that measurement showed *regressed*
   the sentence. When edits relocate friction instead of removing it, the
   sentence has reached the limit of what reshuffling can do — it needs the
   author's own rethink of the idea, which is out of scope for a clarity pass.

**Left for the author (out of scope here):**

- The physics-metaphor ↔ orthogonality tension (ranks 3–4, 11 in the final
  panel) — a content decision: keep the vivid relativity and accept the
  loose fit, or trade it for a plainer "one structure, two slices" framing.
- The binocular-agreement sentence — resists clean phrasing; likely wants a
  structural rethink, not a word-swap.
- **Two factual/consistency items a clarity pass must not silently "fix":** the
  pass-count phrasing ("three review passes" / "later passes") sits in mild
  tension with the only *shown* binocular case (canvasMaximized, said to land
  in post-implementation pass 1); and the Further-Reading "pass 1" link
  (`#4274565406`) vs the intro's "twice against the committed diff" link
  (`#4274952616`) appear crossed. Flagged for the author to verify against the
  actual PR comments.

## Key findings

- **A judge panel is a real clarity instrument.** Six independent readers in
  distinct stances (newcomer, anti-hand-waving architect, copy editor,
  physicist, phone-skimmer, non-native) converged hard: the two weakest
  sections were flagged 6/6 both times, and the dominant failure pattern
  (undefined-term-on-a-definite-article) was named identically across runs.
  Cross-judge agreement is the signal; a lone flag is a lead, not a verdict.
- **The adversarial skeptic earns its keep — but isn't sufficient.** It
  rejected 4 of pass 1's rewriter proposals outright and replaced 4 more with
  its own tighter fix. It correctly killed the physics "fix" that would have
  broken the metaphor. But it gates the *specific* edit in isolation; it cannot
  see the *new* stumble a rewording introduces elsewhere. Only re-measurement
  caught R4's regression. **Skeptic + fresh panel, not skeptic alone.**
- **Most clarity bugs were one mechanism.** Name the load-bearing term before
  you lean on it; front the concrete restatement before the abstract pivot.
  That single move fixed #1, #4, #8, #10, and #3.
- **Over-fixing is the dominant risk, and it's measurable.** Three deliberate
  keeps (#5, #13) and one revert (R4) — the post's own warning ("if a
  simplification is making your diff bigger, one of your lenses is broken")
  applied to its own prose. The diff is +36/−34: it barely grew.
- **Voice survived.** Every kept edit cleared a voice skeptic explicitly
  briefed to reject corporate flattening. The terse closers, em-dash asides,
  and physics imagery are intact; the post still sounds like its author.

## Cost

| Phase | Workflow | Agents | Output tokens |
| --- | --- | --- | --- |
| Baseline panel | clarity-baseline | 7 | ~207k |
| Pass 1 (rewrite+verify) | clarity-pass | 21 | ~433k |
| Pass 2 (#2, 3 candidates) | clarity-defect2 | 12 | ~274k |
| Re-measure | clarity-baseline (re-run) | 7 | ~208k |
| Pass 3 (3 targets) | clarity-pass3 | 12 | ~256k |
| Final re-measure | clarity-baseline (re-run) | 7 | ~205k |
| **Total** | 6 workflows | **66** | **~1.58M** |

Behaviour gate (`just website::build`) run after every pass: **PASS** each time
(6 pages, ~1.8–2.5s). The MDX compiled clean throughout.
