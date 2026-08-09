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
 *  ── The observability floor ─────────────────────────────────────────
 *  A boot deadline is a claim about the SERVER — "this leg was given its ceiling and
 *  never delivered" — so it is only ours to make while THIS browser can reach the
 *  server. {@link resolveCanvasMode} therefore downgrades an `accrue` frame to `clear`
 *  whenever `transportLive` is false: the deadline neither fires nor accumulates, and
 *  the mode passes through untouched (the transport overlay already owns the screen).
 *
 *  The bug that earned it: `floorOnLiveness` (`@kolu/surface-map`) DEMOTES a published
 *  `connected` entry to `warming` over a dead link, so a green chip can never outlive
 *  the link that proves it (#1568). Correct — but it makes "the host is coming up" and
 *  "we cannot see the host" the SAME value. A backgrounded tab (a fullscreen game
 *  throttling its timers) lost the socket for minutes; the local entry demoted to
 *  `warming`, which is leg `daemon` under the LOCAL ceiling, and the monotonic clock
 *  kept advancing — so 30s later the escape certified a kaval that had been running for
 *  twelve hours as `dead`. Two individually-correct mechanisms composed into a false
 *  claim; this floor is the seam that refuses to make any claim at all.
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
import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import {
  NO_LOG_LINES,
  type LogAbsence,
  type LogLine,
} from "../ui/logTailChrome";
import { match, P } from "ts-pattern";
import { isProvisioningPhase } from "../host/connectCanvasCopy";
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
 *     down / host-failed) or UNOBSERVABLE (the observability floor: our link to the server is
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

/** The liveness facts every arm carries, regardless of the active entry's
 *  connection state — the session-loading flag and the host-locality fact the
 *  loading guard reads BEFORE it ever consults an entry arm. Kept as a shared
 *  base so each arm below adds only the facts its own surface needs. */
interface EntryLivenessFacts {
  isLoading: boolean;
  daemonPending: boolean;
  /** THIS browser's own link to kolu-server — the watchdog-backed `app.health().live`
   *  (`daemonTransportLive`), NOT the per-host channel. It is the one fact on this base
   *  that describes US rather than the active host, and it gates the boot deadline for
   *  EVERY arm (see {@link resolveCanvasMode}): with the link down we cannot observe a
   *  boot at all, so no leg may accrue against a ceiling and no escape may fire.
   *
   *  It cannot be folded into the connected arm's `channelLive` (= transport ∧ entry
   *  connected): on the not-yet-connected arms the entry is BY CONSTRUCTION not
   *  connected, so `channelLive` is false there whether our link is up or down — exactly
   *  the two cases that must be told apart. A `warming` LOCAL entry is a kaval
   *  restart-drain worth escaping when we can see the server, and a dropped socket when
   *  we can't. */
  transportLive: boolean;
  /** True while the ACTIVE host is the unremovable LOCAL default. It selects the
   *  boot-deadline CEILING CLASS (local = 30s; a remote's ssh provisioning
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
        (f): Precedence => {
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
          // warming surface (no kaval `daemonState`); `not-a-member` holds neutral `connecting`
          // (never a stale claim about a non-member).
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
function escapeSurface(
  tag: Extract<BootTag, { accrual: "accrue" }>,
  facts: CanvasFacts,
): CanvasMode {
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
 *  the hung leg finally delivers and the raw surface settles. */
export function resolveCanvasMode(
  facts: CanvasFacts,
  deadline: { exceeded: boolean },
): Precedence {
  const raw = resolvePrecedence(facts);
  // THE OBSERVABILITY FLOOR. A boot deadline is a claim about the SERVER — "this
  // leg was given its ceiling and never delivered". That claim is only ours to make while
  // THIS browser can actually reach the server. With `transportLive` false we are not
  // watching a slow boot, we are not watching at all: every subscription is re-pending
  // because the retry fence dropped them, not because anything failed to start. So an
  // `accrue` frame is downgraded to CLEAR — the deadline neither fires (no escape) nor
  // accumulates.
  //
  // The MODE is deliberately passed through untouched: the transport overlay already owns
  // the screen (dimmed, click-through, so scrollback stays readable), and blanking the
  // canvas on every drop would be a worse lie than the dead card this removes.
  //
  // CLEAR, not RETAIN, is load-bearing. RETAIN holds the class anchor, so the outage's
  // elapsed would survive the reconnect and the very first live frame — the ~300ms window
  // where the socket is back but the snapshot has not landed — would read `exceeded` and
  // flash the dead card anyway. Releasing the anchor makes observation restart with a full
  // fresh window, which is the honest reading: we watched nothing, so we timed nothing.
  //
  // ACCEPTED EDGE: a transport that flaps faster than the ceiling keeps re-anchoring, so a
  // genuinely wedged daemon behind a flapping link never escapes. That is the correct
  // outcome, not a residual — a browser that cannot hold a socket has no standing to
  // certify a daemon dead, and the transport overlay is what the user sees meanwhile.
  if (!facts.transportLive && raw.tag.accrual === "accrue") {
    return { mode: raw.mode, tag: CLEAR };
  }
  if (deadline.exceeded && raw.tag.accrual === "accrue") {
    return { mode: escapeSurface(raw.tag, facts), tag: raw.tag };
  }
  return raw;
}
