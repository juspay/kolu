/** Pure, side-effect-free presentation for the kaval daemon + ws transport — the
 *  tables and projections the rail, the dialog, and the canvas all read.
 *
 *  Deliberately imports NOTHING with a module-load side effect (no `../wire`, which
 *  opens the PartySocket; no `createRoot`): only types, the pure `compactDelta`
 *  ladder, and ts-pattern's side-effect-free `match`. `useDaemonStatus.ts` (the
 *  wire-coupled subscription + accessors) re-exports the slice of this presentation
 *  API that existing call sites reach through it (the rail, the dialog, App.tsx's
 *  canvas), so those importers are unchanged — but the presentation is now testable
 *  on its own, which is what lets `toKavalPresence`'s transport-liveness floor be pinned
 *  by a unit test without standing up a socket. */

import type {
  DaemonState,
  DaemonStatus,
  KavalSkewVersions,
} from "@kolu/padi/surface";
import { match, P } from "ts-pattern";
import type { WsStatus } from "../rpc/rpc";
import { compactDelta } from "../time/duration";

/** A daemon state's coarse tone — the warming-up/up/down bucket every display
 *  site shares. `restarting` and `connecting` are both `warming` (transient,
 *  coming up), declared once here rather than re-collapsed at each dot map. */
export type DaemonTone = "ok" | "warming" | "down";

/** The single source of truth for "what does daemon state X mean visually."
 *  One row per state, keyed by `DaemonState`, so a new state is a compile-forced
 *  row instead of N independent edits across the dialog, rail, and gate. Every
 *  presentation a consumer needs is derived from this table: the dot class from
 *  `tone` (via {@link toneDot}), the dialog/rail label from `label`, the App.tsx
 *  warming-canvas message from `canvasLabel`, and the DegradedCanvas narrowing
 *  from `down`. The table is client-only — the tones, labels, and Tailwind
 *  classes are projections of the state, not part of the wire
 *  `DaemonStatusSchema`. */
export const DAEMON_STATE_PRESENTATION: Record<
  DaemonState,
  {
    tone: DaemonTone;
    label: string;
    canvasLabel: string;
    down: boolean;
    /** Which recovery VERB a down state gets: `restart` (a plain restart can
     *  fix it — dead/degraded) or `renew` (only a closure change can —
     *  `incompatible`'s "Update & restart kaval"). Declared in the SAME row
     *  that declares tone and downness, so a future down state must pick its
     *  verb here rather than silently inheriting Restart at a consumer
     *  (see {@link offerRestartVerb}). Absent on the not-down states. */
    recovery?: "restart" | "renew";
  }
> = {
  connecting: {
    tone: "warming",
    label: "starting…",
    canvasLabel: "Connecting…",
    down: false,
  },
  connected: {
    tone: "ok",
    label: "running",
    canvasLabel: "Connected",
    down: false,
  },
  restarting: {
    tone: "warming",
    label: "restarting…",
    canvasLabel: "Restarting kaval…",
    down: false,
  },
  degraded: {
    tone: "down",
    label: "stopped (session preserved)",
    canvasLabel: "Stopped",
    down: true,
    recovery: "restart",
  },
  dead: {
    tone: "down",
    label: "not running",
    canvasLabel: "Not running",
    down: true,
    recovery: "restart",
  },
  // The PROVEN contract skew (SK4): terminal like `dead`, but a DIFFERENT
  // verdict — a restart provably cannot fix it (the arm's only producer is a
  // respawn that already skewed), so the canvas/dialog render the skew card
  // with both versions and the ONE recovery that changes the closure
  // (`hosts.renewDaemon`), never a Restart verb.
  incompatible: {
    tone: "down",
    label: "incompatible — needs update",
    canvasLabel: "Incompatible",
    down: true,
    recovery: "renew",
  },
};

/** A tone → status-dot class. The one place `warming`==`animate-pulse` etc. is
 *  spelled, so the dot is derived from {@link DAEMON_STATE_PRESENTATION}'s tone
 *  rather than re-tabulated per display. */
export const toneDot: Record<DaemonTone, string> = {
  ok: "bg-ok",
  warming: "bg-warning animate-pulse",
  down: "bg-danger",
};

