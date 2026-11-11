# THE FLOOR'S PACKAGE, ON ITS OWN — agent-distro's launchers exactly as
# upstream builds them, with nothing of kolu's wrapped around it.
#
# It lives beside ./default.nix rather than inside it because TWO readers need
# this one derivation and only one of them may know the rest of that file:
#
#   * ./default.nix, which bakes it onto the wrappers (the manifest, the proof);
#   * nix/overlay.nix, whose `kolu-acp-adapter` drives this package's
#     `bin/claude` — the conductor's CLI is the floor's CLI.
#
# The second one cannot reach ./default.nix: that file's `readListing` is a
# command built out of kolu's own build derivation, which bakes KOLU_ACP_AGENT
# from `nix/env.nix`, which reads `pkgs.kolu-acp-adapter`. An adapter importing
# ./default.nix would close that loop — adapter → agent-distro → readListing →
# kolu → koluEnv → adapter — and Nix would answer with an infinite recursion
# nobody could read back to the cause. Nothing here imports anything of kolu's,
# so both readers import THIS file with the same pin and name the same store
# path; a second copy of the launchers would be a second floor, and the whole
# point is that the conductor runs the one the terminals do.
{ pkgs, src }:
let
  inherit (pkgs) lib;

  # agent-distro's flake outputs with kolu's nixpkgs as its `nixpkgs` input.
  # Only `lib` is read: a plain value, so this never instantiates the flake's
  # own per-system package sets.
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
# The one package, as upstream builds it — the same kind of store path kolu
# delivers to a host as `current`.
(distro.lib.mkLaunchers {
  pkgs = pkgsUpstream;
  nixpkgs = nixpkgsInput;
}).package
