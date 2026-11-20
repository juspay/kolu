import { isEncodedHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { isTerminalId } from "@kolu/terminal-vocab/terminalId";
import { splitFleetTerminalRef } from "kolu-mcp/fleetRef";

export interface MemberRef {
  readonly host: string;
  readonly id: TerminalId;
}

export function splitMemberRef(ref: string): MemberRef | null {
  const split = splitFleetTerminalRef(ref);
  if (split === null) return null;
  if (!isEncodedHostKey(split.host) || !isTerminalId(split.id)) return null;
  return { host: split.host, id: split.id };
}
