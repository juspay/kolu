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
    fi
  '';

  packages = with pkgs; [
    just
    nodejs
    pnpm
    tsx
    nixpkgs-fmt
    # `uv` provides `uvx`, used by agents/ai.just to run APM from
    # git+https without a global install (see ci::apm-sync).
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
