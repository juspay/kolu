# Kolu CI steps.
#
# Imports localci/ — a forge-agnostic reusable CI library (to be extracted
# to its own repo in a later phase). See ci/localci/README.md.

import 'localci/lib.just'
import 'localci/forges/github.just'

# The just module name this file is mounted under in the top-level justfile
# (see `mod ci 'ci/mod.just'`). localci recipes dispatch sibling calls via
# `just {{ module_name }}::<recipe>`.
module_name := "ci"

# Target nix systems to build across. Each becomes a lane in `_run-all`.
# The local system runs natively; every other system is dispatched over
# ssh to a remote builder (host resolved via `_host`, cached in
# ~/.config/ci-hosts.json).
systems := "x86_64-linux aarch64-darwin"

# All CI contexts, one per space-separated token. `_contexts` (in lib.just)
# just echoes this list. Source of truth for the summary table and for
# GitHub branch protection (`just ci::protect`). Keep in sync with the
# orchestrator lanes below when adding or removing steps.
contexts := "fmt typecheck unit apm-sync nix@x86_64-linux home-manager@x86_64-linux e2e@x86_64-linux nix@aarch64-darwin e2e@aarch64-darwin"

# Inner workflow: preflight → parallel fanout across systems → summary.
# `default` (defined in lib.just) acquires the single-instance lock and
# execs into this recipe.
_inner: _preflight _run-all _summary

# Lanes run in parallel. Each lane iterates its steps with `|| true` so a
# failing step doesn't abort siblings — per-step failure is captured by
# `_step`'s ERR trap into events.ndjson and surfaced by `_summary`.
[parallel]
_run-all: _local _linux _darwin

# Local-only lane: fast checks that don't need nix fanout.
_local:
    #!/usr/bin/env bash
    set -euo pipefail
    for step in fmt typecheck unit apm-sync; do
        just ci::_step "$step" || true
    done

# Linux lane: nix build first (populates store for reuse), then home-manager
# and e2e fan out in parallel against the pre-built store.
_linux:
    #!/usr/bin/env bash
    set -euo pipefail
    export CI_SYSTEM=x86_64-linux
    just ci::_step nix || true
    just ci::_step home-manager &
    just ci::_step e2e &
    wait || true

# Darwin lane: nix build then e2e, sequentially (no fanout).
_darwin:
    #!/usr/bin/env bash
    set -euo pipefail
    export CI_SYSTEM=aarch64-darwin
    for step in nix e2e; do
        just ci::_step "$step" || true
    done

# ─── Leaf step recipes ──────────────────────────────────────────────────────
#
# Pure command bodies — no CI wrapping. `_step <name>` (in lib.just) runs
# these with full instrumentation; bare `just ci::<name>` invocations run
# them directly without events/signoff (useful for ad-hoc debugging).

fmt:
    @just fmt-check

typecheck:
    @just check

# vitest unit tests (server + client)
unit:
    @just test-unit

# Verify vendored .claude/ matches .apm/ sources + security audit
apm-sync:
    @just ai::apm-sync

nix:
    @{{ devour_flake }} --override-input flake .

home-manager: nix
    @{{ devour_flake }} --override-input flake ./nix/home/example --override-input flake/kolu .

e2e: nix
    @just test
