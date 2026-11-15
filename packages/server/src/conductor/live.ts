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
import { confStore } from "@kolu/surface/server";
import type { ConductorState } from "kolu-common/conductor";
import type { MemberReading } from "kolu-common/works";
import type { Work, WorkMember } from "kolu-work";
import {
  type ConductorHost,
  type FleetMcpEndpoint,
  type PersistedConductor,
  type PersistedMembers,
  type PersistedWorks,
  startConductorHost,
} from "kolu-conductor";
import type { FleetHosts } from "kolu-mcp";
import { proveFleetMcpEndpoint } from "../fleet/mcpEndpoint.ts";
import { log } from "../log.ts";
import { store } from "../state.ts";
import { TRANSCRIPT_FILE_VERSION } from "../stateShape.ts";
import { transcriptFilePath, transcriptFileStore } from "./transcriptFile.ts";
import { workFilesOverHosts } from "./workFiles.ts";

/** Where the fleet MCP face is listening, or `null` while it is not. */
let endpoint: () => FleetMcpEndpoint | null = () => null;

/** The served `conductor` cell's writer, or `null` until `surface.ts`
 *  registers it. */
let writeCell: ((state: ConductorState) => void) | null = null;
/** ...and the served `works` + `memberReadings` COLLECTIONS' writers,
 *  registered at the same moment. Separate writers because they are separate
 *  members: the conversation moves on a keystroke, a work when something about
 *  THAT work is observed, and a member's reading on its terminal's own clock —
 *  and a reader of one has no business re-receiving the others. `null` value =
 *  the key is gone (a work that fell off the cap, a terminal that is no longer
 *  read). */
let writeWork: ((id: string, work: Work | null) => void) | null = null;
let writeMember:
  | ((terminal: string, member: WorkMember | null) => void)
  | null = null;
let writeReading:
  | ((terminal: string, reading: MemberReading | null) => void)
  | null = null;
/** Who is owed a redraw of the `works` resource, or `null` until the boot
 *  wires it — the resource's subscribers, which want every change to a row.
 *  Registered rather than imported for the same reason the cell writers are:
 *  this module is reached by three callers that hold no handle on each other.
 */
let onWorks: (() => void) | null = null;
/** ... and who re-chooses THE WATCH'S SCOPE: the watcher, which re-opens its
 *  per-host subscriptions when the member set or the set of branches with
 *  work in flight moves.
 *
 *  `null` is ordinary at boot — the watcher reads the scope itself when it
 *  starts, so an event before it is wired has nothing to tell. */
let onWatchScope: (() => void) | null = null;
/** The fleet, for the one dependency that needs a padi client rather than a
 *  cell: reading and copying a work's `.waterfall/` files. `null` until the
 *  boot has built the host map — which is BEFORE anything can ask for the
 *  conversation, so a file read that finds it null is a boot-order fault, not
 *  a host being away (that is `hosts.state`'s answer). */
let fleetHosts: (() => FleetHosts) | null = null;

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

/** ... and the two collection writers, registered in the same call
 *  `surface.ts` makes for the conversation's. */
export function setWorksCollectionWriters(writers: {
  work: (id: string, work: Work | null) => void;
  member: (terminal: string, member: WorkMember | null) => void;
  reading: (terminal: string, reading: MemberReading | null) => void;
}): void {
  writeWork = writers.work;
  writeMember = writers.member;
  writeReading = writers.reading;
}

/** ... and register who is owed a redraw of the WORKS ({@link onWorks}), and
 *  who re-chooses the WATCH'S SCOPE ({@link onWatchScope}). Two sinks, because
 *  they are two different jobs: a terminal being renamed moves every row an
 *  agent reads and moves no subscription at all. The conversation announces
 *  each where it happens, so what arrives here is the fact itself rather than
 *  a frame a consumer has to diff. */
export function setWorksListener(listen: () => void): void {
  onWorks = listen;
}

