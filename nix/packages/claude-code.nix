# claude-code for the real-agent-against-ollama e2e lane (Stage C: claude's
# live-state detection runs against the real Claude Code CLI pointed at ollama's
# Anthropic Messages endpoint, /v1/messages).
#
# Unlike codex, claude-code is a Node CLI (no signed macho), so there's no
# darwin code-signing issue and no version pin is needed — kolu's claude
# provider reads the sessions/<pid>.json + projects/<cwd>/*.jsonl that the
# current release writes. The one wrinkle: claude-code is UNFREE, so it can't
# come from the repo's default (free-only) nixpkgs. Import the SAME pinned
# nixpkgs with `allowUnfree` scoped to just this package — the resulting
# derivation carries its own eval, so the free e2e shell can depend on it.
{ pkgs }:
let
  pkgsUnfree = import ../nixpkgs.nix {
    inherit (pkgs.stdenv.hostPlatform) system;
    config.allowUnfree = true;
  };
in
pkgsUnfree.claude-code
