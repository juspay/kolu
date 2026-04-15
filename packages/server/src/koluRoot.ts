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

// Private state — set by ensureKoluRoot(), accessed through getters.
let _root: string | null = null;
let _shellDir: string | null = null;
let _clipboardDir: string | null = null;

/** Per-server-instance root. Everything kolu's server writes to disk for
 *  transient per-terminal use lives under here. */
export function koluRoot(): string {
  if (!_root) throw new Error("koluRoot: call ensureKoluRoot() first");
  return _root;
}

/** Injected bash rc files and zsh ZDOTDIRs, one pair per spawned terminal. */
export function koluShellDir(): string {
  if (!_shellDir) throw new Error("koluShellDir: call ensureKoluRoot() first");
  return _shellDir;
}

/** Per-terminal clipboard image-paste shim directories. */
export function koluClipboardDir(): string {
  if (!_clipboardDir)
    throw new Error("koluClipboardDir: call ensureKoluRoot() first");
  return _clipboardDir;
}

/** Compute paths and create the root + subdirs with owner-only mode.
 *  Called once at server startup before any terminal spawns.
 *  Requires `initHostname()` to have run first. Idempotent. */
export function ensureKoluRoot(): void {
  const runtimeRoot = process.env.XDG_RUNTIME_DIR ?? tmpdir();
  _root = join(runtimeRoot, `kolu-${serverProcessId()}`);
  _shellDir = join(_root, "shell");
  _clipboardDir = join(_root, "clipboard");
  mkdirSync(_shellDir, { recursive: true, mode: 0o700 });
  mkdirSync(_clipboardDir, { recursive: true, mode: 0o700 });
}

/** Remove the whole per-instance root on shutdown. Registered on the
 *  `process.on('exit', ...)` hook so it runs synchronously from every exit
 *  path. If rmSync throws, Node's default exit-handler reporter prints the
 *  stack — we do not swallow. Guards against early exits before
 *  `ensureKoluRoot()` has computed the paths. */
export function shutdownCleanup(): void {
  if (!_root) return;
  rmSync(_root, { recursive: true, force: true });
}
