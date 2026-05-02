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
  surfaceClient,
  type BoundCell,
  type BoundCellOptions,
  type BoundCollection,
  type BoundEvent,
  type BoundStream,
  type SurfaceClient,
} from "./surfaceClient";

// `streamCall` is the one-line escape hatch for raw streaming RPCs that
// don't fit a Cell/Collection/Stream descriptor (binary attaches,
// lifecycle events). Re-exported so consumers can pull it from the same
// `@kolu/surface/solid` import as the hooks. The full transport surface
// (incl. the underlying RPC client constructor) lives at
// `@kolu/surface/client` for non-Solid consumers; `surfaceClient` builds
// it internally so Solid consumers don't reach for it directly.
export { streamCall, type StreamingProcedure } from "../client";
