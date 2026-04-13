---
name: ci
description: Run local CI (`just ci`) and verify all steps passed. Use when building, testing across systems, checking commit statuses, retrying failed CI steps, or diagnosing CI failures. Triggers on "run CI", "check CI", "CI failed", "retry CI", "build and test".
---

# CI

CI runs via **GitHub Actions** on self-hosted runners (`.github/workflows/ci.yaml`). Use `just ci` locally to reproduce and debug a failing GHA job.

## Running locally

```bash
just ci            # all steps in parallel (current system only)
just ci::typecheck # single step
just ci::e2e       # single step (depends on nix)
```

`just ci` runs fmt, typecheck, unit, apm-sync, and nix in parallel. Steps with dependencies (e2e, home-manager) require nix to complete first.

## Checking GHA status

```bash
gh run list --branch "$(git branch --show-current)" --limit 5
gh run view <run-id> --log-failed
```

## On failure

1. Check which GHA job failed: `gh run view <run-id>`
2. Read the logs: `gh run view <run-id> --log-failed`
3. Reproduce locally: `just ci::<step>` (e.g. `just ci::e2e`)
4. Fix, commit, push — GHA re-runs automatically on the PR

## Flaky tests

If a test fails once but passes on retry, post a comment on [issue #320](https://github.com/juspay/kolu/issues/320) capturing the failing scenario, platform, error excerpt, and the PR where it was observed.

**Never pipe CI to `tail` or `head`** — broken pipes kill the CI process mid-run.
