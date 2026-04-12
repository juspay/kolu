---
name: test
description: Run e2e tests relevant to the current changes. Selects `.feature` files based on `git diff`, runs `just test-quick`, and skips e2e when changes are server-only with no UI impact. Triggers on "run tests", "test this", "check if it works", "e2e", "test the changes".
---

# Test

Run e2e tests scoped to the current branch's changes.

## Steps

1. **Identify changed files**: Run `git diff master...HEAD --name-only` to list files changed on this branch.
2. **Select relevant feature files**: Match changed files to `.feature` files under `tests/features/`. Use file names, component names, and domain knowledge to find the right scenarios.
3. **Decide whether to run e2e**:
   - If changes touch `client/src/`, `tests/`, or `common/src/` — run the matching feature files.
   - If changes are purely server-internal (`server/src/` only) with no UI impact — unit tests may suffice. Skip e2e if no relevant scenarios exist.
4. **Run**: `just test-quick features/foo.feature` (or `just test-quick features/foo.feature:42` for a single scenario).

`just test-quick` is fast — no nix build, no separate dev server needed.
