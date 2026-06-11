/**
 * A per-instance temp root for kolu processes that write transient files to
 * disk (injected shell rc files, per-terminal scratch for clipboard/drag-drop).
 *
 * Factored here so both kolu-server (keyed to its startup UUID) and the
 * surviving pty-host daemon (keyed to the stable `"pty-host"` name) compute the
 * same shape without depending on each other — the daemon owns the pty-host's
 * shell-rc injection in Phase B, so it needs its own root, and pty-host cannot
 * import server code.
 *
 * Privacy: rooted at `$XDG_RUNTIME_DIR` (Linux /run/user/$UID — tmpfs, 0700,
 * wiped at logout) when present, else `os.tmpdir()`. Scratch can hold
 * screenshots, dropped files, and secrets, so the dirs are created 0700.
 */
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface KoluRoot {
  /** The instance root — everything below lives here. */
  readonly root: string;
  /** Injected bash rc files / zsh ZDOTDIRs, one pair per spawned terminal. */
  readonly shellDir: string;
  /** Per-terminal scratch for clipboard pastes and drag-and-drop drops. */
  readonly scratchDir: string;
  /** Create the subdirs owner-only. Idempotent; call before first use. */
  ensure(): void;
  /** Remove the whole instance root. Safe from a `process.on("exit")` hook. */
  cleanup(): void;
}

/**
 * Compute a kolu temp root keyed by `id` — a process-unique token (the
 * server's startup UUID) or a stable singleton name (the daemon's
 * `"pty-host"`). Pure: it computes paths; `ensure()` is what touches disk.
 */
export function koluRootFor(id: string): KoluRoot {
  const runtimeRoot = process.env.XDG_RUNTIME_DIR ?? tmpdir();
  const root = join(runtimeRoot, `kolu-${id}`);
  const shellDir = join(root, "shell");
  const scratchDir = join(root, "scratch");
  return {
    root,
    shellDir,
    scratchDir,
    ensure() {
      mkdirSync(shellDir, { recursive: true, mode: 0o700 });
      mkdirSync(scratchDir, { recursive: true, mode: 0o700 });
    },
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}
