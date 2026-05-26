/**
 * Per-terminal on-disk scratch storage for content uploaded from the
 * browser — clipboard image pastes and drag-and-drop file drops both
 * land here via `saveTerminalFile`. The `router.ts` handlers call it
 * and then bracketed-paste the returned path into the PTY so agents
 * that accept paste-as-file-path (codex, Claude Code) can read the
 * file.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, parse } from "node:path";
import { koluClipboardDir } from "./koluRoot.ts";

function dirFor(terminalId: string): string {
  return join(koluClipboardDir, terminalId);
}

/** Strip everything but the basename and collapse any character that
 *  would let a dropped name escape the per-terminal directory or break
 *  shell tools that consume the path. Preserves the extension so the
 *  receiving agent still sees a meaningful suffix. Always returns a
 *  non-empty string. */
function sanitizeUploadName(rawName: string): string {
  const base = basename(rawName);
  const sanitized = base.replace(/[^A-Za-z0-9._-]/g, "_");
  // Strip leading dots so the result is never a hidden file or `..`.
  const trimmed = sanitized.replace(/^\.+/, "");
  return trimmed.length > 0 ? trimmed : "upload";
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
 *  `name` is sanitized first. When `unique` is true (default), a
 *  collision suffix protects existing files in the dir — this is the
 *  drag-and-drop path. When `unique` is false, the path is reused as-is
 *  and a prior file with the same name is overwritten — that's the
 *  clipboard-image path, where every paste is "the latest screenshot"
 *  and accumulating `image-N.png` artifacts would be noise. */
export function saveTerminalFile(
  terminalId: string,
  name: string,
  base64Data: string,
  { unique = true }: { unique?: boolean } = {},
): string {
  const dir = dirFor(terminalId);
  mkdirSync(dir, { recursive: true });
  const safeName = sanitizeUploadName(name);
  const path = unique ? uniquePath(dir, safeName) : join(dir, safeName);
  writeFileSync(path, Buffer.from(base64Data, "base64"));
  return path;
}

/** Remove a terminal's scratch directory. Safe to call when the dir
 *  was never created. */
export function cleanupClipboardDir(terminalId: string): void {
  rmSync(dirFor(terminalId), { recursive: true, force: true });
}
