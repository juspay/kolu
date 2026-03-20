---
name: code-review
description: Review code for quality, simplicity, and common mistakes before declaring work complete.
---

# Code Review

Review the current changes against these principles. Flag any violations.

## Simple, not easy (Rich Hickey)

Simple means *not interleaved*. Each module does one thing. Data flows through arguments and return values, not shared mutable state or indirection.

- No unnecessary abstractions. If a thing has one implementor, it doesn't need a trait/interface.
- No "for future use" code. Build what's needed now.
- Prefer plain data over objects with behavior.

## DRY (with Rule of Three)

- Two similar instances are fine — don't abstract prematurely. Three is the threshold for extraction.
- But *identical* content that must stay in sync (same HTML, same version string) should be deduplicated immediately regardless of count.
- Versions, ports, paths — define once, reference everywhere.

## Make invalid states unrepresentable

- Use enums/sum types, not booleans or stringly-typed fields.
- If two fields can't both be `None` at the same time, model that in the type.

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

## Module structure

- Each module should own one concern. If a module mixes two domains (e.g. WebSocket + PTY), either split it or add a module-level doc comment explaining why it's intentionally glue.
- UI components get their own file (`client/src/header.rs`, not inlined in `main.rs`).
- Large async blocks (`spawn_local`, `spawn`) should be extracted into named functions — the name documents what the block does.

## Readability

- Closure-heavy code (e.g. wasm-bindgen callbacks) should be broken into small named functions. Don't nest 5+ closures in one scope.
- Every public type and every `#[component]` needs a doc comment.
- Structs with non-obvious fields need field-level comments.

## Comments

- Add comments where the *why* isn't obvious from the code. Don't comment the *what*.
- Non-trivial build pipelines (WASM, cross-compilation, multi-stage) deserve step-by-step comments.
