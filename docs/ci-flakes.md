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

## Runs

| Run | Commit | Darwin host | Linux host | Result |
| --- | --- | --- | --- | --- |
| `610a019#1` | `610a01979` | `ci@petit` | `kolu-ci-1` | Passed |

## Failures

No failures were observed in baseline run `610a019#1`. Every node passed on
both platforms without a retry.
