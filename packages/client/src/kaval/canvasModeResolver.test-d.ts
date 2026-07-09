/**
 * TYPE-LEVEL pin — the Skew-UX CanvasFacts decision, plus A' (the live-bug fix):
 *  1. the kaval-derived facts are structurally reachable ONLY on the `connected` arm; and
 *  2. `connectPhase` (the connect-overlay's routing input) exists ONLY on the not-yet-
 *     connected arms (`warming` / `not-a-member`), NEVER on `connected`.
 *
 * `tsc` GREEN over this file ⇒:
 *  - the `connected` arm carries the kaval facts (`daemonState`/`down`/`terminalCount`/…)
 *    — constructing and reading them there compiles — but carries NO `connectPhase`
 *    (constructing one with it, or reading `.connectPhase` off it, is a compile error).
 *    So the "green chip + Building-forever" contradiction — a `connected` entry routed to
 *    the connect overlay — is UNCONSTRUCTIBLE at resolve, not a runtime tie broken by arm
 *    order.
 *  - the `warming` / `not-a-member` arms DO carry `connectPhase`; the `warming` and
 *    `failed` arms carry NONE of the kaval facts (the `@ts-expect-error`s below).
 *
 * House style mirrors `packages/common/src/entryFailedCause.test-d.ts`: bare
 * `const x: T = {...}; void x;` declarations plus inline `// @ts-expect-error`.
 */

import type { DaemonState } from "@kolu/padi/surface";
import type { CanvasFacts } from "./canvasModeResolver";

// Shared liveness facts every arm carries — spread into each literal below. `connectPhase`
// is NOT here anymore (A'): it belongs only to the not-yet-connected arms.
const liveness = {
  isLoading: false,
  daemonPending: false,
  pendingTimedOut: false,
  isLocalHost: true,
};

const daemonState: DaemonState = "connected";

// The `connected` arm DOES carry the kaval facts — this compiles.
const connected: CanvasFacts = {
  ...liveness,
  entry: "connected",
  down: undefined,
  warming: false,
  warmingLabel: "Connecting…",
  daemonState,
  terminalCount: 1,
  recordsAwaited: 0,
  channelLive: true,
};
void connected;
// …and reading a kaval fact off the connected arm is fine.
void (connected.entry === "connected" ? connected.daemonState : undefined);

// A' — the `connected` arm carries NO `connectPhase`: a "connected entry + connect overlay"
// (the green-chip / Building-forever trap) is a TYPE error, not a runtime tie.
const connectedWithPhase: CanvasFacts = {
  ...liveness,
  entry: "connected",
  down: undefined,
  warming: false,
  warmingLabel: "Connecting…",
  daemonState,
  terminalCount: 1,
  recordsAwaited: 0,
  channelLive: true,
  // @ts-expect-error — `connectPhase` does not exist on the connected arm (A'): the overlay
  // cannot be routed while the map reports the host connected.
  connectPhase: "building",
};
void connectedWithPhase;

// Reading `connectPhase` off a value typed as the CONNECTED arm is a type error too — so no
// resolver arm can consult a connect phase on a connected host.
const connectedArm: Extract<CanvasFacts, { entry: "connected" }> = {
  ...liveness,
  entry: "connected",
  down: undefined,
  warming: false,
  warmingLabel: "Connecting…",
  daemonState,
  terminalCount: 1,
  recordsAwaited: 0,
  channelLive: true,
};
// @ts-expect-error — `connectPhase` does not exist on the connected arm.
void connectedArm.connectPhase;

// The `warming` arm carries the label + `connectPhase` + liveness facts, NO kaval facts.
const warming: CanvasFacts = {
  ...liveness,
  entry: "warming",
  warmingLabel: "Connecting…",
  connectPhase: "building",
  // @ts-expect-error — `daemonState` is a CONNECTED-arm-only kaval fact; a warming
  // host's re-served daemonStatus is stale, so the type makes it unspellable here.
  daemonState,
};
void warming;
// The warming arm DOES carry `connectPhase` — reading it here compiles.
void (warming.entry === "warming" ? warming.connectPhase : undefined);

// `connectPhase` is the framework's `ConnectPhase` (the narrated subset), NOT bare `string`
// and NOT even the full phase union: an off-vocabulary phase is UNCONSTRUCTIBLE, so the
// resolver's "is a connect phase" is compiler-guaranteed, not a runtime-only guard.
const warmingBadPhase: CanvasFacts = {
  ...liveness,
  entry: "warming",
  warmingLabel: "Connecting…",
  // @ts-expect-error — `"banana"` is not a `ConnectPhase`, so it can't be a connectPhase.
  connectPhase: "banana",
};
void warmingBadPhase;

// TIGHTER than the full phase union: a terminal/connected phase is unconstructible here too —
// `connected`/`disconnected`/`failed` are NOT connect phases (`useCanvasMode` narrows them to
// `undefined`), so they can never be carried on a not-yet-connected arm.
const warmingConnectedPhase: CanvasFacts = {
  ...liveness,
  entry: "warming",
  warmingLabel: "Connecting…",
  // @ts-expect-error — `"connected"` is excluded from `ConnectPhase` (the narrated subset).
  connectPhase: "connected",
};
void warmingConnectedPhase;

// The `failed` arm carries the cause + reason, NO kaval facts, NO connectPhase.
const failed: CanvasFacts = {
  ...liveness,
  entry: "failed",
  cause: "contract-skew-refused",
  reason: "remote padi contract skew",
  // @ts-expect-error — `down` is a CONNECTED-arm-only kaval fact; a failed host
  // never connected, so there is no daemon to describe.
  down: "dead",
};
void failed;

// Reading a kaval fact off a value typed as the FAILED arm is a type error — the
// property does not exist on that arm, so this cannot silently read a stale fact.
const failedArm: Extract<CanvasFacts, { entry: "failed" }> = {
  ...liveness,
  entry: "failed",
  cause: "link-failed",
  reason: "host unreachable",
};
// @ts-expect-error — `daemonState` does not exist on the `failed` arm.
void failedArm.daemonState;

// Same for the WARMING arm — reading `terminalCount` off it is a type error.
const warmingArm: Extract<CanvasFacts, { entry: "warming" }> = {
  ...liveness,
  entry: "warming",
  warmingLabel: "Connecting…",
  connectPhase: undefined,
};
// @ts-expect-error — `terminalCount` does not exist on the `warming` arm.
void warmingArm.terminalCount;
