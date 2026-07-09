/**
 * TYPE-LEVEL pin — the Skew-UX CanvasFacts decision: the kaval-derived facts are
 * structurally reachable ONLY on the `connected` arm of {@link CanvasFacts}.
 *
 * `tsc` GREEN over this file ⇒:
 *  - the `connected` arm carries the kaval facts (`daemonState`/`down`/
 *    `terminalCount`/…) — constructing and reading them there compiles.
 *  - the `warming` and `failed` arms carry NONE of them — constructing one is an
 *    excess-property error, and reading one off a non-`connected`-typed value is a
 *    "property does not exist" error (the `@ts-expect-error`s below). If any of
 *    those lines ever compiles, the discriminated union has regressed to a flat
 *    shape and a stale daemon fact could again be read off a host whose re-served
 *    `daemonStatus` is frozen.
 *
 * House style mirrors `packages/common/src/entryFailedCause.test-d.ts`: bare
 * `const x: T = {...}; void x;` declarations plus inline `// @ts-expect-error`.
 */

import type { DaemonState } from "@kolu/padi/surface";
import type { CanvasFacts } from "./canvasModeResolver";

// Shared liveness facts every arm carries — spread into each literal below.
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

// The `warming` arm carries the label + liveness facts, NO kaval facts.
const warming: CanvasFacts = {
  ...liveness,
  entry: "warming",
  warmingLabel: "Connecting…",
  // @ts-expect-error — `daemonState` is a CONNECTED-arm-only kaval fact; a warming
  // host's re-served daemonStatus is stale, so the type makes it unspellable here.
  daemonState,
};
void warming;

// The `failed` arm carries the cause + reason, NO kaval facts.
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
};
// @ts-expect-error — `terminalCount` does not exist on the `warming` arm.
void warmingArm.terminalCount;
