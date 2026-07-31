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
- **Proposed fix:** pin the isolated Atlas project to TypeScript 6.0.3, whose
  `tsc` entry point is the JavaScript compiler and therefore cannot enter the
  crashing TypeScript-Go parser. Keep the rest of the repository on TypeScript
  7, and validate the containment with repeated `atlas::check-sync` runs on
  `ci@petit`.
- **Implementation:** Atlas now pins exact TypeScript 6.0.3 rather than the
  TypeScript 7 Go compiler.
- **Fix verification:** the installed 6.0.3 `tsc` executable is a Node entry
  point loading `lib/tsc.js`, so the crashing Go parser is absent from this
  gate. Local `atlas::check-sync` passed its typecheck, 23 helper tests, fresh
  build comparison, and scrambled-locale idempotency build. Targeted
  two-platform run `de8c863#5` then passed `ci::atlas-sync` on `ci@petit` and
  `kolu-ci-1`.

## E2E stabilization streak

The streak starts after the first e2e-flake fix above. Every run covers both
platforms on `ci@petit` and `kolu-ci-1`. Any red full-CI run resets the
consecutive-green count, and any subsequent code change starts a fresh streak.
Every failure is recorded with evidence, root cause, and a proposed fix; every
failure fixable in this repository is in scope.

| Attempt | Commit | Result | Consecutive green |
| --- | --- | --- | --- |
| `3a6c829#1` | `3a6c8295f` | Failed: `ci::osfacts-live@aarch64-darwin`; both e2e nodes passed | `0/5` |
| `dd08e43#1` | `dd08e434d` | Passed | `1/5` |
| `3b57b1f#1` | `3b57b1f9c` | Passed | `2/5` |
| `de10685#1` | `de1068524` | Passed | `1/5` |
| `a454147#1` | `a4541473f` | Passed | `2/5` |
| `7594e7d#1` | `7594e7d1a` | Failed: `ci::fmt@x86_64-linux`; all other nodes passed | `0/5` |
| `37cebaa#1` | `37cebaafc` | Failed: `ci::unit@aarch64-darwin`; all other nodes passed | `0/5` |
| `67b890f#1` | `67b890fff` | Failed: `ci::fmt@aarch64-darwin`; all other nodes passed | `0/5` |
| `650da7f#1` | `650da7f8e` | Passed | `1/5` |
| `7d22bf3#1` | `7d22bf331` | Passed | `2/5` |

**Current active streak: `2/5`.** The first two green runs above predate the
osfacts-live fix prompted by `3a6c829#1`.

### `3a6c829#1`: Darwin osfacts-live process-exit race

- **Failure:** the live-host oracle selected 12 foreign processes from `ps`,
  then asserted that osfacts returned 12 process rows. It received 11.
- **Root cause:** PID 266 exited between the `ps` candidate snapshot and the
  osfacts read. The test treats that expected live-host disappearance as a
  product mismatch before reaching its per-process assertions.
- **Evidence:** osfacts explicitly returned `ESRCH` for every requested facet
  of PID 266 (`proc`, `mem`, `start_time`, `cpu_time`, and `uid`) and returned
  facts for each of the other 11 candidates. The failing assertion compared 11
  `P` rows with all 12 earlier `ps` rows. See
  `.ci/3a6c829/aarch64-darwin/ci::osfacts-live.log`.
- **Proposed fix:** make the live oracle re-read `ps` after osfacts and exclude
  only candidates that both disappeared from `ps` and received `ESRCH` for
  their process facet. Continue requiring exact identity and start facts for
  every surviving candidate.
- **Implementation:** the Darwin oracle now takes the second `ps` snapshot,
  distinguishes a retired or reused PID from the same live process, and accepts
  a missing process row only when osfacts also emitted `proc ESRCH`. All facts
  remain mandatory for every surviving process.
- **Fix verification:** targeted Darwin run `907acfd#1` passed
  `ci::osfacts-live` and its dependency closure on `ci@petit`.

### `7594e7d#1`: Linux fmt, unformatted generated font CSS

- **Failure:** Biome included the generated Nix-store `fonts.css` and rejected
  its source formatting even though `packages/client/public/fonts` is ignored
  explicitly in `biome.jsonc`.
- **Root cause:** the Nix font generator emits CSS that does not satisfy
  Biome's formatter. A full concurrent CI traversal can reach the symlink's
  canonical Nix-store target despite the repository-path ignore, making that
  latent formatting defect part of the checked file set.
