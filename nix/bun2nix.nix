# bun2nix, consumed via npins (NOT a flake input).
#
# The flake intentionally has ZERO inputs (see flake.nix / nix/nixpkgs.nix);
# every external Nix source is pinned with npins. bun2nix gives us the
# fetchBunDeps/hook nixpkgs has no equivalent for — it powers the bun-built
# `arivu-tui` viewer (arivu P3 PR1); the daemon and the rest of kolu stay Node.
#
# bun2nix's `rawflake` branch is a flake-parts flake whose
# `lib.mkBun2nix { pkgs }` builds its rust CLI + setup hook and hands back
# fetchBunDeps. flake-parts needs real flake-input resolution (system
# attributes, transitive nixpkgs/treefmt nodes), so we evaluate it with
# `builtins.getFlake` — but pinned to the EXACT rev + narHash npins records, so
# it is reproducible and is NOT an input on kolu's flake: there is no
# `inputs.bun2nix`, no node in kolu's (nonexistent) flake.lock, and `nix
# develop` never forces it (this file is imported only when the `arivu-tui` attr
# is built). `npins update bun2nix` bumps the pin; this file follows it.
# `mkBun2nix` takes `pkgs` as an argument, so the FOD cache (fetchBunDeps) is
# realised against OUR npins-pinned pkgs — nixpkgs of record on the build path
# stays npins alone.
{ pkgs }:
let
  pin = (builtins.fromJSON (builtins.readFile ../npins/sources.json)).pins.bun2nix;
  bun2nixFlake = builtins.getFlake (
    "github:juspay/bun2nix/${pin.revision}?narHash=${pin.hash}"
  );
in
bun2nixFlake.lib.mkBun2nix { inherit pkgs; }
