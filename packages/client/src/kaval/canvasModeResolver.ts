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
import type {
  ConnectPhase,
  EntryFailedCause,
} from "kolu-common/surfacesWithPadi";
import type { DaemonDownState } from "./daemonPresentation";

/** Which canvas surface wins, with the payload each surface needs. Tagged so
 *  the down sub-state, the warming label, and the host-failure cause travel WITH
 *  the choice — the renderer reads no accessor a second time. `host-failed` is
 *  the Skew-UX addition: the ACTIVE host's map-membership entry itself failed
 *  (an ssh/contract-level fault, cause-typed), distinct from `down` (a CONNECTED
 *  host whose kaval daemon died). */
export type CanvasMode =
  | { kind: "connecting" }
  // `down` carries the payload-bearing verdict (SK4): dead/degraded render the
  // restartable DegradedCanvas; `incompatible` renders the skew card with both
  // versions and the renew action — the affordance is a total function of it.
  | { kind: "down"; down: DaemonDownState }
  | { kind: "host-failed"; cause: EntryFailedCause; reason: string }
  // NO presentation string: the warming surface's copy is derived at RENDER (ConnectCanvas —
  // the connection-cell phase via the ONE copy authority, or the kaval-restart label from the
  // daemon-presentation table keyed on `daemonState`). With no string field on any mode arm, a
  // resolver baking copy is a TYPE error — the four-duplicate-literal flicker is unspellable.
  | { kind: "warming"; daemonState: DaemonState | undefined }
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
}

/** The facts the two NOT-YET-CONNECTED arms (`warming` / `not-a-member`) share — the connect
 *  overlay's routing input, declared ONCE here rather than on each arm. `connectPhase` lives
 *  ONLY on these arms (never on `connected`/`failed`), so a stale/lagging connection cell can
 *  never route the overlay over a host the map reports connected (A'). Typed as the framework's
 *  {@link ConnectPhase} — the narrated up-but-not-yet-connected subset — which is TIGHTER than
 *  the full phase union: `connected`/`disconnected`/`failed` are UNCONSTRUCTIBLE here (not just
 *  an off-vocabulary `"banana"`), so `useCanvasMode` narrows those source phases to `undefined`
 *  at the facts boundary and the resolver's "is a connect phase" collapses to "is defined" — no
 *  runtime guard. `undefined` before the cell's first frame (or once C' floors a stale cell). */
type NotYetConnectedFacts = EntryLivenessFacts & {
  connectPhase: ConnectPhase | undefined;
};

/** The precedence decision's snapshot — a DISCRIMINATED UNION keyed on the active
 *  entry's connection state (`entry`). Only the `connected` arm carries the
 *  kaval-derived facts, so they cannot be read off a host whose re-served
 *  `daemonStatus` is stale (the whole point — see the module header). Separating
 *  this from the live accessors is what makes {@link resolveCanvasMode} a pure,
 *  exhaustively testable total function. */
