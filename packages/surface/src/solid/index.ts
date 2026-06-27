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
// The grace-windowed boolean view — delays a predicate's rising edge, instant on
// the fall. `@kolu/surface-app`'s `SurfaceAppProvider` derives its "show the
// Disconnected overlay" signal from the transport's instantaneous `down` status
// through this, so a sub-second forced reconnect never flashes the alarm.
export { gracedDown } from "./gracedDown";
// `createSurfaceHealthRegistry` is deliberately NOT re-exported: it takes an
// UNBRANDED `live: Accessor<boolean>` and folds it straight into `health().live`,
// so exposing it would let a consumer mint `createSurfaceHealthRegistry(() => true)`
// and paint a green/ready dot over a dead transport (the #1564 lie, reachable with
// no socket and no watchdog) — exactly why its twin `buildSurfaceClient` (also a
// raw-`live` seam) is package-private. The honest producers `surfaceClient` /
// `surfaceClients`, which derive `live` from a branded `LiveSignalHandle`, are the
// only public way to a health fact with a transport leg (pinned in `barrel.test.ts`).
export {
  type GateStatus,
  gateStatus,
  type HealthSource,
  mergeSurfaceHealth,
  type SubHealth,
  type SurfaceHealth,
  type SurfaceHealthRegistry,
} from "./health";
// `createLiveSignal` is the SINGLE, unforgeable minter of a `LiveSignalHandle` (the
// watchdog-backed transport-liveness unit `surfaceClient` requires over a websocket).
// It lives here — not in `@kolu/surface-app` — so the brand set and its sole minter
// share one module; the handle is branded at mint and there is no exported stamper.
// `@kolu/surface-app`'s connect seams re-export `createLiveSignal`.
export {
  type CreateLiveSignalOptions,
  createLiveSignal,
  type HeartbeatTuning,
  isLiveSignalHandle,
  type LiveSignal,
  type LiveSignalHandle,
  type SurfaceConnectionStatus,
  type WatchableSocket,
} from "./liveSignal";
// The browser wake-event seam (window focus / tab visible → an immediate heartbeat
// re-probe). Exported so `@kolu/surface-app`'s `createServerLifecycle` wires the
// same fast resume path over its own watchdog; a no-op off-DOM.
export { onWake } from "./onWake";
// Re-exported so `@kolu/surface-app` (which has no direct `@orpc` dependency) can
// constrain its own generics (`connectSurfaces<C extends AnyContractRouter>`) over
// the combined contract without reaching into `@orpc/contract` itself.
export type { AnyContractRouter } from "@orpc/contract";
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
