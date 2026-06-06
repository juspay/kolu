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
| 2 | "The table lists four transports; they are **one** volatility across four boundaries." | **D**, **S** | New section *"What the table is really a list of — one contract, four boundaries."* Collapses surface / pty-host / surface-nix-host / artifact-sdk-bridge into a single axis: *a live value across a boundary you don't control*, contract = snapshot → deltas → liveness. Names the real electricity as the transport-independent **`Channel` contract**, and the iframe bridge as where it leaked (no `postMessageLink`). Generates a concrete recommendation. | D↑↑ (first genuinely below-module insight), S↑ (a spine the table now hangs from). This is the "huge step back." |
| 3 | "Every row so far is a *boundary*; there's a whole second kind the audit can't see." | **D**, **L** | New section *"The table misses an entire kind: invariant electricities."* Family B = correctness rules run as the same cassette at N call-sites where forgetting is *silent*: snapshot→deltas ordering, owner-before-await (#598/#600/#591), validate-on-read (persistedPref + state.ts), expected-abort silencing. Their correct form *deletes* code, so a package audit is blind to them. Connects back: snapshot→deltas lives in both families — where A meets B is where an electricity is half-built. | D↑ (names un-extractable infra), L↑ (each stated as a volatility = growing call-site set). Two-axis spine now exists (boundary × invariant). |
| 4 | "The note recognises in hindsight; the user's real question is whether it *generates*." | **F**, **S** | New section *"The real test: does the method generate, or only recognise?"* Reframes the whole note as **forward**: three falsifiable standing bets (`postMessageLink`, `createOwnedResource`, `solid-xterm`) + a 4-step from-zero re-derivation of surface. Names step 2 ("what changes" not "what it does") as the move that makes surface *inevitable*. Directly answers "would the method generate surface?" | F↑↑ (predictions are falsifiable, not aspirational), S↑↑ (note now has a generator's spine, not a tracker's). Addresses the central provocation. |
| 5 | "My A/B split is incomplete — it ignores the *biggest* cluster of rows (the renderers)." | **D**, **S**, **X** | Self-critique cycle. Added **family C — appliance electricities** (blob → safe addressable view; solid-markdown/pierre/xterm/transcript/anchoring). Completes a 3-family taxonomy (Boundary × Invariant × Appliance) that every row sorts into. Bonus: explains solid-browser + solid-fileview as **compositions, not electricities** — resolving the doc's own long-standing tension and confirming the Cycle-1 "leaf" verdict from a second angle. | D↑, S↑ (taxonomy now total), X↑ (composition-vs-receptacle is a sharper rejection rule). Points at seams-between-families as where the next electricity hides. |
| 6 | "Follow my own pointer to the seams — what lives at A×C?" | **D**, **X** | Found **addressing** (a reference that outlives what it points at) = `(which view, where inside)`; kolu builds both halves (location in solid-browser, anchor in artifact-sdk) and composes by hand. Creative core: an anchor is **Hickey identity-over-time** — re-finding a `Range` per render *is* surface re-delivering a `Cell` after a delta, with the boundary set to **time**. Reframes family A: not "spatial boundaries" but "a live identity re-resolved across *any* boundary (network/process/origin/time)." Flagged the over-merge honestly per trap ①. | D↑↑ (deepest below-module find; unifies A with Hickey's time model), X↑ (models its own honesty by *refusing* to declare it). |
| 7 | "I've appended brilliance to an unchanged tracker skeleton — is it even coherent?" | **S** | Integration pass: top-of-note orienting frame (inventory above / method below + the 3 families named up front). | S↑. The spine now starts at the top, not halfway down. |
| 8 | "The re-derivation is a 4-step toy; the real method has teeth (two axes + screen)." | **D**, **L**, **F** | (Prior-art workflow `electricity-prior-art`, 13 agents, landed here.) Upgraded the re-derivation into the **6-step procedure**: frame-the-interaction → two axes of change (verbatim Löwy ①same-customer-over-time ②all-customers-at-once) → independence check → variable/volatile + Cooking/Feeding + open-ended screen → name-for-the-axis → the receptacle. Falsifiable claim attached: *fed only "client+server+wire," step 6 must emit surface.* | D↑, L↑ (Löwy's actual elicitation, sourced), F↑ (self-falsifying). The generator now has machinery, not just a slogan. |
| 9 | "The word 'electricity' is still decoration unless the metaphor is a procedure." | **D**, **L** | Section *"The metaphor, made generative."* Electricity→software axis-mapping table; the sweep test (interface must be *bit-identical* across the axis) + naming test; contract-vs-carrier (surface is a contract, oRPC a carrier). Distillations marked as ours, not Löwy. | D↑, L↑. The analogy now does work. |
| **PIVOT** | User: *"a big part of improving this doc is identifying NEW electricities … 20 more cycles."* | **D** (now primary) | Re-scoped: the method is the engine; the deliverable is the **crop**. Dispatched 6 evidence-grounding scouts. New primary metric: **N = count of new electricities identified with kolu evidence + honest verdict** (extract / defer / reject). | Baseline N=0 named-new. Engine validated by scouts; 6 grounded candidates + 2 rejects in hand. |
| 10 | "Run the engine: what's the strongest thing it emits that isn't tabled?" | **D**, **F** | New section *"Newly identified this pass — the engine, turned on,"* opened with the headline find: **`createOwnedResource`** (reactive-owner correctness, Family B) — verdict **extract-now**. Axis + "every time `await`, we hand-edit the owner-dance or leak" + evidence (Terminal.tsx:463-471, scrollLock:63-64, createSharedRoot as inverse, #591/#598/#600/#606). Promotes `dom/`+`createSharedRoot` to two faces of one un-built receptacle. | N=1 (extract-now). D↑↑, F↑ (dated recurring pain, real ③ story). |
| 11 | "A scout says my Cycle-3 claim is *wrong* — fix it in public." | **F**, **X** | Self-correction: surface **enforces** snapshot→deltas by construction (server.ts:146-216, pollOnEvent), not "manually across handlers." Rewrote the Cycle-3 row + closing line; added crop **#2 `terminal.attach`** (the lone surviving hand-roll, router.ts:144-151) as a *narrow* verdict (fold into a Stream). | N=2. F↑↑ (a note that corrects itself), X↑. |
| 12 | "The server has a whole receptacle no one named — and a trap next to it." | **D**, **X** | Crop **#3 `migrate-on-load`** (server schema-evolution, candidate): 23-rung ladder + validate-at-boot (state.ts:88-442). Plus a callout rejecting the naive `persistedPref`+`state.ts` merge — different clocks (per-read vs at-boot vs wire) ⇒ **coincidental-duplication trap**; client persistedPref = done, server = separate candidate. | N=3. D↑, X↑↑ (models the independence check killing a merge). |
| 13 | "Apply sequence-vs-activity *inside* the headline electricity." | **D** | Crop **#4 Manager-vs-Engine**: is surface two electricities? Engine (transport links) already separated; Manager (connect→snapshot→deltas→reconnect→teardown) still braided to the socket (surface-app/solid/index.ts:87-103). Candidate — cleaves when a 2nd transport's lifecycle diverges (postMessageLink the likely trigger). | N=4. D↑ (boldest structural claim; splits an existing vault). |
| 14 | "Real axis, wrong time — will I extract on momentum?" | **D**, **F** | Crop **#5 view→portable-artifact** (export): 5 formats/7 weeks, growing — but welded source+sink, differing guards (params-and-conditionals smell), no 2nd consumer ⇒ **defer**. | N=5 (defer). F↑ (method refuses momentum). |
| 15 | "A clean axis whose volatility hasn't fired." | **D** | Crop **#6 `vt-events`** (escape-seq→typed events): coherent axis fused into pty-host lifecycle; inert since extraction, one entanglement (OSC 633→foreground), no external consumer ⇒ **defer/monitor**. A possible future *cleave* of pty-host. | N=6 (defer). |
| 16 | "A generator that never says no is a tracker — show the refusals." | **X**, **F** | Added **the reject pile**: identity/trust (single-user-local; trust collapses into transport; fails independence) and client multi-tab fan-out (zero client evidence; *but server-side fan-out is real* — refcounted WAL watchers / drop-slow-subscriber). Sharper lesson: the same axis is genuine on one side, speculative on the other. | X↑↑, F↑. Two honest rejects with extract-if conditions. |

## Dead ends

(filled as we go)

## Key findings

(filled at wrap-up)
