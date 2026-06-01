/**
 * The well-known unix-socket path where kolu-server serves the in-process
 * pty-host (via `serveOverStdio`) and `kolu-tui` connects to it (via
 * `stdioLink`). Single source of truth so the server and the CLI — two
 * separate packages — compute it identically.
 *
 * Why a STABLE path (not the per-process `kolu-${serverProcessId}` runtime
 * dir kolu-server writes its scratch under): the CLI is a different process
 * and must find the socket *without* knowing the server's startup UUID. A
 * fixed `$XDG_RUNTIME_DIR/kolu/pty-host.sock` is the discoverable Unix
 * convention (cf. D-Bus's `/run/user/$UID/bus`, X11's `/tmp/.X11-unix`).
 *
 * This assumes one kolu-server per user session — the single-server model
 * R-4 Phase 1 ships. Pass an explicit override (the CLI's `--socket`, the
 * server's `--pty-host-socket`) to run more than one. The `$XDG_RUNTIME_DIR`
 * fallback to `tmpdir()` mirrors `koluRoot`'s own (non-systemd Linux).
 */
import { tmpdir } from "node:os";
import { join } from "node:path";

/** The socket path: `override` if given, else
 *  `$XDG_RUNTIME_DIR/kolu/pty-host.sock` (falling back to
 *  `${tmpdir()}/kolu/pty-host.sock`). */
export function getPtyHostSocketPath(override?: string): string {
  if (override !== undefined && override !== "") return override;
  const runtimeRoot = process.env.XDG_RUNTIME_DIR ?? tmpdir();
  return join(runtimeRoot, "kolu", "pty-host.sock");
}
