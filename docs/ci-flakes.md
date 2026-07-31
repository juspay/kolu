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
| `aef3f80#1` | `aef3f8067` | Passed | `3/5` |
| `222d3f0#1` | `222d3f08f` | Passed | `4/5` |
| `06ff590#1` | `06ff590dd` | Passed | `5/5` |

**Completed pre-review streak: `5/5` at `06ff590#1`. Completed post-review
streak: `5/5` at `07b5e88#1`.** The first two green runs above predate the
osfacts-live fix prompted by `3a6c829#1`.

## Post-review CI streak

These are the five required full two-platform runs after `/be-review`. They run
strictly in sequence on macOS `ci@petit` and Linux `kolu-ci-1`, with no step
retries.

| Attempt | Commit | Result | Consecutive green |
| --- | --- | --- | --- |
| `85b4a61#1` | `85b4a6161` | Failed: `ci::unit`, `ci::daemon`, and `ci::agent-flake-nix` on both platforms | `0/5` |
| `3b40ccf#1` | `3b40ccf11` | Passed | `1/5` |
| `59f09c0#1` | `59f09c0ec` | Passed | `2/5` |
| `c215704#1` | `c215704fb` | Passed | `3/5` |
| `8235c95#1` | `8235c952e` | Failed: `ci::osfacts-live@aarch64-darwin`; all other nodes passed | `0/5` |
| `6f863c2#1` | `6f863c2ed` | Passed | `1/5` |
| `03c8122#1` | `03c812280` | Failed: `ci::daemon@aarch64-darwin`; all other nodes passed | `0/5` |
| `c4ec338#1` | `c4ec33842` | Failed: `ci::e2e@aarch64-darwin`; Linux passed; macOS `ci::osfacts-live` was fail-fast skipped | `0/5` |
| `aea6cc3#1` | `aea6cc331` | Passed all CI nodes, but macOS e2e needed 7 scenario retries | `0/5` flake-free |
| `a1ae2f2#1` | `a1ae2f242` | Passed both platforms; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `1/5` |
| `0f6f4ac#1` | `0f6f4ac85` | Passed both platforms; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `2/5` |
| `a638755#1` | `a638755ec` | Passed both platforms; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `3/5` |
| `ecf8f28#1` | `ecf8f280d` | Passed both platforms; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `4/5` |
| `0dfaddc#1` | `0dfaddc34` | Failed: `ci::e2e-governance@x86_64-linux`; every other node passed and both e2e lanes had 0 retries | `0/5` |
| `82d72ed#1` | `82d72ede0` | Passed both platforms; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `1/5` |
| `fce3b0a#1` | `fce3b0a53` | Passed both platforms; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `2/5` |
| `7299111#1` | `729911162` | Passed both platforms, including both `osfacts-live` nodes; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `3/5` |
| `92ec01a#1` | `92ec01a93` | Passed both platforms; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `4/5` |
| `07b5e88#1` | `07b5e886b` | Passed every node on both platforms, including both `osfacts-live` nodes; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `5/5` |

## E2E-only GitHub streak

This campaign focuses fixes on e2e flakes. A test-only fix is preferred unless
an application change fixes a product bug or makes the behavior reliably
correct in general. Each attempt is a strict full-CI run posted to GitHub from
macOS `ci@petit` and Linux `kolu-ci-1`; a run counts only when every required
GitHub status is green and both e2e lanes finish without a scenario retry.
Any e2e flake resets the streak, is investigated to a demonstrated root cause,
and is fixed in this PR before the campaign resumes.

| Attempt | Commit | Result | Consecutive green |
| --- | --- | --- | --- |
| `02b18bd#1` | `02b18bd35` | Every required GitHub status passed; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `1/5` |
| `48d536d#1` | `48d536ded` | Every GitHub check passed; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `2/5` |
| `d3441b4#1` | `d3441b4c2` | Every GitHub check passed; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `3/5` |
| `4900aa0#1` | `4900aa05d` | Every GitHub check passed; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `4/5` |
| `8eddf56#1` | `8eddf56cd` | Failed only `ci::dev-smoke@x86_64-linux`; both e2e lanes passed with 0 retries; streak reset | `0/5` |
| `916c362#1` | `916c362f2` | Every GitHub check passed, including both repaired `dev-smoke` nodes; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `1/5` |
| `0e224c9#1` | `0e224c993` | Failed only `ci::unit@aarch64-darwin`; both e2e lanes passed with 0 retries; streak reset | `0/5` |
| `b914488#1` | `b9144880b` | Every GitHub check passed, including concurrent `unit` and `dev-smoke`; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `1/5` |
| `0365d16#1` | `0365d16de` | Every GitHub check passed; macOS 506/506 and Linux 507/507 e2e attempts, 0 retries | `2/5` |

