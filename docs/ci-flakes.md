# CI flake log

This document tracks failures found while repeatedly running the full CI
pipeline on `ci@petit` and a Linux `pu` box. A failure is not added until its
root cause has been identified from the run logs and supporting evidence.

## Run rules

- Run both `aarch64-darwin` and `x86_64-linux` every time.
- Pin Darwin to `ci@petit` and Linux to a `pu` box.
- Record the exact odu run identity, commit, hosts, and result.
- Do not classify a red node as a flake merely because a later run passes.
- Record the root cause and evidence alongside every failure.
- Do not record guesses or hypotheses as root causes. A root cause is accepted
  only when direct log evidence, source inspection, or a controlled
  reproduction demonstrates the causal chain. Keep it unresolved until then.

## Runs

| Run | Commit | Darwin host | Linux host | Result |
| --- | --- | --- | --- | --- |
| `610a019#1` | `610a01979` | `ci@petit` | `kolu-ci-1` | Passed |
| `fba3b95#1` | `fba3b9542` | `ci@petit` | `kolu-ci-1` | Passed |
| `fba3b95#2` | `fba3b9542` | `ci@petit` | `kolu-ci-1` | Passed |
| `fba3b95#3` | `fba3b9542` | `ci@petit` | `kolu-ci-1` | Failed: `ci::e2e@x86_64-linux` |
| `fba3b95#4` | `fba3b9542` | `ci@petit` | `kolu-ci-1` | Failed: `ci::atlas-sync@aarch64-darwin` |

## Failures

### `fba3b95#3`: Linux e2e, unique-basename file ref

- **Failure:** `features/file-ref-link.feature:178`, "Bare basename without a
  line number resolves via unique-basename fallback."
- **Observed evidence:** both Cucumber attempts reached the Code tab, then
  timed out after 60 seconds waiting for either
  `[data-testid="pierre-diff-view"]` or
  `[data-testid="pierre-file-view"]` to mount. The run finished with 506 of
  507 scenarios passing. See
  `.ci/fba3b95/x86_64-linux/ci::e2e.log`.
- **Root cause:** under investigation. The observation above does not prove
  why the file view failed to mount, so no cause is asserted yet.
- **Proposed fix:** pending root-cause proof. No implementation is proposed
  while the causal chain is unresolved.

### `fba3b95#4`: Darwin atlas-sync, TypeScript-Go parser panic

- **Failure:** `pnpm check` reached `astro sync && tsc --noEmit`; `astro sync`
  completed, then TypeScript-Go panicked with `ScriptKind must be specified
  when parsing source file` for an extensionless path under
  `/Users/ci/Library/pnpm/store/v10/files/`.
- **Root cause:** TypeScript-Go received the extensionless pnpm content-store
  path for a TypeScript declaration and could not infer its script kind. Its
  parser panicked instead of completing the Atlas typecheck.
- **Evidence:** the panic stack names `parser.initializeState` and the exact
  extensionless store path. Read-only inspection on `ci@petit` showed that
  path has 77 hard links and is the same inode as
  `@shikijs/engine-oniguruma/dist/index.d.mts` in the run checkout; its
  contents are TypeScript declarations. This directly connects the
  extensionless path in the panic to the `.d.mts` input whose script kind was
  lost. See `.ci/fba3b95/aarch64-darwin/ci::atlas-sync.log`.
- **Proposed fix:** reduce this case to an upstream TypeScript-Go regression
  test that passes the logical `.d.mts` path through pnpm's hard-linked store,
  then pin Atlas to the last non-panicking TypeScript release until that
  regression is fixed. Validate the chosen pin with repeated
  `atlas::check-sync` runs on `ci@petit`.
