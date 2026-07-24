# vazhi's own flake, so it can be run — and later moved — on its own:
#
#     nix run ./packages/vazhi        # from a kolu checkout
#     nix run .#vazhi                # the same binary, from the root flake
#
# ONE input, and only because vazhi still lives in the kolu monorepo today: the
# workspace tree it is built out of. Everything vazhi itself needs is in
# `@kolu/port-forward`, which has no dependencies at all — so when vazhi moves
# to its own repo, this input is replaced by its own source and nothing else in
# here changes shape.
#
# nixpkgs deliberately comes from kolu's npins pin (`nix/nixpkgs.nix`) rather
# than a second flake input: kolu's flake has ZERO inputs on purpose (each one
# costs ~1.5s of `nix develop` startup), and vazhi has no reason to disagree
# with the workspace it is built from about which nixpkgs that is.
{
  description = "vazhi — a standalone TUI for ssh port forwards";

  nixConfig = {
    extra-substituters = "https://cache.nixos.asia/oss";
    extra-trusted-public-keys = "oss:KO872wNJkCDgmGN3xy9dT89WAhvv13EiKncTtHDItVU=";
  };

  inputs.kolu.url = "path:../..";

  outputs = { kolu, ... }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
      eachSystem = f: builtins.listToAttrs (map
        (system: {
          name = system;
          value = f (import (kolu + "/nix/nixpkgs.nix") { inherit system; });
        })
        systems);
    in
    {
      packages = eachSystem (pkgs:
        # The ONE definition of the binary lives in ./default.nix, threaded the
        # workspace `src` + `pnpmDeps` by kolu's root composer — so this flake
        # and `nix run .#vazhi` can never build two different vazhis.
        let vazhi = (import kolu { inherit pkgs; }).vazhi;
        in { inherit vazhi; default = vazhi; });
    };
}
