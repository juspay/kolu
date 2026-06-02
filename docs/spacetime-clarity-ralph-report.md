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

| Pass | # | Passage | Failure mode | Action | Verdict | Result |
| --- | --- | --- | --- | --- | --- | --- |

## Dead ends

_(rewrites that didn't clear the stumble or risked meaning/voice — documented
so the knowledge isn't lost)_

## Key findings

_(populated at wrap-up)_
