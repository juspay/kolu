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
 *  `warming`/`failed`/`unobservable`/`not-a-member` arm is a compile error; see
 *  `canvasModeResolver.test-d.ts`). The internal {@link resolvePrecedence} switches on
 *  the discriminant FIRST and touches a kaval fact only inside the `connected` arm.
 *
 *  ── The boot-deadline seam (#1763) ───────────────────────────────────────────
 *  The connect overlay ("Connecting to <host>…") used to have exactly ONE timeout
 *  escape, fed by ONLY the daemon leg (`pendingTimedOut`), so a hung MEMBERSHIP or
 *  SESSION leg span the overlay forever with no way out. The module's ONE exported
 *  function is now {@link resolveCanvasMode}`(facts, { transportLive, exceeded, earnedBoot })`:
 *  it computes
 *  the raw precedence, then — if the boot deadline is exceeded AND the raw surface is a BOOT
 *  overlay (`tag.accrual === "accrue"`, declared at each return site, never guessed from `kind`) —
 *  escapes to an honest surface that names the stalled leg. `resolvePrecedence` is
 *  INTERNAL, so a caller can never render a mode that skipped the deadline. The caller
 *  (`useCanvasMode` + `bootDeadline.ts`) owns the per-host episode anchor and the
 *  phase-aware ceiling that decide `exceeded`; this module stays pure.
 *
 *  ── The observability floor (#2129) ─────────────────────────────────────────
 *  THE ONE TELLING of this story — every other mention in the tree is a citation of
 *  this paragraph, so there is a single copy to keep true.
 *
 *  A boot deadline is a claim about the SERVER — "this leg was given its ceiling and
 *  never delivered" — so it is only ours to make while THIS browser can reach the
 *  server. {@link resolveCanvasMode} therefore downgrades the frame's tag to `clear`
 *  whenever the OBSERVER's `transportLive` is false — EVERY accrual variant, not just
 *  `accrue`, so no arm has to remember to opt in and no cross-package reachability
 *  argument has to hold for the rule to be true (see the note at the `.with` itself).
 *  The deadline neither fires nor accumulates, and the mode passes through untouched
 *  (the transport overlay already owns the screen; blanking the canvas on every drop
 *  would be a worse lie than the dead card this removes). `clear` — NOT `retain` — is
 *  load-bearing: `retain` holds the class anchor, so the outage's elapsed would survive
 *  the reconnect and the first live frame (the window where the socket is back but the
 *  snapshot has not landed) would read `exceeded` and flash the card anyway. We watched
 *  nothing, so we timed nothing.
 *
 *  That is half the floor; it governs the FRAMES we observe. Its other half lives in
 *  `bootDeadline.ts`, because a frozen tab observes no frames at all: `exceeded` itself is
 *  sampled-and-held, so over a dead link the caller reports the verdict this browser last
 *  WATCHED accrue instead of subtracting across an interval it slept through. Neither half
 *  covers the other's case, and the exemption below needs both to be honest.
 *
 *  The floor governs REACHING a verdict, never KEEPING one (AFP C6): an ALREADY-`exceeded`
 *  verdict was earned over a live link and is exempt, because retracting it would take the
 *  card's recovery verb (Restart kaval / Retry connection) off screen — behind a link
 *  flapping faster than the ceiling the user would be denied the one affordance that fixes
 *  the problem, forever. Losing a true claim is worse than never making a false one.
 *  ACCEPTED EDGE, the other side of the same coin: a link that flaps faster than the
 *  ceiling keeps re-anchoring, so a genuinely wedged daemon behind it never escapes —
 *  a browser that cannot hold a socket has no standing to certify a daemon dead.
 *
 *  KEEPING a verdict means keeping the card it earned, so the hold covers the boot's
 *  IDENTITY too ({@link BootIdentity}, held beside the verdict in `bootDeadline.ts`). The
 *  outage is the same event that takes the entry off the `connected` arm (onto `unobservable`),
 *  and the not-yet-connected arms derive `leg` from host-locality alone — so a card recomputed
 *  mid-blip would name a DIFFERENT boot than the one that earned it, turning a `session` stall
 *  into the `down`/dead card this floor exists to prevent. The narration (`phase`/`log`/`logAbsence`)
 *  is deliberately NOT held: "kolu cannot see your machine" is true while it is true.
 *
 *  The bug that earned it: `floorOnLiveness` (`@kolu/surface-map`) demotes a published
 *  `connected` entry over a dead link, so a green chip can never outlive the link that
 *  proves it (#1568). Correct — but it USED to demote to `warming`, which made "the host
 *  is coming up" and "we cannot see the host" the SAME value. A backgrounded tab (a
 *  fullscreen game throttling its timers) lost the socket for minutes; the local entry
 *  demoted to `warming`, which is leg `daemon` under the LOCAL ceiling, and the monotonic
 *  clock kept advancing — so 30s later the escape certified a kaval that had been running
 *  for twelve hours as `dead`. Two individually-correct mechanisms composed into a false
 *  claim; this floor is the seam that refuses to make any claim at all.
 *
 *  The floor is now the SECOND of two defences, and deliberately still load-bearing. The
 *  first is structural: surface-map floors those two live arms onto their own `unobservable`
 *  arm, so `warming` means a campaign the publisher is actually narrating and the conflation
 *  cannot be spelled at all — {@link CanvasFacts} carries it as its own arm, and every
 *  `.exhaustive()` in kolu and drishti must state a policy for it. That kills the class. It
 *  does NOT make this floor redundant, for two reasons worth stating so nobody deletes it:
 *  `failed` and `not-a-member` stay on their published arms over a dead link and still must
 *  not be timed, and the earned-verdict exemption below is a rule about the OBSERVER that no
 *  per-entry arm can express.
 *
 *  The connected-arm sub-order is correctness, not cosmetics:
 *    - `down` beats `empty` so a dead/degraded kaval never masquerades as
 *      "you have no terminals" — the #1034 empty-canvas lie.
 *    - `warming` beats `empty` so a restart's `drain` (which empties the
 *      terminal list) shows the neutral warming surface, not EmptyState with
 *      its enabled Restore / new-terminal affordances — a fast click there
 *      would spawn/restore into the daemon the recycle is about to kill
 *      (terminal creation must wait for `connected`). */

import type { DaemonState } from "@kolu/padi-client/surface";
import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import { match, P } from "ts-pattern";
import { isProvisioningPhase } from "../host/connectCanvasCopy";
import {
  type LogAbsence,
  type LogLine,
  NO_LOG_LINES,
} from "../ui/logTailChrome";
import type { DaemonDownState } from "./daemonPresentation";

/** Which per-host episode ceiling a boot overlay accrues against (#1763). Every
 *  class is FINITE — an unbounded cell would recreate the no-escape bug the ceiling
 *  exists to kill (a link-live frozen `provisioning` would never escape). The concrete
 *  millisecond values live beside the anchor in `bootDeadline.ts`. */
export type CeilingClass = "local" | "remote-provisioning" | "remote-handshake";

/** Which boot leg is still unsettled when the deadline fires — carried on the escape
 *  surface so the failure card can NAME what never arrived (not a mute spinner).
 *  `provisioning` = a remote host binding still coming up — the WHOLE connector-owned warming
 *  campaign in ANY phase (probing / provisioning / connecting), the ssh connector still
 *  retrying. So it does NOT imply the `remote-provisioning` {@link CeilingClass}: a probing
 *  remote is `leg=provisioning` under the `remote-handshake` ceiling. `membership` = the
 *  `entries` snapshot never grounded the active host; `session` = the session/list
 *  subscription hung; `daemon` = the kaval status never reported. There is deliberately NO
 *  `unknown`/catch-all: the `accrue` tag REQUIRES a `leg`, so every overlay return is forced
 *  to name a real one at compile time — a generic fallback would only be a silent-degradation
 *  path the repo's fail-fast philosophy forbids, insuring against a compile-time impossibility. */
export type StalledLeg = "provisioning" | "membership" | "session" | "daemon";

/** The CLIENT-owned stalled legs — every {@link StalledLeg} EXCEPT `provisioning`. A
 *  `provisioning` stall is the SERVER-side ssh connector's own retry loop (a warming REMOTE
 *  entry — PR1's abort-in-flight `recheck()`); the other three legs are genuinely client-side
 *  (a fresh boot re-runs their subscription). This split is what the boot-stalled card's
 *  recovery verb turns on, so it is named ONCE here rather than re-spelled at the card. */
export type ClientStalledLeg = Exclude<StalledLeg, "provisioning">;

/** How a boot-stalled card recovers (#1908 D2) — the honest verb for WHO owns the wedged leg:
 *   - `connector`: a warming REMOTE entry whose ssh connector is STILL retrying (it has NOT
 *     reached its own terminal `failed` verdict — that flips the entry to `failed` → the
 *     host-down card, so this arm is always non-terminal). Recovery RECYCLES the server
 *     connector (`client.hosts.reconnect`, the verb PR1 gave a real abort-in-flight `recheck()`),
 *     and the copy stays NON-TERMINAL; `phase` narrates where the campaign is (probing /
 *     provisioning / connecting) and `log` is that campaign's live output tail — the narration of
 *     the very work the card is asking about. `location.reload()` cannot recycle a server-side dial,
 *     so it would be a lie here.
 *   - `client`: a genuinely client-side leg (a connected host's session / daemon subscription, a
 *     membership stall). A fresh boot re-runs that subscription, so the verb is `location.reload()`
 *     and the copy is the leg's own {@link bootStalledCopy}. Its tail would be a SETTLED connect
 *     log with nothing to say about the wedge, so the arm carries none — the card cannot show one
 *     BY CONSTRUCTION, rather than by a ternary at the render site. */
export type BootStalledRecovery =
  | {
      via: "connector";
      phase: ConnectPhase | undefined;
      /** The campaign's retained output — TOTAL, so `[]` is the whole vocabulary for "no
       *  lines" and the card never infers a cause from an absence. */
      log: readonly LogLine[];
      /** WHY `log` is empty, when that is not the campaign's own fact — see
       *  {@link LogAbsence}. Decided where the liveness fact lives (`useCanvasMode`), so
       *  the card renders a reason it was told. */
      logAbsence: LogAbsence | undefined;
    }
  | { via: "client"; leg: ClientStalledLeg };

/** The per-frame anchor VERDICT, declared AT the resolver's return site (never inferred
 *  from `kind`) — a 3-way discriminant the boot-deadline anchor switches on directly:
 *   - `accrue`: a BOOT overlay (escapable) that the ceiling clock must accumulate against,
 *     carrying its stalled `leg` + `ceiling` class.
 *   - `retain`: a NON-boot overlay the deadline must IGNORE (no-op) — a kaval-restart
 *     warming, a mid-session records-awaited / `!channelLive` connecting (the transport
 *     overlay owns those) — so an overlay-flavored flap can't dodge the ceiling by settling.
 *   - `clear`: a surface with no episode to time — either SETTLED (workspace / empty /
 *     down / host-failed) or UNOBSERVABLE (the #2129 floor: our link to the server is
 *     down, so there is no boot we could honestly be timing). Both release the anchor,
 *     and for the same reason: what the ceiling was measuring is no longer in progress
 *     as far as this browser can tell. The floor is applied in {@link resolveCanvasMode},
 *     not at a return site here — it is a property of the OBSERVER, not of the surface,
 *     so every arm inherits it uniformly rather than each remembering to opt in.
 *  The resolver KNOWS which of the three it is at every return, so the verdict travels ON
 *  the tag rather than being re-derived downstream from `kind`. A future overlay return must
 *  DECLARE its `accrual` or fail to compile. `accrue` also carries `phase` and `log` — the
 *  connect phase the escape surface names beside the leg, the campaign's own output tail, and
 *  why that tail is missing when it is —
 *  declared here for the SAME reason as `leg`/`ceiling`: {@link escapeSurface} renders off the
 *  tag alone, never by re-reading `facts` for a field that may not exist on every arm. */
export type BootTag =
  | { accrual: "clear" }
  | { accrual: "retain" }
  | {
      accrual: "accrue";
      leg: StalledLeg;
      ceiling: CeilingClass;
      phase: ConnectPhase | undefined;
      log: readonly LogLine[];
      logAbsence: LogAbsence | undefined;
    };

/** The ACCRUING arm of {@link BootTag} — the only one {@link escapeSurface} can render a card
 *  from. Its fields split into two kinds, and the split is load-bearing (#2129): WHICH BOOT
 *  this is ({@link BootIdentity}) versus what the link is saying about it right now
 *  (`phase`/`log`/`logAbsence`). */
export type AccruingBootTag = Extract<BootTag, { accrual: "accrue" }>;

/** WHICH BOOT a tag is about — the part that is a property of the episode and must not change
 *  under a verdict already earned for it. Held beside the verdict (`bootDeadline.ts`) because
 *  the outage itself rewrites the live facts these are otherwise derived from: the map floor
 *  takes the entry off the `connected` arm, and the not-yet-connected arms derive `leg` from
 *  host-locality alone. Deliberately EXCLUDES the narration — `logAbsence: "link-down"` is a
 *  true statement about the link right now, and the card should keep telling it. */
export type BootIdentity = Pick<AccruingBootTag, "leg" | "ceiling">;

/** Which canvas surface wins, with the payload each surface needs. Tagged so
 *  the down sub-state and the warming label travel WITH the choice — the renderer
 *  reads no accessor a second time for THOSE. `host-failed` is the Skew-UX addition:
 *  the ACTIVE host's map-membership entry itself failed (an ssh/contract-level fault),
 *  distinct from `down` (a CONNECTED host whose kaval daemon died). It carries NO
 *  payload deliberately — the episode is read as one value by `failedEpisode`
 *  (`useDaemonStatus.ts`, which owns that rationale), so this stays a routing decision with
 *  nothing on it to go stale. `boot-stalled` is the #1763 boot-deadline escape:
 *  a boot overlay held past its ceiling, carrying its honest {@link BootStalledRecovery}
 *  verdict — a `connector` arm (a warming-remote campaign, with its live phase) or a `client`
 *  arm (a client-side leg), never both. */
export type CanvasMode =
  | { kind: "connecting" }
  // `down` carries the payload-bearing verdict (SK4): dead/degraded render the
  // restartable DegradedCanvas; `incompatible` renders the skew card with both
  // versions and the renew action — the affordance is a total function of it.
  | { kind: "down"; down: DaemonDownState }
  | { kind: "host-failed" }
  // The #1763 boot-deadline escape: a boot overlay wedged past its ceiling, carrying its
  // honest {@link BootStalledRecovery} — `connector` (a warming-remote campaign the server ssh
  // connector still owns → recycle it, non-terminal copy, phase narrated) vs `client` (a
  // genuinely client-side leg → `location.reload()`, the leg's own `bootStalledCopy`). The
  // recovery verdict is DECIDED here (in `escapeSurface`), never re-derived at the card.
  | { kind: "boot-stalled"; recovery: BootStalledRecovery }
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

/** The liveness facts every arm carries, regardless of the active entry's connection
 *  state — the session-loading flag, the daemon-status pending flag, and the
 *  host-locality fact, which the loading guard and the ceiling-class choice read BEFORE
 *  they ever consult an entry arm. Kept as a shared base so each arm below adds only
 *  the facts its own surface needs.
 *
 *  Every member here describes THE ACTIVE HOST or the session in front of it. Facts that
 *  describe US — this browser's link to kolu-server (#2129), whether a ceiling already
 *  elapsed (#1763) — deliberately do NOT live on this union at all: they reach
 *  {@link resolveCanvasMode} as its second `observation` argument, so no arm can carry
 *  one and no arm has to remember to. */
interface EntryLivenessFacts {
  isLoading: boolean;
  daemonPending: boolean;
  /** True while the ACTIVE host is the unremovable LOCAL default. It selects the
   *  boot-deadline CEILING CLASS (local = 30s; a remote's ssh provisioning
   *  legitimately outlasts that, so it accrues against a generous remote cell instead)
   *  and routes the daemon-leg escape (a hung LOCAL kaval → the byte-identical
   *  down/dead card; any other leg → the boot-stalled card). */
  isLocalHost: boolean;
}

/** The facts the three NOT-YET-CONNECTED arms (`warming` / `unobservable` / `not-a-member`)
 *  share — the connect
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
  /** The SAME connection cell's retained output tail, read in the same breath as
   *  `connectPhase` (one `connectionInfo()` read in `useCanvasMode`). It rides the boot tag onto
   *  the boot-stalled card's `connector` arm, so a wedged provisioning campaign shows what it was
   *  doing. TOTAL — `[]` when there is no cell frame to read one off. */
  connectLog: readonly LogLine[];
  /** WHY {@link NotYetConnectedFacts.connectLog} is empty, when that is not the campaign's
   *  own fact. There are two ways the cell can hand us nothing — the floor dropped the live
   *  word over a dead link, or no frame has arrived yet — and only ONE of them is a link
   *  problem. `useCanvasMode` holds the liveness fact and states which; nothing downstream
   *  re-derives it from the emptiness, which is a guess the type cannot back. */
  connectLogAbsence: LogAbsence | undefined;
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
       *  (a remote's ssh provisioning), NOT the kaval daemon restarting
       *  (that is a CONNECTED-arm fact). Carries `connectPhase` via {@link NotYetConnectedFacts}. */
      entry: "warming";
    })
  | (EntryLivenessFacts & {
      /** The active entry `failed` — an ssh dial/handshake or contract-level fault
       *  the map reported. Carries NO kaval facts (the host never connected, so there
       *  is no daemon to describe) and NO failure payload (see `failedEpisode`). */
      entry: "failed";
    })
  | (NotYetConnectedFacts & {
      /** The active host is transiently not in the membership pool (mid-switch,
       *  before a re-add lands). No entry facts to read — hold `connecting`. Carries
       *  `connectPhase` via {@link NotYetConnectedFacts}. */
      entry: "not-a-member";
    })
  | (NotYetConnectedFacts & {
      /** THIS browser cannot see the map's publisher, so the entry's published arm is not
       *  ours to read (`@kolu/surface-map`'s `unobservable`). Shaped like the other
       *  not-yet-connected arms because the SURFACE is the same — a host that is not
       *  connected, narrated by whatever the connect overlay has — but kept a SEPARATE arm
       *  because the deadline's answer is the opposite one: an observed campaign accrues,
       *  a blind one may not. Before it existed, the floor handed this frame in as `warming`
       *  and the 30s local ceiling certified a healthy daemon dead (#2129).
       *
       *  The arm deliberately does NOT re-carry the entry's `published` last-known word. This
       *  resolver's job is the deadline, and the deadline's answer while blind is "make no
       *  claim" for BOTH last-known words — a fact nothing here would branch on is a fact this
       *  union should not carry. The surfaces that legitimately narrate the last word (the host
       *  chip's tooltip, the diagnostic snapshot) read it off the entry directly. */
      entry: "unobservable";
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

/** Wraps a settled surface in the CLEAR verdict — the `{ mode, tag: CLEAR }` shape every
 *  settled return site below shares, named once. */
const clear = (mode: CanvasMode): Precedence => ({ mode, tag: CLEAR });
/** Wraps a non-boot overlay in the RETAIN verdict — the `{ mode, tag: RETAIN }` shape every
 *  ignored-overlay return site below shares, named once. */
const retain = (mode: CanvasMode): Precedence => ({ mode, tag: RETAIN });

/** The ONE ceiling-class derivation — host-locality + connect phase → {@link CeilingClass}:
 *  local (30s), a remote actively provisioning (the minutes-scale cell), or
 *  a remote handshake (probing/connecting/undefined — a shorter but still finite cell). Both the
 *  not-yet-connected {@link bindingCeiling} and the connected-arm loading gate read it (the
 *  connected fact has no connect phase → `undefined`), so the ceiling policy lives in one place. */
function ceilingFor(
  isLocalHost: boolean,
  connectPhase: ConnectPhase | undefined,
): CeilingClass {
  if (isLocalHost) return "local";
  return isProvisioningPhase(connectPhase)
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
  // Dispatch on the ACTIVE entry's connection state FIRST (A' — the resolver's spine), with
  // `.exhaustive()` (prefer-ts-pattern) so a future entry kind must be handled or fail the
  // build. The connect overlay is read ONLY inside the not-yet-connected arms, where
  // `connectPhase` exists; the `connected` arm has no `connectPhase`, so it can NEVER route to
  // the overlay — a stale/lagging connection cell can no longer trap the canvas over a host the
  // map reports connected (the green-chip / "Building forever" bug). `failed` has no
  // daemon-status ever coming, so it renders its own cause-typed card, never the loading spinner
  // or the kaval-dead `down` card.
  return (
    match(facts)
      // The host BINDING itself failed (cause-typed) — the Skew-UX host-down card ([Reconnect] /
      // [Switch to local]), distinct from `down` (a connected host's dead kaval). Not a boot
      // overlay: it is already a terminal, escape-bearing surface.
      .with({ entry: "failed" }, () => clear({ kind: "host-failed" }))
      .with(
        { entry: "warming" },
        { entry: "not-a-member" },
        { entry: "unobservable" },
        (f): Precedence => {
          // WHY `unobservable` shares this arm, and why it does NOT get a `clear` of its own.
          // The blind verdict is decided in exactly ONE place — `resolveCanvasMode`'s observer
          // floor — because the floor and the AFP C6 exemption are two halves of one rule read
          // off one value. A blind frame that declared `clear` HERE would never reach the
          // `{ accrual: "accrue", exceeded: true }` arm, so an ALREADY-EARNED verdict would lose
          // its card and its recovery verb the instant the socket dropped: the exact regression
          // ("losing a true claim is worse than never making a false one") the exemption exists
          // to prevent. So the tag is computed the same way for all three, and it is the floor —
          // not this site — that refuses to let a blind frame reach a NEW verdict.
          //
          // What the separate arm buys is upstream of the tag: nothing can now MISTAKE a blind
          // frame for an observed campaign. `warming` here is a real, self-healing campaign worth
          // timing; before the split, "our socket died" wore the same word, and `isLocalHost`
          // below then invented `daemon` for it — the leg whose escape is the dead card #2129
          // showed over a twelve-hour-old kaval. That invention is still computed for a blind
          // frame (it must be, so the shapes match) but it is now provably never READ as one:
          // the floor clears it, or the earned hold replaces it with the boot that was actually
          // watched. What used to be a prose obligation is a case a future editor must name.
          //
          // The boot overlay's leg + ceiling, declared here (C3). A not-a-member entry is a
          // MEMBERSHIP stall (even when it reaches the bindingUp `warming` return). A REMOTE
          // warming entry is the connector-owned `provisioning` leg for its WHOLE coming-up
          // campaign — ANY phase (probing / provisioning / connecting), not just
          // build (#1908 D2): the ssh connector still owns the retry loop, so its escape routes to
          // the NON-TERMINAL connector card, never the reload lie. A LOCAL warming entry is a
          // kaval restart-drain (`daemon`, 30s local ceiling) — a hung one escapes to the
          // byte-identical down/dead card, a normal one clears via the next `workspace` frame.
          const leg: StalledLeg =
            f.entry === "not-a-member"
              ? "membership"
              : f.isLocalHost
                ? "daemon"
                : "provisioning";
          const tag: BootTag = {
            accrual: "accrue",
            leg,
            ceiling: ceilingFor(f.isLocalHost, f.connectPhase),
            phase: f.connectPhase,
            log: f.connectLog,
            logAbsence: f.connectLogAbsence,
          };
          // THE CONNECT OVERLAY (W6), routed off ONE channel: the ACTIVE host's binding is coming
          // up iff its OWN `connection` cell phase is an up-but-not-yet-connected phase — the SAME
          // frame `ConnectCanvas` reads to narrate it, so routing and content never disagree
          // mid-transition. All three overlay returns below are boot overlays; the #1763 ceiling
          // (not a per-arm `pendingTimedOut`) bounds them uniformly in the wrapper.
          const bindingUp = f.connectPhase !== undefined;
          if (bindingUp) {
            return { mode: { kind: "warming", daemonState: undefined }, tag };
          }
          // The residual boot gate — pre-first-frame (`connectPhase` still `undefined`) or a
          // non-binding-up phase: neutral "Connecting…" until both the session cell AND the
          // daemon-status stream have produced a value.
          if (f.isLoading || f.daemonPending) {
            return { mode: { kind: "connecting" }, tag };
          }
          // The entry-specific surface for a still-pre-connected host. `warming` shows the neutral
          // warming surface (no kaval `daemonState`) — "this host is coming up", which on that arm
          // is something the publisher actually said. `not-a-member` and `unobservable` hold
          // neutral `connecting` instead, for the same reason: neither is a stale claim we are
          // entitled to make. A blind entry in particular may have been fully `connected` a moment
          // ago; "coming up" would be our invention, not its news.
          return f.entry === "warming"
            ? { mode: { kind: "warming", daemonState: undefined }, tag }
            : { mode: { kind: "connecting" }, tag };
        },
      )
      .with({ entry: "connected" }, (f): Precedence => {
        // A connected entry ALWAYS reaches its workspace/down/empty surface. The loading gate
        // still covers a connected entry whose session/list or daemon-status leg has not produced
        // its first value (#1034) — a BOOT overlay (Hole B): a hung session leg past the ceiling
        // escapes even though the daemon leg delivered. Leg = `session` if the session/list is
        // what's pending, else `daemon`.
        if (f.isLoading || f.daemonPending) {
          const leg: StalledLeg = f.isLoading ? "session" : "daemon";
          return {
            mode: { kind: "connecting" },
            tag: {
              accrual: "accrue",
              // A connected fact carries no connect phase → the handshake/local cell.
              leg,
              ceiling: ceilingFor(f.isLocalHost, undefined),
              // A connected fact carries no connection-cell narration either — and its
              // absence is a fact about this ARM, not about the link, so no reason.
              phase: undefined,
              log: NO_LOG_LINES,
              logAbsence: undefined,
            },
          };
        }
        // `down` and `warming` arrive ALREADY floored on channel liveness at their source
        // accessors (`downState`/`daemonWarming`), so a stale daemon state never reaches these
        // arms over a dead channel. Neither is a boot overlay: a real kaval death is its own
        // terminal card (a SETTLED surface → CLEAR), and a kaval-restart `warming` (channel live)
        // is NOT a wedged boot — a non-boot overlay the deadline must ignore → RETAIN.
        if (f.down) return clear({ kind: "down", down: f.down });
        if (f.warming)
          return retain({ kind: "warming", daemonState: f.daemonState });
        // Terminals on screen → show them (a settled surface → CLEAR). Otherwise "no terminals"
        // is unconfirmable over a dead channel: show `empty` only when the CHANNEL is LIVE, else
        // neutral connecting.
        if (f.terminalCount > 0) return clear({ kind: "workspace" });
        // Records still arriving after the key list resolved → hold `connecting` instead of
        // flashing `empty`'s restore card. NOT a boot overlay: the workspace is imminent, so the
        // deadline must not escape it (a genuine reboot's records arrive PARKED — awaited hits 0
        // with no live tile — and this falls through to `empty` as intended) → RETAIN.
        if (f.recordsAwaited > 0) return retain({ kind: "connecting" });
        // `empty` is a settled surface → CLEAR. A dead-channel connecting is owned by the
        // post-grace TRANSPORT overlay, not the boot deadline: a non-boot overlay → RETAIN.
        return f.channelLive
          ? clear({ kind: "empty" })
          : retain({ kind: "connecting" });
      })
      .exhaustive()
  );
}

/** The honest escape surface for a boot overlay held past its ceiling (#1763), carrying the
 *  {@link BootStalledRecovery} verdict DECIDED here (never re-derived at the card). Reachable
 *  only via an `accrue` tag, so a kaval-restart warming (tagged `retain`) can never
 *  mislabel-escape. Three routes:
 *   - A hung LOCAL binding leg reuses the byte-identical down/dead DegradedCanvas (#1713
 *     preserved) — covers a connected LOCAL daemon-pending and a LOCAL warming restart-drain
 *     (both leg `daemon`, local).
 *   - The `provisioning` leg is the CONNECTOR-owned warming-remote campaign: the server ssh
 *     connector still owns the retry loop (PR1's `recheck()`), so recovery recycles IT and the
 *     copy stays non-terminal — never the reload lie (#1908 D2). `phase` names where it is.
 *   - Every remaining leg (now narrowed to {@link ClientStalledLeg}) is genuinely client-side —
 *     a connected host's session/daemon subscription or a membership stall a fresh boot re-runs. */
function escapeSurface(tag: AccruingBootTag, facts: CanvasFacts): CanvasMode {
  // Dispatch on the leg (+ host-locality for the down/dead route) with `.exhaustive()`
  // (prefer-ts-pattern), matching `resolvePrecedence` above — a future `StalledLeg` must be
  // handled here or fail the build. The `membership | session | daemon` arm is exactly
  // {@link ClientStalledLeg} (`provisioning` is consumed by the connector arm), so `leg` narrows
  // to it cast-free for the client recovery.
  return match({ leg: tag.leg, isLocalHost: facts.isLocalHost })
    .with(
      { leg: "daemon", isLocalHost: true },
      (): CanvasMode => ({ kind: "down", down: { state: "dead" } }),
    )
    .with(
      { leg: "provisioning" },
      (): CanvasMode => ({
        kind: "boot-stalled",
        recovery: {
          via: "connector",
          phase: tag.phase,
          log: tag.log,
          logAbsence: tag.logAbsence,
        },
      }),
    )
    .with(
      { leg: P.union("membership", "session", "daemon") },
      ({ leg }): CanvasMode => ({
        kind: "boot-stalled",
        recovery: { via: "client", leg },
      }),
    )
    .exhaustive();
}

/** THE ONE exported resolver (#1763). Computes the raw precedence, then — off ONE
 *  resolve — escapes to {@link escapeSurface} iff the boot deadline is `exceeded` AND the
 *  raw surface is a boot overlay (`tag.accrual === "accrue"`, declared at the return site).
 *  Returns both the `mode` to render and the `tag`, which the caller feeds to the per-host
 *  boot-deadline anchor (`bootDeadline.ts`): a pure switch on `tag.accrual`. The escape keeps
 *  the raw `tag` (still `accrue`) so the escaped frame keeps accruing (stays escaped) until
 *  the hung leg finally delivers and the raw surface settles.
 *
 *  A boot overlay's fate is decided on the OBSERVER's pair — the #2129 link liveness and
 *  the #1763 `exceeded` ceiling — never on `kind` and never on which arm produced the tag.
 *  Both rules are explained ONCE, in this module's header ("The observability floor");
 *  the body below carries only the per-outcome notes. */
export function resolveCanvasMode(
  facts: CanvasFacts,
  /** The OBSERVER's standing to time a boot: whether THIS browser's link to kolu-server
   *  is live (#2129), and whether a ceiling already elapsed while it was (#1763). Both
   *  are facts about US, not about any surface, so they arrive together and OUTSIDE the
   *  entry-keyed {@link CanvasFacts} union — no arm can carry them, and no arm has to
   *  remember to.
   *
   *  `earnedBoot` names the boot whose ceiling produced that `exceeded` — the sampled half of
   *  the sample-and-hold, held for the same reason the verdict is (`bootDeadline.ts`). It is
   *  read ONLY while blind, where the live facts can no longer be trusted to name the boot
   *  they describe; over a live link the frame's own tag is fresher and wins. */
  observation: {
    transportLive: boolean;
    exceeded: boolean;
    /** REQUIRED, not optional — `undefined` must be SAID. An optional field here would be a
     *  silent-degradation path: a caller that simply forgot it would compile, and the AFP C6
     *  exemption would quietly go back to recomputing the earned card from facts the outage
     *  has already rewritten. Same reason `floorOnLiveness` takes `live` as a required
     *  argument (`@kolu/surface-map`) — the writer cannot forget to floor. */
    earnedBoot: BootIdentity | undefined;
  },
): Precedence {
  const raw = resolvePrecedence(facts);
  // ONE dispatch on the observer's pair, `.exhaustive()` like every other dispatch in this
  // module (prefer-ts-pattern) — a future 4th `accrual` variant must be handled here or
  // fail the build, rather than falling through as a silent no-op.
  return (
    match({ tag: raw.tag, ...observation })
      // EARNED — first, and that ORDER is the whole AFP C6 exemption: a verdict that
      // elapsed while the link was live is ours to KEEP through a blip, card and recovery
      // verb intact. "While the link was live" is a PROPERTY of the `exceeded` we are handed,
      // not a hope about it: `bootDeadlineExceeded` samples-and-holds it on the same
      // `transportLive` read, so a ceiling crossed entirely across an outage (a tab frozen
      // mid-boot) never arrives here as `true`.
      //
      // KEEPING a verdict means keeping the CARD it earned, not just the boolean — so while
      // blind the boot's IDENTITY comes from the hold, not from this frame. The live facts
      // have already moved under us by then: `floorOnLiveness` demotes the entry off the
      // `connected` arm on the same tick, and the warming arm derives its leg from
      // host-locality alone, so recomputing would swap the earned card for a different,
      // UNEARNED one — a local `session` stall becoming the `down`/dead card, this PR's own
      // false claim reached through the exemption. Only the identity is held: the NARRATION
      // (`phase`/`log`/`logAbsence`) stays this frame's, because "kolu cannot see your
      // machine" is a true thing to be saying while it is true. Recording the merged tag is
      // what also keeps the clock frozen — same ceiling → no re-anchor, earned leg (not a
      // demotion-invented `provisioning`) → no campaign cell armed on a frame nobody watched.
      //
      // WATCHED — the link is live, so this frame's own tag IS the earned identity.
      .with(
        { tag: { accrual: "accrue" }, exceeded: true, transportLive: true },
        ({ tag }) => ({ mode: escapeSurface(tag, facts), tag }),
      )
      // HELD — blind, but a boot identity is IN HAND, so the card that was earned is rebuilt
      // from the boot that earned it rather than from facts the outage has rewritten.
      //
      // Requiring the identity is a GUARD, not a convenience: this used to be a `||
      // earnedBoot === undefined ? tag : …` fallback, which meant a blind frame with no
      // watched boot escaped to a card assembled from THIS frame's invented leg — a local
      // host reads leg `daemon`, whose escape is the `down`/dead card, i.e. #2129's own false
      // claim reached straight through the exemption. It was unreachable only because
      // `bootDeadline.ts` writes and releases the verdict and the identity together, an
      // invariant living in another module. Now the rule is stated where it is relied on: an
      // exemption for an EARNED verdict must be able to name the boot that earned it, and a
      // frame that cannot falls through to the floor below, which makes no claim at all.
      .with(
        {
          tag: { accrual: "accrue" },
          exceeded: true,
          earnedBoot: P.not(undefined),
        },
        ({ tag, earnedBoot }) => {
          const earned: AccruingBootTag = { ...tag, ...earnedBoot };
          return { mode: escapeSurface(earned, facts), tag: earned };
        },
      )
      // BLIND — ONE rule for every variant, no per-accrual carve-out: while the link
      // is down we are not watching a slow boot, we are not watching, so nothing may hold a
      // clock. CLEAR releases the anchor; the mode passes through untouched, because the
      // transport overlay already owns the screen. With the two exemption arms above narrowed
      // to verdicts that can NAME their boot, this also catches the unearned-while-blind case,
      // which is the honest place for it: no watched boot, no card.
      //
      // Only `accrue` can reach this in production — every `retain` return site is on the
      // connected arm, and `floorOnLiveness` demotes an entry off that arm in the same tick
      // this fact goes false (both now read ONE `padiMap.live()`, so they cannot disagree).
      // Covering `retain` anyway is therefore a provable no-op today, and it buys the
      // deletion of a cross-package invariant that was previously held by prose alone: if a
      // future `retain` site appears outside the connected arm, or surface-map changes its
      // floor, the rule still holds instead of silently mis-timing. (The lens review split
      // exactly here — one lens asserting the frame unreachable, the other noting the
      // `empty`-site `retain` documents itself as handling it; both are right about
      // different things, and this states the rule so neither has to be trusted.)
      .with({ transportLive: false }, () => clear(raw.mode))
      // A live link: nothing to floor, and nothing about WHICH accrual it is changes that —
      // a boot genuinely in progress keeps accruing, a settled surface releases, a non-boot
      // overlay holds, all by passing `raw` through untouched. Spelled as one arm over the
      // union rather than three identical ones, so the rule reads as the single rule it is;
      // naming the variants (not `P.any`) is what keeps `.exhaustive()` load-bearing — a
      // future 4th `accrual` is outside this union and still fails the build here.
      .with(
        { tag: { accrual: P.union("accrue", "retain", "clear") } },
        () => raw,
      )
      .exhaustive()
  );
}
