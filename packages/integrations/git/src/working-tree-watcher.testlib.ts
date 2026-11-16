import type { Logger } from "kolu-shared";
import { watchWorkingTree } from "./working-tree-watcher.ts";

/** Subscribe and resolve once the watcher is genuinely installed. The install
 *  is async (git's working-tree probe and ignore enumeration, then the parcel
 *  subscribe) and fires one post-install reconciliation tick when it lands —
 *  that tick IS the ready signal, so this waits on the real handle rather than
 *  a sleep. */
export async function subscribeInstalled(
  repo: string,
  onChange: () => void,
  log?: Logger,
): Promise<() => void> {
  const { promise: ready, resolve: installed } = Promise.withResolvers<void>();
  let seenReconcile = false;
  const off = watchWorkingTree(
    repo,
    "test",
    () => {
      if (!seenReconcile) {
        seenReconcile = true;
        installed();
        return;
      }
      onChange();
    },
    log,
  );
  await ready;
  return off;
}

export const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Poll `cond` until it holds or `ms` elapses; answers whether it held. */
export async function waitFor(
  cond: () => boolean,
  ms = 5000,
): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 50) {
    if (cond()) return true;
    await sleep(50);
  }
  return cond();
}

/** Wait until `count` has stopped moving for a quiet window longer than any
 *  debounce in the chain, so the next pulse is caused by what the caller does
 *  next, not by a reconcile tick still in flight. */
export async function quiesce(count: () => number): Promise<void> {
  for (let seen = -1; seen !== count(); ) {
    seen = count();
    await sleep(500);
  }
}
