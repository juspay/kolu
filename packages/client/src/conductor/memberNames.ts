import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { createMemo } from "solid-js";
import { useFleetTerminalIndex } from "../palette/fleetTerminals";
import { fleetMentionCandidates } from "./mentionCandidates";
import { splitMemberRef } from "./memberRef";
import { useMembership } from "./useWorks";

/** The name each member goes by in the composer, read off the fleet index. */
export function useMemberName(): (ref: string) => string {
  const fleet = useFleetTerminalIndex();
  const membership = useMembership();
  const names = createMemo(() => {
    const byRef = new Map<string, string>();
    for (const candidate of fleetMentionCandidates(fleet(), membership()))
      byRef.set(
        fleetTerminalRef(candidate.host, candidate.terminalId),
        candidate.name,
      );
    return byRef;
  });
  return (ref: string): string =>
    names().get(ref) ?? splitMemberRef(ref)?.id.slice(0, 8) ?? ref;
}