### `0e224c9#1`: macOS dev-smoke install removed unit's Vitest executable

- **Failure:** `ci::unit@aarch64-darwin` stopped in `@kolu/shell-quote` with
  `node_modules/.bin/vitest: No such file or directory` and `spawn ENOENT`.
- **Root cause:** `devSmoke.ts` launched the public `just dev` recipe. Its
  private `_dev` dependency runs `install`, so the dev-smoke node started a
  second workspace `pnpm install` while the unit node was consuming package
  executables from the same CI snapshot. Pnpm temporarily removed
  `shell-quote/node_modules/.bin/vitest` while relinking the workspace.
- **Evidence:** `.ci/0e224c9/aarch64-darwin/ci::unit.log` shows three packages
  pass before the `shell-quote` executable disappears at 03:24:26. Read-only
  inspection of the still-live snapshot found that exact executable recreated
  with a 03:24:27 birth time and root `.modules.yaml` modified at 03:24:27.
  Source inspection closes the competing-writer chain:
  `devSmoke.ts` spawns `just dev`, `dev` invokes `_dev`, and
  `_dev: install _dev-parallel`; the CI `dev-smoke` node otherwise correctly
  enters through the single completed `ci::install` dependency.
- **Proposed fix:** have the already-installed smoke harness launch the
  existing private `_dev-parallel` recipe directly, passing its selected server
  and client ports through the same environment variables. Keep public
  `just dev` dependent on `install` for normal cold local use.
- **Implementation:** the smoke harness now passes its random ports through
  `KOLU_DEV_SERVER_PORT` and `KOLU_DEV_CLIENT_PORT` and launches
  `_dev-parallel` directly. The public `just dev` installation path remains
  unchanged.
- **Fix verification:** targeted two-platform run `39cb543#1` passed `unit` and
  `dev-smoke` concurrently on both `ci@petit` and `kolu-ci-1`.

### `8eddf56#1`: Linux dev-smoke opened the app before its server was ready

- **Failure:** `ci::dev-smoke@x86_64-linux` failed after the browser emitted
  `WebSocket connection to 'ws://localhost:45267/rpc/ws' failed: Connection
  closed before receiving a handshake response`.
- **Root cause:** `devSmoke.ts` waited only for the Vite client URL to return
  HTTP 200 before opening the browser. `just dev` starts Vite and the Kolu
  server in parallel, so Vite could serve the app while its websocket proxy
  target was not listening yet. The first app connection then received
  `ECONNREFUSED`, and the smoke test correctly collected that browser console
  error but incorrectly attributed this harness startup race to the app.
- **Evidence:** `.ci/8eddf56/x86_64-linux/ci::dev-smoke.log` records Vite ready
  and the browser navigation at 07:10:23, Vite's websocket proxy
  `ECONNREFUSED` at 07:10:26, and `kolu listening` only afterward at
  07:10:26.578. Source inspection shows the sole readiness call is
  `waitForHttp(http://localhost:<client>/)`, immediately followed by browser
  navigation; it never probes the separately assigned server port.
- **Proposed fix:** before launching the browser, require HTTP 200 from both the
  Vite client URL and this run's `http://localhost:<server>/api/health`.
  Continue to use the child-process exit and existing timeout as the fail-fast
  bounds.
- **Implementation:** the smoke harness now waits concurrently for the Vite
  page and the Kolu server's health endpoint before launching Chromium.
- **Fix verification:** targeted two-platform run `4b2630b#1` passed
  `ci::dev-smoke` on `ci@petit` and `kolu-ci-1`.

