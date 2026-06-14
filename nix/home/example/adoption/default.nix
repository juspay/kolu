# B3.3 — kaval adoption VM tests (Linux-only; both ride ci::home-manager).
#
#   adopt.nix — the positive path: a kolu redeploy that did NOT change kaval's
#               source keeps the daemon alive, so terminals are ADOPTED.
#   skew.nix  — the negative path: a redeploy that DID change kaval's wire
#               (a contract-version skew) makes the surviving daemon
#               incompatible, so it is RECYCLED — the terminals don't survive,
#               but the session is preserved for restore.
args:
{
  adoption-vm-test = import ./adopt.nix args;
  adoption-skew-vm-test = import ./skew.nix args;
}
