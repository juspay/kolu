---
name: lowy
description: Evaluate architecture and module boundaries for volatility-based decomposition using Juval Lowy's framework (from "Righting Software", building on Parnas 1972). Use when reviewing module splits, service boundaries, new abstractions, or any decomposition decision. Triggers on "where should this boundary be", "how to split this", "module boundaries", "volatility", or references to Lowy, Parnas, or "Righting Software". Complements /hickey (interleaved concerns) with a change-encapsulation lens.
context: fork
agent: Explore
model: sonnet
---

# Lowy: Volatility-Based Decomposition Review

The core question: **do boundaries encapsulate axes of change, or just group
related functionality?** Sources: Juval Lowy,
[*Righting Software*](https://rightingsoftware.org/) (2019); Parnas,
["On the Criteria…"](https://www.win.tue.nl/~wstomv/edu/2ip30/references/criteria_for_modularization.pdf)
(1972).

**Key idea.** Functional decomposition groups code by what it does
(UserService, PaymentController); volatility-based decomposition groups by
what *changes*, encapsulating each axis behind a stable interface — Lowy's
electricity receptacle: enormous supply-side volatility, one stable socket.
Functional decomposition maximizes the blast radius of change.

**Two volatility types in business logic**: *sequence* volatility (workflow
order changes independently — belongs in orchestrators/Managers) and
*activity* volatility (how a step is performed changes independently —
belongs in strategies/Engines). Conflating them makes either change ripple
into the other.

**Variable vs. volatile.** Not everything that varies is volatile. *"If you
cannot clearly state what the volatility is, why it is volatile, and what risk
it poses in likelihood and effect, look further."* Decomposing around mere
variability produces over-engineered boundaries.

## Scope

The trigger is a starting point, not a frame. Default to **whole-module
scope**; cross-file boundary questions and sibling modules are in scope when
the question recurs there. Don't let the framing define the scope: if the
volatility actually lives elsewhere (the data model, a sequence/activity
split), the redirected finding is the headline.

**The graduation sweep — ask the boundary question in both directions**: did
volatility leak *into* a module (containment)? And does the diff *create*
app-local machinery hiding a hard volatility (transport, connection lifetime,
reconnection, multiplicity racing user intent) that wants its own
receptacle/package (graduation)? Name each candidate's volatility and wanted
home — as recorded opportunities, never blockers; prove-then-extract governs
*when*.

## The Evaluation

For every boundary, split, or new abstraction:

### 1. Name the Volatility

Be specific — "the payment provider", not "requirements might change". No
concrete axis → the boundary may be arbitrary.

**Project-declared areas of volatility**: read `.agency/lowy.md` if it exists
(table: area · what changes · why volatile (likelihood × effect) · expected
encapsulation). Its rows are surviving candidates, not findings and not above
review: (a) re-apply Lowy's bar and challenge rows that fail it; (b) audit
whether the boundaries under review actually encapsulate the surviving
volatilities in one place.

**Check for prior encapsulation.** Search for the canonical receptacle the
project already has for this axis (command palette for "pick a thing", generic
dialog for modal interaction, orchestrator for sequence, strategy registry for
activity, one tagged error type for failure modes). **A parallel receptacle
for an already-encapsulated axis is duplicated volatility encapsulation — a
first-class finding**, surfaced before any critique inside the new
abstraction. "New domain, same kind" duplicates the receptacle, not the
volatility. Budget: run this survey when the diff adds a new top-level
module/boundary (`git diff --diff-filter=A --name-only origin/HEAD...HEAD`
non-empty).

**Speculative volatility is not volatility** — a scenario counts only if it
has happened, is on a roadmap, or is a near-certain consequence of the domain.
**Weak volatility may not deserve its own boundary** — ask whether it
justifies the cost or folds into an existing one.

### 2. Classify

Sequence or activity? Also flag *domain decomposition* — boundaries around
domain entities (ProjectService, AccountsManager) are functional decomposition
in a domain hat.

### 3. Functional vs. Volatility Boundary

Does the boundary exist because the code *does something different*, or
because what's behind it *changes independently*? **The naming test**:
orchestrators named for the encapsulated volatility (AccountManager — good;
BillingManager — bad, the gerund signals functional grouping); engines named
for the volatile activity (SearchEngine — good; AccountEngine — bad). Can't
name it after an axis → it may not encapsulate one.

### 4. Change Blast Radius

Trace a plausible change through the modules; leaking across boundaries =
functional decomposition. **Volatility should decrease downward** — the most
depended-upon components must be the least volatile. **Check symmetry**:
similar modules should show the same calling patterns; an asymmetry (present
or absent) flags a missed axis.

### 5. Interface Stability

The receptacle doesn't change when you switch grid to solar — an interface
that changes with the encapsulated volatility is leaking. **Expose atomic
business verbs** (credit, debit, transfer), not implementation operations; an
interface mixing `OpenPort`/`ClosePort` with `ReadCode` jams two axes behind
one contract. Good interfaces are reusable (the tool-hand analogy);
implementations never are.

### 6. Reuse Signal

Reuse increases downward through layers; a lower-layer component locked to a
single consumer suggests functionality-tracking. **But single in-tree
consumer is not disqualifying when the interface is stable under the
encapsulated axis** — a receptacle with one wire plugged in is still a
receptacle (precedent: [`@kolu/surface`](https://kolu.dev/blog/surface-framework/)
and the kolu#998 graduations, all extracted at one consumer). The
disqualifying shape is *"the interface mirrors the implementation"*, not
*"one importer today"*.

### 6.5 Package Coherence

When an extraction crosses a *package* boundary, the package must read as
**one concept, one socket**. For each new published-shape package:

1. **Read the exports list as a new consumer** — one coherent thing, or a
   topic-bundle? (`@kolu/surface` exports `defineSurface` — coherent.
   `@kolu/solid-xterm@0.1` exported `createXtermWebgl` +
   `attachXtermStyleSync` + `createScrollLock` — three internal aspects
   leaked; the fix, `@0.2.0` commit
   [`4af1c647`](https://github.com/juspay/kolu/commit/4af1c647), is one
   `createSolidXterm(…)` primitive hiding them as submodules.)
2. **§5's atomic-verb rule at package altitude** — `createX_webgl` /
   `attachX_style` / `createX_scroll` is three operations on three axes, not
   one abstraction.
3. **The Surface test** — one entry point per coherent concept, internal
   submodules hidden; even exports that individually pass §5 can collectively
   fail this.
4. **The "consumer wires it together" smell** — a consumer importing several
   exports and composing them by hand means the missing primitive is the
   composition.

Verdict when it fires: not "don't extract" — **"extract one socket, not three
wires."**

### 7. The Almost-Expendable Test

Expensive to change → too big (coupled concerns). Trivially expendable → an
unnecessary boundary. *Almost* expendable — contains one axis, replaceable
with thought but not trivially — correct.

## Fact-Check Your Own Evaluation

Invoke `/fact-check` on your own output. It catches findings talked away,
functional boundaries rationalized without a named axis, untraced change
scenarios, and domain decomposition in volatility clothing.

**Phrase shapes that mean you stopped one step early**:

- *"could also be seen as encapsulating volatility"* — name the axis or it's
  functional.
- *"the interface would only need minor changes"* — minor changes are still
  leaking; the receptacle changes not at all.
- *"only used in one place, but that's fine"* — investigate; and conversely
  *"fails Lowy's reuse test"* on import count alone is a symptom, not a
  diagnosis — cite the axis (§5), not the count.
- *"follows the framework's conventions"* — convention is not volatility
  analysis.
- *"could theoretically change independently"* — no concrete scenario, no
  axis.
- *"out of scope" / "pre-existing"* — process judgment; there is no defer,
  fix it in this PR.
- *"encapsulates [domain entity]"* — entities are not axes; what *about* the
  entity changes?
- *"variable, so we should encapsulate it"* — variable is not volatile.
- *"a new kind of [picker/dialog/error] for a new domain"* — run the
  prior-encapsulation check; a parallel receptacle is duplicated
  encapsulation.
- *"each export passes §5 in isolation"* — §6.5 fires per package; read the
  exports list as a consumer and ask "what library is this?"

Revise before presenting if fact-check finds issues.

## Output Format

1. **Boundaries examined**
2. **Volatility map** — per boundary, the axis (sequence/activity) it
   encapsulates or fails to
3. **Findings** — functionality-tracking boundaries with blast-radius
   analysis; symmetry violations; layering inversions
4. **Simplifications** — concrete restructuring per finding
5. **Fact-check result** — including the phrase-shape check
6. **Actions** — one entry per finding (every finding, including
   "pre-existing"/"orthogonal" ones — a finding absent here was dismissed),
   each starting with a **bolded label (≤8 words)** and exactly one
   disposition: **Fix in this PR** (the only forward action; scope expands to
   absorb it) or **No-op** (rare: diff already deletes it, or subsumed
   verbatim by another entry). **There is no Defer.**

   Example: `**useViewport encapsulates ghost concern** — Fix in this PR:
   delete the hook, let FitAddon measure per-tile.`

## Relationship to /hickey

Complementary lenses: Hickey asks "are independent concerns interleaved?";
Lowy asks "do boundaries encapsulate axes of change?" Run both on
architectural decisions. When they disagree (Lowy: merge the shared
volatility; Hickey: a mode flag would complect), **unify the volatile axis
without complecting the strategies** — a shared module encapsulating the
volatile part while strategies stay private. If unification needs a mode flag
or type-switch, that's complecting; find the layer where it's mechanical.
