/**
 * Clipboard shim for bridging browser clipboard → PTY.
 *
 * Claude Code reads images from the system clipboard via xclip/wl-paste
 * when the user presses Ctrl+V. In a web terminal, the server has no
 * access to the browser's clipboard. This module creates shim scripts
 * that serve image data uploaded from the browser, so Claude Code's
 * existing clipboard mechanism works transparently.
 */

import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { log } from "./log.ts";

/** Directory containing the shared xclip/wl-paste shim scripts. */
let shimBinDir: string | undefined;

const XCLIP_SHIM = `#!/bin/sh
# Kolu clipboard shim — serves browser-uploaded images to Claude Code.
# Falls through gracefully when no image is available.
KOLU_IMG="\${KOLU_CLIPBOARD_DIR}/image.png"

# Handle image-related clipboard reads
case "$*" in
  *"-selection"*"clipboard"*"-t"*"TARGETS"*"-o"*)
    [ -f "$KOLU_IMG" ] && printf 'image/png\\n' && exit 0
    ;;
  *"-selection"*"clipboard"*"-t"*"image/"*"-o"*)
    [ -f "$KOLU_IMG" ] && cat "$KOLU_IMG" && exit 0
    ;;
esac
exit 1
`;

const WLPASTE_SHIM = `#!/bin/sh
# Kolu clipboard shim — serves browser-uploaded images to Claude Code.
KOLU_IMG="\${KOLU_CLIPBOARD_DIR}/image.png"

for arg in "$@"; do
  case "$arg" in
    -l|--list-types)
      [ -f "$KOLU_IMG" ] && printf 'image/png\\n' && exit 0
      exit 1
      ;;
  esac
done

# --type image/png (or similar)
case "$*" in
  *"--type"*"image/"*)
    [ -f "$KOLU_IMG" ] && cat "$KOLU_IMG" && exit 0
    ;;
esac
exit 1
`;

/** Create shared shim scripts (idempotent). Returns the bin directory path. */
export function initClipboardShims(): string {
  if (shimBinDir) return shimBinDir;

  shimBinDir = mkdtempSync(join(tmpdir(), "kolu-clipboard-shims-"));
  for (const [name, content] of [
    ["xclip", XCLIP_SHIM],
    ["wl-paste", WLPASTE_SHIM],
  ] as const) {
    const path = join(shimBinDir, name);
    writeFileSync(path, content);
    chmodSync(path, 0o755);
  }
  log.info({ shimBinDir }, "clipboard shims initialized");
  return shimBinDir;
}

/** Create a per-terminal clipboard directory. */
export function createClipboardDir(terminalId: string): string {
  const dir = join(tmpdir(), `kolu-clipboard-${terminalId}`);
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