/** The grey "we don't know" tone — used before the first daemon-status yield AND
 *  whenever the transport delivering that status is not live (see
 *  {@link kavalPresencePresentation}). Distinct from `down` (`bg-danger`, "the daemon is
 *  dead"): grey means "unknown", not "dead", so a dead link never masquerades as a
 *  definite verdict. */
export const DAEMON_UNKNOWN_DOT = "bg-fg-3/50";

/** The status WORD shown whenever a daemon's liveness is unknown — the label twin of
 *  {@link DAEMON_UNKNOWN_DOT}, so the dot and the word for "we can't confirm this daemon"
 *  live together in one place. Read by the kaval/padi presence projections AND the two
 *  host-chip tooltips ({@link kavalPresencePresentation}, `padiPresencePresentation`, and
 *  the rail's `kavalStateText`/`padiTip`), so a copy change ("unknown" → "offline"/"—")
 *  is one edit, not four. */
export const DAEMON_UNKNOWN_LABEL = "unknown";

/** Compact human uptime from a millisecond delta — `45s`, `12m`, `3h 20m`,
 *  `2d 4h`. The one uptime projection for the one daemon: the rail (passing
 *  `clockNow() - startedAt`) and the kaval dialog (`Date.now() - startedAt`)
 *  both call this, so a format tweak reaches both surfaces at once. Renders the
 *  dual-unit form of the shared {@link compactDelta} ladder (the sub-tier where
 *  one exists), so the sec/min/hr/day thresholds stay defined in one place. */
export function formatUptime(ms: number): string {
  const { value, unit, sub } = compactDelta(ms);
  return sub ? `${value}${unit} ${sub.value}${sub.unit}` : `${value}${unit}`;
}

/** A WebSocket transport status → its coarse tone — `connecting` is transient
 *  (warming, pulses), `open` is healthy, `closed` is down. The one place the
 *  WS-status→tone mapping lives. MODULE-PRIVATE: it feeds only the (also private)
 *  {@link wsDot}; the `srv`/mobile dots paint through {@link serverDot}, so the
 *  unfloored lifecycle-only tone has no external spelling. */
const wsTone: Record<WsStatus, DaemonTone> = {
  connecting: "warming",
  open: "ok",
  closed: "down",
};

/** A WebSocket status → its status-dot class, via {@link wsTone} + {@link toneDot}.
 *  MODULE-PRIVATE: it is half-open-BLIND (open→green with no liveness input), so the
 *  ONLY public connection-dot path is {@link serverDot}, which floors its green on
 *  the watchdog fact. Un-exported so the unfloored open→green can't be re-minted at a
 *  future call site (the same seam-closing as `createSurfaceHealthRegistry`). */
const wsDot = (status: WsStatus): string => toneDot[wsTone[status]];

/** The `srv`/mobile **server-connection** dot's tone, FLOORED on the watchdog-backed
 *  transport `live` — the connection-dot sibling of {@link kavalPresencePresentation}, and the
 *  canonical #1568 "paint the connection dot from the FACT, not a narrower signal."
 *
 *  `status` is the open/close-only oRPC lifecycle (`WsStatus`), which is half-open
 *  BLIND: a silently dead socket fires no `close`, so the lifecycle reads `open`
 *  while the half-open watchdog (the SAME socket's `health().live`) has already
 *  flipped `live` false at its probe timeout — it forces the reconnect the lifecycle
 *  only sees AFTERWARD. So a bare `wsDot` would paint a definite green "connected"
 *  over a link the fact already knows is dead. When the lifecycle says `open` but the
 *  fact says not-`live`, paint the reconnecting (warming) tone instead — never green
 *  over a half-open the watchdog caught. A genuine `closed`/`connecting` keeps its own
 *  honest down/warming tone (the floor only withholds the `open`→green claim). */
export function serverDot(status: WsStatus, live: boolean): string {
  if (status === "open" && !live) return toneDot.warming;
  return wsDot(status);
}

/** Is a daemon state in the transient "warming" bucket — `connecting` (boot) or
 *  `restarting` (a supervised restart in flight)? Derived from the presentation
 *  table so the warming set is named ONCE. MODULE-PRIVATE: the transport-liveness-
 *  floored {@link liveWarming} wraps it, and is what every consumer reads (the
 *  canvas via `daemonWarming`, the ⌘T lockout, the restart-button predicate), so the
 *  unfloored predicate has no external spelling; a future warming state is covered
 *  for free. */
