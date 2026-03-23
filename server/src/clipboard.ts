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
import { tmpdir } from "node:os";
import { log } from "./log.ts";

let shimDirResolved = false;
let shimDir: string | undefined;

/** Resolve the clipboard shim bin directory from the environment (cached, logged once). */
export function getClipboardShimDir(): string | undefined {
  if (shimDirResolved) return shimDir;
  shimDirResolved = true;
  shimDir = process.env.KOLU_CLIPBOARD_SHIM_DIR;
  if (shimDir) {
    log.info({ shimBinDir: shimDir }, "clipboard shims available");
  } else {
    log.warn("KOLU_CLIPBOARD_SHIM_DIR not set — Ctrl+V image paste disabled");
  }
  return shimDir;
}

/** Create a per-terminal clipboard directory (namespaced by PID to avoid collisions between parallel workers). */
export function createClipboardDir(terminalId: string): string {
  const dir = join(tmpdir(), `kolu-clipboard-${process.pid}-${terminalId}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Save base64-encoded image data to the terminal's clipboard directory. */
export function saveClipboardImage(
  clipboardDir: string,
  base64Data: string,
): void {
  const imagePath = join(clipboardDir, "image.png");
  writeFileSync(imagePath, Buffer.from(base64Data, "base64"));
}

/** Remove a terminal's clipboard directory. */
export function cleanupClipboardDir(clipboardDir: string): void {
  rmSync(clipboardDir, { recursive: true, force: true });
}
