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
export { useEvent, type UseEventOptions } from "./useEvent";
export {
  matrixClient,
  type BoundCell,
  type BoundCellOptions,
  type BoundCollection,
  type BoundEvent,
  type BoundStream,
  type MatrixClientBundle,
} from "./matrixClient";

// Client-side transport primitives — re-exported so consumers can import
// everything they need from `@kolu/cells/solid`. The pure-transport
// definitions live in `@kolu/cells/client` for non-Solid consumers.
// `STREAM_RETRY` and `ClientRetryPluginContext` are internal — hooks
// thread the context, consumers never see it.
export {
  createCellsClient,
  streamCall,
  type StreamingProcedure,
} from "../client";
