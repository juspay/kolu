/** Generic per-key `Collection<K,V>` bridge.
 *
 *  Subscribes to the agent's `keys` stream and, for each present key,
 *  opens a per-key `get(key)` stream. Pumps every observed value into
 *  the caller's `onUpsert` callback. When a key disappears from the
 *  `keys` snapshot, the per-key stream is aborted and `onRemove` fires.
 *
 *  Per-key streams stay open for the key's lifetime — deltas flow
 *  without re-subscribing. Departed keys see their stream aborted and
 *  the entry removed from the destination collection.
 *
 *  The per-key model is the right fit when N is small (4–32 keys); for
 *  bulk (hundreds of keys, high churn), use a single discriminated-
 *  union snapshot stream instead. See the `remote-process-monitor`
 *  example: `cpuCores` uses this helper; `processes` uses a bulk
 *  `processesSnapshot` stream. */
export async function mirrorRemoteCollection<K, V>(opts: {
  /** Tag used in diagnostic log lines (e.g. "cpuCores",
   *  "terminalMetadata"). */
  label: string;
  /** Caller-supplied logger for non-fatal per-key errors. AbortError is
   *  silently filtered (it's the orchestrator removing a departed
   *  key); anything else is reported here. */
  log: (line: string) => void;
  /** Eager-or-lazy: a Promise of the keys stream (matches the shape
   *  the framework's typed client returns for `<coll>.keys(...)`). */
  keys: Promise<AsyncIterable<readonly K[]>>;
  get: (key: K, signal: AbortSignal) => Promise<AsyncIterable<V>>;
  onUpsert: (key: K, value: V) => void;
  onRemove: (key: K) => void;
}): Promise<void> {
  const open = new Map<K, AbortController>();
  try {
    for await (const keys of await opts.keys) {
      const next = new Set(keys);
      for (const key of next) {
        if (open.has(key)) continue;
        const ctl = new AbortController();
        open.set(key, ctl);
        void (async () => {
          try {
            const stream = await opts.get(key, ctl.signal);
            for await (const value of stream) {
              if (ctl.signal.aborted) break;
              opts.onUpsert(key, value);
            }
          } catch (err) {
            if ((err as Error).name !== "AbortError") {
              opts.log(
                `${opts.label}: per-key stream error for ${String(key)}: ${(err as Error).message}`,
              );
            }
          }
        })();
      }
      for (const [key, ctl] of [...open]) {
        if (next.has(key)) continue;
        ctl.abort();
        open.delete(key);
        opts.onRemove(key);
      }
    }
    opts.log(`${opts.label}: keys stream closed`);
  } catch (err) {
    opts.log(`${opts.label}: keys stream error: ${(err as Error).message}`);
  } finally {
    for (const ctl of open.values()) ctl.abort();
  }
}
