/**
 * Per-terminal on-disk storage for content uploaded from the browser —
 * clipboard image pastes (`saveClipboardImage`) and drag-and-drop file
 * drops (`saveDroppedFile`). The `router.ts` handlers call these and then
 * bracketed-paste the returned path into the PTY so agents that accept
 * paste-as-file-path (codex, Claude Code) can read the file.
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { koluClipboardDir } from "./koluRoot.ts";

function dirFor(terminalId: string): string {
  return join(koluClipboardDir, terminalId);
}

/** Save base64-encoded image data into the terminal's clipboard directory,
 *  creating the dir on first use. Returns the on-disk path so the caller
 *  can bracketed-paste it into the PTY. */
export function saveClipboardImage(
  terminalId: string,
  base64Data: string,
): string {
  const dir = dirFor(terminalId);
  mkdirSync(dir, { recursive: true });
  const imagePath = join(dir, "image.png");
  writeFileSync(imagePath, Buffer.from(base64Data, "base64"));
  return imagePath;
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

/** Pick a path that doesn't collide with an existing dropped file in the
 *  same terminal directory. Appends `-1`, `-2`, … before the extension. */
function uniquePath(dir: string, name: string): string {
  const base = name.slice(0, name.length - extname(name).length);
  const ext = extname(name);
  let candidate = join(dir, name);
  let i = 1;
  while (existsSync(candidate)) {
    candidate = join(dir, `${base}-${i}${ext}`);
    i++;
  }
  return candidate;
}

/** Save a base64-encoded dropped file into the terminal's clipboard
 *  directory, preserving the (sanitized) original name so the agent can
 *  recognize what it received. Returns the on-disk path. */
export function saveDroppedFile(
  terminalId: string,
  rawName: string,
  base64Data: string,
): string {
  const dir = dirFor(terminalId);
  mkdirSync(dir, { recursive: true });
  const path = uniquePath(dir, sanitizeUploadName(rawName));
  writeFileSync(path, Buffer.from(base64Data, "base64"));
  return path;
}

/** Remove a terminal's clipboard directory. Safe to call when the dir was
 *  never created. */
export function cleanupClipboardDir(terminalId: string): void {
  rmSync(dirFor(terminalId), { recursive: true, force: true });
}
