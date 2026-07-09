/** The pure canvas-surface precedence — type + total resolver, with NO reactive
 *  or wire imports, so the load-bearing arm order is unit-testable in isolation
 *  (see `canvasModeResolver.test.ts`). `useCanvasMode.ts` gathers the live
 *  daemon/session facts and delegates the decision here; keeping the decision in
 *  its own dependency-free module is what lets the test import it without
 *  mounting the `daemonStatus` subscription (which drags in `../wire`).
 *
 *  The facts are a DISCRIMINATED UNION keyed on the ACTIVE entry's connection
 *  state (`padiMap.entry(activeHost()).state().kind`), so the kaval-derived facts
 *  (`daemonState`/`down`/`warming`/`terminalCount`/`recordsAwaited`) are
 *  structurally reachable ONLY on the `connected` arm — a non-connected host's
 *  re-served `daemonStatus` is FROZEN stale, so consulting a kaval fact off it is
 *  a lie the type system now makes UNSPELLABLE (reading `.daemonState` on the
 *  `warming`/`failed`/`not-a-member` arm is a compile error; see
 *  `canvasModeResolver.test-d.ts`). {@link resolveCanvasMode} switches on the
 *  discriminant FIRST and touches a kaval fact only inside the `connected` arm.
 *
 *  The connected-arm sub-order is correctness, not cosmetics:
 *    - `down` beats `empty` so a dead/degraded kaval never masquerades as
 *      "you have no terminals" — the #1034 empty-canvas lie.
 *    - `warming` beats `empty` so a restart's `drain` (which empties the
 *      terminal list) shows the neutral warming surface, not EmptyState with
 *      its enabled Restore / new-terminal affordances — a fast click there
 *      would spawn/restore into the daemon the recycle is about to kill
 *      (terminal creation must wait for `connected`). */

import type { DaemonState } from "@kolu/padi/surface";
import type { EntryFailedCause } from "kolu-common/surfacesWithPadi";
import { isConnectPhase } from "./connectCanvasCopy";

/** Which canvas surface wins, with the payload each surface needs. Tagged so
 *  the down sub-state, the warming label, and the host-failure cause travel WITH
 *  the choice — the renderer reads no accessor a second time. `host-failed` is
 *  the Skew-UX addition: the ACTIVE host's map-membership entry itself failed
 *  (an ssh/contract-level fault, cause-typed), distinct from `down` (a CONNECTED
 *  host whose kaval daemon died). */
export type CanvasMode =
  | { kind: "connecting" }
  | { kind: "down"; state: "dead" | "degraded" }
  | { kind: "host-failed"; cause: EntryFailedCause; reason: string }
  | { kind: "warming"; label: string; daemonState: DaemonState | undefined }
  | { kind: "empty" }
  | { kind: "workspace" };

/** The liveness facts every arm carries, regardless of the active entry's
 *  connection state — the session-loading flag and the connect-ceiling facts the
 *  loading guard reads BEFORE it ever consults an entry arm. Kept as a shared
 *  base so each arm below adds only the facts its own surface needs. */
interface EntryLivenessFacts {
  isLoading: boolean;
  daemonPending: boolean;
  /** True once `daemonPending` has held for longer than the local endpoint's own
   *  connect timeout — i.e. the daemon-status stream has NEVER produced a first
   *  value and the wait has structurally run past the ceiling the padi session
   *  itself uses to decide a dial is wedged. Bounds the `connecting` guard below: a
   *  local padi endpoint that never comes up at boot (a spawn/adopt failure — the
   *  #1713 adopt-path sibling is one cause) would otherwise leave `daemonPending`
   *  true FOREVER (no value is ever published), and the canvas would spin at
   *  "Connecting…" with no way out. Always `false` while genuinely still within
   *  the window (the common, near-instant case) — computed by the wall-clock-aware
   *  caller; this module stays pure (see the header). */
  pendingTimedOut: boolean;
  /** True while the ACTIVE host is the unremovable LOCAL default. `pendingTimedOut`'s
   *  30s ceiling (`LOCAL_ENDPOINT_CONNECT_TIMEOUT_MS` in `useDaemonStatus.ts`) mirrors
   *  the LOCAL session's own connect watchdog — a local-stack fact. A REMOTE host's
   *  first connect legitimately takes longer (ssh dial + nix copy + build), so the SAME
   *  ceiling only earns a `down`/`dead` verdict for a local host or a PROVEN-`failed`
   *  entry — never a remote that is merely still provisioning. */
  isLocalHost: boolean;
  /** The ACTIVE host's OWN `connection` cell phase (`probing`/`copying`/`building`/
   *  `connecting`/`connected`/`disconnected`/`failed`), or `undefined` before its first
   *  frame. This is the SAME channel `ConnectCanvas` narrates off, so gating the
   *  connect-overlay decision on it (below) routes AND renders the overlay from ONE
   *  frame — no cross-channel skew with the coarse `EntryStatus` (`entry`), which two
   *  independent subscriptions could otherwise flush out of step. `EntryStatus` stays
   *  the authority for the chips + the connected/failed arms. */
  connectPhase: string | undefined;
}

