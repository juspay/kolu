---
name: ci
description: Check GitHub Actions CI status and debug failures. Use `gh run list` to check status, `gh run view --log-failed` to diagnose, and `just ci::<step>` to reproduce locally. Triggers on "run CI", "check CI", "CI failed", "retry CI", "build and test".
---

# CI

CI runs via **GitHub Actions** on self-hosted runners (`.github/workflows/ci.yaml`). GHA is the source of truth for CI pass/fail — `just ci` is only for local debugging.

## Checking CI status

Push triggers GHA automatically on PRs and master. Check status with:

```bash
gh run list --branch "$(git branch --show-current)" --limit 5
gh run view <run-id>
```

## Verification

CI passes when **all GHA jobs succeed**. Check via:

```bash
gh pr checks
```

Or for a specific run:

```bash
gh run view <run-id> --exit-status
```

## On failure

1. Identify the failing job: `gh run view <run-id>`
2. Read the logs: `gh run view <run-id> --log-failed`
3. Reproduce locally: `just ci::<step>` (e.g. `just ci::e2e`)
4. Fix, commit, push — GHA re-runs automatically on the PR

## Running locally (debug only)

```bash
just ci            # all steps in parallel (current system only)
just ci::typecheck # single step
just ci::e2e       # single step (depends on nix)
```

`just ci` runs fmt, typecheck, unit, apm-sync, and nix in parallel. Steps with dependencies (e2e, home-manager) require nix to complete first. This mirrors what GHA runs, but on the current system only.

## Flaky tests

If a test fails once but passes on retry, post a comment on [issue #320](https://github.com/juspay/kolu/issues/320) capturing the failing scenario, platform, error excerpt, and the PR where it was observed.

**Never pipe CI to `tail` or `head`** — broken pipes kill the CI process mid-run.