- **Evidence:** the failure names the canonical Nix-store file rather than
  `packages/client/public/fonts/fonts.css`. The CI checkout has the ignored
  repository path as a symlink to that exact store directory, and rerunning the
  same Biome command after the symlink stabilized checked 1,732 files and
  passed. The failing concurrent run checked 1,733 files. The formatter's
  proposed output identifies the two long `unicode-range` declarations and a
  trailing blank line produced by `nix/packages/fonts/default.nix`. The same
  generated-output failure later recurred on Darwin after the atomic-symlink
  experiment, ruling out the replacement window as the cause. See
  `.ci/7594e7d/x86_64-linux/ci::fmt.log` and
  `.ci/67b890f/aarch64-darwin/ci::fmt.log`.
- **Proposed fix:** generate `fonts.css` in Biome-normal form: split each long
  `unicode-range` declaration at the property boundary and remove the extra
  trailing newline. Then the file passes regardless of whether traversal sees
  the ignored repository symlink or its canonical store target.
- **Implementation:** the generator now emits each long `unicode-range` in
  Biome's multiline form and removes the Nix indented string's extra trailing
  newline. The atomic-symlink experiment was removed because the Darwin
  recurrence disproved it as a fix.
- **Fix verification:** the rebuilt `kolu-fonts` derivation's `fonts.css`
  passed a direct Biome format check, ends with exactly one newline, and local
  full-repository formatting passed over 1,732 files. Targeted two-platform run
  `de8c863#5` then passed `ci::fmt` on `ci@petit` and `kolu-ci-1`.

### `67b890f#1`: Darwin fmt, same generated font CSS defect

- **Failure:** `ci::fmt@aarch64-darwin` checked the generated
  `/nix/store/...-kolu-fonts/fonts.css` and rejected the same two
  `unicode-range` declarations and trailing blank line seen on Linux.
- **Root cause:** the Nix font generator emits CSS outside Biome's normal form,
  and this run's traversal included its canonical Nix-store output.
- **Evidence:** the log names the canonical store target, reports 1,733 checked
  files, and prints the exact generator-owned edits for both `unicode-range`
  declarations plus the final blank line. This recurrence happened with the
  atomic symlink code in place, directly ruling out the earlier replacement
  race diagnosis. See `.ci/67b890f/aarch64-darwin/ci::fmt.log`.
- **Proposed fix:** make `nix/packages/fonts/default.nix` emit the exact
  Biome-normal layout and verify that generated output directly before
  restarting the full-CI streak.
- **Implementation:** the generator now emits the exact formatter-normal
  layout. The generated derivation passed direct local formatting, followed by
  `ci::fmt` on both platforms in targeted run `de8c863#5`.

### `37cebaa#1`: Darwin unit workspace fanout killed

- **Failure:** `ci::unit@aarch64-darwin` ended by signal 9 as the Kaval package
  suite started.
- **Root cause:** this was not a failed test: the top-level pnpm command was
  externally SIGKILLed during its unbounded workspace-package fanout. The unit
  recipe adds that package concurrency inside a CI node already running beside
  the other full-pipeline nodes.
- **Evidence:** the log shows several package Vitest processes running
  concurrently, every completed package passing, then
  `packages/kaval test:unit$ vitest run`, `packages/kaval test:unit: Failed`,
  and the recipe terminating by signal 9 with no Vitest failure output. A host
  process snapshot during the still-running pipeline showed the concurrent
  Node and Chromium processes occupying hundreds of MiB each. See
  `.ci/37cebaa/aarch64-darwin/ci::unit.log`.
- **Proposed fix:** run the CI unit workspace with
  `--workspace-concurrency=1`, the same explicit resource bound already used by
  the heavier daemon-test node. Preserve the existing per-package Vitest
  parallelism.
- **Implementation:** `ci::unit` now applies that package-level concurrency
  bound.
- **Fix verification:** targeted Darwin run `5a8461c#1` passed `ci::unit` on
  `ci@petit`.

## Targeted verification runs

These CI runs verify a fix on its affected platform but do not count toward the
full two-platform green streak.

| Run | Commit | Scope | Host | Result |
| --- | --- | --- | --- | --- |
| `907acfd#1` | `907acfd2f` | `osfacts-live@aarch64-darwin` and dependencies | `ci@petit` | Passed |
| `e00cbe5#1` | `e00cbe551` | `fmt@x86_64-linux` | `kolu-ci-1` | Passed |
| `5a8461c#1` | `5a8461cb7` | `unit@aarch64-darwin` | `ci@petit` | Passed |
| `de8c863#5` | `de8c86315` | `fmt` and `atlas-sync` on both platforms | `ci@petit`, `kolu-ci-1` | Passed |
