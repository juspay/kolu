import type { TerminalId } from "kolu-common/surface";
import { client } from "../wire";

/** Read a terminal's FULL on-disk transcript as plain text (PR2 — the deep
 *  "copy all" source for both the palette's "Copy terminal text" and the
 *  pager's "Copy all history"). An empty result means history is disabled for
 *  this terminal, so fall back to the live screen buffer ONCE, here — the
 *  opt-out convention (empty ⟹ disabled) lives in one place instead of being
 *  re-derived at every copy site. */
export async function readDeepTerminalText(id: TerminalId): Promise<string> {
  const text = await client.terminal.historyText({ id });
  return text === "" ? client.terminal.screenText({ id }) : text;
}