/** The precedence decision's snapshot — a DISCRIMINATED UNION keyed on the active
 *  entry's connection state (`entry`). Only the `connected` arm carries the
 *  kaval-derived facts, so they cannot be read off a host whose re-served
 *  `daemonStatus` is stale (the whole point — see the module header). Separating
 *  this from the live accessors is what makes {@link resolveCanvasMode} a pure,
 *  exhaustively testable total function. */
export type CanvasFacts =
  | (EntryLivenessFacts & {
      /** The active entry is `warming` — the host binding itself is still coming up
       *  (a remote's ssh dial + nix copy + build), NOT the kaval daemon restarting
       *  (that is a CONNECTED-arm fact). */
      entry: "warming";
      warmingLabel: string;
    })
  | (EntryLivenessFacts & {
      /** The active entry `failed` — an ssh dial/handshake or contract-level fault
       *  the map reported, cause-typed. Carries NO kaval facts (the host never
       *  connected, so there is no daemon to describe). */
      entry: "failed";
      cause: EntryFailedCause;
      reason: string;
    })
  | (EntryLivenessFacts & {
      /** The active host is transiently not in the membership pool (mid-switch,
       *  before a re-add lands). No entry facts to read — hold `connecting`. */
      entry: "not-a-member";
    })
  | (EntryLivenessFacts & {
      /** The active entry is `connected` — the ONLY arm on which the kaval-derived
       *  facts below are trustworthy (a connected channel can still refresh them). */
      entry: "connected";
      down: "dead" | "degraded" | undefined;
      warming: boolean;
      warmingLabel: string;
      daemonState: DaemonState | undefined;
      terminalCount: number;
      /** How many listed terminals' composed records have NOT arrived yet (the
       *  `awaited` arm of the metadata census). Non-zero means the key list resolved
       *  but per-terminal metadata is still in flight — the reload window where
       *  `terminalCount` is transiently 0 because records haven't composed. Gating
       *  `empty` on this is what stops the restore card from flashing before a reload's
       *  live terminals appear; a genuine reboot arrives with records PARKED (awaited 0,
       *  count 0), so it falls through to `empty` as it should. */
      recordsAwaited: number;
      /** The FULL channel liveness of the daemonStatus stream — the ws transport AND
       *  the active entry's own connection. Floors the `empty` claim ("no terminals"),
       *  which a dead channel can't confirm, so a dead/half-open ws makes NO
       *  unconfirmable canvas claim (#1568 SHAPE A). */
      channelLive: boolean;
    });

/** The pure precedence partition — total over {@link CanvasFacts}, exclusive,
 *  order load-bearing (see the module header). No reactive reads, so the whole
 *  #1034 / restart-drain precedence is unit-testable without mounting the
 *  daemon-status subscription. */
