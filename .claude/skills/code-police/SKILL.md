---
name: code-police
description: Review code for quality, simplicity, and common mistakes before declaring work complete.
---

# Code Police

Review the current changes against **every rule in `code-police.yaml`** (in this skill's directory). That file is the primary checklist — read it first.

Additionally, run the three review passes below in order.

## Pass 1: Rule checklist

Present a table with **every rule from `code-police.yaml`**:

| Rule ID | Violation found? | What was identified | Action taken |
| ------- | ---------------- | ------------------- | ------------ |

If no violation was found for a rule, mark it as "No" with a brief note on what was checked. Every rule must appear in the table — no skipping.

## Pass 2: Fact-check

Audit the changes for **correctness and rigor**. This is not a style review — it's a logic review. Find places where the code lies to itself.

Flag:

- **Silent error swallowing** — bare `try/catch: pass`, empty `catch {}`, `|| true`, errors caught but not propagated, `Result`/`Option` silently defaulted.
- **Inaccurate fallbacks** — defaults masking misconfiguration, "sensible defaults" that aren't sensible for the failure case, fallback paths that silently degrade correctness.
- **Wishful thinking** — assumptions about input shape without validation at boundaries, code that "can't fail" but actually can, race conditions papered over with comments.
- **Logic errors** — always-true/false conditions, off-by-one, wrong operators, shadowed variables.

For each finding: file, line, one-line risk, concrete fix. If no issues, say so — don't invent problems.

**Anti-patterns in YOUR review (strictly banned):**

- NEVER talk yourself out of a finding. If you identified a problem, it IS a problem. No "However..." or "acceptable tradeoff."
- NEVER use "theoretically X but practically Y" to dismiss fragility.
- NEVER issue "no action needed" on a finding you just described.
- Assume the code is wrong until proven right.

## Pass 3: Elegance

Invoke the `/elegance` command via the Skill tool: `skill: "elegance"`. Scope to changes in the current branch/PR only. When `/elegance` asks about scope, answer: **changes in the current branch/PR only**.

## Output

After all three passes, present a combined summary:

| Pass       | Issues found | Details                  |
| ---------- | ------------ | ------------------------ |
| Rules      | N            | Brief summary or "Clean" |
| Fact-check | N            | Brief summary or "Clean" |
| Elegance   | N            | Brief summary or "Clean" |

If ANY pass found issues, clearly state: **"Violations or issues found"** so the workflow orchestrator can route to a fix node.

If all passes are clean, state: **"All clear"**.

## Additional principles

### Simple, not easy (Rich Hickey)

Simple means _not interleaved_. Each module does one thing. Data flows through arguments and return values, not shared mutable state or indirection.

- No unnecessary abstractions. If a thing has one implementor, it doesn't need an interface/base class.
- No "for future use" code. Build what's needed now.
- Prefer plain data over objects with behavior.

### Styling

- Tailwind utilities only in markup. No custom CSS unless truly impossible with Tailwind.

### Completeness

- Implement the full spec. Read the plan/requirements and check every deliverable.
- Run CI locally before declaring done.
- Run tests.

### Justfile

- Every recipe must have a doc comment (line starting with `#` above the recipe name).

### Module structure — volatility-based decomposition

Group code by _rate of change_, not by technical layer. Things that change together live together; things that change independently get separate modules.

- Each module should own one volatility zone. If a module mixes concerns with different change-rates, split it.
- UI components get their own file (`client/src/Header.tsx`, not inlined in `App.tsx`).
- Shared constants used by multiple modules (e.g., theme colors) get their own file to avoid coupling unrelated modules.

### Readability

- Every exported type and every component needs a doc comment.
- Avoid deeply nested callbacks. Extract into named functions.
