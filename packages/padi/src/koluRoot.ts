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

const runtimeRoot = process.env.XDG_RUNTIME_DIR ?? tmpdir();

/** This daemon's per-process id, INJECTED at boot by {@link setDaemonProcessId}
 *  rather than derived here. It names the per-instance root dir (`kolu-<id>`) and
 *  the per-terminal shell/scratch subtrees beneath it. A standalone daemon owns its
 *  own disk, so padi's `daemonMain` injects its OWN process id here — the value is
 *  not forked from any other process.
 *
 *  `undefined` until boot injects it: a READ before the set is a boot-order bug,
 *  so {@link requireDaemonProcessId} crashes loudly rather than letting a dir be
 *  derived from an unset/stale id. */
let daemonProcessId: string | undefined;

/** The injected id, or a loud crash if a read beat the boot-time set. Fail-fast:
 *  a never-set read must surface, never silently degrade to an empty-id dir. */
function requireDaemonProcessId(): string {
  if (daemonProcessId === undefined) {
    throw new Error(
      "daemonProcessId read before setDaemonProcessId() — the daemon's boot (padi's daemonMain) must inject it before ensureKoluRoot",
    );
  }
  return daemonProcessId;
}

/** Per-server-instance root. Everything kolu's server writes to disk for
 *  transient per-terminal use lives under here. Derived from the boot-injected
 *  id; throws if read before {@link setDaemonProcessId} ran. */
export function koluRoot(): string {
  return join(runtimeRoot, `kolu-${requireDaemonProcessId()}`);
}

/** Injected bash rc files and zsh ZDOTDIRs, one pair per spawned terminal. */
export function koluShellDir(): string {
  return join(koluRoot(), "shell");
}

/** Per-terminal scratch directories where clipboard image pastes and
 *  drag-and-drop file drops land on disk. */
export function koluScratchDir(): string {
  return join(koluRoot(), "scratch");
}

/** Inject this daemon's per-process id the on-disk roots derive from. Called once
 *  at the very top of the daemon's boot (padi's `daemonMain`), BEFORE
 *  {@link ensureKoluRoot}. */
export function setDaemonProcessId(id: string): void {
  if (!id) throw new Error("setDaemonProcessId: empty");
  daemonProcessId = id;
}

/** Create the root + subdirs with owner-only mode. Called once at server
 *  startup before any terminal spawns. Idempotent. */
export function ensureKoluRoot(): void {
  mkdirSync(koluShellDir(), { recursive: true, mode: 0o700 });
  mkdirSync(koluScratchDir(), { recursive: true, mode: 0o700 });
}

/** Remove the whole per-instance root on shutdown. Registered on the
 *  `process.on('exit', ...)` hook so it runs synchronously from every exit
 *  path. If rmSync throws, Node's default exit-handler reporter prints the
 *  stack — we do not swallow. */
export function shutdownCleanup(): void {
  rmSync(koluRoot(), { recursive: true, force: true });
}
