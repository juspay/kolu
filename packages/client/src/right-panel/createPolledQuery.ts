/** `createPolledQuery` — the CLIENT dual of the server's `pollOnEvent`.
 *
 * Turns a surface PROCEDURE + a `{seq}` PULSE stream into the exact reactive
 * `Subscription<T>` shape `app.streams.X.use(...)` returns — a callable value
 * accessor plus `.pending()` and `.error()` — so the Code tab can read the
 * SHARED `terminalWorkspaceSurface` (procedure + pulse) byte-for-byte the way it
 * read `koluSurface`'s value-bearing streams.
 *
 * The wiring matches the value-bearing stream it replaces (`surface-live-data`):
 *   - call `read(input)` once when `inputFn()` becomes non-null, then re-query on
 *     each pulse `{seq}` bump (and on any input change);
 *   - an INPUT change resets the value to `undefined` (a resubscribe — the
 *     consumer reads `pending`), but a pulse-only bump KEEPS the current value
 *     visible while it re-reads, exactly as a server-pushed value frame did (no
 *     transient empty → the #818 selection-stability guard holds);
 *   - `pending()` is true while the pulse hasn't delivered its `{seq:0}` snapshot
 *     OR a re-query is in flight.
 *
 * This is a composition leaf over the framework's own primitives (a bound pulse
 * stream + a one-shot procedure call) — not a framework receptacle, so it lives
 * here in the client beside its consumers, not in `@kolu/surface`.
 */

import type { Subscription } from "@kolu/surface/solid";
import {
  type Accessor,
  batch,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from "solid-js";

/** The pulse shape `createPolledQuery` reacts to — a monotonic `{seq}`, the
 *  payload of the workspace surface's `subscribeRepoChange`/`subscribeFileChange`
 *  watcher streams (kept structural so this leaf needs no cross-package import). */
type SeqPulse = { seq: number };

export function createPolledQuery<I, T>(
  /** The procedure input, or `null` to stand down (no read). Read reactively. */
  inputFn: () => I | null,
  /** Call the surface procedure for the given input. */
  read: (input: I) => Promise<T>,
  /** The shared `{seq}` pulse driving re-queries (a `subscribeRepoChange` /
   *  `subscribeFileChange` `.use(...)` subscription). */
  pulse: Subscription<SeqPulse>,
  opts?: {
    onError?: (err: Error) => void;
    /** Drop a re-read result equal to the current value — the value-bearing
     *  stream's `isEqual` dedup, so a pulse that re-reads an UNCHANGED repo emits
     *  no fresh reference and the tree/filter/selection don't churn. */
    isEqual?: (a: T, b: T) => boolean;
  },
): Subscription<T> {
  const [value, setValue] = createSignal<T | undefined>(undefined);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal<Error | undefined>(undefined);

  // Dedup key of the last read actually issued — so the same (input, seq) never
  // re-reads. Normalizing the pulse's snapshot frame (`seq:0`) onto the
  // not-yet-delivered state (`?? 0`) is what collapses the mount read and the
  // `{seq:0}` frame into ONE read (the value-bearing stream did one server read);
  // a real delta (`{seq>0}`) or a new input still re-queries.
  let lastReadKey: string | undefined;
  // A monotonic generation: bumped ONLY when a new read is issued (and on
  // dispose), so an in-flight read is invalidated solely by a NEWER read — never
  // by the effect re-running to SKIP. The skip path (a sibling query's value
  // updating an input dep this query then dedups) must NOT cancel the in-flight
  // read, or a live re-query (diff/preview) would be dropped mid-flight.
  let generation = 0;
  onCleanup(() => {
    generation++;
  });

  createEffect(
    on(
      () => {
        const input = inputFn();
        const seq = pulse()?.seq ?? 0;
        return input === null ? null : { input, seq };
      },
      (cur, prev) => {
        if (cur === null) {
          lastReadKey = undefined;
          generation++;
          batch(() => {
            setValue(undefined);
            setError(undefined);
            setLoading(false);
          });
          return;
        }
        const inputJson = JSON.stringify(cur.input);
        const key = `${inputJson}::${cur.seq}`;
        if (key === lastReadKey) return;
        lastReadKey = key;
        const myGen = ++generation;
        // Reset to `undefined` (pending) only when the INPUT itself changed (a
        // new repo / file / mode) — a resubscribe. A pulse-only bump keeps the
        // current value on screen while it re-reads, matching the value-bearing
        // stream this replaces (no transient empty → the #818 guard holds).
        const inputChanged = !prev || JSON.stringify(prev.input) !== inputJson;
        if (inputChanged) setValue(undefined);
        setLoading(true);
        read(cur.input).then(
          (v) => {
            if (myGen !== generation) return;
            batch(() => {
              // `isEqual` dedup: keep the current reference when the re-read is
              // value-identical, so an unchanged repo's pulse doesn't churn the
              // tree (but `loading`/`pending` still settle below).
              const cur = value();
              if (!(opts?.isEqual && cur !== undefined && opts.isEqual(cur, v)))
                setValue(() => v);
              setError(undefined);
              setLoading(false);
            });
          },
          (e: unknown) => {
            if (myGen !== generation) return;
            const err = e instanceof Error ? e : new Error(String(e));
            batch(() => {
              setError(err);
              setLoading(false);
            });
            opts?.onError?.(err);
          },
        );
      },
    ),
  );

  return Object.assign((() => value()) as Accessor<T | undefined>, {
    pending: () => pulse.pending() || loading(),
    error: () => error() ?? pulse.error(),
  }) as Subscription<T>;
}
