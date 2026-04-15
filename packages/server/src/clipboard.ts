/**
 * Clipboard bridge: browser clipboard → PTY via server-side shim scripts.
 *
 * Claude Code reads images from the system clipboard via xclip/wl-paste
 * when the user presses Ctrl+V. In a web terminal, the server has no
 * access to the browser's clipboard. This module manages per-terminal
 * clipboard data directories that Nix-provided shim scripts read from.
 *
 * The shim scripts themselves are packaged as Nix derivations
 * (writeShellScriptBin) and their bin directory is passed via the
 * KOLU_CLIPBOARD_SHIM_DIR environment variable.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { koluClipboardDir } from "./koluRoot.ts";

// Private state — set by initClipboard(), accessed through getter.
let _shimDir: string | null = null;

/** Clipboard shim bin directory — required, crashes on startup if missing. */
export function clipboardShimDir(): string {
  if (!_shimDir)
    throw new Error("clipboardShimDir: call initClipboard() first");
  return _shimDir;
}

/** Validate KOLU_CLIPBOARD_SHIM_DIR and store the path. Must be called once
 *  at server startup before any terminal spawns. */
export function initClipboard(): void {
  const dir = process.env.KOLU_CLIPBOARD_SHIM_DIR;
  if (!dir) {
    throw new Error(
      "KOLU_CLIPBOARD_SHIM_DIR must be set (points to the Nix-built xclip/wl-paste shim bin directory)",
    );
  }
  _shimDir = dir;
}

/** Create a per-terminal clipboard directory under the server's per-instance root. */
export function createClipboardDir(terminalId: string): string {
  const dir = join(koluClipboardDir(), terminalId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Save base64-encoded image data to the terminal's clipboard directory.
 *  Returns the on-disk path so callers can log / reference it. */
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
