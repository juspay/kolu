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
  createSurfaceHealthRegistry,
  type HealthSource,
  mergeSurfaceHealth,
  type SubHealth,
  type SurfaceHealth,
  type SurfaceHealthRegistry,
} from "./health";
// NOTE: `SurfaceGate` (a JSX `.tsx` component) is intentionally NOT re-exported
// here. This barrel must stay free of JSX so a consumer that imports
// `@kolu/surface/solid` for the hooks/registry (e.g. `@kolu/surface-app`, drishti)
// doesn't have to solid-transform a `.tsx` it never uses — re-exporting one drags
// it into every importer's bundle analysis and breaks builds without the Solid
// JSX transform on `node_modules/@kolu/surface`. Import the gate from its own
// entry point instead: `import { SurfaceGate } from "@kolu/surface/solid/SurfaceGate"`.
export {
  type BoundCell,
  type BoundCellOptions,
  type BoundCollection,
  type BoundEvent,
  type BoundStream,
  type SurfaceClient,
  type SurfaceClients,
  surfaceClient,
  surfaceClients,
  surfaceClientsHealth,
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
