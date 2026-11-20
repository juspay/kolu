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
  memory: Schema.NullOr(
    Schema.Struct({
      frame: Schema.Struct({ asking: Ids, finished: Ids }),
      latched: Ids,
      unseenFinished: Ids,
    }),
  ),
  unread: Ids,
});
type SavedAttention = typeof SavedAttentionSchema.Type;

const BLANK: SavedAttention = { memory: null, unread: [] };

const decodeSavedAttention = Schema.decodeUnknownSync(SavedAttentionSchema);

export interface AttentionRecord {
  memory(): AttentionMemory | null;
  remember(memory: AttentionMemory): void;
  isUnread(id: TerminalId): boolean;
  markUnread(id: TerminalId): void;
  clearUnread(id: TerminalId): void;
  clearAllUnread(): void;
}

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

const records = new Map<string, AttentionRecord>();

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

export function forgetAttentionRecord(encHost: string): void {
  records.delete(encHost);
  localStorage.removeItem(perHostName(KEY_BASE, decodeHostKey(encHost)));
}
