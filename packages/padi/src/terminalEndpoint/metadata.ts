import {
  composeTerminalMetadata,
  PadiParkedTerminalSchema,
  type PadiTerminal,
  PersistedSnapshotSchema,
  type TerminalClientMetadata,
} from "@kolu/padi-client/surface";
import type {
  AgentMemory,
  RestoreTarget,
  TerminalSnapshot,
} from "@kolu/terminal-vocab/schema";
import { Schema } from "effect";
import { markCensusMoved } from "../attention/fleetGate.ts";
import { log } from "../log.ts";
import { padiSurfaceCtx } from "../padiSurfaceCtx.ts";
import { notifyDirty } from "../publisher.ts";
import { getTerminal, type TerminalProcess } from "../terminal-registry.ts";

const decodePadiParked = Schema.decodeUnknownSync(PadiParkedTerminalSchema);
const decodePersistedSnapshot = Schema.decodeUnknownSync(
  PersistedSnapshotSchema,
);

export function composePadiTerminal(entry: TerminalProcess): PadiTerminal {
  if (entry.meta.state === "parked") {
    return decodePadiParked({
      ...decodePersistedSnapshot(entry.snapshot),
      ...entry.meta,
    });
  }
  return composeTerminalMetadata(entry.meta, entry.snapshot);
}

function publishComposedTerminal(terminalId: string): void {
  const entry = getTerminal(terminalId);
  if (!entry) return;
  padiSurfaceCtx.collections.terminals.upsert(
    terminalId,
    composePadiTerminal(entry),
  );
}

export function installSnapshot(terminalId: string): void {
  publishComposedTerminal(terminalId);
  markCensusMoved();
}

export function dropSnapshot(terminalId: string): void {
  padiSurfaceCtx.collections.terminals.remove(terminalId);
  markCensusMoved();
}

export function commitSnapshot(
  terminalId: string,
  observation: TerminalSnapshot,
): void {
  const entry = getTerminal(terminalId);
  if (!entry) {
    log.warn({ terminal: terminalId }, "observation commit after removal");
    return;
  }
  entry.snapshot = observation;
  try {
    publishComposedTerminal(terminalId);
  } catch (err) {
    log.error(
      { err, terminal: terminalId },
      "composed terminal publish threw (observation committed; will re-publish on next change)",
    );
  }
}

export function updateMemory(
  terminalId: string,
  memory: AgentMemory,
  restoreTarget: RestoreTarget,
): void {
  const entry = getTerminal(terminalId);
  if (!entry) {
    log.warn({ terminal: terminalId }, "memory write after removal");
    return;
  }
  entry.meta.lastActivityAt = memory.lastActivityAt;
  entry.meta.promptedAt = memory.promptedAt;
  entry.meta.restoreTarget = restoreTarget;
  try {
    publishComposedTerminal(terminalId);
  } catch (err) {
    log.error(
      { err, terminal: terminalId },
      "composed terminal publish threw (memory committed; will re-publish on next change)",
    );
  }
}

export function updateClientMetadata(
  entry: TerminalProcess,
  terminalId: string,
  mutate: (meta: TerminalClientMetadata) => void,
): void {
  mutate(entry.meta);
  publishComposedTerminal(terminalId);
  notifyDirty();
}

export function publishTerminalState(terminalId: string): void {
  publishComposedTerminal(terminalId);
  notifyDirty();
}

type TerminalAgents = NonNullable<TerminalProcess["meta"]["agents"]>;

export function writeProfileInEffect(
  entry: TerminalProcess,
  terminalId: string,
  asked: TerminalAgents,
  effective: NonNullable<TerminalAgents["effective"]>,
): void {
  if (entry.meta.agents !== asked) return;
  entry.meta.agents = { ...asked, effective };
  publishTerminalState(terminalId);
}
