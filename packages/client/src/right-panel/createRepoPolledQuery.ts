/**
 * `createRepoPolledQuery` — {@link createPolledQuery} specialised to a REPO-scoped
 * padi query. It bakes in the `padi` client, the `subscribeRepoChange` pulse, and
 * the `repoPath` pulse key, so a repo-scoped call site declares only its `input`
 * / `pulseName` / `query` / `onError`.
 *
 * This specialisation lives in its OWN module — NOT beside the general
 * `createPolledQuery` — because it imports the concrete `padi` singleton from
 * `../wire`, which drags the full client runtime (solid-js/web) into whatever
 * loads it. Keeping it here leaves `createPolledQuery.ts` free of any value
 * import from `wire`, so the general primitive stays client-agnostic and a unit
 * test can exercise it with a FAKE client without loading the whole app runtime.
 * Reach for the general `createPolledQuery` when the pulse is NOT the repo-change
 * one (e.g. `BrowseFileDispatcher`'s per-file `subscribeFileChange`).
 */

import { padiRpc } from "@kolu/padi/surface";
// NOTE: the `padi` in `pulse: (padi) => …` below is the ACTIVE binding's client
// passed by `createPolledQuery` — not the module-global wire proxy (removed here so
// the pulse can't accidentally pin the boot host).
import type { Subscription } from "@kolu/surface/solid";
import type { Accessor } from "solid-js";
import { createPolledQuery } from "./createPolledQuery";

export function createRepoPolledQuery<
  Input extends { repoPath: string },
  Result,
>(config: {
  /** The query input; `null` = idle (no pulse subscription, no query). */
  input: Accessor<Input | null>;
  /** Health-registry label for the pulse subscription. */
  pulseName: string;
  /** (Re)invoke the padi procedure on each repo-change pulse frame. */
  query: (input: Input, signal: AbortSignal) => Promise<Result>;
  /** Surface query (and pulse) failures — matches `.use(..., { onError })`. */
  onError?: (err: Error) => void;
}): Subscription<Result> {
  return createPolledQuery({
    ...config,
    pulse: (padi) => padiRpc(padi).surface.subscribeRepoChange.get,
    pulseInput: (i) => ({ repoPath: i.repoPath }),
  });
}
