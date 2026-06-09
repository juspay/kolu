/**
 * The well-known unix-socket path where kolu-server serves the in-process
 * pty-host (via `serveOverStdio`) and `kolu-tui` connects to it (via
 * `stdioLink`). Single source of truth so the server and the CLI — two
 * separate packages, two separate processes — compute it identically.
 *
 * Why a STABLE path (not the per-process `kolu-${serverProcessId}` runtime
 * dir kolu-server writes its scratch under): the CLI is a different process
 * and must find the socket *without* knowing the server's startup UUID. A
 * fixed path is the discoverable Unix convention (cf. D-Bus's
 * `/run/user/$UID/bus`, tmux's `/tmp/tmux-$UID/`, X11's `/tmp/.X11-unix`).
 *
 * The path must be identical in EVERY process for the same user, whatever
 * launched it. On systemd Linux `$XDG_RUNTIME_DIR` (`/run/user/$UID`) is
 * exactly that. Off systemd (macOS always; non-systemd Linux) we must NOT use
 * `os.tmpdir()`: it honours `$TMPDIR`, which differs by launch context — a
 * launchd-spawned kolu-server gets a private `/var/folders/.../T`, while a
 * `nix run` CLI gets `/tmp` — so server and CLI would land on *different*
 * sockets and never meet (the macOS symptom: "no pty-host socket at
 * /tmp/kolu/..."). Instead we fall back to a fixed, `$TMPDIR`-independent
 * per-user dir `/tmp/kolu-$UID/` (the tmux convention): `/tmp` is always
 * present and identical in every process on Linux and macOS, and the `-$UID`
 * suffix keeps it per-user. `serveOverSocket` creates it `0700` and refuses to
 * serve unless it's owner-only, so the stable shared path stays private.
 *
 * This assumes one kolu-server per user session — the single-server model
 * R-4 Phase 1 ships. Pass an explicit override (the CLI's and the server's
 * `--pty-host-socket`) to run more than one.
 */
import { join } from "node:path";

/** The socket path: `override` if given, else `$XDG_RUNTIME_DIR/kolu/
 *  pty-host.sock` on systemd Linux, else the `$TMPDIR`-independent per-user
 *  fallback `/tmp/kolu-$UID/pty-host.sock` (see file header for why not
 *  `os.tmpdir()`). */
export function getPtyHostSocketPath(override?: string): string {
  if (override !== undefined && override !== "") return override;
  const xdg = process.env.XDG_RUNTIME_DIR;
  if (xdg !== undefined && xdg !== "") {
    return join(xdg, "kolu", "pty-host.sock");
  }
  // No XDG_RUNTIME_DIR: a FIXED per-user dir under /tmp, NOT os.tmpdir() —
  // see the file header. `getuid` is POSIX (Linux + macOS); the `"shared"`
  // suffix is an unreachable fallback for platforms without uid semantics.
  const uid = process.getuid?.() ?? "shared";
  return join(`/tmp/kolu-${uid}`, "pty-host.sock");
}
