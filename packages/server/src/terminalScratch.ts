/**
 * Per-terminal on-disk scratch storage for content uploaded from the
 * browser — clipboard image pastes and drag-and-drop file drops both
 * land here via `saveTerminalFile`. The `router.ts` handlers call it
 * and then bracketed-paste the returned path into the PTY so agents
 * that accept paste-as-file-path (codex, Claude Code) can read the
 * file. `cleanupTerminalScratch` wipes the dir on terminal exit.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, parse } from "node:path";
import { sanitizeUploadName } from "kolu-common/upload";
import { koluScratchDir } from "./koluRoot.ts";

function dirFor(terminalId: string): string {
  return join(koluScratchDir, terminalId);
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

/** Save base64-encoded data into the terminal's scratch directory,
 *  creating the dir on first use. Returns the on-disk path so the
 *  caller can bracketed-paste it into the PTY.
 *
 *  `name` is sanitized; a collision suffix (`-1`, `-2`, …) protects
 *  any prior file in the dir from being clobbered. Two pastes in
 *  flight — image then drop, drop then drop, or two pastes before the
 *  agent has consumed the first — each get their own path so the
 *  bracketed-paste references survive a late read. */
export function saveTerminalFile(
  terminalId: string,
  name: string,
  base64Data: string,
): string {
  const dir = dirFor(terminalId);
  // mode 0700 (the parent `koluScratchDir` is already 0700 via ensureKoluRoot,
  // but be explicit + consistent with the watcher's host-side scratch) so an
  // uploaded secret is never group/world-readable.
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const path = uniquePath(dir, sanitizeUploadName(name));
  writeFileSync(path, Buffer.from(base64Data, "base64"));
  return path;
}

/** Remove a terminal's scratch directory. Safe to call when the dir
 *  was never created. */
export function cleanupTerminalScratch(terminalId: string): void {
  rmSync(dirFor(terminalId), { recursive: true, force: true });
}
