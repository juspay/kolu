# `kolu-port-scan-darwin` — the libproc helper padi's port scan runs on macOS.
#
# It lives inside `packages/padi/` rather than in `nix/packages/` because location
# is structure: this derivation exists only to compile the C file beside it, and
# the two must move together. (Same reason `packages/surface-daemon/nix/` holds the
# daemon-identity recipe.)
#
# DARWIN ONLY. libproc is a macOS interface; the linux scan reads `/proc` directly
# and needs no helper. Callers must guard on the platform rather than expecting a
# no-op here — `null` on linux makes "there is nothing to bake" explicit at eval
# time instead of building an empty derivation that pretends to be a scanner.
{ lib, stdenv }:

if !stdenv.hostPlatform.isDarwin then
  null
else
  stdenv.mkDerivation {
    pname = "kolu-port-scan-darwin";
    version = "1";

    src = ../native;

    # No inputs beyond the C toolchain: libproc is in the system SDK that stdenv
    # already provides on darwin, and the helper links nothing else. That is the
    # point of it — the old path needed two subprocesses and their text formats.
    dontConfigure = true;

    buildPhase = ''
      runHook preBuild
      # -Wall -Wextra -Werror: this reads kernel structs by field, so a silent
      # truncation or sign surprise must be a build failure, not a wrong port.
      $CC -O2 -Wall -Wextra -Werror -o kolu-port-scan-darwin portScanDarwin.c
      runHook postBuild
    '';

    installPhase = ''
      runHook preInstall
      mkdir -p $out/bin
      cp kolu-port-scan-darwin $out/bin/
      runHook postInstall
    '';

    # A scanner that cannot run is worse than one that is absent, because padi
    # bakes this path and trusts it. Prove it executes and emits the version line
    # its consumer parses, in the sandbox, before it can be depended on.
    doInstallCheck = true;
    installCheckPhase = ''
      runHook preInstallCheck
      out_text="$($out/bin/kolu-port-scan-darwin)" || {
        echo "kolu-port-scan-darwin exited non-zero" >&2; exit 1; }
      case "$out_text" in
        "V	1"*) ;;
        *) echo "kolu-port-scan-darwin did not emit the version line first" >&2
           printf '%s\n' "$out_text" | head -3 >&2
           exit 1 ;;
      esac
      # It must see ITSELF: the sandbox always has at least this process, so an
      # empty process table means libproc told us nothing and the check is real.
      printf '%s\n' "$out_text" | grep -q '^P	' || {
        echo "kolu-port-scan-darwin emitted no process rows" >&2; exit 1; }
      runHook postInstallCheck
    '';

    meta = {
      description =
        "One-pass libproc reader for padi's port scan: process table + listening TCP sockets";
      mainProgram = "kolu-port-scan-darwin";
      platforms = lib.platforms.darwin;
    };
  }
