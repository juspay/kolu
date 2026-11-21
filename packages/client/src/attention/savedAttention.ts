/** What THIS BROWSER remembers about one host's attention, across a reload.
 *
 *  Two things live here, and they are one record because they are one memory:
 *  the dock's unread marks (`createViewState` reads and writes them), and the
 *  attention engine's memory of the last frame it saw (`attentionCore`, through
 *  `useAttention`). Saved together, a page loaded after a reload or a kolu
 *  restart finds the marks as they were and compares padi's first word against
 *  what the last page saw — so a terminal you had opened stays read, one you
 *  had not stays unread, and one that finished meanwhile is marked without a
 *  chime.
 *
 *  ONE WRITER PER PAGE. Every change goes through a record from
 *  {@link attentionRecordOf}, which holds the one copy per host for the page.
 *  Per browser, in `localStorage` under `kolu-attention:<host>`, shared by
 *  every page of this kolu: a page's unread list IS the saved list, followed
 *  through the browser's `storage` event (`storageSync`), so another page's
 *  write reaches this page before this page writes again, and no page puts
 *  back a mark another page took off. Each dock row reads only its own mark.
 *  A stored value that does not validate is dropped with a warning and the
 *  host starts blank, which is what a browser that never saved anything does. */

import { decodeHostKey } from "kolu-common/hostKey";
import { type TerminalId, TerminalIdSchema } from "kolu-common/surface";
import { Schema } from "effect";
import { storageSync } from "@solid-primitives/storage";
import { createComputed, createRoot, untrack } from "solid-js";
import { createStore, produce } from "solid-js/store";
import {
  defaultInvalidWarning,
  perHostName,
  persistedPref,
} from "../persistedPref";
import type { AttentionMemory } from "./attentionCore";

const Ids = Schema.Array(TerminalIdSchema);

const SavedAttentionSchema = Schema.Struct({
  /** The engine's memory, or `null` before it has seen a frame. */
  memory: Schema.NullOr(
    Schema.Struct({
      frame: Schema.Struct({ asking: Ids, finished: Ids }),
      latched: Ids,
      unseenFinished: Ids,
    }),
  ),
  /** The terminals carrying a dock unread mark. */
  unread: Ids,
});
type SavedAttention = typeof SavedAttentionSchema.Type;

const BLANK: SavedAttention = { memory: null, unread: [] };

const decodeSavedAttention = Schema.decodeUnknownSync(SavedAttentionSchema);

/** One host's saved attention, as the page uses it. */
export interface AttentionRecord {
  /** What the engine saved, or `null` when this browser has saved nothing. */
  memory(): AttentionMemory | null;
  remember(memory: AttentionMemory): void;
  /** Reactive, per terminal. */
  isUnread(id: TerminalId): boolean;
  markUnread(id: TerminalId): void;
  clearUnread(id: TerminalId): void;
  clearAllUnread(): void;
}

/** Build a record over `storage` under `name`, reading what is saved there
 *  and following what other pages write to it. Call it under a reactive
 *  owner: the per-terminal marks are a projection that lives as long as that
 *  owner. The app reaches records through {@link attentionRecordOf}; this is
 *  the storage-explicit constructor beneath it. */
export function createAttentionRecord(opts: {
  name: string;
  storage: Storage;
}): AttentionRecord {
  const [saved, setSaved] = persistedPref<SavedAttention>({
    name: opts.name,
    fallback: BLANK,
    parse: (raw) => decodeSavedAttention(JSON.parse(raw)),
    serialize: (value) => JSON.stringify(value),
    onInvalid: defaultInvalidWarning(opts.name, BLANK),
    storage: opts.storage,
    sync: storageSync,
  });
  // The saved list, one store key per terminal: a write from this page or
  // another moves only the keys whose mark changed, so only those rows wake.
  const [unread, setUnread] = createStore<Partial<Record<TerminalId, true>>>(
    {},
  );
  createComputed(() => {
    const next = new Set(saved().unread);
    setUnread(
      produce((marks) => {
        for (const id of Object.keys(marks) as TerminalId[])
          if (!next.has(id)) delete marks[id];
        for (const id of next) marks[id] = true;
      }),
    );
  });
  return {
    memory: () => untrack(saved).memory,
    remember: (memory) => {
      setSaved((prev) => ({ ...prev, memory }));
    },
    isUnread: (id) => unread[id] === true,
    markUnread: (id) => {
      if (untrack(saved).unread.includes(id)) return;
      setSaved((prev) => ({ ...prev, unread: [...prev.unread, id] }));
    },
    clearUnread: (id) => {
      if (!untrack(saved).unread.includes(id)) return;
      setSaved((prev) => ({
        ...prev,
        unread: prev.unread.filter((marked) => marked !== id),
      }));
    },
    clearAllUnread: () => {
      if (untrack(saved).unread.length === 0) return;
      setSaved((prev) => ({ ...prev, unread: [] }));
    },
  };
}

const KEY_BASE = "kolu-attention";

/** The page's records, one per host, keyed by the encoded host — each under a
 *  root of its own, so the record outlives whichever view asked for it first. */
const records = new Map<
  string,
  { readonly record: AttentionRecord; readonly dispose: () => void }
>();

/** This host's record — created from `localStorage` the first time the page
 *  asks, then the same one for the page's life. */
export function attentionRecordOf(encHost: string): AttentionRecord {
  let entry = records.get(encHost);
  if (entry === undefined) {
    entry = createRoot((dispose) => ({
      record: createAttentionRecord({
        name: perHostName(KEY_BASE, decodeHostKey(encHost)),
        storage: localStorage,
      }),
      dispose,
    }));
    records.set(encHost, entry);
  }
  return entry.record;
}

/** The host left the pool: drop its record from the page and from storage,
 *  as the per-host preferences drop theirs. A reload does not run this. */
export function forgetAttentionRecord(encHost: string): void {
  records.get(encHost)?.dispose();
  records.delete(encHost);
  localStorage.removeItem(perHostName(KEY_BASE, decodeHostKey(encHost)));
}
