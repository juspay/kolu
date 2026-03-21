---
name: code-review
description: Review code for quality, simplicity, and common mistakes before declaring work complete.
---

# Code Review

Review the current changes against these principles. Flag any violations.

## Simple, not easy (Rich Hickey)

Simple means _not interleaved_. Each module does one thing. Data flows through arguments and return values, not shared mutable state or indirection.

- No unnecessary abstractions. If a thing has one implementor, it doesn't need an interface/base class.
- No "for future use" code. Build what's needed now.
- Prefer plain data over objects with behavior.

## DRY (with Rule of Three)

- Two similar instances are fine — don't abstract prematurely. Three is the threshold for extraction.
- But _identical_ content that must stay in sync (same HTML, same version string) should be deduplicated immediately regardless of count.
- Versions, ports, paths — define once, reference everywhere.

## Make invalid states unrepresentable

- Use discriminated unions, not booleans or stringly-typed fields.
- If two fields can't both be `undefined` at the same time, model that in the type.

## Dead code

- Aggressively remove unused code. No commented-out blocks, no "just in case" leftovers.

## Styling

- Tailwind utilities only in markup. No custom CSS unless truly impossible with Tailwind.

## Completeness

- Implement the full spec. Read the plan/requirements and check every deliverable.
- Run CI locally before declaring done.
- Run tests.

## Justfile

- Every recipe must have a doc comment (line starting with `#` above the recipe name).

## Module structure — volatility-based decomposition

Group code by _rate of change_, not by technical layer. Things that change together live together; things that change independently get separate modules.

- Each module should own one volatility zone. If a module mixes concerns with different change-rates, split it.
- UI components get their own file (`client/src/Header.tsx`, not inlined in `App.tsx`).
- Shared constants used by multiple modules (e.g., theme colors) get their own file to avoid coupling unrelated modules.

## Readability

- Every exported type and every component needs a doc comment.
- Avoid deeply nested callbacks. Extract into named functions.

## Comments

- Add comments where the _why_ isn't obvious from the code. Don't comment the _what_.
