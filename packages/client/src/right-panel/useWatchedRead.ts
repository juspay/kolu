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
 * This is the concrete "not byte-identical — a one-time client update" cost the
 * R8 plan names: the wire shape changed (stream → procedure+pulse), so the client
 * gains this one adapter instead of reading a value-bearing stream directly.
 */

import { createResource } from "solid-js";
import type { Accessor } from "solid-js";

/** The subset of a surface stream's `.use(...)` accessor this primitive reads —
 *  the pulse value plus its pending/error flags. */
export interface PulseAccessor {
  (): unknown;
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
  const [data] = createResource(
    () => {
      const i = input();
      if (!i) return null;
      // Touch the pulse so a new `{seq}` re-runs this source (→ re-fetch). The
      // fresh input object is never `===` the prior, so each pulse refetches.
      pulse();
      return i;
    },
    async (i: I) => {
      try {
        return await read(i);
      } catch (err) {
        opts?.onError?.(err as Error);
        throw err;
      }
    },
  );
  const accessor = (() => data()) as WatchedRead<O>;
  accessor.pending = () => data.loading || pulse.pending();
  accessor.error = () => (data.error as Error | undefined) ?? pulse.error();
  return accessor;
}