### `0dfaddc#1`: Linux governance lost Vitest command discovery

- **Failure:** `ci::e2e-governance@x86_64-linux` failed while validating the
  coverage-ledger reference to
  `packages/integrations/git/src/index.test.ts`. Its nested command returned
  `ERR_PNPM_RECURSIVE_EXEC_FIRST_FAIL Command "vitest" not found`.
- **Root cause:** governance launched a new
  `pnpm --dir <owning-package> exec vitest` command for each of 17 referenced
  test files. One package-local pnpm command lookup transiently failed under
  the parallel Linux CI fan-out even though Vitest was installed. The check
  coupled test collection to repeated package-bin discovery it does not need.
- **Evidence:** `.ci/0dfaddc/x86_64-linux/ci::install.log` shows the frozen
  workspace install completed successfully before governance started.
  `.ci/0dfaddc/x86_64-linux/ci::e2e-governance.log` records the exact failed
  nested command. A read-only audit of that still-live Odu checkout found both
  root and `packages/integrations/git` Vitest executables present, with their
  original install timestamps; invoking the declared root Vitest CLI directly
  from the Git package collected all 69 tests successfully.
- **Proposed fix:** resolve the root `vitest/vitest.mjs` entry point once and
  invoke it with the current Node process from each owning package directory.
  Keep the package cwd, which preserves Vitest's config discovery, while
  removing all nested pnpm command lookup.
- **Implementation:** governance now fails fast if the root Vitest entry point
  is absent, then uses that exact entry point for every collection. The full
  local governance check and all 17 harness unit tests pass. Targeted run
  `00b3b08#1` passed `ci::e2e-governance` on both required platforms.

### `aea6cc3#1`: five macOS Git fixture commits returned status 128

- **Failures:** the first attempt of five Code-tab scenarios failed while
  creating its Git fixture: `Lists changed files and opens a diff on click`,
  `Folder collapse during active filter persists the filter [browse]`,
  `Code tab back and forward retrace file navigation`,
  `Code tab forward history is truncated when navigating after going back`,
  and `Truncated Markdown warns and renders task checkboxes read-only`.
  Each `git commit` returned status 128; each retried scenario subsequently
  passed.
- **Root cause:** Kolu's always-on background local-status query calls
  `simple-git.status()` without `GIT_OPTIONAL_LOCKS=0`. Git status is allowed
  to refresh cached index metadata and briefly owns `.git/index.lock`; the
  user's fixture `git add`/`git commit` races that optional background write.
  The same race reproduced twice in diagnostic run `4bffcc5#1`.
- **Evidence:** `.ci/aea6cc3/aarch64-darwin/ci::e2e.log` names all five
  first-attempt failures and their status 128 result. After the bounded xterm
  diagnostic landed, `.ci/4bffcc5/aarch64-darwin/ci::e2e.log` captured Git's
  exact fatal error twice:
  `Unable to create '.../.git/index.lock': File exists`. In both cases the
  scenario had just deleted and freshly initialized that path. The client
  source shows `hostCodeTab.localStatus` is active independently of the shown
  view and invokes `getLocalStatus`; that function used an unqualified
  `simpleGit(repoPath).status()`.
- **Proposed fix:** run all reactive/background Git reads with
  `GIT_OPTIONAL_LOCKS=0`, Git's purpose-built contract for background
  refreshers. Preserve the repository's canonical safe spawn environment and
  leave required locks for user-requested mutations intact.
- **Implementation:** the integration package now owns one `backgroundGit`
  constructor and matching `backgroundGitEnv`. Terminal Git-info resolution,
  local/branch status, and diff reads use that contract rather than spawning
  an unqualified background Git process. Its environment reuses
  `kolu-pty.composeSpawnEnv` and adds only `GIT_OPTIONAL_LOCKS=0`.
- **Fix verification:** all 110 `kolu-git` tests pass, including a new
  end-to-end spawn guard for the bounded environment, and the package
  typecheck passes. Targeted macOS e2e run `64ff556#1` completed all 506
  scenarios with no status-128 or `.git/index.lock` retry, directly verifying
  that background Git reads no longer race fixture mutations.

### `aea6cc3#1`: two macOS file-reference opens did not settle

