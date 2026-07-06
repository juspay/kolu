---
name: test
description: Run e2e tests relevant to the current changes. Selects `.feature` files based on `git diff`, runs `just test-quick`, and skips e2e when changes are server-only with no UI impact. Triggers on "run tests", "test this", "check if it works", "e2e", "test the changes".
---

# Test

Run e2e tests scoped to the current branch's changes.

## Steps

1. **Identify changed files**: Run `git diff master...HEAD --name-only` to list files changed on this branch.
2. **Select relevant feature files**: Match changed files to `.feature` files under `packages/tests/features/`. Use file names, component names, and domain knowledge to find the right scenarios.
3. **Decide whether to run e2e**:
   - If changes touch `packages/client/src/`, `packages/tests/`, or `packages/common/src/` — run the matching feature files.
   - If changes are purely server-internal (`packages/server/src/` only) with no UI impact — unit tests may suffice. Skip e2e if no relevant scenarios exist.
4. **Decide where it runs — pu box, not locally, whenever production is live.** `just test-quick` builds the client and spawns a server: that is **heavy work**, and it goes on an ephemeral pu box (see `/pu` / `/evidence`) any time `systemctl --user is-active kolu` is `active` (the normal case). A pile-up of local e2e runs OOM-`SIGKILL`ed production `kolu.service` beside this command before — "fast" is not "safe to run beside production." Apply `/dev-server` §0's local-vs-pu venue gate before invoking it, and run locally **only** when production is `inactive` here.
5. **Run**: `just test-quick features/foo.feature` (or `just test-quick features/foo.feature:42` for a single scenario).

`just test-quick` is fast — no nix build, no separate dev server needed — but **fast is not local-by-default**: see step 4.
