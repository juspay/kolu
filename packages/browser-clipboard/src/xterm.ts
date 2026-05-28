/**
 * xterm `IClipboardProvider` that uses `writeTextToClipboard` for
 * writes (survives non-secure contexts) and returns empty on reads
 * when `navigator.clipboard` is unavailable. OSC 52 read queries
 * (`?`) are rare and have no safe fallback.
 */

import type {
  ClipboardSelectionType,
  IClipboardProvider,
} from "@xterm/addon-clipboard";
import { writeTextToClipboard } from "./index";

export class SafeClipboardProvider implements IClipboardProvider {
  public async readText(selection: ClipboardSelectionType): Promise<string> {
    if (selection !== "c") return "";
    if (!navigator.clipboard?.readText) return "";
    return navigator.clipboard.readText();
  }

  public async writeText(
    selection: ClipboardSelectionType,
    text: string,
  ): Promise<void> {
    if (selection !== "c") return;
    await writeTextToClipboard(text);
  }
}
