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
