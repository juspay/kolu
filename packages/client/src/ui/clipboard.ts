import type {
  ClipboardSelectionType,
  IClipboardProvider,
} from "@xterm/addon-clipboard";
import { writeTextToClipboard } from "@kolu/solid-logtail";
import { Effect } from "effect";
import { runActionPromise } from "../runAction";

/** xterm `IClipboardProvider` that uses `writeTextToClipboard` for writes and
 *  returns empty on reads when `navigator.clipboard` is unavailable. Promise-
 *  shaped and `Effect.orDie`'d because the `@xterm/addon-clipboard` interface
 *  has neither an Effect nor an error channel. */
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
