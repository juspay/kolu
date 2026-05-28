# Dev shell — shared by `nix develop` (via flake.nix) and `nix-shell`.
#
# Imports env.nix directly instead of going through default.nix, which also
# defines pnpmDeps/kolu build derivations that are unnecessary for the shell.
#
# Playwright is NOT included here — it adds ~600ms to nix develop cold start.
# flake.nix exposes devShells.e2e for e2e tests: `nix develop .#e2e`.
{ pkgs ? import ./nix/nixpkgs.nix { } }:
let
  koluEnv = import ./nix/env.nix { inherit pkgs; };
in
pkgs.mkShell {
  name = "kolu-shell";

  env = koluEnv // {
    KOLU_COMMIT_HASH = "dev";
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
  };

  shellHook = ''
    if root=$(git rev-parse --show-toplevel 2>/dev/null); then
      ln -sfn "$KOLU_FONTS_DIR" "$root/packages/client/public/fonts"
      # Remote terminals (R-2): the `kolu --stdio` agent's drv path is
      # resolved by `nix eval --raw $KOLU_AGENT_FLAKE_REF#packages.<sys>.default.drvPath`.
      # In dev, we want the local source — `path:$root` resolves
      # against the worktree's flake (not a pushed github branch).
      # Set only in the devShell; the production wrapper leaves the
      # env var unset so operators opt in explicitly per the
      # "no fallback" contract.
      export KOLU_AGENT_FLAKE_REF="path:$root"
    fi
  '';

  packages = with pkgs; [
    just
    jq # used by ci/lib.just recipes
    nodejs
    pnpm
    tsx
    nixpkgs-fmt
    # Biome from nixpkgs — single toolchain source, avoids per-platform Rust
    # binary fetches via pnpm postinstall. Version drift between this and
    # biome.jsonc's $schema URL is tolerable for IDE auto-complete (#885).
    biome
    # `uv` provides `uvx`, used by agents/ai.just to run APM from
    # git+https without a global install.
    uv
    # prettier is provided by pnpm (same version) — no need for a nix copy.
    # Use `pnpm exec prettier` or ensure `just install` has been run.
    # node-gyp toolchain — required by `pnpm install` to recompile node-pty
    # after applying patches/node-pty@1.1.0.patch (the patched install
    # script forces node-gyp rebuild). The build derivation already lists
    # these in nativeBuildInputs; the dev shell needs them so `just install`
    # works outside the nix build.
    python3
    nodePackages.node-gyp
    pkg-config
  ];
}