function isWarming(state: DaemonState | undefined): boolean {
  return state ? DAEMON_STATE_PRESENTATION[state].tone === "warming" : false;
}

/** {@link isWarming}, FLOORED on transport liveness — the same floor `toKavalPresence`
 *  applies to the dot. A daemon-state claim ("the daemon is coming up") only holds
 *  over a LIVE link: when `live` is false (transport dead / silently half-open) the
 *  retained state is stale, so a known "warming" state may only REFINE the verdict
 *  WITHIN a live link, never assert "restarting…/connecting…" over a dead channel.
 *  Every consumer of "is the daemon warming" reads the floor through THIS one
 *  function — most via `daemonWarming()` (the App canvas, the ⌘T terminal-creation
 *  lockout `refuseIfWarming`, the command-palette gate), and `restartInFlight`
 *  (the Restart-kaval button gate) by calling `liveWarming` directly with the same
 *  `(state, daemonTransportLive())` pair, so its warming arm stays exactly
 *  `daemonWarming()`'s body. The floor is therefore applied ONCE here, and no
 *  consumer can read an unfloored warming verdict. */
export function liveWarming(
  state: DaemonState | undefined,
  live: boolean,
): boolean {
  return live && isWarming(state);
}

/** The daemon's down verdict as the canvas consumes it — a payload-bearing sum
 *  (SK4): `dead`/`degraded` carry nothing extra; `incompatible` carries BOTH
 *  contract versions off the typed wire arm ({@link KavalSkewVersions}, the
 *  ONE skew-payload spelling), so the skew card renders them structurally
 *  (never re-parsed from prose). */
export type DaemonDownState =
  | { state: "dead" | "degraded" }
  | ({ state: "incompatible" } & KavalSkewVersions);

/** The daemon's down sub-state, FLOORED on transport liveness — the down twin of
 *  {@link liveWarming}. "The daemon is down" is a claim the dead channel can't
 *  confirm, so when `live` is false this reads `undefined` ("unknown"), never a
 *  stale down verdict that would paint DegradedCanvas over a link we can't see
 *  through. The post-grace transport overlay owns the disconnect messaging
 *  instead; a known down-state may only refine the canvas WITHIN a live link.
 *  (Unknown ≠ down — same distinction `DAEMON_UNKNOWN_DOT` draws for the dot.)
 *  Takes the FULL status (not just the state) because the `incompatible` arm's
 *  versions ride the same wire value — the down union is derived from the
 *  presentation table's `down` flag, so a future down state is covered here by
 *  construction. */
export function liveDownState(
  status: DaemonStatus | undefined,
  live: boolean,
): DaemonDownState | undefined {
  if (!live || !status) return undefined;
  // Exhaustive `match` over the WHOLE wire union — no `.state as "dead" |
  // "degraded"` cast: `.exhaustive()` makes a new `DaemonState` member a
  // compile error here until it picks an arm, so a future down state can never
  // slip through mislabelled as `dead`/`degraded` and render the Restart verb
  // against a daemon a restart can't fix (the exact class SK4 made
  // unspellable — never re-open it via a cast). The up arms map to `undefined`
  // ("not down"); their `down: false` in DAEMON_STATE_PRESENTATION is pinned
  // equal to this by daemonPresentation.test.ts, so the two agree by test.
  return match(status)
    .with(
      { state: P.union("connecting", "connected", "restarting") },
      () => undefined,
    )
    .with({ state: P.union("dead", "degraded") }, (s) => ({ state: s.state }))
    .with({ state: "incompatible" }, (s) => ({
      state: "incompatible" as const,
      daemonVersion: s.daemonVersion,
      requiredVersion: s.requiredVersion,
    }))
    .exhaustive();
}

/** Whether a surface may OFFER the "Restart kaval" verb (D5c/SK4): never while
 *  warming (a restart is already in flight / booting — the verb would be a
 *  no-op) and, for a down state, only when its presentation row declares
 *  `recovery: "restart"` — a PROVEN skew (`incompatible`) declares `renew`
 *  instead (a restart provably respawns the same incompatible binary; the skew
 *  card's "Update & restart kaval" is the recovery there). Read off
 *  {@link DAEMON_STATE_PRESENTATION} — not an open negative check against one
 *  state literal — so a future down state must declare its verb in the same
 *  row that declares its tone and downness, never silently inheriting Restart.
 *  The palette reads this so the affordance stays a total function of the
 *  state sum, testable without the wire. */
