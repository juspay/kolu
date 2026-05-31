/** xterm `IClipboardProvider` (OSC 52 support) decoupled from how text is
 *  actually written to the system clipboard.
 *
 *  The "how to write" half is genuinely generic — Kolu uses the same path to
 *  copy PR URLs, comments, and diagnostics, none of which involve a terminal.
 *  So the writer is injected: `@kolu/solid-xterm` owns the xterm-shaped
 *  adapter, the consumer owns the clipboard mechanics (and its non-secure-
 *  context fallback). Reads have no safe fallback — OSC 52 read queries (`?`)
 *  are rare and `navigator.clipboard.readText` is the only path. */

import type {
  ClipboardSelectionType,
  IClipboardProvider,
} from "@xterm/addon-clipboard";

/**
 * Build an xterm `IClipboardProvider` that delegates writes to `write`.
 *
 * @param write — writes a string to the system clipboard. The consumer
 *   supplies this so the provider stays free of any particular fallback
 *   strategy (e.g. the `execCommand` escape hatch for non-secure contexts).
 */
export function createSafeClipboardProvider(
  write: (text: string) => Promise<void>,
): IClipboardProvider {
  return {
    async readText(selection: ClipboardSelectionType): Promise<string> {
      if (selection !== "c") return "";
      if (!navigator.clipboard?.readText) return "";
      return navigator.clipboard.readText();
    },
    async writeText(
      selection: ClipboardSelectionType,
      text: string,
    ): Promise<void> {
      if (selection !== "c") return;
      await write(text);
    },
  };
}
