/**
 * WHAT THE CONDUCTOR IS TOLD A MESSAGE WAS ABOUT — the `[kolu] about …`
 * lines that ride above a person's words.
 *
 * The agent cannot see the chips, so what reached it has to carry the same
 * facts the row does, or the panel is claiming a context the model never
 * had. One line per mention:
 *
 *  - a terminal by the name the human typed and its `host/id` — the one
 *    name every kolu tool takes, as the standing prompt teaches — then its
 *    directory and intent when it has them;
 *  - a piece of work by its title and its id, which is what `works` lists
 *    it under and every `work_*` tool takes.
 */

import type { ConductorMention } from "kolu-common/conductor";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";

export function aboutBlock(mentions: ReadonlyArray<ConductorMention>): string {
  return mentions
    .map((one) =>
      one.kind === "work"
        ? `[kolu] about work “${one.title}” (${one.work})`
        : `[kolu] about terminal ${one.name} (${fleetTerminalRef(one.host, one.terminalId)})` +
          `${one.cwd === null ? "" : ` · ${one.cwd}`}` +
          `${one.intent === null ? "" : ` — ${one.intent}`}`,
    )
    .join("\n");
}
