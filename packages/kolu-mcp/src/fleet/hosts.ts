/**
 * The PORT kolu-server implements, and the two refusals every lifted call goes
 * through before it dials anything.
 *
 * The fleet face holds NO host map of its own. kolu-server already mirrors
 * every padi — membership, reachability, the live client — and a second copy
 * inside this package would be a copy that can be wrong: a host that left would
 * keep answering until something noticed. So the port is the narrowest thing a
 * projection needs (who is there, what are they called, which are answering,
 * tell me when that moves) and kolu-server stays the one authority.
 *
 * **A host that is not connected is refused BY NAME.** The alternative — an
 * empty list, a terminal that is "not found" — is the failure mode this whole
 * face exists to avoid: an agent reads silence as "that host has nothing
 * running", carries on, and reports a clean sweep over a machine it never
 * reached. So every refusal says which host and what state it is in, as prose
 * for the model and as `structuredContent` for a driver.
 */

import type { PadiSurfaceClient } from "@kolu/padi-client/dial";
import { ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect } from "effect";
import type { FleetHostState } from "./fleetSurface.ts";
import { type FleetTerminalRef, splitFleetTerminalRef } from "./ref.ts";

/** What kolu-server hands the fleet face. */
export interface FleetHosts {
  /** Encoded host keys, stable order, local first. */
  keys(): readonly string[];
  /** What a person calls this host. */
  display(key: string): string;
  /** That host's padi client, or null while it is not connected.
   *
   *  The VALUE is the link, and the fleet watch compares it by identity: a
   *  host that dropped and came back between two calls answers with a
   *  different client, which is how a leg learns that the padi behind it may
   *  never have heard its subscription. */
  padi(key: string): PadiSurfaceClient | null;
  state(key: string): FleetHostState;
  /** Membership or reachability moved. */
  subscribe(cb: () => void): () => void;
}

/** MEMBERSHIP alone: this key names a host the fleet holds, or a refusal
 *  listing the ones it does.
 *
 *  Its own function because {@link requireHost} is membership AND reachability
 *  and the two refusals are different sentences: a host that is in the fleet
 *  but not answering is told what it is doing, where a key nobody holds is
 *  told the roster. Split here, once, so the two readings cannot teach an
 *  agent two grammars for one mistake. Module-private: every caller wants the
 *  pair, and the roster resource that once wanted this half alone now answers
 *  rows straight off `hosts.keys()`. */
function requireMember(
  hosts: FleetHosts,
  key: string,
): Effect.Effect<void, ToolFailure> {
  return Effect.suspend((): Effect.Effect<void, ToolFailure> => {
    const roster = hosts.keys();
    if (roster.includes(key)) return Effect.void;
    return Effect.fail(
      new ToolFailure(
        `no host ${JSON.stringify(key)} in this fleet — the fleet is ${roster.map((k) => JSON.stringify(k)).join(", ") || "(empty)"}. Read \`surface://cells/hosts\` for the live roster — every host and its state in one read; it changes while you work.`,
        { kind: "unknown-host", host: key, fleet: [...roster] },
      ),
    );
  });
}

/** The padi behind a host key — a member that is ALSO answering — or a refusal
 *  naming the host and its state. */
export function requireHost(
  hosts: FleetHosts,
  key: string,
): Effect.Effect<PadiSurfaceClient, ToolFailure> {
  return Effect.flatMap(
    requireMember(hosts, key),
    (): Effect.Effect<PadiSurfaceClient, ToolFailure> => {
      const padi = hosts.padi(key);
      if (padi === null) {
        const state = hosts.state(key);
        return Effect.fail(
          new ToolFailure(
            `host ${JSON.stringify(key)} (${hosts.display(key)}) is ${state}, not connected — this call cannot reach it. ${state === "warming" ? "It is still coming up; read the `hosts` resource again in a moment." : "Its padi is not answering; nothing on it can be read or driven until kolu-server reaches it again."} Nothing was done on any other host.`,
            { kind: "host-not-connected", host: key, state },
          ),
        );
      }
      return Effect.succeed(padi);
    },
  );
}

/** One terminal reference, resolved: the split plus the host's live client.
 *  The refusal for a malformed reference is raised HERE rather than by the
 *  grammar leaf, so it reaches the agent as data like every other one. */
export function requireTerminal(
  hosts: FleetHosts,
  ref: string,
): Effect.Effect<
  FleetTerminalRef & { readonly padi: PadiSurfaceClient },
  ToolFailure
> {
  return Effect.suspend(
    (): Effect.Effect<
      FleetTerminalRef & { readonly padi: PadiSurfaceClient },
      ToolFailure
    > => {
      const split = splitFleetTerminalRef(ref);
      if (split === null) {
        return Effect.fail(
          new ToolFailure(
            `${JSON.stringify(ref)} is not a fleet terminal reference — a terminal is addressed as <host>/<id> on this face. Read \`surface://collections/terminals\` for the live set.`,
            { kind: "not-a-fleet-ref", ref },
          ),
        );
      }
      return Effect.map(requireHost(hosts, split.host), (padi) => ({
        ...split,
        padi,
      }));
    },
  );
}