export function offerRestartVerb(
  warming: boolean,
  down: DaemonDownState | undefined,
): boolean {
  return (
    !warming &&
    (down === undefined ||
      DAEMON_STATE_PRESENTATION[down.state].recovery === "restart")
  );
}

// ── The active-entry leg: the SECOND floor on the (host-scoped) kaval daemonStatus ──
//
// `daemonStatus` is scoped per active host — RETAINED per host since W9
// (`activeScope().wire.daemonStatus`). For a REMOTE active host the
// browser↔kolu-server ws (`transportLive`) can be up while the leg that actually delivers
// that host's status — the server→remote link (the entry's own `EntryStatus`, projected
// from its session's connection state, {@link @kolu/surface-remote's serveHostMap}) — is
// dead/(re)establishing. On that flap the re-served `daemonStatus` FREEZES stale at
// whatever it last read, so a rail floored only on `transportLive` paints a green
// "running" kaval dot over a dead/warming daemon, contradicting the (honestly red/warming)
// host chip — the #1568 green-over-dead class `foldState` floors on the chip, relocated to
// the rail. This leg closes it: the daemonStatus channel is live only when the active
// entry is itself `connected`.
//
// This is the SAME leg the LOCAL host's `daemon.restart` drain rides — the local session
// is a `pool` member exactly like a remote one (`serveHostMap` attaches its `onState` no
// differently), so a local padi drain ALSO drops the entry out of `connected` for the
// whole drain window. There is no separate "local padi link" leg to fold any more (W4
// daemon-rail unification, retiring the host-gated `localPadiLinkOnly`/`activePadiLink`
// detour this file used to carry): every host — local or remote — floors on exactly this
// one channel-liveness fact, computed the same way, with no host parameter anywhere in
// this module.

/** The daemonStatus channel's TRUE liveness: the ws transport (`transportLive`) AND the
 *  active host entry's own connection (`entryConnected`). Every kaval-rail read of the
 *  ACTIVE host's daemon state floors on THIS, not `transportLive` alone, so a dead/warming
 *  entry — local (a padi drain) or remote (an ssh flap) alike — reads "unknown", never a
 *  green "running" over a frozen re-served status. Pure so the leg is pinnable without a
 *  socket, like {@link kavalPresencePresentation}. */
export function channelLive(
  transportLive: boolean,
  entryConnected: boolean,
): boolean {
  return transportLive && entryConnected;
}

// ── KavalPresence — the P4 escape-hatch retirement ──────────────────────────────
//
// The wire's `DaemonStatusSchema` keeps `identity` OPTIONAL on the `connected` arm for
// one reason: a pre-identity kaval build's own `system.version` predates the field
// (`@kolu/padi/ptyHost/connect.ts`'s backward-compat seam — `@kolu/padi`'s call, not this
// package's). That optionality let the DIALOG render a `connected` kaval with a
// synthesized "—" build commit — the overloaded-null the drain/reconnect bug rode: a
// dead-subscription "unknown" and a genuinely-connected-but-not-yet-identified kaval were
// indistinguishable at the render site, both spelled with a `??`/ternary fallback.
//
// `KavalPresence` retires that: it is a NARROWER, client-owned sum every render site must
// go through — `identity` is MANDATORY on its `connected` arm, so "connected but identity
// unknown" is IMPOSSIBLE TO CONSTRUCT (a compile error, pinned by
// `daemonPresentation.test.ts`'s `@ts-expect-error`). `toKavalPresence` is the ONE place
// that decides what an identity-less "connected" wire value means — it folds to
// `warming` (still becoming known), never a synthesized "—" beside a green dot.

/** The wire's optional per-kaval identity, narrowed to "definitely present" — the shape
 *  `KavalPresence`'s `connected` arm carries. Derived from `DaemonStatus["identity"]`
 *  (not re-declared) so it can never drift from the wire schema. */
export type KavalIdentity = NonNullable<DaemonStatus["identity"]>;

