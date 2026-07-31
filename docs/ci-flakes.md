# CI flake campaign

This PR investigated repeated CI failures on exactly macOS `ci@petit` and the
Linux pu box `kolu-ci-1`. It covered e2e, `osfacts-live`, and any other failure
fixable in the Kolu repository.

Root causes in this document are evidence-backed. A later green run is not
proof by itself: logs, source inspection, or a controlled reproduction must
close the causal chain. The one failure whose original artifact cannot do that
remains explicitly unresolved.

## Current state

- **CI is stopped.** Full run `694deab#1` was cancelled before completion at
  the user's request. No further CI run should be started unless requested.
- **Last fully validated commit:** `ef06330b0`. Strict run `ef06330#1` passed
  all 59 GitHub checks on `ci@petit` and `kolu-ci-1`; macOS completed 506/506
  e2e attempts and Linux 507/507, with zero retries.
- **Completed flake-free streak:** `2a74a53#1`, `60d847e#1`, `02220ff#1`,
  `5750c67#1`, and `147d463#1` were five consecutive strict two-platform
  greens with zero e2e retries.
- **Review:** `/be-review` completed, and Grok approved every debate finding
  as resolved in round 2.
- **Open evidence gap:** the Linux Markdown-source selection failure from
  `cd70a6e#1` is still unresolved. Diagnostics and extensive reproduction did
  not recur, so this PR does not invent a cause or claim a product fix.
- **PR-head status:** the commit containing this compacted document is not
  claimed CI-green. It has not been validated after the requested CI stop.

## What failed and how it was fixed

