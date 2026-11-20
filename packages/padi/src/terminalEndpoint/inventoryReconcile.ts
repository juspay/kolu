import { type TerminalId, TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Result, Schema } from "effect";
import type { PtyHostInventoryEvent, PtyHostListEntry } from "kaval";

const decodeTerminalId = Schema.decodeUnknownResult(TerminalIdSchema);
import { log } from "../log.ts";
import { ptyHostClient } from "../ptyHost/index.ts";
import { getTerminal } from "../terminal-registry.ts";
import {
  adoptLocalOrphanAndArmAutosave,
  reapUnrepresentablePty,
  resubscribeStream,
} from "./local.ts";

const RESUBSCRIBE_DELAY_MS = 2_000;

export function startInventoryReconciler(signal: AbortSignal): void {
  void runReconciler(signal);
}

async function runReconciler(signal: AbortSignal): Promise<void> {
  await resubscribeStream({
    signal,
    delayMs: RESUBSCRIBE_DELAY_MS,
    getStream: () => ptyHostClient.surface.inventory.get({}),
    onEvent: applyEvent,
    onDrop: (err) =>
      log.debug({ err }, "kaval inventory subscribe failed; will re-subscribe"),
  });
}

export interface InventoryAdoption {
  id: TerminalId;
  entry: PtyHostListEntry;
}

export type InventoryCreationFrame = Extract<
  PtyHostInventoryEvent,
  { kind: "snapshot" | "created" }
>;

export function inventoryAdoptions(
  ev: InventoryCreationFrame,
  isTracked: (id: TerminalId) => boolean,
  onInvalid: (rawId: string) => void,
): InventoryAdoption[] {
  switch (ev.kind) {
    case "snapshot":
      return adoptableEntries(ev.entries, isTracked, onInvalid);
    case "created":
      return adoptableEntries([ev.entry], isTracked, onInvalid);
  }
}

function adoptableEntries(
  entries: readonly PtyHostListEntry[],
  isTracked: (id: TerminalId) => boolean,
  onInvalid: (rawId: string) => void,
): InventoryAdoption[] {
  const adoptions: InventoryAdoption[] = [];
  for (const entry of entries) {
    const parsed = decodeTerminalId(entry.id);
    if (Result.isFailure(parsed)) {
      onInvalid(entry.id);
      continue;
    }
    if (!isTracked(parsed.success)) {
      adoptions.push({ id: parsed.success, entry });
    }
  }
  return adoptions;
}

function applyEvent(ev: PtyHostInventoryEvent): void {
  dispatchInventoryFrame(
    ev,
    isTrackedById,
    onInvalidId,
    adoptLocalOrphanAndArmAutosave,
  );
}

export function dispatchInventoryFrame(
  ev: PtyHostInventoryEvent,
  isTracked: (id: TerminalId) => boolean,
  onInvalid: (rawId: string) => void,
  adopt: (id: TerminalId, entry: PtyHostListEntry) => void,
): void {
  if (ev.kind === "exited") return;
  for (const { id, entry } of inventoryAdoptions(ev, isTracked, onInvalid)) {
    log.info(
      { terminal: id, pid: entry.pid },
      "adopting out-of-band PTY from kaval inventory",
    );
    adopt(id, entry);
  }
}

const isTrackedById = (id: TerminalId): boolean =>
  getTerminal(id) !== undefined;

const onInvalidId = (rawId: string): void => reapUnrepresentablePty(rawId);