/** A daemon's serialized lifetime as it rides the wire — the daemon-neutral shape
 *  shared by both kaval (`status.lifetime`) and padi (`identity.lifetime`), derived
 *  from the schema (not re-declared) so it can never drift. Optional on the wire (a
 *  survivor predating the field reports none), so this is the non-null shape. */
export type DaemonLifetimeView = NonNullable<DaemonStatus["lifetime"]>;

/** The kaval dialog's own honest presence sum — the dialog's SOLE daemon input (there is
 *  no `props.status` at the render site any more, so a connected-era fact can only be read
 *  off the `connected` arm; "render a fact while not live" is a type error, #1793). Two
 *  orthogonal facets travel together, deliberately:
 *
 *  - `kind` is the FACT-GATE — the only arm carrying the connected-era facts
 *    (contractVersion, socketPath, identity, startedAt, lifetime) is `connected`, reached
 *    only over a live link with an arrived identity. Every other arm carries NO fact.
 *  - `state` (on `warming`/`down`) is the PRESENTATION facet — the fine `DaemonState` the
 *    dot tone and the status word derive from ({@link kavalPresencePresentation}),
 *    so a live `restarting` still reads "restarting…" and
 *    a live pre-identity `connected` still reads "running", losslessly. `state` is coarse
 *    liveness, NOT a fact — it can never spell a socket path or a contract version.
 *
 *  `unknown` (dead/half-open channel or pre-first-value) is DISTINCT from `warming`
 *  (a LIVE link coming up): the dot must read grey "unknown", never a warming pulse that
 *  implies "coming up" over a dead channel. */
export type KavalPresence =
  | {
      kind: "connected";
      identity: KavalIdentity;
      contractVersion: string;
      startedAt: number;
      socketPath: string | undefined;
      /** The daemon's lifetime (`forever` in production; `boundToPid` under a
       *  test/smoke run). `undefined` for a survivor predating the wire field. */
      lifetime: DaemonLifetimeView | undefined;
    }
  /** A LIVE link coming up: `connecting`/`restarting`, or a `connected` wire status whose
   *  `identity` has not (yet) arrived (`state: "connected"` → still reads "running", but no
   *  facts are trustworthy yet). */
  | { kind: "warming"; state: "connecting" | "restarting" | "connected" }
  /** No trustworthy state at all — a dead/half-open channel (not live) or pre-first-value.
   *  Grey "unknown", never a definite verdict painted off a value the dead channel can no
   *  longer confirm (the #1568 floor). */
  | { kind: "unknown" }
  | { kind: "down"; state: "dead" | "degraded" }
  /** The PROVEN contract skew (SK4) — its own arm, never folded into `down`
   *  (a restart can fix `down`; nothing but a closure change fixes this) and
   *  never allowed to fall through to a lying `warming` pulse. PAYLOAD-LESS:
   *  the versions are rendered by the two deliberate skew surfaces — the
   *  canvas card ({@link DaemonDownState}) and the attention chip/banner
   *  (`KavalAttention`) — and the presence's one consumer (the dialog)
   *  extracts only `connected`, so carrying a third copy here would be a
   *  projection nobody reads. */
  | { kind: "incompatible" };

/** Project a (possibly stale/absent) `DaemonStatus` + the channel's liveness into the
 *  client's own honest {@link KavalPresence} — the ONE place "connected" is decided.
 *  Floored on `live` exactly like {@link liveWarming}/{@link liveDownState} (and the
 *  dot it feeds, {@link kavalPresencePresentation}): a dead/half-open channel can't confirm ANY
 *  state, so it folds
 *  to `unknown` (never a stale "connected" claim over a value the dead channel can no
 *  longer refresh). */
export function toKavalPresence(
  status: DaemonStatus | undefined,
  live: boolean,
): KavalPresence {
  if (!live || status === undefined) return { kind: "unknown" };
  if (status.state === "dead" || status.state === "degraded")
    return { kind: "down", state: status.state };
  if (status.state === "incompatible") {
    // The proven skew must NEVER read as a warming pulse — it is a terminal
    // verdict. Payload-less: the versions ride the two surfaces that render
    // them (`liveDownState`'s canvas card, `kavalAttention`'s chip/banner).
    return { kind: "incompatible" };
  }
  if (status.state !== "connected")
    return { kind: "warming", state: status.state }; // connecting | restarting
  if (status.identity === undefined)
    return { kind: "warming", state: "connected" }; // pre-identity survivor
  return {
    kind: "connected",
    identity: status.identity,
    contractVersion: status.contractVersion,
    startedAt: status.startedAt,
    socketPath: status.socketPath,
    lifetime: status.lifetime,
  };
}

