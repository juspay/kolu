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

// The client-side member ref shapes, re-exported so a consumer types a carve-out
// stream ref (`.unenrolled`) or a bound procedure without importing the transport
// tier. There is no contract type to re-export any more: the seam between face and
// link is the erased `SurfaceDispatch`, and per-member precision lives in the
// spec-derived bound faces below (D2/#16).
export type {
  StreamingProcedure,
  SurfaceFace,
  UnaryEffect,
} from "../client";
// The keyed-root swap atom: run a factory under a root disposed + rebuilt on a key
// change (the switch-abort ordering). Pure solid-generic; `@kolu/surface-map`'s
// `useEntry` builds on it.
export { createKeyedRoot } from "./createKeyedRoot";
export {
  createReactiveSubscription,
  type ReactiveSubscriptionOptions,
} from "./createReactiveSubscription";
export {
  type CellChange,
  createSubscription,
  type Dispose,
  type Subscription,
  type SubscriptionOptions,
  // The three lifecycle signals a stream-backed view carries, apart from its value
  // — what `useCollectionDeltas`'s `.stream` hands the un-enrolled reach.
  type SubscriptionState,
  wireSubscriptionError,
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
// no socket and no watchdog). Its twin `buildSurfaceClient` (also a raw-`live` seam)
// IS exposed below — but only for FRAMEWORK COMPOSITION over a transport RESOLVED
// through the half-open guard (`resolveTransport`); the registry minter has no such
// composition need and no guard, so it stays private. The honest producers
// `surfaceClient` / `surfaceClients` derive `live` from a branded `LiveSignalHandle`
// and remain the way an APP obtains a health fact with a transport leg (barrel.test.ts
// pins the registry minter's absence).
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
} from "./liveSignal";
// The READOUT — the transport's four states folded WITH the health fact into the
// five an indicator may report, so `live` is a claim about what reaches the page
// rather than about a socket. The connect seams (`@kolu/surface-app`) hand back
// `createSurfaceReadout`'s memoized accessor INSTEAD of a transport-only `status`;
// a consumer that assembles its own wire (a hand-built `createLiveSignal` +
// `surfaceClient`) folds the same two facts through the same function here.
export {
  createSurfaceReadout,
  type DegradedReadout,
  type SurfaceReadout,
  surfaceReadout,
  type SurfaceReadoutHandle,
  type SurfaceReadoutStatus,
  type TransportReadout,
} from "./readout";
// The browser wake-event seam (window focus / tab visible → an immediate heartbeat
// re-probe). Exported so `@kolu/surface-app`'s `createServerLifecycle` wires the
// same fast resume path over its own watchdog; a no-op off-DOM.
export { onWake } from "./onWake";
// NOTE: `SurfaceGate` (a JSX `.tsx` component) is intentionally NOT re-exported
// here. This barrel must stay free of JSX so a consumer that imports
// `@kolu/surface/solid` for the hooks/registry (e.g. `@kolu/surface-app`, drishti)
// doesn't have to solid-transform a `.tsx` it never uses — re-exporting one drags
// it into every importer's bundle analysis and breaks builds without the Solid
// JSX transform on `node_modules/@kolu/surface`. Import the gate from its own
// entry point instead: `import { SurfaceGate } from "@kolu/surface/solid/SurfaceGate"`.
// `buildSurfaceClient` + `resolveTransport` are exposed for FRAMEWORK COMPOSITION —
// a builder serving many clients over ONE resolved transport (`@kolu/surface-map`'s
// per-key clients thread the app's resolved `live` into each). `resolveTransport`
// applies the half-open guard; `buildSurfaceClient` takes the already-resolved
// `link`+`live`. See `buildSurfaceClient`'s docstring for the pairing guarantee.
export {
  type BoundCell,
  type BoundCellOptions,
  type BoundCollection,
  type BoundCollectionMutations,
  type BoundCollectionResult,
  type CollectionUse,
  type DeltasCollectionUse,
  type BoundDeltasCollection,
  type BoundDeltasCollectionResult,
  type BoundEvent,
  type BoundStream,
  buildSurfaceClient,
  // The bound procedure — `client.procedures.<ns>.<verb>` — an `Effect` a consumer
  // COMPOSES (a deadline, a race, a supersede, a Ctrl-C) rather than awaits. The
  // declared error union rides its channel, so the narrowing verbs an awaited
  // rejection used to need (`isDefinedError` / `safe`) are `Effect.catchTag` now.
  type EffectProcedure,
  type ProcedureEffect,
  type OnClientError,
  type ReadOnlyBoundCollection,
  type ReadOnlyBoundCollectionResult,
  type ReadOnlyBoundDeltasCollection,
  type ReadOnlyBoundDeltasCollectionResult,
  resolveTransport,
  type SurfaceClient,
  type SurfaceClients,
  surfaceClient,
  surfaceClients,
  surfaceClientsHealth,
} from "./surfaceClient";
export {
  type Authority,
  type UseCellLocalResult,
  type UseCellOptions,
  type UseCellResult,
  useCell,
} from "./useCell";
// `useCollectionDeltas` is public alongside `useCollection` because the
// deliberately UN-ENROLLED reach needs it. `.use()` is the default and enrols the
// batched stream into `client.health()`; the #1591 carve-out — a whole-collection
// view whose re-subscribe must not flicker the health gate — takes
// `.unenrolledDeltas` instead, and then has to fold the raw frames itself. Without
// this export that consumer had no way to reach the framework's own store and
// hand-rolled a copying one beside it, which is the shape this hook exists to
// retire. The hook takes a caller-provided `source`, so exporting it serves the
// carve-out without touching the health story.
export {
  type CollectionFold,
  type CollectionFoldOptions,
  type UseCollectionOptions,
  type UseCollectionDeltasResult,
  type UseCollectionResult,
  useCollection,
  useCollectionDeltas,
} from "./useCollection";
export { type UseEventOptions, useEvent } from "./useEvent";
export { useStream } from "./useStream";
// The reconcile-or-assign write into a wrapped `{ v }` store — shared by
// `createSubscription`/`createReactiveSubscription` internally and by
// non-framework callers that stitch server data into the same wrapped-store
// shape (e.g. `@kolu/client`'s `createPolledQuery`).
export { writeWrappedValue } from "./writeValue";
// The ONE Effect→Solid run edge (PLAN D10/#25). Exported so a consumer that drives
// a raw stream OUTSIDE a `Subscription` — kolu's terminal attach, which owns its own
// in-pane reset/retry UX — inherits the same scoped-fiber teardown and the same
// "a disposed subscription reports nothing" rule instead of hand-rolling a second
// `Effect.runFork` edge with its own interruption bugs.
export {
  runStreamScoped,
  type StreamRunHandlers,
  toError,
} from "../runStream";
