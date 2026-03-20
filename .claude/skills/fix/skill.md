---
name: fix
description: Fix a bug by first writing a failing e2e test, then identifying the root cause, then implementing the fix.
---

# Fix Bug

Given a user-provided bug report, fix it using this workflow:

## 1. Write a failing test

- Add a Cucumber scenario in `tests/features/` that reproduces the bug.
- Add step definitions in `tests/step_definitions/` if needed.
- Run the test to confirm it fails (or document why the bug can't be reproduced in headless e2e — e.g. TUI rendering issues).

## 2. Identify root cause

- Read the relevant source code. Trace the data/control flow that triggers the bug.
- Do NOT guess or hallucinate. If unsure, read more code or add logging.
- Present the root cause to the user before proceeding with the fix.

## 3. Fix it

- Implement the minimal fix.
- Run `cargo clippy --workspace` — no warnings.
- Run the test from step 1 to confirm it passes.
- Run `just pc` (pre-commit hooks).
