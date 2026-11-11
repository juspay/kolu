/**
 * THE ONE LIVE CONVERSATION in this process, and the two seams the boot uses
 * to reach it.
 *
 * kolu-server hosts exactly one orchestrator, and three unrelated callers need
 * it: `surface.ts` (which seeds the `orchestrator` cell and binds the nine
 * procedures and the transcript stream), `index.ts` (which starts the fleet MCP
 * listener and tears the conversation down), and nothing else. None of them
 * holds a handle on what the others built, so the host is held HERE, by name —
 * the shape `servePadi.ts` used for exactly the same reason before the hosting
 * moved.
 *
 * BUILT ON THE FIRST READER, not at import. Constructing the host asks the ACP
 * engine whether an adapter is seated and nothing else: no store read, no
 * spawn, no publish. Deferring it anyway is what keeps the two orders a boot
 * can run in — "listener first" and "surface first" — equally correct, because
 * the endpoint and the cell writer are both read through thunks the host calls
 * when it actually needs them rather than captured at construction.
 */

import { homedir, hostname } from "node:os";
import { dirname } from "node:path";
import { startHarness } from "@kolu/acp-harness";
import type { OrchestratorState } from "kolu-common/orchestrator";
import { confStore } from "@kolu/surface/server";
import { log } from "../log.ts";
import { store } from "../state.ts";
import {
  type FleetMcpEndpoint,
  type OrchestratorHost,
  startOrchestratorHost,
} from "./orchestrator.ts";
import type { PersistedOrchestrator } from "./persisted.ts";

/** Where the fleet MCP face is listening, or `null` while it is not. */
let endpoint: () => FleetMcpEndpoint | null = () => null;

/** The served cell's writer, or `null` until `surface.ts` registers it. */
let writeCell: ((state: OrchestratorState) => void) | null = null;

let live: OrchestratorHost | undefined;

/**
 * Tell the orchestrator where the fleet MCP face is listening.
 *
 * Called once by the boot that OWNS the listener (`index.ts`), with a thunk
 * rather than a value because the listener binds an ephemeral port
 * asynchronously and the orchestrator may be reachable before that lands. The
 * orchestrator does not trust what this returns: it PROVES the endpoint with a
 * real request before it names it to an agent.
 */
export function setFleetMcpEndpoint(
  at: () => FleetMcpEndpoint | null,
): void {
  endpoint = at;
}

/**
 * Register the `orchestrator` cell's writer. `surface.ts` calls this exactly
 * once, right after the surface ctx exists — the same moment, and for the same
 * reason, padi registered its late-bound ctx.
 *
 * It is a REGISTRATION rather than an import because the arrow would otherwise
 * point both ways: `surface.ts` seeds the cell from this host's first reading,
 * so a host that imported `surface.ts` to publish would close the cycle.
 */
export function setOrchestratorCellWriter(
  write: (state: OrchestratorState) => void,
): void {
  writeCell = write;
}

/**
 * This process's one conversation, built on the first call.
 *
 * Every reader — the cell's seed, the transcript stream, each of the nine
 * procedures — comes through here, so there is exactly one ACP child however
 * many readers arrive and in whatever order.
 */
export function liveServerOrchestrator(): OrchestratorHost {
  if (live !== undefined) return live;
  live = startOrchestratorHost({
    log,
    // The conversation works in the HOME of the machine kolu-server runs on,
    // not in its cwd: it is the directory a person's repositories are under on
    // THIS box, and it is what makes a stored session findable when it is
    // resumed. The fleet's other hosts are reached through the MCP face, never
    // through this path.
    home: homedir(),
    // …and it is seated on a MACHINE, which is what the standing prompt names.
    // The two are different facts and the conversation needs both: a directory
    // is where it works, a host is where it IS — and "where it is" is the half
    // it quotes back when it reports what it did somewhere else.
    hostName: hostname(),
    fleetMcp: () => endpoint(),
    publish: (state) => {
      if (writeCell === null) {
        // A publish before the cell exists is a BOOT-ORDER bug, not a state to
        // tolerate: the reader it was meant for is subscribed to a cell nobody
        // has built, so swallowing it would lose the one frame that says the
        // conversation refused to open. Crash the way every other
        // read-before-boot seam in this tree does.
        throw new Error(
          "the orchestrator published before surface.ts registered the cell writer — implementKoluSurface must run before the first reader",
        );
      }
      writeCell(state);
    },
    store: confStore<PersistedOrchestrator>(store, "orchestrator"),
    storePath: () => store.path,
    // Attachments land beside the state file, under `orchestrator/attachments`.
    // `store.path` is `<KOLU_STATE_DIR>/config.json`, and taking the directory
    // off the store itself rather than re-reading the env is what keeps the
    // two from ever naming different roots.
    stateRoot: dirname(store.path),
    // The composition root is the one place that knows BOTH that a
    // conversation is an ACP subprocess and that kolu-server is what hosts it.
    spawn: startHarness,
  });
  return live;
}

/**
 * Stop the conversation and write what it was saying.
 *
 * AWAITED FIRST in kolu-server's teardown: the adapter is spawned `detached`,
 * deliberately, so a crashing server cannot take a conversation's subprocess
 * down with it by accident — which also means nothing else in the teardown
 * reaches it. A shutdown that skipped this would leave the adapter and the
 * `claude` under it running under a server that no longer exists, and the next
 * boot would spawn a second set beside them.
 *
 * Idempotent, and a no-op on a process where nobody ever looked: a conversation
 * that was never built has no child to stop and no record to flush.
 */
export async function disposeServerOrchestrator(): Promise<void> {
  await live?.dispose();
}
