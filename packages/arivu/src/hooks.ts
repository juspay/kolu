/**
 * `arivu`'s `AwarenessSink` — the one seam that differs from kolu-server's
 * local endpoint. Where kolu-server mutates its co-owned `terminalMetadata`
 * entry (splitting persisted vs live across its autosave fence), `arivu` owns
 * the *whole* `AwarenessValue` and simply publishes each updated record into
 * the served `awareness` collection. There is no fold here and none locally,
 * ever — the merge + persisted/live split is a kolu-side, remote-only concern
 * (P2). The daemon owns one undivided value per terminal.
 *
 * The load-bearing rule from `@kolu/terminal-workspace`'s `AwarenessSink`
 * docstring: mutate `record.meta` **synchronously** before publishing — the
 * sensors read `record.meta` back as their own prior state (the agent-command
 * dedup, the publish-if-changed gate, the recency bump). A sink that published
 * to the collection WITHOUT mutating the record would type-check and then
 * silently defeat every one of those gates. So both writers apply `mutate` to
 * the captured record first, then publish the result.
 */

import type {
  AwarenessRecord,
  AwarenessSink,
  AwarenessValue,
} from "@kolu/terminal-workspace";

export interface AwarenessSinkDeps {
  /** The per-terminal record the sensors mutate and read back. Captured here,
   *  so the `record` argument each method also receives (for hosts whose write
   *  function isn't keyed by terminal) is ignored — `arivu` is per-terminal. */
  record: AwarenessRecord;
  /** Publish the record's current value into the served collection. The daemon
   *  binds this to `ctx.collections.awareness.upsert(id, …)`. */
  publish: (meta: AwarenessValue) => void;
  /** Read the terminal's rendered screen tail — kaval's `getScreenText`. Drives
   *  the agents' screen-scrape promotion (Claude's awaiting-user prompt). */
  readScreenText: (tailLines?: number) => Promise<string>;
}

/** Build the daemon's per-terminal sink. */
export function makeAwarenessSink(deps: AwarenessSinkDeps): AwarenessSink {
  const { record, publish, readScreenText } = deps;
  return {
    updateServerMetadata: (_record, mutate) => {
      mutate(record.meta);
      publish(record.meta);
    },
    updateServerLiveMetadata: (_record, mutate) => {
      mutate(record.meta);
      publish(record.meta);
    },
    readScreenText,
  };
}
