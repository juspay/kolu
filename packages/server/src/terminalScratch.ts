/**
 * Per-terminal on-disk scratch storage for content uploaded from the
 * browser — clipboard image pastes and drag-and-drop file drops both
 * land here via `saveTerminalFile`. The `router.ts` handlers call it
 * and then bracketed-paste the returned path into the PTY so agents
 * that accept paste-as-file-path (codex, Claude Code) can read the
 * file. `cleanupTerminalScratch` wipes the dir on terminal exit.
 *
 * The write+sanitize itself lives in `@kolu/terminal-workspace/scratch`
 * (`writeScratchFile`) — the SAME primitive the `scratch.write` surface
 * procedure serves on the local arm (and the pulam daemon serves on its own
 * host). kolu-server only binds it to `koluScratchDir` and owns the cleanup.
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { writeScratchFile } from "@kolu/terminal-workspace/scratch";
import { koluScratchDir } from "./koluRoot.ts";

// Re-exported from the shared scratch primitive so existing importers (the
// upload-name unit test) keep one home for the sanitizer.
export { sanitizeUploadName } from "@kolu/terminal-workspace/scratch";

function dirFor(terminalId: string): string {
  return join(koluScratchDir, terminalId);
}

/** Save base64-encoded data into the terminal's scratch directory under
 *  `koluScratchDir`, creating the dir on first use. Returns the on-disk path so
 *  the caller can bracketed-paste it into the PTY. Thin binding of the shared
 *  `writeScratchFile` to kolu-server's scratch root. */
export function saveTerminalFile(
  terminalId: string,
  name: string,
  base64Data: string,
): string {
  return writeScratchFile(koluScratchDir, terminalId, name, base64Data);
}

/** Remove a terminal's scratch directory. Safe to call when the dir
 *  was never created. */
export function cleanupTerminalScratch(terminalId: string): void {
  rmSync(dirFor(terminalId), { recursive: true, force: true });
}
