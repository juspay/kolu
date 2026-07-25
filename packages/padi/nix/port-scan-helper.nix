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

      # The DUAL-STACK case, checked here rather than only in the TypeScript live
      # test, because the defect it guards lives in the C: `insi_vflag` sets BOTH
      # INI_IPV4 and INI_IPV6 for a `::` socket, and an earlier revision tested
      # INI_IPV4 first and so reported `::` as `0.0.0.0`. A fixture cannot catch
      # that — only a real socket can — so bind one right here and read it back.
      cat > dualstack.c <<'DUALSTACK'
      #include <netinet/in.h>
      #include <stdio.h>
      #include <string.h>
      #include <sys/socket.h>
      #include <unistd.h>
      int main(void) {
        int fd = socket(AF_INET6, SOCK_STREAM, 0);
        if (fd < 0) return 2;
        int off = 0;  /* dual-stack: v6only OFF, so both vflag bits get set */
        setsockopt(fd, IPPROTO_IPV6, IPV6_V6ONLY, &off, sizeof(off));
        struct sockaddr_in6 sa;
        memset(&sa, 0, sizeof(sa));
        sa.sin6_family = AF_INET6;
        sa.sin6_len = sizeof(sa);
        sa.sin6_addr = in6addr_any;          /* :: */
        if (bind(fd, (struct sockaddr *)&sa, sizeof(sa)) < 0) return 2;
        if (listen(fd, 4) < 0) return 2;
        socklen_t n = sizeof(sa);
        if (getsockname(fd, (struct sockaddr *)&sa, &n) < 0) return 2;
        printf("%d\n", ntohs(sa.sin6_port));  /* port 0 -> kernel picks a free one */
        fflush(stdout);
        sleep(20);
        return 0;
      }
DUALSTACK
      $CC -O0 -o dualstack dualstack.c || {
        echo "could not build the dual-stack probe" >&2; exit 1; }
      ./dualstack > ds.port &
      ds_pid=$!
      # Wait for the bind rather than sleeping blind.
      for _ in 1 2 3 4 5 6 7 8 9 10; do
        [ -s ds.port ] && break
        sleep 0.3
      done
      ds_port="$(cat ds.port 2>/dev/null)"
      if [ -z "$ds_port" ]; then
        # A sandbox that cannot bind at all must not silently pass this check.
        kill $ds_pid 2>/dev/null || true
        echo "the dual-stack probe never bound — this check cannot be skipped" >&2
        exit 1
      fi
      ds_row="$($out/bin/kolu-port-scan-darwin | awk -v p="$ds_port" '$1 == "L" && $3 == p { print $4; exit }')"
      kill $ds_pid 2>/dev/null || true
      case "$ds_row" in
        # 32 zeros: the v6 wildcard, read from the v6 slot. The bug emitted the
        # 8-zero v4 form here instead.
        00000000000000000000000000000000) ;;
        "") echo "the helper did not report the dual-stack listener on port $ds_port" >&2
            exit 1 ;;
        *)  echo "dual-stack :: reported as '$ds_row' — expected the 16-byte v6 wildcard." >&2
            echo "An 8-digit answer means INI_IPV4 is being tested before INI_IPV6." >&2
            exit 1 ;;
      esac
      runHook postInstallCheck
    '';

    meta = {
      description =
        "One-pass libproc reader for padi's port scan: process table + listening TCP sockets";
      mainProgram = "kolu-port-scan-darwin";
      platforms = lib.platforms.darwin;
    };
  }
