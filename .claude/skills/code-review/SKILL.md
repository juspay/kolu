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

## Completeness

- Implement the full spec. Read the plan/requirements and check every deliverable.
- Run CI locally before declaring done.
- Run tests.

## Justfile

- Every recipe must have a doc comment (line starting with `#` above the recipe name).

## Comments

- Add comments where the *why* isn't obvious from the code. Don't comment the *what*.
- Non-trivial build pipelines (WASM, cross-compilation, multi-stage) deserve step-by-step comments.
