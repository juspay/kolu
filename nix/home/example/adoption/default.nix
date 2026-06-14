# B3.3/B3.4 — kaval adoption VM tests (Linux-only; all ride ci::home-manager).
#
#   adopt.nix    — the positive path: a kolu redeploy that did NOT change kaval's
#                  source keeps the daemon alive, so terminals are ADOPTED (and the
#                  rail shows NO update-pending — running == expected, the #1034
#                  no-op-deploy-no-nudge proof).
#   skew.nix     — the contract-skew negative path: a redeploy that DID change
#                  kaval's wire (a contract-version skew) makes the surviving
#                  daemon incompatible, so it is RECYCLED — the terminals don't
#                  survive, but the session is preserved for restore.
#   currency.nix — the build-skew path (B3.4): a redeploy that changed kaval's
#                  BUILD but not its wire keeps the survivor COMPATIBLE, so it is
#                  ADOPTED (gate unchanged) and detected a build behind → the rail
#                  nudges "update pending".
#
# All share one scaffold; lib.nix owns it (the survival VM node, the boot polls,
# the machinectl+result-file run/assert helpers, the jq/curl bindings, and the
# runtime-layout literals). Each .nix is just its distinguishing data.
{ pkgs, kolu, home-manager, nixosModule, system }:
let
  # The kolu user service's listen port. This is one fact that must agree across
  # the module default, the kaval-<port>/ namespace the scripts read, the curl
  # health-check URL, and the kolu-new ExecStart --port — so it is declared ONCE
  # here and threaded into both tests. Pinned to the home-manager module default
  # (nix/home/module.nix:63). The true fix is reading the module's effective port
  # rather than restating it; deferred as an app-side change.
  port = "7681";

  kavalTui = "${kolu.packages.${system}.kaval-tui}/bin/kaval-tui";

  lib = import ./lib.nix {
    inherit pkgs home-manager nixosModule port kavalTui;
  };

  args = { inherit pkgs kolu system port kavalTui lib; };
in
# Symmetric attr names that decline one stem after the file stems
  # (adopt.nix → adoption-adopt, skew.nix → adoption-skew, currency.nix →
  # adoption-currency). The redundant -vm-test suffix is dropped — all live under
  # the VM-test-only Linux lane — so a reader grepping a failing check name meets
  # one consistent spelling.
{
  adoption-adopt = import ./adopt.nix args;
  adoption-skew = import ./skew.nix args;
  adoption-currency = import ./currency.nix args;
}
