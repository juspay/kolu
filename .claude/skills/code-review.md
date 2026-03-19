---
name: code-review
description: Review code for quality, simplicity, and common mistakes before declaring work complete.
user_invocable: true
---

# Code Review

Review the current changes against these principles. Flag any violations.

## Simple, not easy (Rich Hickey)

Simple means *not interleaved*. Each module does one thing. Data flows through arguments and return values, not shared mutable state or indirection.

- No unnecessary abstractions. If a thing has one implementor, it doesn't need a trait/interface.
- No "for future use" code. Build what's needed now.
- Prefer plain data over objects with behavior.

## DRY

- Don't duplicate logic, config, or content across files. If two files must stay in sync, extract the shared part.
- Versions, ports, paths — define once, reference everywhere.

## Completeness

- Implement the full spec. Read the plan/requirements and check every deliverable.
- Run CI locally before declaring done.
- Run tests.

## Justfile

- Every recipe must have a doc comment (line starting with `#` above the recipe name).

## Gitignore

- Build artifacts, generated files, and editor/tool directories must be gitignored.
- Never commit secrets, credentials, or node_modules.

## Comments

- Add comments where the *why* isn't obvious from the code. Don't comment the *what*.
- Non-trivial build pipelines (WASM, cross-compilation, multi-stage) deserve step-by-step comments.
