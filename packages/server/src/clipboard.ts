/**
 * Clipboard bridge: browser clipboard → PTY via bracketed-paste.
 *
 * On image paste, the browser uploads base64 bytes to the server, which
 * writes them to a per-terminal directory and bracketed-pastes the path
 * into the PTY. Agents that accept paste-as-file-path (codex, Claude Code)
 * auto-attach the image. See `router.ts` `pasteImage` handler.
 *
 * The on-disk layout (`koluClipboardDir/<terminalId>/image.png`) is an
 * implementation detail of this module — callers pass a terminal id and
 * get back a path (or nothing, for cleanup). The `TerminalProcess` record
 * intentionally does not carry the path.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
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

/** Remove a terminal's clipboard directory. Safe to call when the dir was
 *  never created. */
export function cleanupClipboardDir(terminalId: string): void {
  rmSync(dirFor(terminalId), { recursive: true, force: true });
}
