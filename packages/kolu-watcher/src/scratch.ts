/**
 * Host-side per-terminal scratch storage for content uploaded from the browser
 * — clipboard image pastes and drag-and-drop file drops land here via
 * `writeWatcherFile`, which kolu-server reaches through the watcher's
 * `fs.writeFile` procedure. The returned path is bracketed-pasted into the PTY
 * so agents that accept paste-as-file-path (codex, Claude Code) can read the
 * file from the HOST the terminal actually runs on, not kolu-server's machine.
 * `cleanupWatcherFile` wipes a terminal's dir when it exits.
 *
 * The host-side analogue of kolu-server's `terminalScratch.ts` (same shape,
 * writing under a per-USER host scratch ROOT instead of `koluScratchDir`). The
 * name sanitizer is the ONE shared `sanitizeUploadName` from `kolu-common/upload`
 * — no duplicated security-sensitive copy to drift.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import { join, parse } from "node:path";
import { sanitizeUploadName } from "kolu-common/upload";

/** Per-USER host scratch root. Prefer `$XDG_RUNTIME_DIR` (on systemd hosts
 *  `/run/user/$UID` — a user-private tmpfs, mode 0700), falling back to the OS
 *  tmpdir. The uid is folded into the name so the tmpdir fallback (a shared,
 *  world-writable `/tmp`) is never a predictable shared path two users collide
 *  on, and every dir is created mode 0700 (below) so a pasted secret is never
 *  group/world-readable. */
const scratchRoot = join(
  process.env.XDG_RUNTIME_DIR ?? os.tmpdir(),
  `kolu-watcher-scratch-${process.getuid?.() ?? "shared"}`,
);

function dirFor(terminalId: string): string {
  // terminalId arrives UUID-validated over the wire (TerminalIdSchema =
  // z.string().uuid()), so it can't contain a separator — but guard anyway so a
  // future schema slip can never traverse out of the scratch root.
  if (
    terminalId.includes("/") ||
    terminalId.includes("\\") ||
    terminalId.includes("..")
  ) {
    throw new Error(
      `unsafe terminal id for scratch: ${JSON.stringify(terminalId)}`,
    );
  }
  return join(scratchRoot, terminalId);
}

/** Pick a path that doesn't collide with an existing file in the same
 *  terminal directory. Appends `-1`, `-2`, … before the extension. */
function uniquePath(dir: string, name: string): string {
  const { name: stem, ext } = parse(name);
  let candidate = join(dir, name);
  let i = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${stem}-${i}${ext}`);
    i++;
  }
  return candidate;
}

/** Save base64-encoded data into the host's per-terminal scratch directory,
 *  creating the dir (mode 0700, owner-only) on first use. Returns the on-disk
 *  path so the caller can bracketed-paste it into the PTY. `name` is sanitized;
 *  a collision suffix (`-1`, `-2`, …) protects any prior file from clobbering. */
export function writeWatcherFile(
  terminalId: string,
  name: string,
  base64Data: string,
): string {
  const dir = dirFor(terminalId);
  // mode 0700 on every created dir (incl. the recursive root) so an uploaded
  // secret is never group/world-readable, even under a shared `/tmp` fallback.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = uniquePath(dir, sanitizeUploadName(name));
  writeFileSync(path, Buffer.from(base64Data, "base64"));
  return path;
}

/** Remove a terminal's scratch directory on exit. Safe to call when the dir
 *  was never created (no upload happened). Mirrors kolu-server's
 *  `cleanupTerminalScratch`. */
export function cleanupWatcherFile(terminalId: string): void {
  rmSync(dirFor(terminalId), { recursive: true, force: true });
}
