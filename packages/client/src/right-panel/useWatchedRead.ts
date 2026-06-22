/**
 * R8 — `useWatchedRead`: reconstruct a value-bearing reactive read from a
 * `terminalWorkspaceSurface` PROCEDURE + its change-PULSE watcher stream.
 *
 * R6 left kolu's fs/git as value-bearing streams on `koluSurface` (each yield a
 * full re-read). R8 deletes those and composes `terminalWorkspaceSurface`, whose
 * fs/git are PROCEDURES (request → response) plus `subscribeRepoChange` /
 * `subscribeFileChange` watcher streams that carry a payload-free `{seq}` PULSE.
 * The consumer's job — what this primitive does — is "(re-)query the procedure on
 * the input AND on every pulse, exposing the latest result." The result is the
 * SAME ergonomic shape the old `app.streams.X.use(...)` gave (`value()` /
 * `.pending()` / `.error()`), so the Code-tab call sites barely move.
 *
 * Two seams, mirroring the old value-bearing stream's semantics:
 *   - `on(input)` — the INPUT changed: reset the value (so a stale value can't be
 *     read as fresh) and re-query. Resetting is what makes `pending()` honest.
 *   - `on(pulse.seq)` — a change fired: re-query WITHOUT resetting, so the tile
 *     keeps showing the current value while the fresh one loads (no flicker).
 *
 * `pending()` is DERIVED, not an imperative flag: it's true exactly when there is
 * an input but no value (and no error) for it yet. Deriving it dodges an
 * effect-ordering race a flag has — a consumer reading `pending()` during the same
 * tick the input changed (e.g. the Code tab's diff→browse `openInCodeTab`
 * resolution, which defers while `allPaths.pending()`) sees `true` because the
 * value was just reset, regardless of whether this primitive's effect has run yet.
 * A stale flag read `false` there and resolved against an empty list — the
 * deterministic "browse content doesn't load after navigation" bug.
 */

import { type Accessor, createEffect, createSignal, on } from "solid-js";

/** The subset of a surface stream's `.use(...)` accessor this primitive reads —
 *  the `{seq}` pulse value plus its pending/error flags. Tracking the nested `seq`
 *  (not the whole object) is required: the surface subscription reconciles the
 *  frame in place, so only `seq` re-notifies. */
export interface PulseAccessor {
  (): { seq: number } | undefined;
  pending: () => boolean;
  error: () => Error | undefined;
}

/** The reconstructed value-bearing read — drop-in for the old `stream.use(...)`. */
export interface WatchedRead<O> {
  (): O | undefined;
  pending: () => boolean;
  error: () => Error | undefined;
}

export function useWatchedRead<I, O>(
  /** The procedure input, or `null` to stand the read down (no repo / wrong view). */
  input: Accessor<I | null>,
  /** Call the workspace procedure — e.g. `(i) => client.surface.terminalWorkspace.git.getStatus(i)`. */
  read: (input: I) => Promise<O>,
  /** The change-pulse subscription scoped to the same repo/file — re-querying on
   *  each new pulse is what keeps the value live. */
  pulse: PulseAccessor,
  opts?: { onError?: (err: Error) => void },
): WatchedRead<O> {
  const [value, setValue] = createSignal<O | undefined>(undefined);
  const [error, setError] = createSignal<Error | undefined>(undefined);

  // A monotonic token per query so a slow stale read (input/pulse moved on) can't
  // clobber the fresh one — and a rejected read is HANDLED here, never an
  // unhandled rejection / page error.
  let token = 0;
  function query(i: I): void {
    const mine = ++token;
    void read(i).then(
      (out) => {
        if (mine !== token) return;
        setValue(() => out);
        setError(undefined);
      },
      (err: unknown) => {
        if (mine !== token) return;
        setError(err as Error);
        opts?.onError?.(err as Error);
      },
    );
  }

  // INPUT changed → reset (so `pending()` reads true while loading), then query.
  createEffect(
    on(input, (i) => {
      token++; // abandon any in-flight read for the previous input
      setValue(undefined);
      setError(undefined);
      if (i !== null) query(i);
    }),
  );

  // PULSE fired → re-query WITHOUT resetting (the tile keeps its current value
  // while the fresh one loads). `defer` skips the initial frame — the input effect
  // already issued the first query.
  createEffect(
    on(
      () => pulse()?.seq,
      () => {
        const i = input();
        if (i !== null) query(i);
      },
      { defer: true },
    ),
  );

  const accessor = (() => value()) as WatchedRead<O>;
  // DERIVED: pending ⇔ there's an input but no value/error for it yet. Race-free.
  accessor.pending = () =>
    input() !== null && value() === undefined && error() === undefined;
  accessor.error = () => error() ?? pulse.error();
  return accessor;
}
