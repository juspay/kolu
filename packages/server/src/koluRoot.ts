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

// Set by ensureKoluRoot(). Module is inert on import — paths are computed
// only when the server explicitly creates the root directory.
/** Per-server-instance root. Everything kolu's server writes to disk for
 *  transient per-terminal use lives under here. */
export let koluRoot: string;

/** Injected bash rc files and zsh ZDOTDIRs, one pair per spawned terminal. */
export let koluShellDir: string;

/** Per-terminal clipboard image-paste shim directories. */
export let koluClipboardDir: string;

/** Compute paths and create the root + subdirs with owner-only mode.
 *  Called once at server startup before any terminal spawns.
 *  Requires `initHostname()` to have run first. Idempotent. */
export function ensureKoluRoot(): void {
  const runtimeRoot = process.env.XDG_RUNTIME_DIR ?? tmpdir();
  koluRoot = join(runtimeRoot, `kolu-${serverProcessId}`);
  koluShellDir = join(koluRoot, "shell");
  koluClipboardDir = join(koluRoot, "clipboard");
  mkdirSync(koluShellDir, { recursive: true, mode: 0o700 });
  mkdirSync(koluClipboardDir, { recursive: true, mode: 0o700 });
}

/** Remove the whole per-instance root on shutdown. Registered on the
 *  `process.on('exit', ...)` hook so it runs synchronously from every exit
 *  path. If rmSync throws, Node's default exit-handler reporter prints the
 *  stack — we do not swallow. Guards against early exits before
 *  `ensureKoluRoot()` has computed the paths. */
export function shutdownCleanup(): void {
  if (!koluRoot) return;
  rmSync(koluRoot, { recursive: true, force: true });
}
