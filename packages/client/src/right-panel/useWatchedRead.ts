/**
 * R8 — `useWatchedRead`: reconstruct a value-bearing reactive read from a
 * `terminalWorkspaceSurface` PROCEDURE + its change-PULSE watcher stream.
 *
 * R6 left kolu's fs/git as value-bearing streams on `koluSurface` (each yield a
 * full re-read). R8 deletes those and composes `terminalWorkspaceSurface`, whose
 * fs/git are PROCEDURES (request → response) plus `subscribeRepoChange` /
 * `subscribeFileChange` watcher streams that carry a payload-free `{seq}` PULSE.
 * The consumer's job — what this primitive does — is "subscribe to the pulse,
 * re-query the procedure on every pulse (including the `{seq:0}` snapshot frame)."
 * The result is the SAME ergonomic shape the old `app.streams.X.use(...)` gave
 * (`value()` / `.pending()` / `.error()`), so the Code-tab call sites barely move.
 *
 * Driven by an explicit `createEffect` (not `createResource`): the effect tracks
 * `input()` AND the `pulse()`, so each new pulse re-runs the read — and it stores
 * the outcome in plain signals, so a rejected read (e.g. `git ls-files` in a bare
 * repo) lands on `error()`/`onError` and NEVER throws on read. A resource would
 * re-throw on `value()` and surface as an uncaught page error (the old
 * value-bearing stream routed such failures to its `onError` instead).
 *
 * This is the concrete "not byte-identical — a one-time client update" cost the
 * R8 plan names: the wire shape changed (stream → procedure+pulse), so the client
 * gains this one adapter instead of reading a value-bearing stream directly.
 */

import { type Accessor, createEffect, createSignal, onCleanup } from "solid-js";

/** The subset of a surface stream's `.use(...)` accessor this primitive reads —
 *  the `{seq}` pulse value plus its pending/error flags. Typed to the monotonic
 *  `seq` (not `unknown`) deliberately: the surface subscription stores the frame
 *  in a `createStore` and writes it via `reconcile`, so a new pulse keeps the SAME
 *  object reference and mutates only `seq`. The consumer MUST track the nested
 *  `seq` field — reading the whole object would never re-notify (the bug that
 *  froze the Code tab's live updates while directLink, which iterates raw, worked). */
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
  const [pending, setPending] = createSignal(false);

  createEffect(() => {
    const i = input();
    // Track the nested `seq` (NOT the whole pulse object) so a new `{seq}` — incl.
    // the `{seq:0}` snapshot — re-runs the read. The surface subscription reconciles
    // the frame in place, so the object reference is stable; only `seq` changes, and
    // only a read OF `seq` re-notifies. This is the "requery on pulse" the composed
    // surface's watcher streams exist for.
    void pulse()?.seq;
    if (!i) {
      setValue(undefined);
      setError(undefined);
      setPending(false);
      return;
    }
    let cancelled = false;
    setPending(true);
    // `.then(ok, err)` (not `await`/`throw`) so a rejected read is HANDLED here —
    // it lands on `error()` + `onError`, never an unhandled rejection / page error.
    void read(i).then(
      (out) => {
        if (cancelled) return;
        setValue(() => out);
        setError(undefined);
        setPending(false);
      },
      (err: unknown) => {
        if (cancelled) return;
        setError(err as Error);
        setPending(false);
        opts?.onError?.(err as Error);
      },
    );
    // A newer input/pulse supersedes an in-flight read — drop its result so a slow
    // stale read can't clobber the fresh one.
    onCleanup(() => {
      cancelled = true;
    });
  });

  const accessor = (() => value()) as WatchedRead<O>;
  accessor.pending = () => pending() || pulse.pending();
  accessor.error = () => error() ?? pulse.error();
  return accessor;
}
