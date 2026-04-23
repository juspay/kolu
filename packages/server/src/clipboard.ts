/**
 * Clipboard bridge: browser clipboard → PTY image-paste inputs.
 *
 * In a web terminal, the server has no access to the browser's clipboard.
 * This module persists pasted browser images into a per-terminal directory,
 * then translates that saved image into the PTY input expected by the
 * foreground terminal app: Claude reads from xclip/wl-paste shims on raw
 * Ctrl+V, while Codex attaches a bracketed-pasted local image path.
 *
 * The shim scripts themselves are packaged as Nix derivations
 * (writeShellScriptBin) and their bin directory is passed via the
 * KOLU_CLIPBOARD_SHIM_DIR environment variable.
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { match } from "ts-pattern";
import type { TerminalMetadata } from "kolu-common";
import { koluClipboardDir } from "./koluRoot.ts";

/** Clipboard shim bin directory — required, crashes on startup if missing. */
export const CLIPBOARD_SHIM_DIR = (() => {
  const dir = process.env.KOLU_CLIPBOARD_SHIM_DIR;
  if (!dir) {
    throw new Error(
      "KOLU_CLIPBOARD_SHIM_DIR must be set (points to the Nix-built xclip/wl-paste shim bin directory)",
    );
  }
  return dir;
})();

/** Create a per-terminal clipboard directory under the server's per-instance root. */
export function createClipboardDir(terminalId: string): string {
  const dir = join(koluClipboardDir, terminalId);
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

/** The PTY input protocol a terminal expects for a pasted browser image. */
export type ImagePasteMode = "raw-ctrl-v" | "bracketed-path";

/** Collapse terminal metadata into one authoritative image-paste mode so
 *  routing decisions do not have to reconstruct policy from multiple fields. */
export function imagePasteMode(meta: TerminalMetadata): ImagePasteMode {
  // Two observations of the same fact at different latencies:
  // `foreground` is the fast path (OSC 7 process name from the PTY);
  // `agent` is the slower detection path that catches sessions where
  // foreground has not yet resolved at paste time.
  if (meta.foreground?.name === "codex" || meta.agent?.kind === "codex") {
    return "bracketed-path";
  }
  return "raw-ctrl-v";
}

/** Translate an uploaded browser image into the PTY input expected by the
 *  resolved terminal paste mode. Claude reads the clipboard on raw Ctrl+V;
 *  Codex expects a bracketed-paste path and attaches local images from it. */
export function dispatchPastedImage(
  mode: ImagePasteMode,
  imagePath: string,
): string {
  return match(mode)
    .with("bracketed-path", () => `\x1b[200~${imagePath}\x1b[201~`)
    .with("raw-ctrl-v", () => "\x16")
    .exhaustive();
}

/** Remove a terminal's clipboard directory. */
export function cleanupClipboardDir(clipboardDir: string): void {
  rmSync(clipboardDir, { recursive: true, force: true });
}
