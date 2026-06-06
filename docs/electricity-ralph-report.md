# Electricity.mdx — Ralph report

A measurement-driven, 20-iteration refinement of
`docs/atlas/src/content/atlas/electricity.mdx`. The goal is **not** to split or
re-arrange modules — it is to identify kolu's *hidden infrastructure*: the
volatilities that already power the app but have not been named, pulled out, or
correctly classified. We think like Juval Löwy (volatility-based decomposition,
the electricity/receptacle analogy) and critically re-evaluate each prior round.

## The metric (what "better" means)

There is no wall-clock number here; the artifact is an analysis. So we score the
document against a falsifiable rubric, and each cycle must move at least one
dimension without regressing the others.

| Dim | Name | Question it answers | How we measure |
| --- | --- | --- | --- |
| **C** | Coverage | Are *all* shipped electricities tracked, none stale/missing? | diff the table against the actual `@kolu/*` package set (`find packages -name package.json`) |
| **D** | Depth (hidden infra) | Does it surface volatilities *not yet packaged*, vs just listing shipped packages? | count of named-but-un-extracted volatilities with a concrete axis-of-change + consumer evidence |
| **X** | Discrimination | Does it correctly *reject* non-electricities (organs/leaves/domain-coupled)? | every "no" row has a Löwy/Hickey reason, not a vibe |
| **L** | Löwy-fidelity | Is the framing the *axis of change*, not the *function*? | each row states what *changes*, not what it *does* |
| **F** | Falsifiability | Are ③-graduation proofs real (a different app plugs in), not aspirational? | each "done" has a real second consumer or an honest "proof-pending" |
| **S** | Structure | Does the doc itself read as infrastructure (one frame), not a list? | one spine the reader can restate in a sentence |

**Methodology per cycle:** (1) take a step back — restate the whole picture in
one sentence; (2) find the single biggest gap on one dimension; (3) make one
targeted change; (4) re-score; (5) commit only if a dimension genuinely improved
with no regression. Dead ends are logged, not committed.

## Baseline (pre-iteration)

Measured before cycle 1.

- **C** — STALE. The actual package set includes `@kolu/solid-fileview`,
  `@kolu/solid-markdown`, `@kolu/url-shape`, `@kolu/pty-host` (scoped) and
  `terminal-themes`, `memorable-names`, `nonempty`, `integrations` — none of
  which appear in the table. The doc tracks 13 rows; the repo ships more.
- **D** — Thin. The doc lists shipped/planned *packages*. The only genuinely
  "hidden" (un-extracted) candidates it names are `createSharedRoot`,
  `persistedPref`, `dom/` — all already half-graduated. The deeper question the
  user is pushing ("the work is not at file/module level at all") is barely
  engaged: what volatility *axes* run under kolu that no package yet owns?
- **X** — Strong. The "Considered — not electricity" table and the three-traps
  callout are the doc's best asset.
- **L** — Mixed. The "Owns (volatility)" column is good, but several rows still
  describe *what the package does* (e.g. "SolidJS adapters for Pierre tree/diff")
  rather than *what changes*.
- **F** — Strong for surface (drishti is real); weaker elsewhere (most rows have
  no second consumer and don't claim "proof-pending" honestly).
- **S** — A list with excellent callouts, but no single spine. The reader cannot
  restate "the electricities of kolu" as one infrastructure.

## Optimization log

| Cycle | Step-back (one-sentence frame) | Dimension targeted | Change | Result |
| --- | --- | --- | --- | --- |
| 0 | "A good list of packages, audited well, but it tracks *packages* not *volatilities*." | — | baseline | — |
| 1 | "Before judging depth, the list must at least be *true* — and it isn't." | **C** | Added the 7 shipped-but-untracked packages, each classified honestly: solid-markdown (electricity — the *sanitiser* is the volatility), pty-host (electricity w/ ③-caveat: contract lives in kolu-common), url-shape/nonempty/memorable-names/terminal-themes (leaves), solid-fileview (**leaf mislabeled by package scope** — a composition, not a receptacle). | C↑. Coverage now matches the repo. Surfaced a fresh trap: *being an `@kolu/*` package is not sufficient* — solid-fileview is scoped but isn't electricity. |

## Dead ends

(filled as we go)

## Key findings

(filled at wrap-up)
