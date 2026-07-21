/**
 * Test helper: suppress every `fs.watch` EDGE so the `statSync` poll floor is
 * exercised in isolation (juspay/kolu#1754). Shared by the kolu-io primitive
 * test and every consumer-watcher test (grok / claude / WAL), which otherwise
 * each hand-rolled the identical no-op FSWatcher stub.
 */

import fs from "node:fs";

/**
 * Replace `fs.watch` with a no-op FSWatcher (the OS never delivers an edge —
 * modeling the dropped/coalesced notification that is #1754), leaving the real
 * `statSync` poll floor as the only recovery path. Returns a restore function;
 * call it in `afterEach`.
 */
export function suppressFsWatchEdges(): () => void {
  const realWatch = fs.watch;
  fs.watch = (() => ({
    close: () => {},
    on() {
      return this;
    },
    ref() {
      return this;
    },
    unref() {
      return this;
    },
  })) as unknown as typeof fs.watch;
  return () => {
    fs.watch = realWatch;
  };
}
