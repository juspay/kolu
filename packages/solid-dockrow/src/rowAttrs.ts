import type { TerminalId } from "@kolu/terminal-vocab/schema";
import type { DockRowBucket } from "./pipBind.ts";

/** A boolean rendered as an HTML attribute: present and empty, or absent. The
 *  only two values an attribute selector (`[data-asking]`) reads as off and on
 *  — a stringified `false` would match it. */
export type FlagAttr = "" | undefined;

function flagAttr(on: boolean | undefined): FlagAttr {
  return on ? "" : undefined;
}

export type DockRowAttrs = {
  "data-dock-row": "";
  "data-terminal-id": TerminalId;
  "data-bucket": DockRowBucket;
  "data-agent-state": string | undefined;
  "data-active": FlagAttr;
  "data-asking": FlagAttr;
  "data-unread": FlagAttr;
};

export type DockRowAttrsInput = {
  id: TerminalId;
  bucket: DockRowBucket;
  agentState: string | undefined;
  pip: { asking: boolean; alert: boolean };
  active?: boolean;
};

export function dockRowAttrs(row: DockRowAttrsInput): DockRowAttrs {
  return {
    "data-dock-row": "",
    "data-terminal-id": row.id,
    "data-bucket": row.bucket,
    "data-agent-state": row.agentState,
    "data-active": flagAttr(row.active),
    "data-asking": flagAttr(row.pip.asking),
    "data-unread": flagAttr(row.pip.alert),
  };
}