- **Failures:** `Clicking a slash-containing path with no line opens the file
  with no selection` waited 60 seconds without either Pierre file/diff view
  becoming visible. `Clicking a line-range deep in a long file scrolls the
  selection into view` waited 20 seconds without line 161 becoming selected.
  Both first attempts failed and both retries passed.
- **Root cause:** the direct fresh inventory read could resolve and select each
  just-created target before the retained tree caught up. The independent
  selection-membership effect then treated that settled-but-stale tree as
  authoritative and cleared the selection. With no selected path, no Pierre
  viewer or line-range selection could remain mounted.
- **Evidence:** `.ci/aea6cc3/aarch64-darwin/ci::e2e.log` records the exact
  locator and selection timeouts after the file-ref link action, followed by
  successful retries. Diagnostic run `64ff556#1` reproduced the same missing
  selection on `Bare basename without a line number resolves via
  unique-basename fallback`: the panel was open in browse mode, but
  `selectedTreePaths` was empty, neither Pierre view was mounted, and the
  content area still read `Select a file to view its content`. The exact facts
  are preserved in `.ci/64ff556/aarch64-darwin/ci::e2e.log`. All three
  scenarios create their target immediately before the same open pipeline.
  The regression test reproduces the causal state sequence: a fresh read
  contains the path while retained inventory does not; the old membership
  verdict clears it, which also invalidates `selectedRange`.
- **Proposed fix:** carry retained-versus-fresh resolution provenance and pin
  an exact fresh-resolved selection until retained inventory first confirms
  it. Consume the pin at confirmation so a later real deletion still clears
  the selection.
- **Implementation:** the provenance and bounded fresh-selection pin described
  under `64ff556#1` below cover both failures. Targeted run `407e56b#1`
  completed every file-reference scenario without a retry, and the final five
  full runs had no file-reference retry on either platform.

### `64ff556#1`: fresh file-reference selection was cleared by stale inventory

- **Failure:** `Bare basename without a line number resolves via
  unique-basename fallback` failed its first attempt after the file-reference
  click; its retry passed. The targeted node completed 506 scenarios in 507
  attempts.
- **Root cause:** the request's direct fresh inventory read can find and select
  a just-created file before the retained tree receives its repository-change
  update. The independent selection-membership effect treated the retained
  tree's settled-but-stale path set as authoritative and immediately cleared
  that freshly proven selection.
- **Evidence:** `.ci/64ff556/aarch64-darwin/ci::e2e.log` captured an open browse
  panel with no selected tree path, neither Pierre viewer mounted, and the
  fallback `Select a file to view its content`. The production path has the
  exact contradictory sequence: `readFreshCodePaths` exists specifically
  because the retained tree can lag a just-created file; its success calls
  `select`, while the separate membership effect clears any selected path
  absent from the retained paths whenever that inventory is not pending. The
  new regression test pins all three states: keep while only the fresh read
  contains the path, consume that pin when retained inventory catches up, then
  clear on a later authoritative removal.
- **Proposed fix:** identify whether an open resolved from retained or fresh
  inventory. Pin only a fresh-resolved file selection through the stale
  retained window; consume the pin as soon as the retained tree contains the
  path so future deletion keeps its existing clear-selection behavior.
- **Implementation:** the open controller now labels resolution provenance.
  Code-tab batches the fresh pin with selection, and its membership verdict
  preserves that exact request/path until retained inventory confirms it.
  All 1,195 client unit tests (including the 12 focused controller and
  membership tests) plus the client typecheck pass. Targeted macOS e2e
  run `407e56b#1` then completed every file-reference scenario without a retry.

### `407e56b#1`: terminal fixture creation returned no new ID

- **Failure:** the first attempt of `Clicking the dock handle (mouse path)
  opens the drawer without errors` failed in its `Given the terminal is ready`
  setup. `KoluWorld.createTerminal` threw
  `Created terminal but no new id appeared`; the scenario retry passed. The
  targeted node completed 506 scenarios in 507 attempts.
- **Root cause:** `KoluWorld.createTerminal` detected a new terminal ID in one
  browser evaluation, discarded that value, then took a second DOM snapshot to
  rediscover it. The mobile empty-state → tile transition can briefly unmount
  all `data-terminal-id` nodes between those evaluations, so successful
  creation was reported as missing.
