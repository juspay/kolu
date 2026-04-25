/**
 * Per-terminal on-disk storage for images pasted from the browser clipboard.
 * The `router.ts` `pasteImage` handler calls `saveClipboardImage` and then
 * bracketed-pastes the returned path into the PTY so agents that accept
 * paste-as-file-path (codex, Claude Code) auto-attach the image.
 */

import { mkdirSync, rmSync, writeFileSync } from "node:fs";
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
