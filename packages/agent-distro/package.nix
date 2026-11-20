{ pkgs, src }:
let
  inherit (pkgs) lib;

  distro = (import "${src}/flake.nix").outputs {
    nixpkgs = {
      outPath = pkgs.path;
      inherit lib;
    };
  };

  # The launchers are built with AGENT-DISTRO'S OWN locked nixpkgs, not kolu's:
  # any other package set hashes differently, so the cache holds nothing and
  # every kolu build compiles five harnesses — and the floor would not be the
  # store path kolu delivers to every host. `import`ed exactly as upstream's
  # flake does it (same system, `allowUnfree` for Claude Code, no overlays),
  # because a byte off is a cache miss.
  lockedNixpkgs = (builtins.fromJSON (builtins.readFile "${src}/flake.lock")).nodes.nixpkgs.locked;
  nixpkgsSource = builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/${lockedNixpkgs.rev}.tar.gz";
    sha256 = lockedNixpkgs.narHash;
  };
  pkgsUpstream = import nixpkgsSource {
    inherit (pkgs.stdenv.hostPlatform) system;
    config = { allowUnfree = true; };
  };
  # The shape upstream's flake passes as `nixpkgs`: its `rev`/`narHash` let the
  # launchers name nixpkgs by a locked reference instead of holding its source,
  # and baking the path alone is a different derivation.
  nixpkgsInput = {
    outPath = nixpkgsSource;
    inherit (lockedNixpkgs) rev narHash;
  };
in
(distro.lib.mkLaunchers {
  pkgs = pkgsUpstream;
  nixpkgs = nixpkgsInput;
}).package
