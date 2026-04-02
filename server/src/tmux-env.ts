/**
 * tmux compatibility environment for PTY shells.
 *
 * Creates a temporary directory containing a `tmux` wrapper script
 * that invokes the kolu-tmux shim. This directory is prepended to
 * PTY shell PATH so Claude Code (and other AI tools) find `tmux`
 * and auto-detect multiplexer support.
 *
 * Also manages per-terminal synthetic pane IDs ($TMUX_PANE) and
 * the $TMUX env var that signals "inside tmux" to tools.
 */

import { mkdirSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Path to tmux-shim.ts (co-located with this module). */
const SHIM_SCRIPT = join(__dirname, "tmux-shim.ts");

/** Resolve absolute path to tsx at startup — PTY shells may not have it on PATH
 *  because NixOS shell init rebuilds PATH from scratch. */
function resolveTsxPath(): string {
  try {
    return execFileSync("which", ["tsx"], { encoding: "utf-8" }).trim();
  } catch {
    // Fallback: assume tsx is on PATH (production Nix wrapper guarantees it)
    return "tsx";
  }
}

/** Temp directory containing the `tmux` wrapper. Created once at startup. */
let shimBinDir: string | undefined;

/** Monotonically increasing pane index counter. Never reused — keeps IDs stable. */
let nextPaneIndex = 0;

/** Create the tmux shim bin directory. Call once at server startup. */
export function initTmuxShim(): void {
  const dir = join(tmpdir(), `kolu-tmux-shim-${process.pid}`);
  mkdirSync(dir, { recursive: true });

  // Write a tiny wrapper script that delegates to tsx + tmux-shim.ts.
  // Use absolute tsx path — PTY shells may not have it on PATH after shell init.
  const tsxPath = resolveTsxPath();
  const wrapper = join(dir, "tmux");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec "${tsxPath}" "${SHIM_SCRIPT}" "$@"\n`,
  );
  chmodSync(wrapper, 0o755);

  shimBinDir = dir;
}

/** Get the tmux shim bin directory. Throws if initTmuxShim() hasn't been called. */
export function getTmuxShimDir(): string {
  if (!shimBinDir) throw new Error("initTmuxShim() not called");
  return shimBinDir;
}

/** Remove the temp directory on shutdown. */
export function cleanupTmuxShim(): void {
  if (shimBinDir) {
    rmSync(shimBinDir, { recursive: true, force: true });
    shimBinDir = undefined;
  }
}

/** Allocate a unique pane index for a new terminal. Returns the index (0, 1, 2, ...). */
export function allocatePaneIndex(): number {
  return nextPaneIndex++;
}

/** Build the $TMUX value for PTY shells. Format matches tmux: <socket>,<pid>,0 */
export function tmuxEnvValue(): string {
  const socketPath = join(tmpdir(), `kolu-tmux-${process.pid}`, "default");
  return `${socketPath},${process.pid},0`;
}
