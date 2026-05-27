/**
 * Per-server-instance temp root for server-generated files.
 *
 * Kolu writes shell rc files and per-terminal scratch storage (clipboard
 * image pastes, drag-and-drop file drops) under a single root keyed by
 * the server's startup UUID, rooted at $XDG_RUNTIME_DIR when available.
 *
 * Privacy: $XDG_RUNTIME_DIR on Linux is /run/user/$UID — tmpfs, mode 0700,
 * wiped at logout. Scratch files can contain screenshots, dropped files,
 * and secrets; sharing /tmp with every other user on the host was the
 * wrong default. macOS os.tmpdir() already returns a per-user dir.
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

/** Injected bash rc files and zsh ZDOTDIRs, one pair per spawned terminal. */
export const koluShellDir = join(koluRoot, "shell");

/** Per-terminal scratch directories where clipboard image pastes and
 *  drag-and-drop file drops land on disk. */
export const koluScratchDir = join(koluRoot, "scratch");

/** Create the root + subdirs with owner-only mode. Called once at server
 *  startup before any terminal spawns. Idempotent. */
export function ensureKoluRoot(): void {
  mkdirSync(koluShellDir, { recursive: true, mode: 0o700 });
  mkdirSync(koluScratchDir, { recursive: true, mode: 0o700 });
}

/** Remove the whole per-instance root on shutdown. Registered on the
 *  `process.on('exit', ...)` hook so it runs synchronously from every exit
 *  path. If rmSync throws, Node's default exit-handler reporter prints the
 *  stack — we do not swallow. */
export function shutdownCleanup(): void {
  rmSync(koluRoot, { recursive: true, force: true });
}
