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
