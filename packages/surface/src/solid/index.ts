// Raw streaming RPCs that don't fit a Cell/Collection/Stream descriptor (a bulk
// snapshot feed, a binary attach) join the health FACT through `client.rawStream`
// (`./surfaceClient`) — the STRUCTURAL path that enrols them and THROWS if driven
// outside a reactive owner. The bare `unenrolledStreamCall` primitive is
// intentionally NOT re-exported from this Solid barrel: a surface-scoped raw
// stream must go through `client.rawStream` so it can't silently escape `health()`
// (the Leak A bug class), and a stream that is NOT a surface subscription (a root
// RPC — e.g. the terminal attach, with its own in-pane reset/retry UX) reaches for
// the low-level `unenrolledStreamCall` at `@kolu/surface/client` *deliberately* —
// its `unenrolled-` name is itself the "I own this stream's health myself" signal,
// so a hand-enrol can never read as a forgotten one. The full transport surface
// lives at `@kolu/surface/client` for non-Solid consumers.
export type { StreamingProcedure } from "../client";
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
