---
name: code-police
description: Review code for quality, simplicity, and common mistakes before declaring work complete.
context: fork
model: sonnet
argument-hint: "[--no-elegance]"
---

# Code Police

Review the current changes (scoped to the current branch/PR) against the rules
below plus any project rules. The three passes — rule checklist, fact-check,
elegance — run as sub-agents on fresh contexts: the implementer's main context
just wrote the diff and is biased to rationalize it; sub-agents start cold.
The orchestrator stitches their findings into one summary.

## Arguments

`--no-elegance` — skip Pass 3 entirely (report
`Elegance | – | Skipped (--no-elegance)`). Use when `/simplify` already ran
over this same tree; without the flag Pass 3 would re-invoke it for a
near-guaranteed no-op. Passes 1–2 still run.

## Project rules

Before spawning the passes, read `.agency/code-police.md` if it exists —
its rules (inline or via pointer) are additions to the built-in list, appearing
as separate Pass 1 rows under the project's rule IDs. Missing file → built-in
rules only.

## Reviewing principles

Apply to every pass, and to the orchestrator (push back on a sub-agent that
violates them rather than laundering its dismissal into the summary):

- **NEVER talk yourself out of a finding.** No "However…", no "acceptable
  tradeoff", no "theoretically X but practically Y".
- **NEVER issue "no action needed"** on a finding you just described, and
  never end with reassurance unless you genuinely found zero issues.
- **Assume the code is wrong until proven right** — prosecutor, not defense.

## Rules

### dry-rule-of-three

Two similar instances are fine; three is the threshold for extraction. But
identical content that must stay in sync (same HTML, version string, port,
path) is deduplicated immediately regardless of count.

### prefer-focused-library

Before hand-rolling a utility (tokenizer, parser, date/semver/URL helper, arg
parser, tree walker, path normalizer…), search for a focused library — and
prefer it even as a new dependency when scope and bundle cost fit. "Zero deps"
is an easiness judgment: code you don't own doesn't bitrot and its edge cases
are someone else's problem. Hand-roll only when the library adds surface you
actively don't want, or the hand-roll is genuinely a few branch-free lines.
Neither "it's already in the tree" nor "only ~40 lines" gates this — judge
scope fit and bundle cost, in both directions (left-pad exists).

### invalid-states-unrepresentable

Discriminated unions, not booleans or stringly-typed fields. If two fields
can't both be `undefined`, the type says so.

### no-dead-code

Aggressively remove unused code — no commented-out blocks, no "just in case".

### no-silent-error-swallowing

No empty `catch {}`, bare `catch: pass`, or `|| true`. At minimum log; an
intentional best-effort catch carries a comment saying why ignoring is safe.

### no-unbounded-growth

Collections, buffers, and listeners that grow with usage need a bound or
cleanup path: cap or evict arrays pushed from handlers; debounce/throttle
high-frequency sources (`fs.watch`, `resize`, `scroll`, `onmessage`) unless
the handler is O(1) and allocation-free; stream instead of whole-file buffers
when the source can grow; share watchers instead of per-caller installs.
LLM-generated code defaults to the simplest correct implementation, which is
often O(n) in session lifetime — fix at write time (cap, debounce, stream,
share); it's rarely caught in review because the code is functionally correct.

### comment-the-non-obvious

At every non-trivial declaration or block, ask: can a reader who didn't write
this tell **what it does** or **why this shape**? Write the comment that
supplies whichever is missing (design intent, control-flow semantics, a hidden
constraint types don't carry). "Obvious to me because I just wrote it" is the
failure mode.

## Running the passes

Spawn Pass 1 and Pass 2 as **two parallel read-only sub-agents**
(`subagent_type: "Explore"`; both `Agent` blocks in one response). Each prompt
is self-contained and points at this file for the rules-of-record. Pass 3 runs
**after** they return (it applies fixes and would race their reads); skip it
under `--no-elegance`. Then stitch all outputs into the summary.

**Pass 1 (rule checklist)** — sub-agent prompt must direct it to: read the
"Reviewing principles" and "Rules" sections of
`.apm/skills/code-police/SKILL.md` plus `.agency/code-police.md` if present;
scope to `git diff origin/HEAD...HEAD` (or the appropriate base ref); and
return one table covering **every** rule (built-in + project):

| Rule ID | Violation found? | What was identified | Action taken |
| ------- | ---------------- | ------------------- | ------------ |

Every "No" requires a **`Checked by:`** field — the grep that confirmed
absence (negative rules), or the enumeration of positive candidates ruled out
(bidirectional rules like `comment-the-non-obvious`). A "No" without
`Checked by:` is malformed. No skipped rows, no fixes applied (the
orchestrator routes them).

**Pass 2 (fact-check)** — sub-agent prompt must direct it to: read the
"Reviewing principles" and apply them verbatim; scope as above; this is a
**logic** review, not style — find where the code lies to itself: silent error
swallowing, inaccurate fallbacks (defaults masking misconfiguration), wishful
thinking (unvalidated boundary inputs, "can't fail" code that can, races
papered over with comments), logic errors (always-true conditions, off-by-one,
shadowing), and slow leaks (unbounded growth, undebounced hot handlers,
per-caller watchers). Fail loud over fail silent; every fallback justified for
the failure case; precision over coverage (3 real issues beat 20 maybes). Per
finding: file, line, one-line risk, concrete fix. No fixes applied.

**Pass 3 (elegance)** — skip under `--no-elegance`; skip when the diff is
under 10 lines (`Elegance | 0 | Skipped (tiny diff)`) — the fan-out overhead
is disproportionate there. Otherwise: under Claude Code, invoke the bundled
`/simplify` via the Skill tool (three parallel lenses, applies fixes). On
harnesses without it, run 3 iterations of understand → research → apply →
verify, preferring fewer lines, clearer intent, idiomatic style — remove
abstractions, don't add them. The reviewing principles bind here too.

## Output

| Pass       | Issues found | Details                  |
| ---------- | ------------ | ------------------------ |
| Rules      | N            | Brief summary or "Clean" |
| Fact-check | N            | Brief summary or "Clean" |
| Elegance   | N            | Brief summary or "Clean" |

Below the table, reproduce each pass's full findings verbatim (so a caller
like `/do` can commit each violation individually). Any pass found issues →
state **"Violations or issues found"**; all clean → **"All clear"**.

## Additional principles

- **Simple, not easy**: modules do one thing; data flows through arguments
  and returns, not shared mutable state. No interfaces with one implementor,
  no "for future use" code, plain data over objects with behavior.
- **Completeness**: implement the full spec; run tests and local CI before
  declaring done.
- **Justfile**: every recipe carries a doc comment.
- **Volatility-based module structure**: group by rate of change; each module
  owns one volatility zone; shared constants get their own file.
- **Readability**: exported types and components get doc comments; extract
  deeply nested callbacks into named functions.
