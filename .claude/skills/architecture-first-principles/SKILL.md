---
name: architecture-first-principles
description: >-
  Evaluate an architecture or design against FOUNDATIONAL computer-science principles of state,
  change, and time — the "state-and-time lens" that hickey (simplicity) and lowy (boundaries) do
  not own. Five grounded principles — values-not-places, pure-core/effects-at-the-edge,
  one-authority-on-its-own-clock, illegal-states-unrepresentable, guarantees-at-the-knowing-endpoint —
  with the immutable fold over a log (reducer / Elm / Redux / CQRS) named as their canonical
  composite. Use when designing or reviewing how state is produced, stored, ordered, and typed; when
  asking "is the state model right?"; or as a lens within /perfection-review. Project-agnostic.
---

# Architecture from first principles — the state-and-time lens

A lens for the **dynamic, temporal** axis of an architecture: how state is *produced*, where
*change* happens, who owns *time* and *authority*, and which states can even be *expressed*. It is
the complement to `hickey` ("is the **structure** simple?") and `lowy` ("are the **boundaries**
right?"): this one asks **"is the *state model* right?"** The axes are orthogonal — tests can pass,
code can be uncomplected and well-decomposed, and the system can *still* clobber a shared mutable
cell, import a foreign clock, or let an illegal state ship. Those are this lens's defects.

## The five principles

Each: the principle · its canonical source · **the diagnostic question** · the positive
("make-it-unspellable") form.

**P1 — Values, not places.** State is a succession of immutable *values*; an *identity* is the
series of values it takes over *time*. Change is a new value, never an in-place edit of a shared
cell that one party writes and another reads back as truth.
- *Source:* Hickey, "The Value of Values" (2012) & "Are We There Yet?" (2009 — the identity/state/time model); Backus, Turing lecture (1978 — the von-Neumann mutable-store bottleneck); Okasaki, *Purely Functional Data Structures* (1998 — structural sharing makes immutability cheap).
- *Ask:* Is there a place written by one party and read back as truth by another? Is "the current state" a mutable cell, or a value derived from history?
- *Fix:* remove the shared mutable place; make change produce a new value.

**P2 — Pure core, effects at the edge.** The logic is a referentially-transparent function of its
inputs; I/O, the clock, randomness, the network, and dependency injection live at the **boundary**.
Effects are *described* in the core and *interpreted* at the edge.
- *Source:* Backus (1978 — equational reasoning); Moseley & Marks, "Out of the Tar Pit" (2006 — "state is the enemy"; essential vs accidental complexity); Bernhardt, "Boundaries / Functional Core, Imperative Shell" (2012); Seemann, "Functional architecture is Ports & Adapters" (2016) & "Dependency Rejection" (2017 — a pure core needs no DI; push impurity out, don't inject it in).
- *Ask:* Can the core run with no I/O, no clock, no network, no DI — purely from its arguments? A function that reads `now()` or a global is in the wrong layer.
- *Fix:* pass effects in as values (`now: () => number`, `readFile: (p) => Promise<…>`); concentrate I/O in a thin shell that wires inputs and applies outputs.

**P3 — One authority, ordered, on its own clock.** Every fact has exactly one writer (a single
source of truth). Where concurrency forbids that, converge only through operations that are
**idempotent, commutative, and associative**, so retries and reordering cannot corrupt. Order is
explicit and causal — derived from the data, never from comparing two machines' wall-clocks; a
consumer stamps time with *its own* clock and never imports a remote producer's.
- *Source:* Lamport, "Time, Clocks, and the Ordering of Events in a Distributed System" (1978 — logical/causal order without synchronized clocks); Shapiro, Preguiça, Baquero & Zawirski, "Conflict-free Replicated Data Types" (2011 — the commutative/associative/idempotent merge); Hellerstein & Alvaro, "Keeping CALM" (monotone logic needs no coordination). The **monoid** (associative op + identity) as the algebra of safe aggregation is standard algebra / FP folklore — *not* a single canonical architecture paper [flagged].
- *Ask:* Who is the sole writer of this fact? If many, do the merges survive reorder + duplication? Whose clock stamps it — and does any correctness claim assume two clocks agree? *(Probe: set the producer's clock a year ahead — does the consumer's ordering change? If yes, it imported a foreign clock.)*
- *Fix:* one writer; the consumer's clock; or a lawful (CRDT / monotone) merge.

**P4 — Illegal states unrepresentable.** The type is the proof: shape the data so a wrong value
*cannot be constructed*; **parse** untrusted input *once* at the boundary into a type that cannot
express the bad state (don't re-validate the same thing everywhere); represent failure as a *value*
(`Result`/`Either`), not a nullable hole or out-of-band control flow.
- *Source:* Minsky, "make illegal states unrepresentable" (Jane Street — a **practitioner maxim**, not a paper [flagged]); King, "Parse, Don't Validate" (2019 — influential blog [flagged]); Wlaschin, *Domain Modeling Made Functional* (2018) & "Railway-Oriented Programming" (2014 — errors as values); Hoare, "Null References: the Billion-Dollar Mistake" (2009). Deepest lineage: **Curry–Howard** (types as propositions, programs as proofs) — Wadler, "Propositions as Types".
- *Ask:* Can a wrong value be constructed at all? Is validation a one-time parse into a stronger type, or the same check scattered across call sites? Are errors return values or hidden control flow?
- *Fix:* split the type (discriminated union / refined type) so the bad state is *uninhabitable* — the "unspellable > absent" bar reached by construction.

**P5 — Guarantees at the knowing endpoint.** A correctness/reliability guarantee belongs at the
endpoint with enough knowledge to make it *complete*. Lower / intermediate layers may *optimize*
but cannot *guarantee*; a check placed where it can't see enough is an optimization at best and a
false assurance at worst.
- *Source:* Saltzer, Reed & Clark, "End-to-End Arguments in System Design" (1984, ACM TOCS).
- *Ask:* Is this guarantee at the layer that can make it authoritative, or one that can only partially enforce it? Which endpoint actually owns this claim?
- *Fix:* move the guarantee to the authoritative endpoint; let lower layers stay a (removable) optimization, not the sole proof.

## The canonical composite — the immutable fold over a log

The highest-leverage *instance* of P1–P4 together, and the most common violation — so name it when
you see it:

> A pure fold `(state, event) → state` over an ordered, immutable log, where the **log is the
> source of truth (P3)**, the **fold is pure (P2)**, the **state is a value (P1)**, the
> **events/state are typed so bad transitions can't be expressed (P4)**, and the **consumer stamps
> its own clock (P3)**.

It is **not a sixth principle** — it is P1+P2+P3+P4 composed; stating it as an axiom would violate
*foundational, not corollary*. This skill **teaches the five and recognizes the composite.** Its
lineage, so you can name what you see:
- the fold = a **catamorphism** — Meijer, Fokkinga & Paterson, "Functional Programming with Bananas, Lenses, Envelopes and Barbed Wire" (1991);
- "derive state from the log" — Kreps, "The Log" (2013);
- the reducer `(state, action) → state` — **Redux** (Abramov, from Flux) and **The Elm Architecture**'s `update` (Czaplicki);
- the architectural form (write-log + materialized read-models) — **CQRS / event sourcing** (Greg Young; Martin Fowler).

## Techniques this subsumes (so the set stays minimal)

Each maps to a principle and earns no slot of its own — list them to prove minimality:
functional-core/imperative-shell & dependency rejection → **P2** · FRP (behaviors/events over time;
Elliott & Hudak, "Functional Reactive Animation", 1997) → **P1+P2** · free monads / tagless-final /
algebraic effects → **P2** techniques (separate description from interpretation) · optics / lenses →
**P1** technique (immutable update) · railway-oriented / errors-as-values → **P4** · CRDTs / CALM /
logical clocks → **P3** · CQRS / event-sourcing → the composite.

## How to use it

A **lens, not a checklist** — five diagnostic questions held as a *covering set* (no fixed order;
together they cover the space of state/data-flow defects). Three modes:

- **Designing:** ask all five *before* committing a state/data-flow decision; prefer the composite
  (a fold over a log) and justify any departure.
- **Reviewing:** run it like `hickey`/`lowy` — a forked, read-only pass (e.g. an `Explore` agent),
  whole-module scope, that **fact-checks its own output** (invoke `fact-check`) and emits findings
  under a *no-defer* disposition: each is *fix now* or *no-op* — "acceptable for scope" is not a
  pass. Treat each principle as a **proof obligation**: either cite the structural mechanism that
  enforces it, or construct the concrete defect that is still expressible.
- **Diagnosing a reported defect** (a bug report / failing symptom / "what's the root cause of X"):
  **reproduce it first.** Every principle here can be argued from reading code alone — which is
  exactly how a confident, *hallucinated* root cause ships. Glean the facts from an actual
  reproduction (or a test that fails for the real reason), *then* name the principle the evidence
  implicates; never assert a root cause you have only reasoned to, and don't wait to be told to
  reproduce. State the conclusion in **plain words** — the lens's rigor lives in the analysis, the
  answer the human reads stays a plain sentence (`conventions` → "Answer in plain words", which
  holds even when this lens's vocabulary is dense).

It owns **state, data-flow, and time**, and **delegates**: "is this boundary in the right place?" →
`/lowy`; "are these concerns braided / fragmented?" → `/hickey`; "is the code idiomatic?" →
`/elegance`. One defect often shows on several axes at once — e.g. "the producer mutates the
consumer's store" is a **P1 + P5** violation *and* a `hickey` complect of derivation with storage.
That is triangulation, not redundancy; run all the lenses to cover the whole space.

## How `/perfection-review` invokes it

perfection-review's bar is *"the defect can no longer be expressed,"* and it frames each finding as
*the invariant it violates*. This skill is its **catalog of foundational invariants**:
- name **which principle's invariant** a residual defect violates (e.g. "a remote `lastActivityAt`
  reorders the fleet" = **P3**: foreign clock + multi-writer);
- the **"unspellable" target** for the fix is that principle's positive form — **P4** → make it a
  type error; **P3** → one writer / the consumer's clock / a lawful merge; **P1** → delete the
  mutable place; **P2** → move the effect to the edge; **P5** → relocate the guarantee.

Wiring: *perfection-review hunts the relocating defect → this lens names the invariant and supplies
the structural make-it-unspellable fix → perfection-review verifies the defect can no longer be
expressed.*

## Relationship to the other lenses

| lens | axis | core question |
|---|---|---|
| `hickey` | static — separation | are independent concerns braided / fragmented? |
| `lowy` | static — boundaries | do boundaries encapsulate an axis of change? (Parnas 1972) |
| `elegance` | local — idiom | is the code idiomatic and minimal? |
| **this** | **dynamic — state & time** | values-over-time, derived purely, single-writer on its own clock, illegal states unrepresentable, guarantees at the knowing endpoint? |

Orthogonal axes — a system can be perfectly decomposed (`lowy`) and uncomplected (`hickey`) yet
still clobber a mutable cell or import a foreign clock, and vice versa. This lens **cross-references**
but **subsumes none**: P3's single-writer is the *concurrent* face of Parnas information-hiding
(`lowy` owns the decomposition); P1's "a mutable place complects value + time + identity" is the
positive of one `hickey` row (this skill develops the *state model*; `hickey` treats it as one
complecting pattern). Run all; this one owns state and time.

## References (grounded; practitioner / folklore sources flagged)

Backus (1978) · Hickey, "The Value of Values" (2012), "Are We There Yet?" (2009), "Simple Made
Easy" (2011) · Okasaki, *Purely Functional Data Structures* (1998) · Moseley & Marks, "Out of the
Tar Pit" (2006) · Bernhardt, "Boundaries / Functional Core, Imperative Shell" (2012) · Seemann,
"Functional architecture is Ports & Adapters" (2016), "Dependency Rejection" (2017) · Parnas, "On
the Criteria To Be Used in Decomposing Systems into Modules" (1972 — the root under `lowy` and under
P3's single-writer information-hiding) · Lamport, "Time, Clocks…" (1978) · Shapiro et al., "CRDTs"
(2011) · Hellerstein & Alvaro, "Keeping CALM" · Saltzer, Reed & Clark, "End-to-End Arguments"
(1984) · Meijer, Fokkinga & Paterson, "Bananas, Lenses, Envelopes and Barbed Wire" (1991) · Kreps,
"The Log" (2013) · The Elm Architecture (Czaplicki) / Redux (Abramov) / Flux · CQRS & Event Sourcing
(Greg Young; Fowler) · Elliott & Hudak, "Functional Reactive Animation" (1997) · Wadler,
"Propositions as Types" · Wlaschin, *Domain Modeling Made Functional* (2018), "Railway-Oriented
Programming" (2014) · Hoare, "Null References: the Billion-Dollar Mistake" (2009).

**Flagged (honest grounding — do not present as peer-reviewed):** *monoids as "the algebra of safe
combination"* — standard abstract algebra / FP folklore, no single canonical architecture paper.
*"Make illegal states unrepresentable" (Minsky)* and *"Parse, Don't Validate" (King, 2019)* —
influential **practitioner maxims** (talk / blog), canonical by adoption. *Curry–Howard* — cited as
the lineage under P4 (via Wadler), not a single architecture source. Hickey, Bernhardt, Seemann,
Wlaschin, Elm, and Redux are **practitioner canon**, not academic papers — cite them as such.
