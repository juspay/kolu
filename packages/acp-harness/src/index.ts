/**
 * @kolu/acp-harness — one host's orchestrator, as a subprocess that speaks ACP.
 *
 * THE ONE PACKAGE IN THIS TREE THAT RUNS THE PROTOCOL. `@kolu/acp` owns the
 * protocol's vocabulary and its pure projections and spawns nothing; padi owns
 * the cell, the stream and the store and speaks no ACP. This is the middle: it
 * starts an adapter, keeps one conversation with it, and publishes that
 * conversation in padi's own words
 * ({@link @kolu/padi-client/orchestrator}'s rows and state) through the one
 * callback a caller hands in.
 *
 * It imports nothing from `packages/padi`, `packages/server` or
 * `packages/client`, and the arrow points that way on purpose: padi calls this,
 * never the other way round.
 */

export {
  type Harness,
  type HarnessChange,
  type HarnessOptions,
  HarnessRefused,
  type HarnessState,
  HarnessUnavailable,
  type SignedIn,
  type StdioServer,
  startHarness,
} from "./harness.ts";
