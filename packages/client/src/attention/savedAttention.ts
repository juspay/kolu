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
 *  every page of this kolu whatever its address: a page's unread list IS the
 *  saved list, followed through the browser's `storage` event
 *  (`originStorageSync`). That event reaches a page some time AFTER another
 *  page's write, so a write never starts from what this page last heard: it
 *  reads the stored record at that moment and changes only its own part, and
 *  no page puts back a mark another page took off. Each dock row reads only
 *  its own mark.
 *  A stored value that does not validate is dropped with a warning and the
 *  host starts blank, which is what a browser that never saved anything does. */

import { decodeHostKey } from "kolu-common/hostKey";
import {
  type TerminalId,
  TerminalIdSchema,
} from "@kolu/terminal-vocab/terminalId";
import { Schema } from "effect";
import { createProjection } from "solid-js";
import { detachedRoot } from "../detachedRoot";
import {
  defaultInvalidWarning,
  originStorageSync,
  perHostName,
  persistedPref,
  readWithFallback,
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
  const parse = (raw: string) => decodeSavedAttention(JSON.parse(raw));
  const onInvalid = defaultInvalidWarning(opts.name, BLANK);
  const [saved, setSaved, loaded] = persistedPref<SavedAttention>({
    name: opts.name,
    fallback: BLANK,
    parse,
    serialize: (value) => JSON.stringify(value),
    onInvalid,
    storage: opts.storage,
    sync: originStorageSync,
  });
  /** The record as stored NOW, which may hold another page's write this page
   *  has not heard yet — what every write starts from. */
  const stored = (): SavedAttention => {
    const raw = opts.storage.getItem(opts.name);
    return raw === null
      ? BLANK
      : readWithFallback(raw, parse, BLANK, onInvalid);
  };
  /** What this page last put into `saved` — its own writes, and a stored
   *  record it took over below. Kept beside the signal because every write
   *  path below runs in the IMPERATIVE phase (an effect's callback, a
   *  command), where reading a reactive value is a strict-read defect, and
   *  where a value just written reads back stale anyway. Seeded with what the
   *  pref LOADED, not with a read of `saved`: hydration is a staged write, so
   *  the signal still answers the blank fallback here and this page would
   *  start out forgetting what the browser saved. */
  let pageValue = loaded;
  /** Write `change` of the stored record, and take it as this page's value
   *  too, so the page is current with every page's writes as of this one.
   *  `change` answers `null` when the stored record already says it; the page
   *  then still takes the stored record if its own value is behind it. */
  const update = (change: (now: SavedAttention) => SavedAttention | null) => {
    const now = stored();
    const next = change(now);
    const value =
      next ?? (JSON.stringify(pageValue) === JSON.stringify(now) ? null : now);
    if (value === null) return;
    pageValue = value;
    setSaved(() => value);
  };
  // The saved list, one store key per terminal: a DERIVED store, so a write
  // from this page or another moves only the keys whose mark changed and only
  // those rows wake.
  const unread = createProjection<Partial<Record<TerminalId, true>>>(() => {
    const marks: Partial<Record<TerminalId, true>> = {};
    for (const id of saved().unread) marks[id] = true;
    return marks;
  });
  return {
    memory: () => pageValue.memory,
    remember: (memory) => update((now) => ({ ...now, memory })),
    isUnread: (id) => unread[id] === true,
    markUnread: (id) =>
      update((now) =>
        now.unread.includes(id)
          ? null
          : { ...now, unread: [...now.unread, id] },
      ),
    clearUnread: (id) =>
      update((now) =>
        now.unread.includes(id)
          ? { ...now, unread: now.unread.filter((marked) => marked !== id) }
          : null,
      ),
    clearAllUnread: () =>
      update((now) =>
        now.unread.length === 0 ? null : { ...now, unread: [] },
      ),
  };
}

const KEY_BASE = "kolu-attention";

/** The page's records, one per host, keyed by the encoded host — each under a
 *  {@link detachedRoot} of its own, so the record outlives whichever view
 *  asked for it first. */
const records = new Map<
  string,
  { readonly record: AttentionRecord; readonly dispose: () => void }
>();

/** This host's record — created from `localStorage` the first time the page
 *  asks, then the same one for the page's life. */
export function attentionRecordOf(encHost: string): AttentionRecord {
  let entry = records.get(encHost);
  if (entry === undefined) {
    entry = detachedRoot((dispose) => ({
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
