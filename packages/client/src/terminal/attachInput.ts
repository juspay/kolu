/**
 * What a tile's attach ASKS for — and what a transport retry of it may do.
 *
 * An attach that carries `resizeTo` is a resize: the host resizes the shared
 * PTY to it before serializing (`@kolu/padi-client/surface`, the attach
 * input). So the rule that a tile behind the Conductor states no size has to
 * hold here as well as on the publish door (`shownPane.ts`) and the foreign
 * answer (`foreignGrid.ts`): **while the Conductor is in front, no request
 * leaves a tile carrying a size.** Something in front is sizing the terminal,
 * and nothing behind it may take the size back.
 *
 * Two decisions, one fact (`viewShown`, stated by the shell that places the
 * tile):
 *
 *  - **The input.** In front, the tile asks for the grid it wants. Behind, it
 *    asks for nothing: the id and the cause, with the size key ABSENT — the
 *    wire refuses a present `undefined`. Every open goes through here: a reveal,
 *    a split mounted behind the Conductor, the loop's own re-attach after an
 *    end or a failure, a foreign reopen still waiting out its pause.
 *  - **A transport retry.** The fence re-subscribes by REPLAYING the input it
 *    captured at the first call (`dev/skills/streaming/SKILL.md` §3), so a
 *    stream opened in front with a size would re-send that size from behind.
 *    The repo's rule for captured input is "keep it a stable key, or reopen":
 *    a retry of a stream that carries a size, while the view is behind, ends
 *    the attempt and reopens — and the reopen, built behind, asks for nothing.
 *    A stream with no size replays nothing worth refusing, and one in front
 *    replays as it always has.
 *
 * Coming back in front needs nothing here: the foreign-grid watcher sees the
 * terminal is not at the tile's size and re-attaches at it after its settle.
 */

import type { AttachCause } from "@kolu/padi-client/surface";
import type { TerminalGrid } from "@kolu/xterm-kit/solid";
import type { TerminalId } from "kolu-common/surface";

/** The attach input a tile sends. `resizeTo` is present only in front. */
export type TileAttachInput =
  | { id: TerminalId; cause: AttachCause; resizeTo: TerminalGrid }
  | { id: TerminalId; cause: AttachCause };

/** The attach input for one open, read at the moment it opens. */
export function tileAttachInput(i: {
  id: TerminalId;
  cause: AttachCause;
  wanted: TerminalGrid;
  viewShown: boolean;
}): TileAttachInput {
  return i.viewShown
    ? { id: i.id, resizeTo: i.wanted, cause: i.cause }
    : { id: i.id, cause: i.cause };
}

/** What a transport retry of `sent` does: REPLAY the captured input (the
 *  fence's own re-subscribe), or end this attempt and REOPEN, so the successor
 *  builds its input from the view as it is now. */
export function attachRetry(
  sent: TileAttachInput,
  viewShown: boolean,
): "replay" | "reopen" {
  return "resizeTo" in sent && !viewShown ? "reopen" : "replay";
}
