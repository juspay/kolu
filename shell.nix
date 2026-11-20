{ pkgs ? import ./nix/nixpkgs.nix { } }:
let
  koluEnv = import ./nix/env.nix { inherit pkgs; };
  sources = import ./npins;
in
pkgs.mkShell {
  name = "kolu-shell";

  env = koluEnv // {
    KOLU_COMMIT_HASH = "dev";
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD = "1";
    KOLU_AGENT_DISTRO_SRC = "${sources.agent-distro}";
  };

  shellHook = ''
    if root=$(git rev-parse --show-toplevel 2>/dev/null); then
      ln -sfn "$KOLU_FONTS_DIR" "$root/packages/client/public/fonts"
    fi
  '';

  packages = with pkgs; [
    just
    jq
    nodejs
    pnpm_10
    tsx
    nixpkgs-fmt
    biome
    d2
    # node-gyp toolchain — required by `pnpm install` to recompile node-pty
    # after applying patches/node-pty@1.1.0.patch (the patched install
    # script forces node-gyp rebuild). The build derivation already lists
    # these in nativeBuildInputs; the dev shell needs them so `just install`
    # works outside the nix build.
    python3
    node-gyp
    pkg-config
  ];
}
