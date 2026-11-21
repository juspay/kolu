/** WHAT A MEMBER TERMINAL IS CALLED — its own name while kolu can read one,
 *  and its HOST, never an id, when it cannot: a terminal that is gone,
 *  asleep somewhere this browser cannot see, or on a host not connected has
 *  no name on screen, and eight hex digits tell a person nothing.
 *
 *  Two shapes of the fallback, by where the name stands:
 *
 *    - beside its role, as on a work's terminal row: "on nix@example" — the
 *      role is already there, so the host is the rest;
 *    - alone, as on the peek's tabs and title: "Implementor on nix@example".
 *
 *  The host is named as kolu names hosts everywhere (`hostLabel`). */

import type { WorkRole } from "kolu-work";
import { decodeHostKey } from "kolu-common/hostKey";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import { createMemo } from "solid-js";
import { hostLabel } from "../host/hostChipTone";
import { useFleetTerminalIndex } from "../palette/fleetTerminals";
import { fleetMentionCandidates } from "./mentionCandidates";
import { splitMemberRef } from "./memberRef";
import { useMembership } from "./useWorks";
import { ROLE_WORD } from "./workReadings";

/** "on nix@example" — the host a member's ref names, in a person's words. A
 *  ref this browser cannot read names no host it can say, and says that. */
export function onHostWords(ref: string): string {
  const split = splitMemberRef(ref);
  return split === null
    ? "on a host kolu cannot read"
    : `on ${hostLabel(decodeHostKey(split.host))}`;
}

/** A MEMBER'S NAME STANDING ALONE: its own name when kolu has one, else its
 *  role on its host ("Implementor on nix@example"), else "Terminal on …" for
 *  a terminal in no work. Never an id. */
export function standaloneName(
  name: string | undefined,
  ref: string,
  role: WorkRole | undefined,
): string {
  if (name !== undefined) return name;
  return `${ROLE_WORD[role ?? "other"]} ${onHostWords(ref)}`;
}

/** The names kolu can read, by member ref, off the fleet index. */
export function useKnownNames(): () => ReadonlyMap<string, string> {
  const fleet = useFleetTerminalIndex();
  const membership = useMembership();
  return createMemo(() => {
    const byRef = new Map<string, string>();
    for (const candidate of fleetMentionCandidates(fleet(), membership()))
      byRef.set(
        fleetTerminalRef(candidate.host, candidate.terminalId),
        candidate.name,
      );
    return byRef;
  });
}

/** The name a member goes by standing alone — the peek's tabs and title. */
export function useMemberName(): (ref: string) => string {
  const names = useKnownNames();
  const membership = useMembership();
  return (ref: string): string =>
    standaloneName(names().get(ref), ref, membership().get(ref)?.role);
}
