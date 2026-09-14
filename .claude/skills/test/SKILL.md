---
name: test
description: Run this repo's tests scoped to the current changes — the unit lane (`just test-unit` / a `--filter`ed vitest run) and the e2e lane (`.feature` files selected from `git diff`, run via `just test-quick`), plus which lane a diff needs and where it is safe to run. Triggers on "run tests", "test this", "check if it works", "unit tests", "vitest", "e2e", "test the changes".
---

# Test

Run tests scoped to the current branch's changes. Two lanes: **unit** (vitest, §Unit lane) and **e2e** (Cucumber + Playwright, §Steps).

## Unit lane — the invocations, so you never re-derive them

Don't go hunting through the `justfile` or a `package.json` for how to run vitest here; these four forms are the whole surface. `pnpm` and `vitest` are **not** on a bare `$PATH` — every form below either is a `just` recipe or must be prefixed with `nix develop -c`.

| Reach | Command |
| --- | --- |
| Whole workspace, fork-free | `just test-unit` |
| One package | `nix develop -c pnpm --filter <pkg> test:unit` — or `test:daemon` for a daemon-forking package (see below) |
| One or more files | `nix develop -c pnpm --filter <pkg> exec vitest run src/foo.test.ts` |
| Daemon-forking suites (CI / `pu` box **only**) | `just test-daemon` |

- **A package declares exactly ONE lane script: `test:unit` or `test:daemon`.** The 13 whose suites fork real daemons or PTYs — `kaval`, `kaval-tui`, `@kolu/padi`, `kolu-server`, `kolu-cli`, `@kolu/surface`, `@kolu/surface-daemon`, `@kolu/surface-daemon-supervisor`, `@kolu/surface-remote`, `@kolu/port-forward`, `kolu-pty`, `kolu-pi`, `kolu-claude-code` — declare `test:daemon`, so `just test-unit` skips them; everything else declares `test:unit`. `pnpm --filter <pkg> test:unit` on a daemon-lane package fails with "no script" — read its `package.json` rather than guessing. A per-package `test:daemon` still needs `KOLU_DAEMON_TESTS=1` to un-skip its gated blocks, plus the venue gate below.
- **`<pkg>` is the `name` from that package's own `package.json`, and it is not uniformly `@kolu/…`** — the apps are bare (`kolu-server`, `kolu-client`, `kolu-common`) while the libraries are scoped (`@kolu/surface-remote`). Read the name; don't guess it. `--filter` repeats to span packages: `pnpm --filter kolu-server --filter @kolu/surface-remote test:unit`.
- **A fresh worktree has no `node_modules`.** `just test-unit` / `just test-daemon` depend on the `install` recipe, so they bootstrap themselves; the two `--filter` forms do **not** — run `just install` once first when `node_modules/` is absent, rather than reading a missing-module error as a broken test.
- **`just test-daemon` never runs beside a live kolu.** Its suites fork real kaval/padi daemons and PTYs; a workstation run OOM-reaped production kaval in [#1375](https://github.com/juspay/kolu/issues/1375). Apply the same venue gate as step 4 below.
- Narrow to the packages the diff touches — the whole-workspace run is the fallback, not the default, when you already know which package changed.

## Steps

1. **Identify changed files**: Run `git diff master...HEAD --name-only` to list files changed on this branch.
2. **Select relevant feature files**: Match changed files to `.feature` files under `packages/tests/features/`. Use file names, component names, and domain knowledge to find the right scenarios.
3. **Decide whether to run e2e**:
   - If changes touch `packages/client/src/`, `packages/tests/`, or `packages/common/src/` — run the matching feature files.
   - If changes are purely server-internal (`packages/server/src/` only) with no UI impact — the unit lane may suffice; run it with the §Unit lane invocations. Skip e2e if no relevant scenarios exist.
4. **Decide where it runs — pu box, not locally, whenever production is live.** `just test-quick` builds the client and spawns a server: that is **heavy work**, and it goes on an ephemeral pu box (see `/pu` / `/evidence`) any time `systemctl --user is-active kolu` is `active` (the normal case). A pile-up of local e2e runs OOM-`SIGKILL`ed production `kolu.service` beside this command before — "fast" is not "safe to run beside production." Apply `/dev-server` §0's local-vs-pu venue gate before invoking it, and run locally **only** when production is `inactive` here.
5. **Run**: `just test-quick features/foo.feature` (or `just test-quick features/foo.feature:42` for a single scenario).
6. **Re-run the feature-scoped suite after *later* commits touching that feature's path — before you push.** A green run at commit N is no evidence about commit N+4: a simplify/police/debate cleanup lands in the same files and nothing re-exercises them. One feature file is ~8 s, far cheaper than a CI cycle, and it is the only thing that catches such a regression locally. In [#1982](https://github.com/juspay/kolu/pull/1982) the ports scenarios were verified at `f199c421`, four cleanup commits followed, and CI became the first thing to exercise the final tree — surfacing a false-green e2e guard as a phantom product bug.

`just test-quick` is fast — no nix build, no separate dev server needed — but **fast is not local-by-default**: see step 4.
