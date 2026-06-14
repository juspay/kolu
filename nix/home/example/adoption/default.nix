# B3.3 — kaval adoption VM tests (Linux-only; both ride ci::home-manager).
#
#   adopt.nix — the positive path: a kolu redeploy that did NOT change kaval's
#               source keeps the daemon alive, so terminals are ADOPTED.
#   skew.nix  — the negative path: a redeploy that DID change kaval's wire
#               (a contract-version skew) makes the surviving daemon
#               incompatible, so it is RECYCLED — the terminals don't survive,
#               but the session is preserved for restore.
#
# Both tests share one scaffold; lib.nix owns it (the survival VM node, the boot
# polls, the machinectl+result-file run/assert helpers, the jq/curl bindings, and
# the runtime-layout literals). adopt.nix/skew.nix are just their distinguishing
# data.
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
{
  adoption-vm-test = import ./adopt.nix args;
  adoption-skew-vm-test = import ./skew.nix args;
}
