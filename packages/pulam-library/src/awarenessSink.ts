/**
 * The library's per-terminal `AwarenessSink` — mutate the captured record, then
 * publish the whole `AwarenessValue` into the served `awareness` collection.
 *
 * This is the sink `createPulam` wires for each terminal: the home injects the
 * write target (`publish`) and the screen reader (`readScreenText`), and this
 * builds the {@link AwarenessSink} the sensors drive. It owns the *whole*
 * undivided value — no persisted/live fold (that fold is a kolu-side, remote-only
 * concern; the local in-process path never reseeds, so it never needs it).
 *
 * The load-bearing rule from {@link AwarenessSink}'s docstring: mutate
 * `record.meta` **synchronously** before publishing — the sensors read
 * `record.meta` back as their own prior state (the agent-command dedup, the
 * publish-if-changed gate, the recency bump). A sink that published to the
 * collection WITHOUT mutating the record would type-check and then silently
 * defeat every one of those gates. So both writers apply `mutate` to the captured
 * record first, then publish the result.
 */

import type { AwarenessValue } from "./schema.ts";
import type { AwarenessRecord, AwarenessSink } from "./sensors.ts";

export interface AwarenessSinkDeps {
  /** The per-terminal record the sensors mutate and read back. Captured here,
   *  so the `record` argument each method also receives (for hosts whose write
   *  function isn't keyed by terminal) is ignored — this sink is per-terminal. */
  record: AwarenessRecord;
  /** Publish the record's current value into the served collection. `createPulam`
   *  binds this to `ctx.collections.awareness.upsert(id, …)`. */
  publish: (meta: AwarenessValue) => void;
  /** Read the terminal's rendered screen tail — kaval's `getScreenText`. Drives
   *  the agents' screen-scrape promotion (Claude's awaiting-user prompt). */
  readScreenText: (tailLines: number) => Promise<string>;
}

/** Build the per-terminal sink: apply each mutation to the captured record, then
 *  publish the whole value. */
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
