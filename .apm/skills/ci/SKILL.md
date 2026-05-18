---
name: ci
description: Run local CI (`CI=true nix run github:juspay/ci -- run`) and verify all `(recipe, platform)` nodes reported success. Use when building, testing across systems, checking commit statuses, retrying failed CI steps, or diagnosing CI failures. Triggers on "run CI", "check CI", "CI failed", "retry CI", "build and test".
---

# CI

Kolu's pipeline is defined in `ci/mod.just` and driven by [juspay/ci](https://github.com/juspay/ci). The binary translates the `just` recipe graph into a process-compose DAG, fans every reachable recipe out across the platforms in `~/.config/ci/hosts.json`, and posts a GitHub commit status per `(recipe, platform)` node.

## Running

Strict mode pre-flight: clean working tree, HEAD pushed to the remote, and a runnable host per non-local Nix system. The darwin lane runs against the static `sincereintent` entry already in `~/.config/ci/hosts.json`. The linux lane runs against an **ephemeral Incus container created per CI run** via `pu`, redirected through juspay/ci's `--host` override:

```sh
pr=$(gh pr view --json number --jq .number)
host="kolu-pr-$pr"
pu create --name "$host"                                                 # writes ~/.pu-state/$host/ssh_config; ssh $host now works
CI=true nix run github:juspay/ci -- run --host x86_64-linux="$host"      # run with the override
pu destroy "$host"                                                       # tear down at the end
```

Why ephemeral: each CI run gets a clean linux build VM, so prior runs' state (nix store cruft, disk pressure, dirty workspace caches) can't poison a re-run. The darwin lane stays on the static `sincereintent` because reprovisioning a macOS host per run isn't free.

The runner accepts `--host PLATFORM=ADDR` repeatedly; CLI entries win over `hosts.json` on collision, and platforms not named on the CLI still consult the file.

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

The runner accepts positional `RECIPE[@PLATFORM]` selectors that restrict the DAG to a subset while keeping commit-status posting intact (juspay/ci#20). Each partial re-run **overwrites the same `ci::<recipe>@<platform>` status** the full run wrote — exactly what flips a single red check green:

```sh
CI=true nix run github:juspay/ci -- run e2e@x86_64-linux   # one node, posts a status
CI=true nix run github:juspay/ci -- run e2e                # both platforms
```

For local-only iteration without touching commit statuses, `just ci::<recipe>` still runs the recipe in the live worktree.

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

Hosts are configured in `~/.config/ci/hosts.json`, keyed by full Nix system tuple. Values are anything `ssh` can dial — bare hostname, `user@host`, or an `~/.ssh/config` alias. An entry for the *local* system takes precedence over inline execution.
