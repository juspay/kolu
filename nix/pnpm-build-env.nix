# Every environment setting a `pnpm run` inside a Nix builder needs.
#
# MERGED WHOLE by each consumer (`// (import ./nix/pnpm-build-env.nix)`), never
# `inherit`ed one attribute at a time — the shape `koluEnv` (nix/env.nix) already
# uses. That is what makes a second setting a ONE-FILE change: naming the attribute
# at each call site would mean editing every builder again for exactly the kind of
# change this file exists to absorb.
#
# Every derivation that runs `pnpm` inside a builder takes it: default.nix,
# nix/pnpm-typecheck.nix, website/default.nix,
# packages/solid-browser/example/docsite/default.nix and
# packages/surface/example/remote-process-monitor/default.nix. It is NOT `koluEnv`:
# that one is kolu's RUNTIME env and is also consumed by the devShell, where a
# developer at a TTY wants pnpm's progress tree. This is build-only.
#
# ── Why `npm_config_reporter` ────────────────────────────────────────────────
# pnpm's default reporter draws a live progress TREE and redraws it with cursor-up
# escapes. Inside a Nix builder that redraw ERASES the failing package's own output:
# `tsc` prints its diagnostic, the next frame overwrites the line, and `nix log` ends
# at a bare `ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL` with the actual error gone —
# unrecoverable short of rebuilding by hand with `--keep-failed`. That is not a
# theoretical loss: a remote host failed to provision, and neither the card ("'nix
# build' exited with code 1") nor `nix log` could say why, because the one line that
# named the cause had been drawn over.
#
# `append-only` streams each line once and never redraws, so the diagnostic survives
# into `nix log`.
#
# It has to be the ENV var rather than a `--reporter` flag: the root `typecheck` /
# `build` scripts shell out to a NESTED `pnpm -r`, which a flag on the outer
# invocation never reaches. An env var is inherited by every descendant.
{
  npm_config_reporter = "append-only";
}