- **Evidence:** `.ci/407e56b/aarch64-darwin/ci::e2e.log` records the exact
  first-attempt stack at `packages/tests/support/world.ts:228`, followed by a
  successful retry. The first `waitForFunction` can return only after finding
  an ID absent from `beforeIds`; the subsequent `newId` check threw only because
  the separate `terminalIds()` evaluation no longer contained it. Those two
  facts prove the loss occurs between the helper's check and use, not in
  terminal creation. No file-reference scenario retried in this run.
- **Proposed fix:** return the newly observed ID from the existing browser poll
  and use that exact value; do not resnapshot the transitioning DOM to recover
  it.
- **Implementation:** the poll now returns the first new ID as its value and
  the helper reads that value from the Playwright handle before continuing.
  All 17 test-harness unit tests pass. Targeted macOS e2e run `8dd5b31#1`
  completed all 506 scenarios in exactly 506 attempts with zero retries.

### `4bffcc5#1`: diagnostic macOS e2e retries

- **Failures:** the targeted macOS e2e node passed 506 scenarios after three
  retries. `Browse mode decorates changed files with git status` and
  `Tree/content split has a draggable handle` each failed a fixture commit
  with status 128. `Clicking a line-range file-ref selects the whole range`
  entered the new Code-tab timeout diagnostic, which itself threw
  `ReferenceError: __name is not defined`.
- **Root cause:** the two Git failures are the optional-index-lock race proven
  above. The diagnostic failure is separate and exact: tsx injects its
  `__name` helper when Playwright serializes an argument function, but that
  helper does not exist in the browser evaluation realm.
- **Evidence:** `.ci/4bffcc5/aarch64-darwin/ci::e2e.log` includes the complete
  terminal buffer for both Git failures, each naming the pre-existing
  `.git/index.lock`. Its third warning's stack starts in
  `codeTabTimeoutDiagnostic` and reports `page.evaluate: ReferenceError:
  __name is not defined`.
- **Proposed fix:** apply the `GIT_OPTIONAL_LOCKS=0` background-read contract
  above. Express the browser diagnostic as a string evaluation, matching the
  existing shadow-DOM diagnostic helpers that already avoid tsx's serializer.
- **Implementation:** both changes are applied. Targeted macOS run
  `64ff556#1` had no Git-lock retry and captured the missing-selection state;
  targeted run `407e56b#1` then completed every file-reference scenario
  without a retry.

### `c4ec338#1`: macOS background Git reads raced status and fixture updates

- **Failures:** macOS e2e made 513 attempts. Five fixture mutations returned
  Git status 128. The Local-mode count stayed absent for 60 seconds on another
  attempt. `Editing a file updates the diff view live` stayed on the old diff
  for 60 seconds on attempts 1 and 2 despite a 500 ms file nudge; its third
  attempt was the final status-128 fixture failure.
- **Root cause:** the same always-on `simple-git.status()` path described under
  `aea6cc3#1` ran without `GIT_OPTIONAL_LOCKS=0`. Its optional index refresh
  raced user fixture mutations, producing status 128, and concurrent
  background status consumers could fail their own refresh instead of
  publishing the Local count and diff input that those two UI assertions
  awaited.
- **Evidence:** `.ci/c4ec338/aarch64-darwin/ci::e2e.log` records all five
  status-128 mutations, the missing Local count (`last saw "null"`), both
  stale-diff timeouts, and the final 505-passed/1-failed result. Source
  inspection shows both the passive Local badge and active Local diff are fed
  by the always-on `hostCodeTab.localStatus`/active-status reads, which used
  the unqualified background `simpleGit.status()`. Diagnostic run
  `4bffcc5#1` then captured Git's exact fatal `.git/index.lock` collision twice
  on that same path, closing the status-128 mechanism rather than inferring it
  from the numeric exit code alone.
- **Proposed fix:** make every reactive/background Git read lock-free with
  `GIT_OPTIONAL_LOCKS=0`, while leaving user-requested mutations unchanged.
  Preserve bounded timeout diagnostics so a non-Git Code-tab failure would
  retain its own state facts.