/** The presentation of a kaval {@link KavalPresence} — its dot tone, its status word, AND
 *  the label's text tone, as ONE value from ONE `match`. "The presentation of a presence"
 *  is a single concept: a new presence arm updates all three facets here at once, never in
 *  three parallel exhaustive matches kept arm-aligned by hand (this mirrors how
 *  {@link DAEMON_STATE_PRESENTATION} keeps a state's tone + label in one row). Both BOTH
 *  the dialog (a single memo, reading `.dot`/`.label`/`.textClass`) and the rail mark
 *  (reading `.dot`) share it, so the `!live → unknown` floor — folded into
 *  {@link toKavalPresence} — reaches every surface. `unknown` is grey + `text-fg-3`;
 *  every other arm reuses {@link DAEMON_STATE_PRESENTATION}'s tone/label off the arm's
 *  `state`, so a live `restarting` still reads "restarting…" and a live pre-identity
 *  `connected` still reads "running". */
export function kavalPresencePresentation(presence: KavalPresence): {
  dot: string;
  label: string;
  textClass: string;
} {
  return match(presence)
    .with({ kind: "unknown" }, () => ({
      dot: DAEMON_UNKNOWN_DOT,
      label: DAEMON_UNKNOWN_LABEL,
      textClass: "text-fg-3",
    }))
    .with({ kind: "connected" }, () => ({
      dot: toneDot[DAEMON_STATE_PRESENTATION.connected.tone],
      label: DAEMON_STATE_PRESENTATION.connected.label,
      textClass: "text-fg",
    }))
    .with({ kind: "warming" }, (p) => ({
      dot: toneDot[DAEMON_STATE_PRESENTATION[p.state].tone],
      label: DAEMON_STATE_PRESENTATION[p.state].label,
      textClass: "text-fg",
    }))
    .with({ kind: "down" }, (p) => ({
      dot: toneDot[DAEMON_STATE_PRESENTATION[p.state].tone],
      label: DAEMON_STATE_PRESENTATION[p.state].label,
      textClass: "text-fg",
    }))
    .with({ kind: "incompatible" }, () => ({
      dot: toneDot[DAEMON_STATE_PRESENTATION.incompatible.tone],
      label: DAEMON_STATE_PRESENTATION.incompatible.label,
      textClass: "text-fg",
    }))
    .exhaustive();
}

/** The kaval rail mark's `data-daemon-state` attribute, projected from
 *  {@link KavalPresence} — the machine-readable twin of the dot tone that e2e selectors
 *  key on. `connected`/`incompatible`/`unknown` name themselves; `warming`/`down` expose
 *  the arm's fine `DaemonState` so `connecting`/`restarting`/`dead`/`degraded` stay
 *  distinguishable. Behavior-identical to the retired raw `(state, live)` attribute: a
 *  pre-identity `connected` still reads `connected` (the `warming` arm carries
 *  `state: "connected"`). */
export function daemonStateAttr(presence: KavalPresence): string {
  return match(presence)
    .with({ kind: "connected" }, () => "connected")
    .with({ kind: "warming" }, (p) => p.state)
    .with({ kind: "down" }, (p) => p.state)
    .with({ kind: "incompatible" }, () => "incompatible")
    .with({ kind: "unknown" }, () => "unknown")
    .exhaustive();
}

/** Humanize a daemon's serialized lifetime for the Kaval/Padi dialog rows —
 *  shared by both (padi's `identity.lifetime`, kaval's `status.lifetime`). A
 *  survivor predating the wire field (`undefined`) reads "—". `forever` is the
 *  production value; `boundToPid` appears under a test/smoke run. */
export function formatLifetime(
  lifetime: DaemonLifetimeView | undefined,
): string {
  if (lifetime === undefined) return "—";
  return match(lifetime)
    .with({ kind: "forever" }, () => "forever")
    .with(
      { kind: "idleTimeout" },
      (l) => `idle timeout (${formatUptime(l.ms)})`,
    )
    .with({ kind: "boundToPid" }, (l) => `bound to run pid ${l.pid}`)
    .exhaustive();
}
