/**
 * Sleeping-record store — the sibling of the active terminal registry.
 *
 * A terminal put to sleep has no live PTY, so it cannot live in
 * `terminal-registry.ts` (which holds only `ActiveTerminal` by construction —
 * see its doc-comment). It lives here as a `SavedSleepingTerminal` record keyed
 * by its freshly-minted id, persisted into the session snapshot and re-seeded
 * here at boot.
 *
 * This module also owns the one MERGE that makes a sleeping terminal real on the
 * wire: `mergedTerminalList()` concatenates the active and sleeping ids into the
 * single `terminalList` the client subscribes off. A sleeping id absent from
 * that list reaches NO client surface — it is the load-bearing seam.
 *
 * A leaf collection, not an electricity boundary: it hides no hard volatility,
 * so it stays in kolu-server rather than a `@kolu/*` package.
 */

import type {
  SavedSleepingTerminal,
  SleepingTerminal,
  TerminalId,
  TerminalInfo,
} from "kolu-common/surface";
import { listTerminals } from "./terminal-registry.ts";

const sleeping = new Map<TerminalId, SavedSleepingTerminal>();

/** Insert/replace a sleeping record, keyed by its (minted) id. The saved
 *  sleeping id is a UUID `TerminalId` by schema (F7), so no cast is needed. */
export function putSleeping(record: SavedSleepingTerminal): void {
  sleeping.set(record.id, record);
}

export function getSleeping(id: TerminalId): SavedSleepingTerminal | undefined {
  return sleeping.get(id);
}

/** Remove a sleeping record. Returns true if it was present. */
export function deleteSleeping(id: TerminalId): boolean {
  return sleeping.delete(id);
}

/** Drop every sleeping record — the sibling of `drainTerminals` for the sleeping
 *  store. `terminal.killAll` clears BOTH the live registry and this store (F3):
 *  without it, sleeping records survive a close-all and reappear on the next
 *  `terminalList` snapshot or reload (and leak across e2e scenarios, since the
 *  `Before` hook resets state via `killAll`). Returns the count cleared so the
 *  caller can decide whether to re-persist. */
export function drainSleeping(): number {
  const count = sleeping.size;
  sleeping.clear();
  return count;
}

export function listSleepingIds(): TerminalId[] {
  return [...sleeping.keys()];
}

export function listSleepingRecords(): SavedSleepingTerminal[] {
  return [...sleeping.values()];
}

/** The wire value for a sleeping key — the record minus its id, i.e. the
 *  `SleepingTerminal` arm the `terminalMetadata` collection serves. */
export function sleepingMeta(id: TerminalId): SleepingTerminal | undefined {
  const record = sleeping.get(id);
  if (!record) return undefined;
  const { id: _id, ...meta } = record;
  return meta;
}

/** The merged active∪sleeping id list the `terminalList` cell carries — active
 *  ids first (registry insertion order), sleeping ids appended. A sleeping
 *  record has no live pid, so it rides the `pid: 0` placeholder (already the
 *  spawn-shadow convention). BOTH the push (`emitTerminalListChanged`) and the
 *  snapshot read (the cell `store.get`) call this, so the live channel and a
 *  reconnect can never disagree about which terminals exist. */
export function mergedTerminalList(): TerminalInfo[] {
  return [
    ...listTerminals(),
    ...listSleepingIds().map((id): TerminalInfo => ({ id, pid: 0 })),
  ];
}
