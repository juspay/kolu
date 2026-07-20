/** The pure canvas-surface precedence — types + the total resolver, with NO reactive
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
 *  `canvasModeResolver.test-d.ts`). The internal {@link resolvePrecedence} switches on
 *  the discriminant FIRST and touches a kaval fact only inside the `connected` arm.
 *
 *  ── The boot-deadline seam (#1763) ───────────────────────────────────────────
 *  The connect overlay ("Connecting to <host>…") used to have exactly ONE timeout
 *  escape, fed by ONLY the daemon leg (`pendingTimedOut`), so a hung MEMBERSHIP or
 *  SESSION leg span the overlay forever with no way out. The module's ONE exported
 *  function is now {@link resolveCanvasMode}`(facts, { exceeded })`: it computes the raw
 *  precedence, then — if the boot deadline is exceeded AND the raw surface is a BOOT
 *  overlay (`tag.accrual === "accrue"`, declared at each return site, never guessed from `kind`) —
 *  escapes to an honest surface that names the stalled leg. `resolvePrecedence` is
 *  INTERNAL, so a caller can never render a mode that skipped the deadline. The caller
 *  (`useCanvasMode` + `bootDeadline.ts`) owns the per-host episode anchor and the
 *  phase-aware ceiling that decide `exceeded`; this module stays pure.
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

/** Which per-host episode ceiling a boot overlay accrues against (#1763). Every
 *  class is FINITE — an unbounded cell would recreate the no-escape bug the ceiling
 *  exists to kill (a link-live frozen `building` would never escape). The concrete
 *  millisecond values live beside the anchor in `bootDeadline.ts`. */
export type CeilingClass = "local" | "remote-provisioning" | "remote-handshake";

/** Which boot leg is still unsettled when the deadline fires — carried on the escape
 *  surface so the failure card can NAME what never arrived (not a mute spinner).
 *  `provisioning` = a remote host binding still copying/building; `membership` = the
 *  `entries` snapshot never grounded the active host; `session` = the session/list
 *  subscription hung; `daemon` = the kaval status never reported. `unknown` is
 *  UNREACHABLE by design today — future-arm insurance so a new overlay return that
 *  forgets to name its leg still escapes (named generically) rather than being missed. */
export type StalledLeg =
  | "provisioning"
  | "membership"
  | "session"
  | "daemon"
  | "unknown";

/** The per-frame anchor VERDICT, declared AT the resolver's return site (never inferred
 *  from `kind`) — a 3-way discriminant the boot-deadline anchor switches on directly:
 *   - `accrue`: a BOOT overlay (escapable) that the ceiling clock must accumulate against,
 *     carrying its stalled `leg` + `ceiling` class.
 *   - `retain`: a NON-boot overlay the deadline must IGNORE (no-op) — a kaval-restart
 *     warming, a mid-session records-awaited / `!channelLive` connecting (the transport
 *     overlay owns those) — so an overlay-flavored flap can't dodge the ceiling by settling.
 *   - `clear`: a SETTLED surface (workspace / empty / down / host-failed) that releases the
 *     anchor.
 *  The resolver KNOWS which of the three it is at every return, so the verdict travels ON
 *  the tag rather than being re-derived downstream from `kind`. A future overlay return must
 *  DECLARE its `accrual` or fail to compile. */
export type BootTag =
  | { accrual: "clear" }
  | { accrual: "retain" }
  | { accrual: "accrue"; leg: StalledLeg; ceiling: CeilingClass };

/** Which canvas surface wins, with the payload each surface needs. Tagged so
 *  the down sub-state, the warming label, and the host-failure cause travel WITH
 *  the choice — the renderer reads no accessor a second time. `host-failed` is
 *  the Skew-UX addition: the ACTIVE host's map-membership entry itself failed
 *  (an ssh/contract-level fault, cause-typed), distinct from `down` (a CONNECTED
 *  host whose kaval daemon died). `boot-stalled` is the #1763 boot-deadline escape:
 *  a boot overlay held past its ceiling, naming the stalled leg + the phase. */
export type CanvasMode =
  | { kind: "connecting" }
  // `down` carries the payload-bearing verdict (SK4): dead/degraded render the
  // restartable DegradedCanvas; `incompatible` renders the skew card with both
  // versions and the renew action — the affordance is a total function of it.
  | { kind: "down"; down: DaemonDownState }
  | { kind: "host-failed"; cause: EntryFailedCause; reason: string }
  // The #1763 boot-deadline escape: a boot overlay wedged past its ceiling. `leg`
  // names what never delivered (its copy authority is `bootStalledCopy.ts`); `phase`
  // is rendered beside the copy so a wedged remote provisioning names copying/building.
  | { kind: "boot-stalled"; leg: StalledLeg; phase: ConnectPhase | undefined }
  // NO presentation string: the warming surface's copy is derived at RENDER (ConnectCanvas —
  // the connection-cell phase via the ONE copy authority, or the kaval-restart label from the
  // daemon-presentation table keyed on `daemonState`). With no string field on any mode arm, a
  // resolver baking copy is a TYPE error — the four-duplicate-literal flicker is unspellable.
  | { kind: "warming"; daemonState: DaemonState | undefined }
  | { kind: "empty" }
  | { kind: "workspace" };

