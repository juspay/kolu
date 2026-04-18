---
name: ci
description: Run local CI (`just ci`) and verify all steps passed. Use when building, testing across systems, checking commit statuses, retrying failed CI steps, or diagnosing CI failures. Triggers on "run CI", "check CI", "CI failed", "retry CI", "build and test".
---

# CI

Run `just ci` and verify every expected step reported success.

## Running

Run `just ci` via the **Monitor** tool with this filter so each finishing CI step becomes one event:

```
just ci 2>&1 | grep --line-buffered -oE 'context="ci/[^"]+" -f description="[^"]+"'
```

Each event corresponds to one GitHub status post by `just ci`. The `description` field encodes the step state:

- `srid · running` → step started
- `srid · Ns · <log path>` → step finished successfully
- `srid · failed after Ns · <log path>` → step failed

`just ci` is bound to the Monitor's lifetime — **stopping the monitor kills `just ci` mid-run**. Let it run to completion.

**Never read `just ci` stdout/stderr directly** (no `cat`, `tail`, `head`, `Read` on its output file). The combined stream is enormous and interleaves every parallel step, so it's not useful for diagnosis. The authoritative source is `.logs/<short-sha>/<step>@<system>.log` — one file per step, written by `just ci` itself. For diagnostics, read those files (the failing event's `description` carries the path).

> **Brittleness:** the regex depends on `just ci` literally invoking `gh api ... context="ci/X" -f description="..."` on stdout. If that internal format ever changes, Monitor will silently emit zero events. The cleaner long-term fix is a `just ci::events` wrapper recipe that owns the event format. If you refactor the just recipe's status posting, update this filter too.

## Verification

After `just ci` exits, confirm that **every expected context** reported success — not just that the ones which did report are green. Silence (a missing context) means the step never ran.

1. Get the expected contexts: `just ci::_contexts` (one per line, e.g. `nix@x86_64-linux`).
2. Query posted statuses and cross-check:

```bash
export EXPECTED=$(just ci::_contexts | sed 's/^/ci\//')
export POSTED=$(gh api "repos/<owner>/<repo>/statuses/<sha>" \
  --jq '[.[] | select(.context | startswith("ci/"))] | group_by(.context) | map(max_by(.updated_at)) | .[] | "\(.context) \(.state)"')

# Check for missing contexts (expected but never posted)
echo "$EXPECTED" | while read ctx; do
  echo "$POSTED" | grep -q "^$ctx " || echo "MISSING: $ctx"
done

# Check for non-success contexts
echo "$POSTED" | grep -v ' success$' || true
```

Both checks must pass: no `MISSING` lines and no non-success states. If any context is missing, the step was blocked before it could post — investigate why (see #471 for a prior example).

## On failure

Read the log file (path is in the event's description) to diagnose.

## Retrying individual steps

`just ci::<step>` (e.g., `just ci::e2e`). Single-step retries are short enough to run via `Bash(run_in_background)` — Monitor only pays off for full `just ci` runs.

## Flaky tests

If a test fails once but passes on retry, post a comment on [issue #320](https://github.com/juspay/kolu/issues/320) capturing the failing scenario, platform, error excerpt, and the PR where it was observed. This keeps the flaky-test log current without manual curation.

## Reference

`just ci` builds and tests across all systems. It:

- Runs preflight checks (clean worktree, commit pushed)
- Builds on x86_64-linux and aarch64-darwin in parallel
- Posts GitHub commit statuses per step
- Prints a summary table at the end

Individual steps: `just ci::nix-toplevel`, `just ci::e2e`, etc.
Target a specific system: `CI_SYSTEM=x86_64-linux just ci::e2e`
Logs are saved to `.logs/<short-sha>/<step>@<system>.log`.

**Never pipe CI to `tail` or `head`** — broken pipes kill the CI process mid-run.
