# A version-current `codex` for the real-agent-against-ollama e2e lane only.
#
# WHY NOT `pkgs.codex`: the repo's pinned nixpkgs ships codex 0.114.0, whose
# `threads` SQLite table predates the `updated_at_ms` + `model` columns that
# kolu's OWN codex provider requires (packages/integrations/codex/src/core.ts).
# Against 0.114 the provider logs "threads table is missing required columns —
# Codex detection disabled" and no agent state surfaces.
#
# So the e2e lane pins a newer codex via `sadjow/codex-cli-nix` (npins-pinned):
# a maintained packaging of OpenAI's official codex release (0.144.1) that
# vendors the native release binary per platform and handles the darwin case
# (nixpkgs' fixup re-signs the macho; `dontStrip` keeps it from being
# re-invalidated) — dropping the hand-rolled multi-platform hashes +
# autoSignDarwinBinariesHook this file used to carry. `runtime = "native"` gives
# the standalone Rust binary (no node runtime). This pins ONLY the e2e agent;
# production/dev keep `pkgs.codex`.
{ pkgs }:
let
  sources = import ../../npins;
in
pkgs.callPackage (sources.codex-cli-nix + "/package.nix") {
  runtime = "native";
}