- **Implementation:** the shared `backgroundGit`/`backgroundGitEnv` contract
  covers Local status, branch status, Git-info, and diff reads. Targeted run
  `64ff556#1` had no Git-lock retry; the final five full runs had zero e2e
  retries on both platforms.

### Proven during `c4ec338#1`: `dev-smoke` leaks one daemon tree per CI run

- **Failure:** completed `ci::dev-smoke` nodes leave their detached padi/kaval
  daemon tree alive after the Odu snapshot and its server process have exited.
  Before this fix, 29 orphaned Odu daemon processes remained on `ci@petit`
  using 3,043,120 KiB RSS, and 22 remained on `kolu-ci-1` using 3,790,592 KiB
  RSS.
- **Root cause:** `packages/tests/devSmoke.ts` passes `process.env` unchanged
  to `just dev`. It terminates the foreground `just` process group, but padi is
  deliberately detached and therefore survives that signal. Because
  `KOLU_DAEMON_BIND_PID` is absent, padi selects its production `forever`
  lifetime instead of binding itself and its kaval child to the smoke process.
- **Evidence:** the `c4ec338#1` dev-smoke log chose server port 58422 and
  reported success. After the node and full run settled, PID 91143 on
  `ci@petit` was reparented to PID 1 and still ran padi from the exact
  `c4ec338-88894-683e335a` Odu snapshot with legacy kaval socket
  `kaval-58422-502`; its environment contained the snapshot's
  `KOLU_PADI_STATE_DIR` and no `KOLU_DAEMON_BIND_PID`. The other surviving
  process commands each name a distinct historical Odu snapshot, establishing
  the one-run-per-leak pattern on both hosts.
- **Proposed fix:** set `KOLU_DAEMON_BIND_PID` to the dev-smoke process PID in
  the environment passed to `just dev`. The existing padi-to-kaval forwarding
  and `boundToPid` lifetime then reap the detached tree when the smoke process
  ends, without changing normal developer `just dev` persistence.
- **Implementation:** `startDevServer` now overrides the spawned smoke
  environment with `KOLU_DAEMON_BIND_PID: String(process.pid)`. An always-on
  daemon-gate test prevents that leash from being removed while leaving normal
  developer `just dev` untouched.
- **Fix verification:** all 22 daemon-gate tests pass. Targeted two-platform run
  `ba374cf#1` passed `ci::dev-smoke` on `ci@petit` and `kolu-ci-1`; after both
  nodes settled, neither host had a padi or kaval process whose command named
  that run's `ba374cf` Odu snapshot. Before resuming full CI, the historical
  Odu-snapshot daemon trees identified above were terminated; a second process
  audit found zero matching padi or kaval processes on either host.

### `03c8122#1`: duplicate macOS unit workspaces externally killed

- **Failure:** `ci::daemon@aarch64-darwin` terminated by signal 9 with exit
  code 137 while starting the `@kolu/solid-pwa-install` package. Every completed
  test file before the termination passed.
- **Root cause:** the CI DAG started `ci::unit` and `ci::daemon` together on
  macOS. Each invoked a complete 63-package pnpm workspace traversal; their
  package concurrency was individually bounded to one, but the two workspace
  runners still executed concurrently inside the rest of the CI fanout. The
  daemon runner was externally SIGKILLed eight seconds after both nodes
  started.
- **Evidence:** `.ci/03c8122/runs/1.log` records `ci::unit` and `ci::daemon`
  starting together and the daemon node failing eight seconds later.
  `.ci/03c8122/aarch64-darwin/ci::daemon.log` records `Scope: 63 of 64
  workspace projects`, successful results for every completed package, then
  `test-daemon was terminated ... by signal 9`; there is no Vitest failure.
- **Proposed fix:** make `ci::daemon` depend on `ci::unit`. This preserves both
  required nodes and every gated daemon suite while preventing two copies of
  the 63-package workspace from running at once.
- **Implementation:** the CI DAG now declares `daemon: install unit`, and the
  daemon-node structural guard pins that serialization alongside the existing
  delegation and gate assertions.
