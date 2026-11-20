{ pkgs, kolu, home-manager, nixosModule, system }:
let
  port = "7681";

  kavalTui = "${kolu.packages.${system}.kaval-tui}/bin/kaval-tui";

  kavalBin = "${kolu.packages.${system}.kaval}/bin/kaval";

  koluRpc = "${kolu.packages.${system}.kolu-rpc}/bin/kolu-rpc";

  lib = import ./lib.nix {
    inherit pkgs home-manager nixosModule port kavalTui koluRpc;
  };

  args = { inherit pkgs kolu system port kavalTui kavalBin lib; };
in
{
  adoption-adopt = import ./adopt.nix args;
  adoption-skew = import ./skew.nix args;
  adoption-currency = import ./currency.nix args;
  adoption-padi-upgrade = import ./padi-upgrade.nix args;
  offline-provision = import ./offline-provision.nix args;
}
  // import ./upgrade.nix args
