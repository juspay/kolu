/**
 * Per-server-instance temp root for server-generated files.
 *
 * Kolu injects shell rc files and clipboard image shim directories on a
 * per-terminal basis. Those go under a single root keyed by the server's
 * startup UUID, rooted at $XDG_RUNTIME_DIR when available.
 *
 * Privacy: $XDG_RUNTIME_DIR on Linux is /run/user/$UID — tmpfs, mode 0700,
 * wiped at logout. Clipboard images can contain screenshots, drag-dropped
 * files, and secrets; sharing /tmp with every other user on the host was
 * the wrong default. macOS os.tmpdir() already returns a per-user dir.
 * Non-systemd Linux falls back to /tmp with no regression.
 */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverProcessId } from "./hostname.ts";

const runtimeRoot = process.env.XDG_RUNTIME_DIR ?? tmpdir();

/** Per-server-instance root. Everything kolu's server writes to disk for
 *  transient per-terminal use lives under here. */
export const koluRoot = join(runtimeRoot, `kolu-${serverProcessId}`);

/** Injected bash rc files and zsh ZDOTDIRs, one pair per spawned terminal.
 *  Regenerated on every terminal spawn — removed on server shutdown. */
export const koluShellDir = join(koluRoot, "shell");

/** Per-terminal clipboard image-paste shim directories.
 *  Preserved across server shutdown — the user may still want pasted
 *  screenshots inspectable; aged out by XDG logout-wipe. */
export const koluClipboardDir = join(koluRoot, "clipboard");

/** `KOLU_TEST_MODE=1` flips shutdown cleanup from selective (production) to
 *  full-root (e2e fixture wipe). Set once at module load; tests pass it via
 *  the spawned server's env. */
const isTestMode = process.env.KOLU_TEST_MODE === "1";

/** Create the root + subdirs with owner-only mode. Called once at server
 *  startup before any terminal spawns. Idempotent. */
export function ensureKoluRoot(): void {
  mkdirSync(koluShellDir, { recursive: true, mode: 0o700 });
  mkdirSync(koluClipboardDir, { recursive: true, mode: 0o700 });
}

/** Cleanup run from the signal/fatal handlers at process exit.
 *
 *  - Test mode: remove the whole root (all fixture data, nothing valuable).
 *  - Production: remove only `shell/`. Clipboard images may still matter to
 *    the user and XDG logout-wipe will reclaim them later.
 *
 *  Errors are swallowed on purpose: this runs from uncaughtException /
 *  unhandledRejection paths where a throw would cascade past `process.exit`
 *  and leave the process wedged in Node's default crash path. A failed
 *  cleanup is strictly better than a stuck server. */
export function shutdownCleanup(): void {
  const target = isTestMode ? koluRoot : koluShellDir;
  try {
    rmSync(target, { recursive: true, force: true });
  } catch {
    // Best-effort — see doc comment above.
  }
}
