---
name: architecture-first-principles
description: Evaluate an architecture against foundational principles of state, change, and time — five grounded principles PLUS a fixed set of named, executable review checks (C1–C7) run as a Workflow fan-out over a diff: ecosystem duplicates, consumer ergonomics, graduation sweep, one-hop depends-on, fresh-eyes, state-and-time, project conventions. Theory and execution in one skill; per-repo specifics live in .agency/architecture-first-principles.md. Use when designing/reviewing state models, from /be-review (runs FIRST on framework/structure diffs), or on any architecture/electricity review ask.
argument-hint: "[--base <branch>] [--scope <paths>]"
---

# Architecture from first principles — the lens, and its executable checks

Two halves, one skill: **the five principles** (the state-and-time lens — what
`hickey`'s simplicity and `lowy`'s boundaries don't own), and **the checks**
(C1–C7) — named, verbatim hunter prompts that RUN the principles and their
sibling lenses over a diff. The checks exist because prose advice does not
survive contact: in one real week, five architecture smells shipped past a
four-lens review and were each caught by the human — every miss a question
nobody asked. The questions are now executable.

## The five principles

Each: the principle · **the diagnostic question** · the make-it-unspellable fix.
(Sources, compressed: Backus '78; Hickey "Value of Values"; Moseley & Marks "Out
of the Tar Pit"; Bernhardt "Functional Core, Imperative Shell"; Lamport '78;
Shapiro et al. CRDTs '11; Minsky "make illegal states unrepresentable"; King
"Parse, Don't Validate"; Saltzer/Reed/Clark "End-to-End Arguments" '84.)

- **P1 — Values, not places.** State is a succession of immutable values; change
  is a new value, never an in-place edit of a shared cell one party writes and
  another reads back as truth. *Ask:* is "the current state" a mutable place, or
  a value derived from history? *Fix:* delete the shared mutable place.
- **P2 — Pure core, effects at the edge.** Logic is a function of its inputs;
  I/O, clock, randomness, network live at the boundary, passed in as values.
  *Ask:* can the core run with no I/O, no `now()`, no globals? *Fix:* move the
  effect to the edge; pass it in.
- **P3 — One authority, ordered, on its own clock.** Every fact has one writer;
  concurrent merges must survive reorder + duplication (idempotent, commutative,
  associative); a consumer stamps time with its OWN clock. *Ask:* who is the
  sole writer? whose clock? does any correctness claim assume two clocks agree?
  *Fix:* one writer, the consumer's clock, or a lawful merge.
- **P4 — Illegal states unrepresentable.** Shape the data so a wrong value
  cannot be constructed; parse once at the boundary; errors are values, not
  nullable holes. *Ask:* can a contradictory value exist at all? is `null`
  doing two jobs? *Fix:* discriminated union; the bad state becomes a type
  error.
- **P5 — Guarantees at the knowing endpoint.** A guarantee belongs where enough
  is known to make it complete; lower layers may optimize but cannot guarantee.
  *Ask:* can this layer actually see enough to promise this? *Fix:* relocate
  the guarantee; keep the lower check as a removable optimization.

**The canonical composite** (P1+P2+P3+P4, not a sixth principle): a pure fold
`(state, event) → state` over an ordered immutable log — the log is the truth,
the fold is pure, the state is a value, the types forbid bad transitions, the
consumer stamps its own clock. (Reducer / Elm / Redux / CQRS lineage.)
Techniques this subsumes, so the set stays minimal: functional-core, FRP, free
monads/effects (P2); optics (P1); errors-as-values (P4); CRDTs/CALM/logical
clocks (P3); event-sourcing (the composite).

**Relationship to the other lenses:** `hickey` = static separation ("is it
braided?"), `lowy` = static boundaries ("does it encapsulate change?"), this =
dynamic state & time. Orthogonal; run all; one defect often shows on several
axes — that is triangulation, not redundancy.

## The checks — how a review actually runs

### Project overlay

Read **`.agency/architecture-first-principles.md`** if it exists (the
`code-police` `.agency/` pattern). It parameterizes: C1's ecosystem hints, C3's
layer ladder, C7's conventions coverage map, plus any project-added checks.
Only C1/C3/C7 take overlay parameters; the rest are fully generic. Missing
overlay → run generic and SAY so.

### Mechanics (identical every run)

1. Resolve the diff (`git diff origin/<base>...HEAD`) in a clean checkout.
2. ONE Workflow: each check is a parallel `agent()` hunter, flat schema
   `{ findings: [{ title, file, line, class, severity(real|minor), detail, fix }] }`.
   Substitute `$ROOT`/`$BASE`/`$NEW_FILES` + overlay parameters into the prompts
   verbatim — never paraphrase them.
3. **Verify pass:** every `real` finding gets an adversarial refuter
   (`CONFIRMED|WEAKENED|REFUTED`, evidence-required). REFUTED drops; WEAKENED
   keeps only what survived.
4. Report confirmed findings ranked with per-finding fixes; disposition each
   (fix now or record where) — "acceptable for scope" is not a disposition.

**Scope rule — one hop down (non-negotiable):** for every new module, list its
non-framework imports and run the checks on those files too; most real misses
live one hop below the diff.

### C1 · ecosystem-duplicate — "does something already ship this?"

> HUNT hand-rolled ecosystem duplicates in $ROOT (diff vs $BASE, plus one hop:
> the non-framework imports of $NEW_FILES). For EVERY mechanism the diff adds or
> stands on: does the project's dependency set, its ecosystem's standard
> libraries (overlay hints), the language/runtime built-ins, or an existing
> in-repo framework export already ship it? Check the manifest AND the lockfile
> — a transitive dep already present costs zero to adopt. Name the exact library
> API, cite the hand-roll file:line, judge adopt-vs-keep honestly. ONLY real
> duplicates — no "could theoretically use X".

### C2 · consumer-ergonomics — "read every new export from the consumer's chair"

> For EVERY new exported symbol, grep its real call sites and read them as the
> CONSUMER. Hunt: (a) double-derefs / awkward call shapes (nested accessors as
> API); (b) options required or documented but NEVER READ (dead knobs); (c)
> exports with zero production callers; (d) paired obligations the API could
> fuse; (e) policy callbacks that cannot reach the mechanism they need (forcing
> forward-reference hacks); (f) near-constant boilerplate at every call site;
> (g) names that lie at the call site. Evidence: the call-site code, quoted.

### C3 · graduation-sweep — the boundary question, BOTH directions

> Containment: did volatility leak INTO a module where it doesn't belong?
> Graduation: does the diff CREATE app-local machinery HIDING a hard volatility
> (transport, connection lifetime, reconnection, multiplicity racing intent,
> persistence, context loss) that wants its own receptacle — NAMED, with the
> volatility and the home, EVEN AT POPULATION ONE (a recorded opportunity,
> never a blocker; prove-then-extract gates the act, not the naming)? Judge
> LAYER PLACEMENT against the overlay's ladder — lowest honest layer. State
> DEFENSIBLE placements explicitly; no moves for tidiness.

### C4 · depends-on — "audit what the new code stands on"

> Trace every non-framework import of $NEW_FILES into the PRE-EXISTING code it
> leans on; audit THOSE files for: detached lifetimes with discarded disposers;
> module-global mutable state / caches whose lifetime mismatches the new
> consumer; hand-rolled duplicates (C1's bar); sentinel/null-overload hacks;
> fail-fast throws whose reachability the diff CHANGED (a boot throw now
> triggered by persisted state); proxies/singletons with surprising semantics
> as a foundation. Report: the pre-existing hack + the NEW call site leaning on
> it.

### C5 · fresh-eyes-consumer — "read only the public surface, know nothing"

> You know NOTHING of this change's implementation or history. Read ONLY the
> public surface: touched packages' READMEs, exported symbols/types, any design
> doc the PR cites. As a competent newcomer: (a) every export you cannot
> explain from the README alone (undocumented or stale docs); (b) every name or
> call shape that confuses you; (c) every doc claim the exports contradict.
> Your confusions ARE the findings — no deference.

### C6 · state-and-time — the five principles, executed

> Run P1–P5's diagnostic questions (above) over the diff's state-bearing code:
> mutable place read back as truth? core reaching for now()/globals? sole
> writer per fact + whose clock + do merges survive reorder? constructible
> contradictions / two-job nulls? guarantees at a layer that can't see enough?
> Cite the violated principle per finding.

### C7 · project-conventions — walk the overlay's coverage map

> For each coverage-map row marked judgment-enforced, check the diff against
> that convention explicitly; report violations with file:line. Overlay absent
> → skip and say so.

## Adding a check (the self-improve contract)

A human catches a smell the checks missed → a GENERAL lesson lands here as a new
named check or sharpened prompt line (and upstreams); a PROJECT lesson lands in
the repo's `.agency/architecture-first-principles.md`. Never as advisory prose
in another skill. A check earns its slot with: the seed miss, the question, the
evidence bar.