/** The precedence result: the winning surface plus its {@link BootTag}. The caller
 *  reads `.mode` to render and `.tag` to drive the per-host boot-deadline anchor
 *  (a pure switch on `tag.accrual` — accrue / retain / clear — see `bootDeadline.ts`). */
export interface Precedence {
  mode: CanvasMode;
  tag: BootTag;
}

/** The liveness facts every arm carries, regardless of the active entry's
 *  connection state — the session-loading flag and the host-locality fact the
 *  loading guard reads BEFORE it ever consults an entry arm. Kept as a shared
 *  base so each arm below adds only the facts its own surface needs. */
interface EntryLivenessFacts {
  isLoading: boolean;
  daemonPending: boolean;
  /** True while the ACTIVE host is the unremovable LOCAL default. It selects the
   *  boot-deadline CEILING CLASS (local = 30s; a remote's ssh dial + nix copy + build
   *  legitimately outlasts that, so it accrues against a generous remote cell instead)
   *  and routes the daemon-leg escape (a hung LOCAL kaval → the byte-identical
   *  down/dead card; any other leg → the boot-stalled card). */
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
 *  this from the live accessors is what makes {@link resolvePrecedence} a pure,
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

/** A settled surface — releases the per-host anchor. */
const CLEAR: BootTag = { accrual: "clear" };
/** A non-boot overlay the deadline must ignore — holds the anchor without accruing. */
const RETAIN: BootTag = { accrual: "retain" };

/** The ceiling class a NOT-YET-CONNECTED boot overlay accrues against: local (30s), a
 *  remote actively provisioning (copying/building — the minutes-scale cell), or a remote
 *  handshake (probing/connecting/undefined — a shorter but still finite cell). */
function bindingCeiling(facts: NotYetConnectedFacts): CeilingClass {
  if (facts.isLocalHost) return "local";
  return facts.connectPhase === "copying" || facts.connectPhase === "building"
    ? "remote-provisioning"
    : "remote-handshake";
}

/** The internal precedence partition — total over {@link CanvasFacts}, exclusive,
 *  order load-bearing (see the module header). Each return DECLARES its {@link BootTag}
 *  accrual verdict: `accrue` (with leg + ceiling) for a real boot overlay, `retain` for a
 *  surface the deadline must never escape (kaval-restart warming; a mid-session
 *  records-awaited / `!channelLive` connecting the transport overlay owns), `clear` for a
 *  settled surface. No timeout logic lives here — the escape is applied by
 *  {@link resolveCanvasMode} off this tag. */
function resolvePrecedence(facts: CanvasFacts): Precedence {
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
      // ([Reconnect] / [Switch to local]), distinct from `down` (a connected host's dead
      // kaval). Not a boot overlay: it is already a terminal, escape-bearing surface.
      return {
        mode: { kind: "host-failed", cause: facts.cause, reason: facts.reason },
        tag: CLEAR,
      };

    case "warming":
    case "not-a-member": {
      // The boot overlay's leg + ceiling, declared here (C3): a not-a-member entry is a
      // MEMBERSHIP stall even when it reaches the bindingUp `warming` return; a warming
      // binding is `provisioning` while nix-copy/build runs, else the binding/`daemon` leg
      // (a LOCAL restart-drain rides this arm and so carries the 30s local ceiling — a hung
      // one escapes to down/dead, a normal one clears via the next `workspace` frame).
      const leg: StalledLeg =
        facts.entry === "not-a-member"
          ? "membership"
          : facts.connectPhase === "copying" ||
              facts.connectPhase === "building"
            ? "provisioning"
            : "daemon";
      const tag: BootTag = {
        accrual: "accrue",
        leg,
        ceiling: bindingCeiling(facts),
      };
      // THE CONNECT OVERLAY (W6), routed off ONE channel: the ACTIVE host's binding is
      // coming up iff its OWN `connection` cell phase is an up-but-not-yet-connected phase —
      // the SAME frame `ConnectCanvas` reads to narrate it, so routing and content never
      // disagree mid-transition. All three overlay returns below are boot overlays; the
      // #1763 ceiling (not a per-arm `pendingTimedOut`) bounds them uniformly in the wrapper.
      const bindingUp = facts.connectPhase !== undefined;
      if (bindingUp) {
        return { mode: { kind: "warming", daemonState: undefined }, tag };
      }
      // The residual boot gate — pre-first-frame (`connectPhase` still `undefined`) or a
      // non-binding-up phase: neutral "Connecting…" until both the session cell AND the
      // daemon-status stream have produced a value.
      if (facts.isLoading || facts.daemonPending) {
        return { mode: { kind: "connecting" }, tag };
      }
      // The entry-specific surface for a still-pre-connected host. `warming` shows the
      // neutral warming surface (no kaval `daemonState`); `not-a-member` holds neutral
      // `connecting` (never a stale claim about a non-member).
      return facts.entry === "warming"
        ? { mode: { kind: "warming", daemonState: undefined }, tag }
        : { mode: { kind: "connecting" }, tag };
    }

    case "connected": {
      // A connected entry ALWAYS reaches its workspace/down/empty surface. The loading gate
      // still covers a connected entry whose session/list or daemon-status leg has not
      // produced its first value (#1034) — a BOOT overlay (Hole B): a hung session leg past
      // the ceiling escapes even though the daemon leg delivered. Leg = `session` if the
      // session/list is what's pending, else `daemon`.
      if (facts.isLoading || facts.daemonPending) {
        const leg: StalledLeg = facts.isLoading ? "session" : "daemon";
        return {
          mode: { kind: "connecting" },
          tag: {
            accrual: "accrue",
            leg,
            ceiling: facts.isLocalHost ? "local" : "remote-handshake",
          },
        };
      }
      // `down` and `warming` arrive ALREADY floored on channel liveness at their source
      // accessors (`downState`/`daemonWarming`), so a stale daemon state never reaches these
      // arms over a dead channel. Neither is a boot overlay: a real kaval death is its own
      // terminal card (a SETTLED surface → CLEAR), and a kaval-restart `warming` (channel live)
      // is NOT a wedged boot — a non-boot overlay the deadline must ignore → RETAIN.
      if (facts.down)
        return { mode: { kind: "down", down: facts.down }, tag: CLEAR };
      if (facts.warming)
        return {
          mode: { kind: "warming", daemonState: facts.daemonState },
          tag: RETAIN,
        };
      // Terminals on screen → show them (a settled surface → CLEAR). Otherwise "no terminals"
      // is unconfirmable over a dead channel: show `empty` only when the CHANNEL is LIVE, else
      // neutral connecting.
      if (facts.terminalCount > 0)
        return { mode: { kind: "workspace" }, tag: CLEAR };
      // Records still arriving after the key list resolved → hold `connecting` instead of
      // flashing `empty`'s restore card. NOT a boot overlay: the workspace is imminent, so the
      // deadline must not escape it (a genuine reboot's records arrive PARKED — awaited hits 0
      // with no live tile — and this falls through to `empty` as intended) → RETAIN.
      if (facts.recordsAwaited > 0)
        return { mode: { kind: "connecting" }, tag: RETAIN };
      // `empty` is a settled surface → CLEAR. A dead-channel connecting is owned by the
      // post-grace TRANSPORT overlay, not the boot deadline: a non-boot overlay → RETAIN.
      return facts.channelLive
        ? { mode: { kind: "empty" }, tag: CLEAR }
        : { mode: { kind: "connecting" }, tag: RETAIN };
    }
  }
}

