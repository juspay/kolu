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
  type KoluOffer,
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

let endpoint: () => FleetMcpEndpoint | null = () => null;

let writeCell: ((state: ConductorState) => void) | null = null;
let writeWork: ((id: string, work: Work | null) => void) | null = null;
let writeMember:
  | ((terminal: string, member: WorkMember | null) => void)
  | null = null;
let writeReading:
  | ((terminal: string, reading: MemberReading | null) => void)
  | null = null;
let onWorks: (() => void) | null = null;
let onWatchScope: (() => void) | null = null;
let fleetHosts: (() => FleetHosts) | null = null;

let offer: KoluOffer | null = null;

let live: ConductorHost | undefined;

export function setFleetMcpEndpoint(at: () => FleetMcpEndpoint | null): void {
  endpoint = at;
}

export function setConductorCellWriter(
  write: (state: ConductorState) => void,
): void {
  writeCell = write;
}

export function setWorksCollectionWriters(writers: {
  work: (id: string, work: Work | null) => void;
  member: (terminal: string, member: WorkMember | null) => void;
  reading: (terminal: string, reading: MemberReading | null) => void;
}): void {
  writeWork = writers.work;
  writeMember = writers.member;
  writeReading = writers.reading;
}

export function setWorksListener(listen: () => void): void {
  onWorks = listen;
}

export function setWatchScopeListener(listen: () => void): void {
  onWatchScope = listen;
}

export function setConductorFleetHosts(hosts: () => FleetHosts): void {
  fleetHosts = hosts;
}

function requireFleet(): FleetHosts {
  if (fleetHosts === null) {
    throw new Error(
      "the conductor read a work's files before index.ts registered the fleet — setConductorFleetHosts must run before the first reader",
    );
  }
  return fleetHosts();
}

export function setConductorOffer(next: KoluOffer): void {
  offer = next;
}

export function liveServerConductor(): ConductorHost {
  if (live !== undefined) return live;
  live = startConductorHost({
    log,
    home: homedir(),
    hostName: hostname(),
    fleetMcp: () => endpoint(),
    offer: () => {
      if (offer === null)
        throw new Error(
          "a work was opened, answered or started before index.ts handed the conductor kolu's offer — setConductorOffer must run before the surface is served",
        );
      return offer;
    },
    proveFleetMcp: proveFleetMcpEndpoint,
    publish: (state) => {
      if (writeCell === null) {
        throw new Error(
          "the conductor published before surface.ts registered the cell writer — implementKoluSurface must run before the first reader",
        );
      }
      writeCell(state);
    },
    publishWork: (id, work) => {
      if (writeWork === null) {
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
    worksMoved: () => onWorks?.(),
    watchScopeMoved: () => onWatchScope?.(),
    store: confStore<PersistedConductor>(store, "conductor"),
    works: confStore<PersistedWorks>(store, "works"),
    members: confStore<PersistedMembers>(store, "members"),
    transcript: transcriptFileStore(
      dirname(store.path),
      TRANSCRIPT_FILE_VERSION,
    ),
    storePath: () => store.path,
    transcriptPath: () => transcriptFilePath(dirname(store.path)),
    stateRoot: dirname(store.path),
    workFiles: workFilesOverHosts({
      hosts: {
        padi: (key) => requireFleet().padi(key),
        display: (key) => requireFleet().display(key),
        state: (key) => requireFleet().state(key),
      },
      stateRoot: dirname(store.path),
      log,
    }),
    spawn: startHarness,
  });
  return live;
}

export async function disposeServerConductor(): Promise<void> {
  await live?.dispose();
}
