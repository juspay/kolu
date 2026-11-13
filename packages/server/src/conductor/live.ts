/**
 * THE ONE LIVE CONVERSATION in this process, and the two seams the boot uses
 * to reach it.
 *
 * kolu-server hosts exactly one conductor, and three unrelated callers need
 * it: `surface.ts` (which seeds the `conductor` cell and binds the nine
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
import type { ConductorState } from "kolu-common/conductor";
import { confStore } from "@kolu/surface/server";
import { log } from "../log.ts";
import { store } from "../state.ts";
import {
  type FleetMcpEndpoint,
  type ConductorHost,
  type PersistedConductor,
  startConductorHost,
} from "kolu-conductor";
import { proveFleetMcpEndpoint } from "../fleet/mcpEndpoint.ts";

/** Where the fleet MCP face is listening, or `null` while it is not. */
let endpoint: () => FleetMcpEndpoint | null = () => null;

/** The served cell's writer, or `null` until `surface.ts` registers it. */
let writeCell: ((state: ConductorState) => void) | null = null;
/** What else wants to know the conversation moved, or `null` — the WATCHER,
 *  which re-scopes its subscriptions when the watch list changes. Beside the
 *  cell writer rather than inside it because the two are different audiences:
 *  the cell is what a browser reads, and this is a process-internal consumer
 *  of the same frame that must not be able to break the browser's by throwing
 *  into the publish path. */
let onState: ((state: ConductorState) => void) | null = null;

let live: ConductorHost | undefined;

/**
 * Tell the conductor where the fleet MCP face is listening.
 *
 * Called once by the boot that OWNS the listener (`index.ts`), with a thunk
 * rather than a value because the listener binds an ephemeral port
 * asynchronously and the conductor may be reachable before that lands. The
 * conductor does not trust what this returns: it PROVES the endpoint with a
 * real request before it names it to an agent.
 */
export function setFleetMcpEndpoint(at: () => FleetMcpEndpoint | null): void {
  endpoint = at;
}

/**
 * Register the `conductor` cell's writer. `surface.ts` calls this exactly
 * once, right after the surface ctx exists — the same moment, and for the same
 * reason, padi registered its late-bound ctx.
 *
 * It is a REGISTRATION rather than an import because the arrow would otherwise
 * point both ways: `surface.ts` seeds the cell from this host's first reading,
 * so a host that imported `surface.ts` to publish would close the cycle.
 */
export function setConductorCellWriter(
  write: (state: ConductorState) => void,
): void {
  writeCell = write;
}

/** ... and register the one process-internal reader of the same frame: the
 *  WATCHER, whose subscriptions follow the watch list the conversation
 *  publishes. Optional — a boot that never started one publishes exactly as it
 *  always did — and guarded at the call site, because a listener that threw
 *  must not take a browser's frame down with it. */
export function setConductorStateListener(
  listen: (state: ConductorState) => void,
): void {
  onState = listen;
}

/**
 * This process's one conversation, built on the first call.
 *
 * Every reader — the cell's seed, the transcript stream, each of the nine
 * procedures — comes through here, so there is exactly one ACP child however
 * many readers arrive and in whatever order.
 */
export function liveServerConductor(): ConductorHost {
  if (live !== undefined) return live;
  live = startConductorHost({
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
    // The PROOF is the server's, not the conversation's: it is one MCP
    // `initialize` routed by a session header, and those spellings move with
    // the SDK — a pin `kolu-conductor` never talks to. The door that owns it
    // hands its own prover over here, which is the whole of what the mount
    // injects on this seam.
    proveFleetMcp: proveFleetMcpEndpoint,
    publish: (state) => {
      if (writeCell === null) {
        // A publish before the cell exists is a BOOT-ORDER bug, not a state to
        // tolerate: the reader it was meant for is subscribed to a cell nobody
        // has built, so swallowing it would lose the one frame that says the
        // conversation refused to open. Crash the way every other
        // read-before-boot seam in this tree does.
        throw new Error(
          "the conductor published before surface.ts registered the cell writer — implementKoluSurface must run before the first reader",
        );
      }
      writeCell(state);
      // ... and whoever else in this process follows the conversation. AFTER
      // the cell and inside its own guard: a watcher that threw here would
      // take a frame a browser is waiting on down with it.
      try {
        onState?.(state);
      } catch (err) {
        log.warn(
          { err },
          "kolu-server: a conductor state listener threw and was ignored",
        );
      }
    },
    store: confStore<PersistedConductor>(store, "conductor"),
    storePath: () => store.path,
    // Attachments land beside the state file, under `conductor/attachments`.
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
export async function disposeServerConductor(): Promise<void> {
  await live?.dispose();
}
