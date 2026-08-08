---
name: hickey
description: Evaluate code (especially LLM-generated) for structural simplicity using Rich Hickey's "Simple Made Easy" framework. Use when reviewing a PR, diff, or snippet for accidental complexity, or when the user asks about complecting, simplicity vs. easiness, structural coupling, or concept deduplication. Triggers on "is this simple", "does this complect", "review for complexity", or any reference to Hickey / Simple Made Easy.
context: fork
agent: Explore
model: sonnet
---

# Hickey: Structural Simplicity Evaluation

Tests tell you code works; they tell you nothing about whether it's simple.
Complected code can be perfectly correct today — the damage shows up when you
change, reason about, or extend it. Full talk:
[transcript](https://github.com/matthiasn/talk-transcripts/blob/master/Hickey_Rich/SimpleMadeEasy.md)
(also `transcript.md` beside this skill).

**Definitions.** *Simple* (one fold): one concern, one role — objective; count
the interleavings. *Easy* (nearby): familiar, at hand — relative. *Complect*:
braid independent concerns so neither can be reasoned about alone. *Compose*:
place independent things side by side, preserving isolation.

## Scope

The trigger is a *starting point*, not a frame. Default to **whole-module
scope**: read the whole file, every touched file of a diff, and adjacent
siblings when the pattern recurs there. Don't let the user's framing define
the scope — if the cited symptom is one instance of a broader structural
issue, the broader finding is the headline, not a footnote. Anchoring on the
trigger's framing is itself a finding the review never let form.

## The Evaluation Process

Work the layers in order; every finding must later survive `/fact-check`.

### Layer 1: Identify the Concerns

Name the independent concerns explicitly. Can't cleanly name them → that is a
finding.

### Layer 2: Fragmentation Check

"Don't complect" has a dual: **don't fragment what belongs together**. One
domain concept split across fields, state locations, signals, or modules —
held together by an unenforced rule — is the same structural bug from the
opposite direction. The fix is reunification at whatever layer the one thing
naturally lives (one type, one signal, one module, one file).

For every group of related fields or state locations: **does the domain model
this as one thing?** If yes:

1. **Enumerate the invariants** coupling the parts, in plain language ("if A
   then B", "every update of P must update Q").
2. **Check consumption sites** — fragmentation shows at the reader: every
   consumer projecting the same value out of a per-entity structure is the
   fingerprint.
3. **Watch for reconciliation machinery** — a memo lifting one value from a
   collection, an effect copying state across entities, a "keep X in sync
   with Y" comment. The machinery is the bug, not the fix.
4. **Collapse at the natural layer** — wherever the unity stops needing a rule
   to hold.
5. **Silence is the bug** — when nothing is found, write "no invariants
   found" explicitly; the enumeration forces the check.

### Layer 3: Concept Multiplication

For each new abstraction (component, module, signal, type) the code
introduces:

1. **Name what it represents at the domain level.**
2. **Survey the codebase for the canonical in-repo pattern for the same
   *kind* of operation** — a new picker → every other "pick a thing" surface;
   a new dialog/scheduler/error type/config loader → the project's existing
   instance of that primitive kind. When the canonical pattern exists and the
   diff reinvents rather than extends it, that is the **headline finding**,
   before any critique inside the new abstraction.
3. **"Mirror existing pattern" is an easiness judgment** — creating B because
   A looks similar adds a concept; extending A keeps the count flat.
4. **Package surface as a fragmentation site** — read a new package's exports
   the way Layer 2 reads a per-entity structure: a consumer forced to wire
   several exports together to reconstitute one concept means the package
   fragmented one primitive into N exports. Collapse to one entry point;
   see `/lowy` §6.5 for the volatility-side argument and the worked example.

Budget: the survey fires when the diff adds new files
(`git diff --diff-filter=A --name-only origin/HEAD...HEAD` non-empty) or a
new exported abstraction; pure refactors and line-level fixes are exempt.

Concept Multiplication is *duplicated wholes* (two classes for one concept →
delete one); Fragmentation is *split wholes* (one concept shattered →
collapse). One finding can trigger both — that's redundancy, not muddling.

### Layer 4: Structural Pattern Catalog

Scan for these plus any project-declared patterns — read `.agency/hickey.md`
if it exists and treat its contents as catalog additions.

**Complecting patterns**

| Construct | What it complects | Simpler alternative |
|---|---|---|
| Mutable state | Value + time + identity | Immutable values, controlled state containers |
| Objects | State + identity + value + namespace | Plain functions + data + namespaces |
| Methods | Function + state/namespace | Free functions, interfaces |
| Inheritance | Types with types | Composition, interfaces, traits |
| Switch/case on type | Who + what | Dynamic dispatch, visitor |
| Mutable variables | Value + time | `const` bindings, immutable data |
| Imperative loops | What + how + when | `map`/`filter`/`reduce` |
| Actors | What + who | Queues + stateless handlers |
| ORM | Identity + relational model + query | Plain data + declarative queries |
| Conditionals scattered across code | One decision braided across sites | Rules, policies, lookup tables |
| Callbacks over mutable state | Control flow + state + time | Streams, queues, immutable values |
| Hand-rolled utility (tokenizer, parser, date/semver/URL helper, arg parser) when a focused library fits | Scope decision with implementation choice | Use the library. "Zero deps" is an easiness judgment: code you don't own is simpler than code you do — it doesn't bitrot, and its edge cases are someone else's problem. Hand-roll only when the library adds surface you actively don't want. |
| New abstraction reimplementing an in-repo canonical pattern for the same kind of operation | Scope decision with placement choice | Reuse/extend the canonical pattern (Layer 3's survey detects this). A standalone abstraction is justified only when extending the canonical one would complect two genuinely independent volatility axes. |

**Fragmentation patterns**

| Construct | What it fragments | Simpler alternative |
|---|---|---|
| Parallel optionals with coupled presence | Existence + shape, admitting illegal states | Discriminated union |
| Per-entity state the domain says must agree | One value into N copies with an "all agree" rule | Single source of truth at the containing scope |
| Reactive pipeline projecting one value out of a per-entity structure | Sharedness reconstituted at read time | Make the state shared; delete the pipeline |
| Callback-down + value-up across modules | One state location into a cycle | Lift the state to the shared layer |
| Sum type as parallel optional fields | A discriminator scattered into projections | Actual sum type |
| Boolean combinations encoding a state machine | One state into independent flags | Enum/union naming each state |
| "Update X when Y changes" by convention | A rule into memory | Structure making the coupling mechanical |
| Duplicated derivations | One computation into N copies | Compute once, read N times |
| Config split across files by accident of history | A concept into cross-referenced shards | Collapse into the owning module |
| Shared helper living in whichever module imported it first | Its natural home into an authoring-order accident | **Alternative-placement test**: name the consumers, try the helper in each candidate home, and compare which placement leaves the more cohesive module. The default home owns the concept's *generative* side (layout, store, identity, lifecycle), not the first reader. |

On a catalog match, **don't dismiss** — design the concrete alternative first
(Layer 7), then judge. The proof burden is on the current code.

### Layer 5: Structural Entanglement

Per touched module: concern count (>1 = braiding); mutable bindings per
function (3+ = scrutinize); closures over mutable state; data-flow topology
(cycles = complected); lifecycle nesting (new scopes inside a handler that has
its own); temporal coupling beyond what types enforce.

### Layer 6: Severity

Assess blast radius, change friction, and reasoning load per finding — but
**severity does not grant dismissal**. Low-severity findings are still
findings; the user decides, not you.

### Layer 7: Suggest Simplifications

For **every** finding, propose a concrete structural alternative — pseudocode
counts. **Never label anything "essential complexity" without first designing
the simplified version**; only with it in hand can you judge, and then you
must say exactly what makes the simple version non-viable. Design questions:
cleaner boundary (what), subcomponents as arguments (who), isolated
implementation (how), queues over direct calls (when/where), declarative
policies over scattered conditionals (why).

## Fact-Check Your Own Evaluation

After all layers, **invoke `/fact-check` on your own output**. It catches
findings you talked yourself out of, "low severity" used as "ignore", bogus
essential-complexity labels, and unverified behavior claims.

**There is no Defer.** "Out of scope", "pre-existing", "orthogonal",
"follow-up refactor" are process judgments, not simplicity judgments — every
such phrase in the evaluation must correspond to an Actions entry that fixes
the finding in this PR. The PR's scope expands to absorb findings.

**Phrase shapes that mean you stopped one step early** — if these appear,
re-open the question they dismiss:

- *"X and Y share Z but are separate concerns"* — verified at the domain
  level, or just at today's layout?
- *"different consumers read different fields"* — domain difference, or how
  today's UI happens to be organized?
- *"technically could diverge, but in practice doesn't"* — "in practice" is a
  promise that won't survive refactors.
- *"each X could theoretically have its own Y"* — the classic fragmentation
  cover story.
- *"convention, not a constraint"* / *"we remember to update both"* —
  discipline is not a type system.
- *"X is the natural home for Y"* / *"Y's primary consumer is X"* — circular
  if Y already lives in X; run the alternative-placement test.
- *"the existing X is shaped for a different domain"* — "different domain,
  same kind of operation" is concept multiplication; run the Layer 3 survey
  before accepting the framing.

Revise before presenting if fact-check finds issues.

## Output Format

1. **Concerns identified**
2. **Fragmentation findings** (or an explicit "no invariants found")
3. **Concept multiplication**
4. **Structural pattern matches** — with line references
5. **Severity** per finding
6. **Simplifications** — concrete alternative for every finding
7. **Fact-check result** — including the phrase-shape check
8. **Actions** — one entry per finding from every layer (a finding that never
   reaches this section has been dismissed). Each starts with a **bolded
   label (≤8 words)**, then exactly one disposition:
   - **Fix in this PR** — the only forward action; scope expands to absorb it.
   - **No-op** — rare: the diff already deletes the code, or the finding is
     subsumed verbatim by another entry (cite it).

   Example: `**viewportDimensions complects current+default roles** — Fix in
   this PR: delete the signal, replace with per-tile FitAddon measurement.`

   "No findings" → "No actions." Findings with an empty Actions list =
   incomplete evaluation.

No "What's simple" section — praise biases the framing; absence of findings is
its own praise.

## Caveats

- Simple ≠ easy, ≠ short, ≠ familiar.
- This complements correctness review, not replaces it.
- **Do NOT run tests, builds, or shell commands** — purely analytical.
- For volatility-based decomposition, see `/lowy`.
