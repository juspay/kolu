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
   *  The VALUE is the link: a host that dropped and came back between two
   *  calls answers with a DIFFERENT client, which is why every standing read
   *  of the fleet (`overHosts.ts`, which both this face's folds and the
   *  conductor's watch go through) re-reads this on each roster move rather
   *  than holding a client it was handed once — a stream still running over
   *  the old client is reading a padi that has never heard of it. */
  padi(key: string): PadiSurfaceClient | null;
  state(key: string): FleetHostState;
  /** Membership or reachability moved. */
  subscribe(cb: () => void): () => void;
}

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
