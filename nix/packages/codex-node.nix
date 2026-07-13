# The NODE-distributed codex (npm runtime) for the ONE npm-shim e2e scenario.
#
# codex-real.feature drives the NATIVE codex (codex-pinned.nix). This packages
# the OTHER distribution — the npm one — from the SAME pin (sadjow/codex-cli-nix,
# `runtime = "node"`): a node wrapper that runs codex via `node`. That is exactly
# the shape that made an npm-installed codex evade detection (#673 / #677): the
# foreground process's kernel basename is `node`, NOT `codex`, so
# `readForegroundBasename` can't match it — detection has to fall back to the
# shell's OSC 633;E command-hint (`lastAgentCommandName = "codex"`). The e2e
# launches this by its absolute `.../bin/codex` path so the typed command's
# basename is `codex` while the running process is `node` — the authentic
# npm-shim divergence, no fake bin.
#
# `nodeBinName = "codex"` so the bin is named `codex` (not the default
# `codex-node`); the native and node codex live at different store paths, so
# there is no PATH collision (both are launched by absolute path).
{ pkgs }:
let
  sources = import ../../npins;
in
pkgs.callPackage (sources.codex-cli-nix + "/package.nix") {
  runtime = "node";
  nodeBinName = "codex";
}
