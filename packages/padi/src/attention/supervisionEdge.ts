import type { PadiTerminal, PadiWatchEvent } from "@kolu/padi-client/surface";
import type { TerminalId } from "@kolu/terminal-vocab/schema";

export type SupervisionEdge = Pick<PadiWatchEvent, "parentId" | "intent">;

export function edgeOf(record: PadiTerminal): SupervisionEdge {
  return {
    ...(record.parentId === undefined
      ? {}
      : { parentId: record.parentId as TerminalId }),
    ...(record.intent === undefined ? {} : { intent: record.intent }),
  };
}

export function edgeMatches(
  edge: SupervisionEdge,
  record: PadiTerminal,
): boolean {
  return edge.parentId === record.parentId && edge.intent === record.intent;
}