- **Fix verification:** all 21 daemon-test-gate unit tests pass, and a dry run
  of `ci::daemon` orders `ci::unit` before `ci::daemon`.

### `8235c95#1`: Darwin `ps etime` ceiling lost at sub-second delay

- **Failure:** the foreign-process oracle rejected PID 387 because osfacts
  measured an elapsed age of 371049 seconds while its computed `ps` interval
  began at 371050 seconds.
- **Root cause:** Darwin `ps etime` advances to the next displayed second
  before exact elapsed time reaches that second. The oracle attempted to allow
  for that by subtracting one from the measured inter-snapshot delay before
  adding it to `ps`'s value. When that delay was below one second,
  `saturating_sub(1)` clamped the delay to zero and discarded the required
  one-second allowance.
- **Evidence:** the failing log prints the exact rejected comparison:
  `osfacts elapsed=371049s, ps expected=371050..=371051`. A controlled
  14-sample probe on the same `ci@petit` host observed `ps etime=00:01` after
  only 0.262 seconds and `ps etime=00:02` after 1.065 seconds, directly
  establishing the ceiling behavior. The oracle code at `8235c952e` subtracts
  from `Duration::as_secs()` before adding the reported `ps` age. See
  `.ci/8235c95/aarch64-darwin/ci::osfacts-live.log`.
- **Proposed fix:** add the measured lower delay to the `ps` age first, then
  subtract the one-second Darwin display allowance from the total so it is
  preserved even when the delay is sub-second.
- **Implementation:** the lower endpoint is now
  `(ps elapsed + measured lower delay).saturating_sub(1)`.
- **Fix verification:** full two-platform run `6f863c2#1` passed, including
  `ci::osfacts-live@aarch64-darwin`.

### `85b4a61#1`: stale daemon-recipe structural assertion

- **Failure:** `ci::unit` and `ci::daemon` failed on both platforms in
  `packages/daemon-test-gate/src/daemon-node.test.ts`. The assertion required
  the immediate `ci/mod.just` `daemon` body to contain
  `KOLU_DAEMON_TESTS=1`.
- **Root cause:** review commit `be07c4313` changed that CI body from a duplicate
  inline command to `just --no-deps test-daemon`. The canonical root
  `test-daemon` recipe still sets both `KOLU_DAEMON_TESTS=1` and
  `KOLU_DAEMON_BIND_PID=$$`, but the structural test inspected only the
  delegating recipe and therefore rejected the new valid shape.
- **Evidence:** all four node logs show the same received body,
  `{{ nix_shell }} just --no-deps test-daemon`, and the same failed expectation
  for an inline `KOLU_DAEMON_TESTS=1`. The root `justfile` recipe at the tested
  commit contains both required environment assignments. See
  `.ci/85b4a61/{aarch64-darwin,x86_64-linux}/ci::{unit,daemon}.log`.
- **Proposed fix:** assert the complete delegation chain: the CI `daemon`
  recipe must call `just --no-deps test-daemon`, and the root `test-daemon`
  recipe must set both the daemon gate and spawn leash.
- **Implementation:** the structural test now reads both recipe bodies and
  pins those three facts separately.
- **Fix verification:** all 20 daemon-test-gate unit tests pass locally.

### `85b4a61#1`: remote-agent source omits the formatter config

- **Failure:** `ci::agent-flake-nix` failed on both platforms while evaluating
  the `kaval` derivation because
  `/nix/store/...-source/biome.jsonc` did not exist.
- **Root cause:** the font derivation now formats its generated CSS with
  `--config-path ${../../../biome.jsonc}`, but `agentSource` assembles a minimal
  remote-agent tree that included `default.nix`, `nix/`, `npins/`, `osfacts/`,
  and the workspace fileset—not root `biome.jsonc`. Evaluating the font
  derivation from that deliberately filtered tree therefore dereferenced a
  file excluded by its source contract.
- **Evidence:** the macOS and Linux logs independently terminate at the same
  Nix evaluation error: `path '/nix/store/...-source/biome.jsonc' does not
  exist`. `default.nix`'s `agentSource` union at `85b4a6161` does not list that
  file, while `nix/packages/fonts/default.nix` directly reads it. See
  `.ci/85b4a61/{aarch64-darwin,x86_64-linux}/ci::agent-flake-nix.log`.
