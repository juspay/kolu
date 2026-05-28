// `streamCall` is the one-line escape hatch for raw streaming RPCs that
// don't fit a Cell/Collection/Stream descriptor (binary attaches,
// lifecycle events). Re-exported so consumers can pull it from the same
// `@kolu/surface/solid` import as the hooks. The full transport surface
// (incl. the underlying RPC client constructor) lives at
// `@kolu/surface/client` for non-Solid consumers; `surfaceClient` builds
// it internally so Solid consumers don't reach for it directly.
export { type StreamingProcedure, streamCall } from "../client";
export {
  createReactiveSubscription,
  type ReactiveSubscriptionOptions,
} from "./createReactiveSubscription";
export {
  createSubscription,
  type Subscription,
  type SubscriptionOptions,
} from "./createSubscription";
export {
  type BoundCell,
  type BoundCellOptions,
  type BoundCollection,
  type BoundEvent,
  type BoundStream,
  type SurfaceClient,
  surfaceClient,
} from "./surfaceClient";
export {
  type Authority,
  type UnaryProcedure,
  type UseCellOptions,
  type UseCellResult,
  useCell,
} from "./useCell";
export {
  type UseCollectionOptions,
  type UseCollectionResult,
  useCollection,
} from "./useCollection";
export { type UseEventOptions, useEvent } from "./useEvent";
export { useStream } from "./useStream";