/** The honest escape surface for a boot overlay held past its ceiling (#1763). A hung
 *  LOCAL kaval leg reuses the byte-identical down/dead DegradedCanvas (#1713 preserved);
 *  every other stalled leg gets the boot-stalled card, which names the leg (its copy) +
 *  the phase (rendered beside it). Reachable only via an `accrue` tag, so a kaval-restart
 *  warming (tagged `retain`) can never mislabel-escape into the daemon-dead cell. */
function escapeSurface(
  tag: Extract<BootTag, { accrual: "accrue" }>,
  facts: CanvasFacts,
): CanvasMode {
  if (tag.leg === "daemon" && facts.isLocalHost) {
    return { kind: "down", down: { state: "dead" } };
  }
  const phase = "connectPhase" in facts ? facts.connectPhase : undefined;
  return { kind: "boot-stalled", leg: tag.leg, phase };
}

/** THE ONE exported resolver (#1763). Computes the raw precedence, then — off ONE
 *  resolve — escapes to {@link escapeSurface} iff the boot deadline is `exceeded` AND the
 *  raw surface is a boot overlay (`tag.accrual === "accrue"`, declared at the return site).
 *  Returns both the `mode` to render and the `tag`, which the caller feeds to the per-host
 *  boot-deadline anchor (`bootDeadline.ts`): a pure switch on `tag.accrual`. The escape keeps
 *  the raw `tag` (still `accrue`) so the escaped frame keeps accruing (stays escaped) until
 *  the hung leg finally delivers and the raw surface settles. */
export function resolveCanvasMode(
  facts: CanvasFacts,
  deadline: { exceeded: boolean },
): Precedence {
  const raw = resolvePrecedence(facts);
  if (deadline.exceeded && raw.tag.accrual === "accrue") {
    return { mode: escapeSurface(raw.tag, facts), tag: raw.tag };
  }
  return raw;
}