- **Proposed fix:** add root `biome.jsonc` to the proven remote-agent fileset so
  every file read while evaluating its derivations is present.
- **Implementation:** `agentSource.fileset` now explicitly includes
  `./biome.jsonc`.
- **Fix verification:** the complete local `ci::agent-flake-nix` recipe passes,
  including evaluation of every exposed remote-agent package from the assembled
  source.

The failed run settled without retries. Every other runnable node passed on
both platforms; `ci::osfacts-live` was dependency-skipped after the failures
above.

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

### Generated font CSS formatting

Two runs observed the same generator-owned defect:

| Run | Platform | Evidence |
| --- | --- | --- |
| `7594e7d#1` | `x86_64-linux` | `.ci/7594e7d/x86_64-linux/ci::fmt.log` |
| `67b890f#1` | `aarch64-darwin` | `.ci/67b890f/aarch64-darwin/ci::fmt.log` |

- **Failure:** Biome traversed the canonical Nix-store `fonts.css` and rejected
  two long `unicode-range` declarations plus a trailing blank line, even though
  the repository symlink at `packages/client/public/fonts` is ignored.
- **Root cause:** `nix/packages/fonts/default.nix` generated CSS outside the
  repository formatter's normal form. The Linux occurrence first suggested a
  symlink replacement window, but the Darwin occurrence reproduced the exact
  formatter edits with the atomic-symlink experiment in place and ruled that
  hypothesis out.
- **Evidence:** both logs name the canonical store target, report 1,733 checked
  files, and propose the same generator-owned edits. The Linux rerun after the
  symlink stabilized checked 1,732 files and passed, showing why the latent
  output defect appeared only when traversal reached the store target.
- **Proposed fix:** keep semantic CSS generation independent of formatter
  layout, then run the repository-pinned Nixpkgs Biome on `fonts.css` inside the
  derivation.
- **Implementation:** the font derivation now generates semantic declarations
  and formats the artifact with the same pinned Biome implementation used by
  the repository gate. The disproven atomic-symlink experiment remains removed.
- **Fix verification:** before formatter ownership moved into the derivation,
  the rebuilt artifact passed direct Biome formatting and targeted
  two-platform run `de8c863#5` passed `ci::fmt` on `ci@petit` and `kolu-ci-1`.
  The derivation itself is now the durable enforcement point.

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
- **Implementation:** the root `test-unit` recipe owns that package-level
  concurrency bound, and `ci::unit` reuses it with `just --no-deps` after the
  CI install funnel. The daemon lane reuses `test-daemon` the same way.
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
| `ba374cf#1` | `ba374cfb2` | `dev-smoke` on both platforms plus post-run daemon process audit | `ci@petit`, `kolu-ci-1` | Passed; no daemon from the run survived |
| `4bffcc5#1` | `4bffcc577` | `e2e@aarch64-darwin` with bounded flake diagnostics | `ci@petit` | Passed all scenarios after 3 retries; failures recorded above |
| `64ff556#1` | `64ff5562a` | `e2e@aarch64-darwin` after background-Git lock fix | `ci@petit` | Passed all 506 scenarios after 1 file-reference retry; failure recorded above |
| `407e56b#1` | `407e56b1d` | `e2e@aarch64-darwin` after fresh-selection fix | `ci@petit` | Passed all scenarios after 1 terminal-creation retry; failure recorded above |
| `8dd5b31#1` | `8dd5b31d9` | `e2e@aarch64-darwin` after atomic terminal-ID fix | `ci@petit` | Passed: 506 scenarios, 506 attempts, 0 retries |
| `00b3b08#1` | `00b3b08df` | `e2e-governance` on both platforms after direct-Vitest fix | `ci@petit`, `kolu-ci-1` | Passed |
| `4b2630b#1` | `4b2630ba3` | `dev-smoke` on both platforms after dual-server readiness fix | `ci@petit`, `kolu-ci-1` | Passed |
| `39cb543#1` | `39cb5436a` | `unit` and `dev-smoke` concurrently on both platforms after single-install fix | `ci@petit`, `kolu-ci-1` | Passed |