| Area | What happened and evidence | Root cause | Fix |
| --- | --- | --- | --- |
| Code-tab file references | `fba3b95#3`, `aea6cc3#1`, and `64ff556#1` opened no file or briefly selected one and then cleared it. Instrumentation captured a settled empty/stale inventory and later a fresh hit overwritten by the retained snapshot. | The open request treated retained `fs.listAll` state as authoritative and could be consumed or cleared before a fresh inventory settled. | Added a dedicated open controller: retained misses fall through to a direct fresh read, request ownership survives transient scope changes, fresh-hit provenance pins selection through stale updates, and the issuing terminal is focused before navigation. Focused controller and file-ref tests cover the lifecycle. |
| Background Git lock races | macOS fixture commits in `aea6cc3#1`, `4bffcc5#1`, and `c4ec338#1` failed with Git status 128. Logs named `.git/index.lock`; controlled overlap reproduced it. | Always-on reactive `simple-git.status()` reads opportunistically refreshed the index while fixture Git writes were running. | Centralized background Git reads behind `GIT_OPTIONAL_LOCKS=0` and routed status/review/resolve callers through it. A regression holds the index lock and proves reads still succeed without mutating it. |
| External branch changes | `cd70a6e#1` switched to `watcher-test`, but the UI remained on `master`. | Branch metadata depended on an edge-only `.git/HEAD` `fs.watch`; a missed/coalesced edge had no recovery path. | Kept `fs.watch` as the fast path and added a bounded stat-identity reconciliation floor to the shared narrow-file watcher. A unit test suppresses every watch edge and proves recovery. |
| Markdown text selection | `cd70a6e#1` rendered the source text and completed the drag, but no comment pill appeared. The original log contains no native-selection state. | **Unresolved:** the artifact cannot distinguish a failed browser drag from a valid selection missed by the app. | Added bounded document and shadow-root selection diagnostics immediately after mouse-up and at pill timeout. The exact scenario then passed 120 isolated retry-free executions, five complete Code-tab feature runs, ten complete Linux e2e lanes, and later strict CI without recurrence. This improves the next failure's evidence; it is not presented as a root-cause fix. |
| Terminal fixture identity | `407e56b#1` observed terminal count increase but returned no new terminal ID. | The helper polled for the ID, discarded the successful value, then performed a second snapshot that could race terminal churn. | The existing poll now returns the newly observed ID atomically. The targeted macOS e2e run then completed 506/506 with zero retries. |
| Codex SQLite fixture | `eebf0ee#1` failed `updateCodexRollout` with `database is locked`; a controlled second connection reproduced the same immediate failure. | The synthetic Codex writer used node:sqlite's zero-wait default while Kolu concurrently read the WAL database. | Installed a 5-second `busy_timeout` on fixture connections and added a real transient-lock regression. The lock holder uses a worker thread, avoiding the real-process spawn gate exposed by `9c7062d#1`. |
| Dev-smoke startup | `8eddf56#1` loaded the browser after Vite was ready but before kolu-server listened, producing proxy `ECONNREFUSED`. | The harness gated only on the client URL. | Wait concurrently for HTTP 200 from both Vite and kolu-server before launching the browser. |
| Dev-smoke install race | `0e224c9#1` lost `node_modules/.bin/vitest` while unit tests were running. File timestamps showed it recreated one second later. | Dev-smoke launched public `just dev`, which performed a second `pnpm install` beside the unit lane. | Launch the already-installed private `_dev-parallel` recipe directly. Targeted two-platform unit + dev-smoke verification passed concurrently. |
| Dev-smoke daemon leak | Process inspection after `c4ec338#1` found the smoke server gone but its padi/kaval tree still alive. | The child inherited `process.env`, so daemon lifetime bound to the long-lived Odu runner PID rather than the smoke process. | Set `KOLU_DAEMON_BIND_PID` to the smoke process PID. A post-run audit found no surviving daemon from the targeted run. |
| E2E governance command | `0dfaddc#1` could not resolve Vitest from an isolated temp workspace even though install was complete. | Governance launched `pnpm exec vitest` from the temp directory, where pnpm package discovery intentionally had no workspace context. | Resolve the repository's `vitest/vitest.mjs` once and invoke it directly with Node; fail loudly if it is absent. |
| Unit/daemon resource contention | `37cebaa#1` and `03c8122#1` ended macOS Vitest workspaces with external `SIGKILL`. Logs showed package fanout and duplicate unit workspaces running together. | Root unit tests had unbounded package concurrency, while `ci::unit` and `ci::daemon` duplicated the same workspace load concurrently. | Bound root package concurrency and make the daemon CI node depend on unit, while retaining per-package Vitest parallelism. |
| Daemon recipe governance | `85b4a61#1` failed unit and daemon gates on both platforms after the CI recipe began delegating to `test-daemon`. | The structural assertion still inspected the old duplicate body rather than the new delegation chain. | Assert the full `ci::daemon -> test-daemon -> test-unit` chain. |
| Remote-agent Nix source | `85b4a61#1` failed `agent-flake-nix` on both platforms because the fonts derivation could not find `biome.jsonc`. | The filtered remote-agent source included the font derivation but omitted its newly required formatter config. | Add the root Biome config to the canonical filtered fileset; the full agent-flake check passes. |
| Generated font CSS | Linux and macOS formatting runs rejected the Nix-store `fonts.css` target. | Semantic CSS generation and formatter ownership were split: the derivation generated unformatted CSS, then the dev shell exposed it to Biome. | Format CSS inside the font derivation before it becomes the canonical store artifact. |
| Atlas TypeScript | `fba3b95#4` panicked in TypeScript-Go while parsing an extensionless pnpm content-store path. Inode inspection linked it to a `.d.mts` declaration. | TypeScript-Go lost the script kind when it received the extensionless hard-link path. | Pin the isolated Atlas project to TypeScript 6.0.3's JavaScript compiler. Atlas sync passed on both hosts. |
| Darwin `osfacts-live` process churn | `3a6c829#1` sampled a foreign PID that exited before osfacts read it; osfacts correctly returned `ESRCH`. | The live oracle treated the first `ps` snapshot as permanent membership. | Re-read `ps` after osfacts and accept `ESRCH` only for identities proven retired. Still-live identities remain hard failures. |
| Darwin `ps etime` timing | `8235c95#1` rejected a live process because its displayed `etime` advanced across a sub-second delay. | The oracle compared quantized `ps` age against an incomplete timing interval. | Record each `ps` command's start and finish and compare age growth against the full measured interval with one-second quantization bounds. |

## Verification summary

- Multiple full-CI campaigns ran sequentially on only `ci@petit` and
  `kolu-ci-1`; failures reset the active streak and were investigated before
  continuing.
- The final completed five-run streak was:

  | Run | GitHub result | E2E result |
  | --- | --- | --- |
  | `2a74a53#1` | 59/59 passed | macOS 506/506; Linux 507/507; 0 retries |
  | `60d847e#1` | 59/59 passed | macOS 506/506; Linux 507/507; 0 retries |
  | `02220ff#1` | 59/59 passed | macOS 506/506; Linux 507/507; 0 retries |
  | `5750c67#1` | 59/59 passed | macOS 506/506; Linux 507/507; 0 retries |
  | `147d463#1` | 59/59 passed | macOS 506/506; Linux 507/507; 0 retries |

- `ef06330#1` later revalidated the documentation head with the same 59/59
  GitHub result and zero e2e retries.
- `694deab#1` was started only to validate a later documentation commit, then
  cancelled before completion when the user asked to stop CI. It is not green
  evidence and is not counted.
- The full per-node history and logs remain in Odu's durable `.ci/` ledger;
  this document intentionally summarizes the campaign rather than duplicating
  every transition.
