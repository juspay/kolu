# Kolu CI steps.
#
# Imports localci/ — a forge-agnostic reusable CI library (to be extracted
# to its own repo in a later phase). See ci/localci/README.md.
#
# Each leaf below is a regular justfile recipe with a direct body. The
# `[group("system:...")]` attributes tell localci's scheduler which
# target systems each step runs on; just's native dep syntax
# (`e2e: nix`) encodes intra-lane ordering. localci reads both via
# `just --dump`, builds a DAG, and dispatches through its lifecycle
# wrapper (events, signoff, transport, log capture).

# All CI recipes run from repo root, not the ci/ submodule directory.
# Required so `--override-input flake .` and similar path args resolve
# against the project root as users expect.
set working-directory := '..'

import 'localci/lib.just'
import 'localci/forges/github.just'

# The just module name this file is mounted under in the top-level
# justfile (see `mod ci 'ci/mod.just'`). localci uses this to resolve
# sibling recipe calls and to locate this module in `just --dump` output.
module_name := "ci"

# `just ci` entry point — dispatch to the library's lock wrapper, which
# acquires the perl Fcntl::flock on .localci/current and execs into the
# scheduler. This recipe MUST be declared in mod.just (not inherited from
# lib.just's `default`) because just picks the module's default from the
# first-defined recipe in the module's own source, not from imports.
default: _default

# Prefix shared by the nix/home-manager steps that use devour-flake.
devour_prefix := "nix build github:srid/devour-flake -L --no-link --print-out-paths"

# ─── Local-only steps ────────────────────────────────────────────────────────
# These run once on whatever machine invokes `just ci`, with no
# per-system fanout and no @system suffix in their CI context name.

[group("system:local")]
fmt:
    just fmt-check

[group("system:local")]
typecheck:
    just check

# Vitest unit tests (server + client)
[group("system:local")]
unit:
    just test-unit

# Verify vendored .claude/ matches .apm/ sources + security audit
[group("system:local")]
apm-sync:
    just ai::apm-sync

# ─── Per-system steps ────────────────────────────────────────────────────────
# These run on every system tagged below, in parallel lanes. Ordering
# within a lane is via normal just `dep:` syntax, which localci's
# scheduler reads from `just --dump`.

[group("system:x86_64-linux")]
[group("system:aarch64-darwin")]
nix:
    {{ devour_prefix }} --override-input flake .

[group("system:x86_64-linux")]
home-manager: nix
    {{ devour_prefix }} --override-input flake ./nix/home/example --override-input flake/kolu .

[group("system:x86_64-linux")]
[group("system:aarch64-darwin")]
e2e: nix
    just test
