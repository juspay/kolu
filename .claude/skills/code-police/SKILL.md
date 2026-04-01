---
name: code-police
description: Review code for quality, simplicity, and common mistakes before declaring work complete.
---

# Code Police

Review the current changes against **every rule in `code-police.yaml`** (in this skill's directory). That file is the primary checklist — read it first.

Additionally, check the principles below.

## Output

Present a table with **every rule from `code-police.yaml`**:

| Rule ID | Violation found? | What was identified | Action taken |
| ------- | ---------------- | ------------------- | ------------ |

If no violation was found for a rule, mark it as "No" with a brief note on what was checked. Every rule must appear in the table — no skipping.

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
