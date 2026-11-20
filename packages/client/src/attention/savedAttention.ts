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
 *  ONE WRITER. Every change goes through a record from {@link attentionRecordOf},
 *  which holds the one copy per host for the page; the marks live in a store so
 *  each dock row reads only its own. Per browser, in `localStorage` under
 *  `kolu-attention:<host>`: two tabs share it and the last write wins. A stored
 *  value that does not validate is dropped with a warning and the host starts
 *  blank, which is what a browser that never saved anything does. */

import { decodeHostKey } from "kolu-common/hostKey";
import { type TerminalId, TerminalIdSchema } from "kolu-common/surface";
import { Schema } from "effect";
import { untrack } from "solid-js";
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

/** Build a record over `storage` under `name`, reading what is saved there.
 *  The app reaches records through {@link attentionRecordOf}; this is the
 *  storage-explicit constructor beneath it. */
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
  });
  const [unread, setUnread] = createStore<Partial<Record<TerminalId, true>>>(
    Object.fromEntries(untrack(saved).unread.map((id) => [id, true])),
  );
  const saveUnread = (): void => {
    setSaved((prev) => ({
      ...prev,
      unread: Object.keys(unread) as TerminalId[],
    }));
  };
  return {
    memory: () => untrack(saved).memory,
    remember: (memory) => {
      setSaved((prev) => ({ ...prev, memory }));
    },
    isUnread: (id) => unread[id] === true,
    markUnread: (id) => {
      if (unread[id] === true) return;
      setUnread(id, true);
      saveUnread();
    },
    clearUnread: (id) => {
      if (unread[id] !== true) return;
      setUnread(
        produce((marks) => {
          delete marks[id];
        }),
      );
      saveUnread();
    },
    clearAllUnread: () => {
      if (Object.keys(unread).length === 0) return;
      setUnread(
        produce((marks) => {
          for (const id of Object.keys(marks) as TerminalId[]) delete marks[id];
        }),
      );
      saveUnread();
    },
  };
}

const KEY_BASE = "kolu-attention";

/** The page's records, one per host, keyed by the encoded host. */
const records = new Map<string, AttentionRecord>();

/** This host's record — created from `localStorage` the first time the page
 *  asks, then the same one for the page's life. */
export function attentionRecordOf(encHost: string): AttentionRecord {
  let record = records.get(encHost);
  if (record === undefined) {
    record = createAttentionRecord({
      name: perHostName(KEY_BASE, decodeHostKey(encHost)),
      storage: localStorage,
    });
    records.set(encHost, record);
  }
  return record;
}

/** The host left the pool: drop its record from the page and from storage,
 *  as the per-host preferences drop theirs. A reload does not run this. */
export function forgetAttentionRecord(encHost: string): void {
  records.delete(encHost);
  localStorage.removeItem(perHostName(KEY_BASE, decodeHostKey(encHost)));
}
