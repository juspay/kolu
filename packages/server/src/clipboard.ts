/**
 * Clipboard bridge: browser clipboard → PTY via bracketed-paste.
 *
 * On image paste, the browser uploads base64 bytes to the server, which
 * writes them to a per-terminal directory and bracketed-pastes the path
 * into the PTY. Agents that accept paste-as-file-path (codex, Claude Code)
 * auto-attach the image. See `router.ts` `pasteImage` handler.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { koluClipboardDir } from "./koluRoot.ts";

/** Create a per-terminal clipboard directory under the server's per-instance root. */
export function createClipboardDir(terminalId: string): string {
  const dir = join(koluClipboardDir, terminalId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Save base64-encoded image data to the terminal's clipboard directory.
 *  Returns the on-disk path so callers can bracketed-paste it into the PTY. */
export function saveClipboardImage(
  clipboardDir: string,
  base64Data: string,
): string {
  const imagePath = join(clipboardDir, "image.png");
  writeFileSync(imagePath, Buffer.from(base64Data, "base64"));
  return imagePath;
}

/** Remove a terminal's clipboard directory. */
export function cleanupClipboardDir(clipboardDir: string): void {
  rmSync(clipboardDir, { recursive: true, force: true });
}
