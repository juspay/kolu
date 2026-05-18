---
name: ci
description: Run local CI (`CI=true nix run github:juspay/ci -- run`) and verify all `(recipe, platform)` nodes reported success. Use when building, testing across systems, checking commit statuses, retrying failed CI steps, or diagnosing CI failures. Triggers on "run CI", "check CI", "CI failed", "retry CI", "build and test".
---

# CI

Kolu's pipeline is defined in `ci/mod.just` and driven by [juspay/ci](https://github.com/juspay/ci). The binary translates the `just` recipe graph into a process-compose DAG, fans every reachable recipe out across the platforms in `~/.config/ci/hosts.json`, and posts a GitHub commit status per `(recipe, platform)` node.

## Running

Run in strict mode so the binary posts live commit statuses and pins to HEAD:

```sh
CI=true nix run github:juspay/ci -- run
```

Pre-flight requirements (strict mode refuses otherwise):

- Working tree is clean.
- HEAD is pushed to the remote (GitHub status API needs the SHA).
- `~/.config/ci/hosts.json` has entries for each non-local Nix system family declared on the root recipe.

The binary blocks until the pipeline finishes. Process-compose's per-node state transitions stream to its own log at `.ci/pc.log`; the binary's stdout carries the verdict summary printed at the end (one line per node with its final state).

### Backgrounding

For long runs, spawn the binary via `Bash(run_in_background)` and poll GitHub statuses while it executes. The binary's exit code is authoritative — zero only if every node finished `Success`.

## Verification

Final exit code zero is necessary but not sufficient: cross-check every expected context posted a `success` status.

1. Get the expected contexts. The runner names each node `ci::<recipe>@<platform>`:

   ```sh
   nix run github:juspay/ci -- dump-yaml | grep -oE '^  ci::[^:]+:' | tr -d ':' | sort -u
   ```

   (Each `ci::<recipe>@<platform>` line in the dump-yaml output is one expected commit-status context.)

2. Query posted statuses and cross-check:

   ```bash
   sha=$(git rev-parse HEAD)
   posted=$(gh api "repos/juspay/kolu/statuses/$sha" \
     --jq '[.[] | select(.context | startswith("ci::"))]
           | group_by(.context) | map(max_by(.updated_at))
           | .[] | "\(.context) \(.state)"')

   # Expected: ci::<recipe>@<platform> for each (recipe, platform) in the dump.
   expected=$(nix run github:juspay/ci -- dump-yaml | grep -oE '^  ci::[^:]+' | sort -u)

   # Missing: expected but not posted
   echo "$expected" | while read ctx; do
     echo "$posted" | grep -q "^$ctx " || echo "MISSING: $ctx"
   done

   # Non-success
   echo "$posted" | grep -v ' success$' || true
   ```

Both checks must pass: no `MISSING` lines and no non-success states. Silence (missing context) means the node never transitioned — investigate `.ci/pc.log`.

## On failure

Each failed node's `description` field contains the path to its log. The path layout is:

```
.ci/<short-sha>/<platform>/<recipe>.log
```

Read that file to diagnose. Do **not** read the binary's stdout/stderr directly — the combined stream interleaves every parallel node.

## Retrying individual steps

Single-recipe retries don't need the runner — invoke the just recipe directly:

```sh
just ci::<recipe>          # local platform, in the worktree
```

For a specific platform, run from a host that matches that platform (or SSH into one). The full runner is only needed when you want the multi-platform fanout + status posting.

## Flaky tests

If a test fails once but passes on retry, post a comment on [issue #320](https://github.com/juspay/kolu/issues/320) capturing the failing scenario, platform, error excerpt, and the PR where it was observed. This keeps the flaky-test log current without manual curation.

**IMPORTANT**: At least one platform must have `e2e` fully passed before the /do workflow is considered done.

## Reference

The pipeline root is `ci::default`, tagged `[linux] [macos] [parallel] [metadata("ci")]`. Its `depends_on` list is the full recipe graph; the runner replicates each one per platform.

Runtime artifacts live under `.ci/` (gitignored):

- `.ci/pc.log` — process-compose's combined event log.
- `.ci/pc.sock` — Unix domain socket the observer subscribes to.
- `.ci/worktree/` — git worktree pinned to HEAD (strict mode only).
- `.ci/<short-sha>/<platform>/<recipe>.log` — one log per node.

Hosts are configured in `~/.config/ci/hosts.json`, keyed by full Nix system tuple. See `ci/README.md` for the schema and host-string conventions.