export function setWatchScopeListener(listen: () => void): void {
  onWatchScope = listen;
}

/** ... and hand over the fleet, which `index.ts` builds before anything can
 *  ask for the conversation. It is the ONE dependency here that is a live
 *  client rather than a stored value: a work's files are read off the machine
 *  its terminals are on. */
export function setConductorFleetHosts(hosts: () => FleetHosts): void {
  fleetHosts = hosts;
}

/** The fleet, or the boot-order crash. `index.ts` registers it before the
 *  surface is served, which is before anything can reach the conversation —
 *  so `null` here is wiring that moved, never a host that is away. */
function requireFleet(): FleetHosts {
  if (fleetHosts === null) {
    throw new Error(
      "the conductor read a work's files before index.ts registered the fleet — setConductorFleetHosts must run before the first reader",
    );
  }
  return fleetHosts();
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
    },
    publishWork: (id, work) => {
      if (writeWork === null) {
        // Same boot-order crash as the conversation's publish above, for the
        // same reason: a work frame nobody can receive is the restart's own
        // "here is what was in flight" frame, lost.
        throw new Error(
          "the conductor published a work before surface.ts registered the works collection writer — implementKoluSurface must run before the first reader",
        );
      }
      writeWork(id, work);
    },
    publishMember: (terminal, member) => {
      if (writeMember === null) {
        throw new Error(
          "the conductor published a membership before surface.ts registered the workMembers collection writer — implementKoluSurface must run before the first reader",
        );
      }
      writeMember(terminal, member);
    },
    publishReading: (terminal, reading) => {
      if (writeReading === null) {
        throw new Error(
          "the conductor published a member reading before surface.ts registered the memberReadings collection writer — implementKoluSurface must run before the first reader",
        );
      }
      writeReading(terminal, reading);
    },
    // What moved, said by the one thing that knows. Unguarded: this is not
    // riding a browser's frame any more, so a listener that throws is a
    // boot-wiring fault to see rather than a frame to protect.
    worksMoved: () => onWorks?.(),
    watchScopeMoved: () => onWatchScope?.(),
    // THE FOUR RECORDS, each where its volatility says it belongs. The
    // conversation, the works and what kolu knows about their member
    // terminals are keys of the one conf store (one schema, one ladder —
    // `dev/skills/state/SKILL.md`); the transcript is a file of its own
    // because it is most of the bytes and it moves on every keystroke, and it
    // rides the SAME ladder from there (`transcriptFile.ts`).
    //
    // `members` is its own key beside `works` rather than a field inside one,
    // because it is the watch's memory of a TERMINAL (what it was called,
    // what the conversation was told about it) rather than part of what a
    // work IS — and it moves every time a host is read.
    store: confStore<PersistedConductor>(store, "conductor"),
    works: confStore<PersistedWorks>(store, "works"),
    members: confStore<PersistedMembers>(store, "members"),
    transcript: transcriptFileStore(
      dirname(store.path),
      TRANSCRIPT_FILE_VERSION,
    ),
    storePath: () => store.path,
    transcriptPath: () => transcriptFilePath(dirname(store.path)),
    // Attachments land beside the state file, under `conductor/attachments`.
    // `store.path` is `<KOLU_STATE_DIR>/config.json`, and taking the directory
    // off the store itself rather than re-reading the env is what keeps the
    // two from ever naming different roots.
    stateRoot: dirname(store.path),
    // A work's files are read off the machine its terminals are on and copied
    // under this state root. The fleet is reached through the thunk the boot
    // registered, read per call: a host that dropped and came back answers
    // with a different client, and holding one here would be reading a padi
    // that has never heard of this process.
    workFiles: workFilesOverHosts({
      hosts: {
        padi: (key) => requireFleet().padi(key),
        display: (key) => requireFleet().display(key),
        state: (key) => requireFleet().state(key),
      },
      stateRoot: dirname(store.path),
      log,
    }),
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
