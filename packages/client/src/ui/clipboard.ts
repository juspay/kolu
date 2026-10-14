/** The xterm half of the clipboard seam.
 *
 *  The clipboard WRITE — its fallback ladder, its gesture-window caveat, and why
 *  plain `http://` has no `navigator.clipboard` at all — is
 *  `@kolu/solid-logtail`'s (`writeTextToClipboard`), because every surface app
 *  that copies anything needs it. What is left here is the one piece that is
 *  kolu's: the shape `@xterm/addon-clipboard` demands of us.
 *
 *  Reads have no safe fallback (the textarea trick is write-only), so a
 *  non-secure context simply cannot paste via OSC 52 — see the package's
 *  `clipboard.ts` for the whole account. */

import type {
  ClipboardSelectionType,
  IClipboardProvider,
} from "@xterm/addon-clipboard";
import { writeTextToClipboard } from "@kolu/solid-logtail";
import { Effect } from "effect";
import { runActionPromise } from "../runAction";

/** xterm `IClipboardProvider` that uses `writeTextToClipboard` for writes
 *  (survives non-secure contexts) and returns empty on reads when
 *  navigator.clipboard is unavailable. OSC 52 read queries (`?`) are rare
 *  and have no safe fallback.
 *
 *  The one piece of kolu's clipboard story that is still Promise-shaped, because
 *  the shape is `@xterm/addon-clipboard`'s: `IClipboardProvider` is an interface
 *  this repo implements, not one it defines. `Effect.orDie` before the run edge
 *  because the interface has no error channel either — a failed write was always
 *  a rejection to xterm, and a defect is what a rejection is on this side. */
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
    await runActionPromise(writeTextToClipboard(text).pipe(Effect.orDie));
  }
}