export type CanvasFacts =
  | (NotYetConnectedFacts & {
      /** The active entry is `warming` — the host binding itself is still coming up
       *  (a remote's ssh dial + nix copy + build), NOT the kaval daemon restarting
       *  (that is a CONNECTED-arm fact). Carries `connectPhase` via {@link NotYetConnectedFacts}. */
      entry: "warming";
    })
  | (EntryLivenessFacts & {
      /** The active entry `failed` — an ssh dial/handshake or contract-level fault
       *  the map reported, cause-typed. Carries NO kaval facts (the host never
       *  connected, so there is no daemon to describe). */
      entry: "failed";
      cause: EntryFailedCause;
      reason: string;
    })
  | (NotYetConnectedFacts & {
      /** The active host is transiently not in the membership pool (mid-switch,
       *  before a re-add lands). No entry facts to read — hold `connecting`. Carries
       *  `connectPhase` via {@link NotYetConnectedFacts}. */
      entry: "not-a-member";
    })
  | (EntryLivenessFacts & {
      /** The active entry is `connected` — the ONLY arm on which the kaval-derived
       *  facts below are trustworthy (a connected channel can still refresh them). */
      entry: "connected";
      down: DaemonDownState | undefined;
      warming: boolean;
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
  // Switch on the ACTIVE entry's connection state FIRST (A' — the resolver's spine). The
  // connect overlay is read ONLY inside the not-yet-connected arms, where `connectPhase`
  // exists; the `connected` arm has no `connectPhase`, so it can NEVER route to the overlay
  // — a stale/lagging connection cell can no longer trap the canvas over a host the map
  // reports connected (the green-chip / "Building forever" bug). `failed` has no
  // daemon-status ever coming, so it renders its own cause-typed card, never the loading
  // spinner or the kaval-dead `down` card.
  switch (facts.entry) {
    case "failed":
      // The host BINDING itself failed (cause-typed) — the Skew-UX host-down card
      // ([Switch to local], no retry), distinct from `down` (a connected host's dead kaval).
      return { kind: "host-failed", cause: facts.cause, reason: facts.reason };

    case "warming":
    case "not-a-member": {
      // THE CONNECT OVERLAY (W6), routed off ONE channel: the ACTIVE host's binding is
      // coming up iff its OWN `connection` cell phase is an up-but-not-yet-connected phase —
      // the SAME frame `ConnectCanvas` reads to narrate it, so routing and content never
      // disagree mid-transition. `connectPhase` is typed `ConnectPhase` (the framework's
      // narrated subset), so a `connected`/`disconnected`/`failed` phase is UNCONSTRUCTIBLE
      // here — `useCanvasMode` narrows those to `undefined` at the facts boundary. So "is a
      // connect phase" IS simply "defined", no runtime re-check. The #1713 safety: a LOCAL
      // endpoint wedged past its own connect ceiling earns `down`/`dead` rather than narrating
      // forever (a remote's ssh + nix copy + build legitimately outlasts that ceiling).
      const bindingUp = facts.connectPhase !== undefined;
      if (bindingUp) {
        return facts.pendingTimedOut && facts.isLocalHost
          ? { kind: "down", down: { state: "dead" } }
          : // No copy baked here — `ConnectCanvas` narrates off the connection cell (its
            // phase → the ONE copy authority), so the mode carries only `daemonState`.
            { kind: "warming", daemonState: undefined };
      }
      // The residual boot gate — pre-first-frame (`connectPhase` still `undefined`) or a
      // non-binding-up phase: neutral "Connecting…" until both the session cell AND the
      // daemon-status stream have produced a value, bounded by the local connect ceiling
      // (#1034 / #1713). Gating on daemon-status-pending stops a `dead` boot flashing the
      // empty workspace first.
      if (facts.isLoading || facts.daemonPending) {
        return facts.pendingTimedOut && facts.isLocalHost
          ? { kind: "down", down: { state: "dead" } }
          : { kind: "connecting" };
      }
      // The entry-specific surface for a still-pre-connected host. `warming` shows the
      // neutral warming surface (no kaval `daemonState` — no connected daemon to describe
      // yet); `not-a-member` holds neutral `connecting` (never a stale claim about a
      // non-member).
      return facts.entry === "warming"
        ? { kind: "warming", daemonState: undefined }
        : { kind: "connecting" };
    }

    case "connected": {
      // A connected entry ALWAYS reaches its workspace/down/empty surface — there is no
      // `connectPhase` on this arm, so no connect overlay can intercept it. The loading gate
      // still covers a connected entry whose daemon-status stream has not produced its first
      // value (#1034), bounded by the local connect ceiling (#1713).
      if (facts.isLoading || facts.daemonPending) {
        return facts.pendingTimedOut && facts.isLocalHost
          ? { kind: "down", down: { state: "dead" } }
          : { kind: "connecting" };
      }
      // `down` and `warming` arrive ALREADY floored on channel liveness at their source
      // accessors (`downState`/`daemonWarming`), so a stale daemon state never reaches these
      // arms over a dead channel.
      if (facts.down) return { kind: "down", down: facts.down };
      if (facts.warming)
        return { kind: "warming", daemonState: facts.daemonState };
      // Terminals on screen → show them. Otherwise "no terminals" is unconfirmable over a
      // dead channel: show `empty` only when the CHANNEL is LIVE, else neutral connecting.
      if (facts.terminalCount > 0) return { kind: "workspace" };
      // Records still arriving after the key list resolved → hold `connecting` instead of
      // flashing `empty`'s restore card. A genuine reboot's records arrive PARKED (awaited
      // hits 0 with no live tile), so this falls through to `empty` as intended.
      if (facts.recordsAwaited > 0) return { kind: "connecting" };
      return facts.channelLive ? { kind: "empty" } : { kind: "connecting" };
    }
  }
}
