export {
  createSubscription,
  type Subscription,
  type SubscriptionOptions,
} from "./createSubscription";
export {
  createReactiveSubscription,
  type ReactiveSubscriptionOptions,
} from "./createReactiveSubscription";
export {
  useCell,
  type Authority,
  type UnaryProcedure,
  type UseCellOptions,
  type UseCellResult,
} from "./useCell";
export {
  useCollection,
  type UseCollectionOptions,
  type UseCollectionResult,
} from "./useCollection";
export { useStream } from "./useStream";

// Client-side transport primitives — re-exported so consumers can import
// everything they need from `@kolu/cells/solid`. The pure-transport
// definitions live in `@kolu/cells/client` for non-Solid consumers.
export {
  type ClientRetryPluginContext,
  createCellsClient,
  STREAM_RETRY,
  streamCall,
  type StreamingProcedure,
} from "../client";