export function resolveCanvasMode(facts: CanvasFacts): CanvasMode {
  // A `failed` entry is decided by the entry-state switch below, NEVER this loading
  // gate: the host BINDING itself failed (cause-typed), so no daemon-status is ever
  // coming (`daemonPending` stays true forever) and the correct surface is the
  // cause-typed host-down card — not a "Connecting…" spinner, and not the kaval-dead
  // `down` card. Fall straight through so `case "failed"` renders the Skew-UX card.
  // (This is why the guard excludes it: a `failed` host has no daemon-status to wait
  // for, so the loading gate would otherwise strand it at connecting/down forever.)
  //
  // For every OTHER entry: neutral "connecting" until BOTH the session cell AND the
  // daemon-status stream have produced their first value — reads only the liveness
  // facts every arm carries, so it runs BEFORE the entry-state switch below. Gating
  // on daemon-status-pending (not just the entry state) stops a `dead` boot from
  // flashing the normal empty workspace first (#1034). BOUNDED: once the wait has
  // run past the local endpoint's own connect timeout, "still pending" no longer
  // means "about to arrive" — nothing will ever be published (a local padi that
  // never came up), so resolve honestly to `down`/`dead` instead of spinning at
  // "Connecting…" forever (the #1713 adopt-path sibling's canvas symptom). The 30s
  // ceiling only earns that verdict for a LOCAL host (whose own connect watchdog it
  // mirrors) — never a remote merely still provisioning (`warming`), whose ssh dial +
  // nix copy + build can genuinely outlast 30s, and never a `failed` entry (above).
  // THE CONNECT OVERLAY, routed off ONE channel (W6 crossed-frames fix): the ACTIVE
  // host's binding is coming up iff its OWN `connection` cell phase is an
  // up-but-not-yet-connected phase (`probing`/`copying`/`building`/`connecting`) — the
  // SAME frame `ConnectCanvas` reads to narrate it, so routing and content can never
  // disagree mid-transition. This SUPERSEDES the old `EntryStatus === "warming"` gate
  // (which is a second, independently-flushed subscription): a warming remote provision
  // no longer waits on the loading gate (its daemon-status never yields until it
  // connects — the hang-indistinguishable mute "Connecting…"), and a local boot shows
  // the same honest surface. The one exception is the #1713 safety: a LOCAL endpoint
  // wedged past its own connect ceiling earns `down`/`dead` rather than spinning here
  // forever (a remote's ssh + nix copy + build legitimately outlasts that ceiling). A
  // `disconnected`/`failed` phase is NOT a connect phase → the host-down card (below)
  // owns it, never this overlay.
  const bindingUp =
    facts.connectPhase !== undefined &&
    facts.connectPhase !== "connected" &&
    isConnectPhase(facts.connectPhase) &&
    facts.entry !== "failed";
  if (bindingUp) {
    return facts.pendingTimedOut && facts.isLocalHost
      ? { kind: "down", state: "dead" }
      : // `label` is vestigial on the binding-up path — `ConnectCanvas` narrates off
        // the connection cell (daemonState `undefined`), ignoring it — so a neutral
        // constant, not the kaval `warmingLabel` (which isn't on every facts arm and
        // means "Restarting kaval…", a CONNECTED-host concern).
        { kind: "warming", label: "Connecting…", daemonState: undefined };
  }

  // The residual boot gate — for the pre-first-frame window (`connectPhase` still
  // `undefined`) and any non-binding-up state that isn't `failed`: neutral "Connecting…"
  // until both the session cell AND the daemon-status stream have produced a value,
  // bounded by the local connect ceiling (#1034 / #1713, as before).
  if ((facts.isLoading || facts.daemonPending) && facts.entry !== "failed") {
    return facts.pendingTimedOut && facts.isLocalHost
      ? { kind: "down", state: "dead" }
      : { kind: "connecting" };
  }
  // Past the loading guard, the ACTIVE entry's connection state decides the surface.
  // A non-connected host's re-served daemonStatus is FROZEN stale, so its arms never
  // touch a kaval fact (they don't carry one) — only the `connected` arm consults the
  // daemon-derived facts.
  switch (facts.entry) {
    case "warming":
      // The host binding is still coming up. Show the neutral warming surface with no
      // kaval `daemonState` — there is no connected daemon to describe yet.
      return {
        kind: "warming",
        label: facts.warmingLabel,
        daemonState: undefined,
      };
    case "failed":
      // The host binding itself failed (cause-typed). Its own surface — the Skew-UX
      // host-down card ([Switch to local], no retry) — is distinct from `down` (a
      // connected host's dead kaval).
      return { kind: "host-failed", cause: facts.cause, reason: facts.reason };
    case "not-a-member":
      // Transiently outside the pool (mid host-switch). Neutral connecting surface —
      // never a stale claim about a host that is not currently a member.
      return { kind: "connecting" };
    case "connected": {
      // `down` and `warming` arrive ALREADY floored on channel liveness at their source
      // accessors (`downState`/`daemonWarming`), so a stale daemon state never reaches
      // these arms over a dead channel.
      if (facts.down) return { kind: "down", state: facts.down };
      if (facts.warming)
        return {
          kind: "warming",
          label: facts.warmingLabel,
          daemonState: facts.daemonState,
        };
      // Terminals on screen → show them. Otherwise "no terminals" is the remaining
      // daemon-derived claim, and it too is unconfirmable over a dead channel: show
      // `empty` only when the CHANNEL is LIVE (ws ∧ the active entry — it can confirm the
      // set really is empty), else the neutral connecting surface. The post-grace
      // TransportOverlay owns the disconnect messaging.
      if (facts.terminalCount > 0) return { kind: "workspace" };
      // Records still arriving after the key list resolved → a reload's live terminals
      // are mid-compose, so `terminalCount === 0` is a NOT-YET-settled claim, not "no
      // terminals". Hold `connecting` instead of flashing `empty`'s restore card. A
      // genuine reboot's records arrive PARKED (awaited hits 0 with no live tile), so
      // this falls through to `empty` and the restore card, exactly as intended.
      if (facts.recordsAwaited > 0) return { kind: "connecting" };
      return facts.channelLive ? { kind: "empty" } : { kind: "connecting" };
    }
  }
}
