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
- **Root cause:** the Code tab treated a settled but stale `fs.listAll`
  inventory as authoritative. It consumed the open request before resolving
  it; resolution returned no match, and the consumed request could not run
  again when the inventory later refreshed. No Pierre file view was therefore
  mounted.
- **Evidence:** a controlled single-scenario run on `kolu-ci-1` reproduced the
  same timeout with the adjacent exact-path case, `plain.txt`. The file-creation
  step passed, but instrumentation at the resolution tick recorded
  `pathCount: 0`, `exactPathPresent: false`, and `isPending: false`, followed by
  the toast `File reference not found: plain.txt` and no mounted view. Source
  inspection closes the causal chain: `resolveRef` can resolve that exact path
  only from `repoPaths`, while `CodeTab` assigns `consumedRequest = req` before
  calling `resolveRef`; a later inventory update cannot replay the request.
  This also demonstrates that the failure is not specific to the
  unique-basename fallback.
- **Proposed fix:** on a not-found verdict, refresh `fs.listAll` and keep the
  request eligible until resolution has run against that fresh inventory.
  Consume the request only after it resolves, or after the refreshed
  authoritative inventory also proves the path absent. Add an e2e regression
  that creates a file immediately before clicking its terminal reference and
  verifies that the request survives the initial stale settled snapshot.
- **Implementation:** the Code-tab open pipeline now checks an initial miss
  against a direct fresh browse inventory before consuming the request. The
  existing file-ref scenarios already create each target immediately before
  clicking it, including the exact-path and unique-basename cases that exposed
  this race.
- **Fix verification:** `kolu-client` passed all 1,181 unit tests. On
  `kolu-ci-1`, `features/file-ref-link.feature` passed all 12 scenarios and 136
  steps with zero retries, including both immediate-create cases.

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

## E2E stabilization streak

The streak starts after the first e2e-flake fix above. Every run covers both
platforms on `ci@petit` and `kolu-ci-1`. Any red full-CI run resets the
consecutive-green count. Every failure is recorded with evidence, root cause,
and a proposed fix; fixes in this PR remain limited to e2e failures.

| Attempt | Commit | Result | Consecutive green |
| --- | --- | --- | --- |
