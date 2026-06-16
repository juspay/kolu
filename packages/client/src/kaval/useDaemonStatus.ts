/**
 * The live status of this host's pty-host daemon (kaval), as the server's
 * supervisor endpoint reports it on the `daemonStatus` surface collection.
 *
 * A module-level singleton subscription (one local host, keyed `"local"`),
 * consumed by the ChromeBar's KAVAL rail column and App.tsx's DegradedCanvas
 * gate — so the UI can tell "the daemon is down" apart from "you have no
 * terminals" (B2, the empty-canvas-lie fix).
 */

import type { DaemonState, DaemonStatus } from "kolu-common/surface";
import { createEffect, createRoot } from "solid-js";
import { toast } from "solid-sonner";
import { persistedPref } from "../persistedPref";
import type { WsStatus } from "../rpc/rpc";
import { app } from "../wire";
import { announceReattach } from "./reattachAnnounce";

/** The local host's key. Remote (P3, kaval-sessions) ssh hosts add more keys to
 *  the same `daemonStatus` collection, keyed by hostId. */
export const LOCAL_HOST = "local";

/** A daemon state's coarse tone — the warming-up/up/down bucket every display
 *  site shares. `restarting` and `connecting` are both `warming` (transient,
 *  coming up), declared once here rather than re-collapsed at each dot map. */
export type DaemonTone = "ok" | "warming" | "down";

/** The states a display site renders — the wire `DaemonState` PLUS two
 *  client-only projections for the ssh-host lifecycle (P3). `provisioning`
 *  (cold `nix copy` / dialing a remote) and `unreachable` (a remote host that
 *  dropped) are NEVER on the wire — the `daemonStatus.state` enum stays its 5
 *  members (so the shared surface, and drishti, are untouched). They are
 *  derived at read sites from a remote host's wire state by {@link
 *  clientDaemonState}, so a remote host chip reads "provisioning…/unreachable"
 *  where a local one would read "starting…/stopped". */
export type ClientDaemonState = DaemonState | "provisioning" | "unreachable";

/** The single source of truth for "what does daemon state X mean visually."
 *  One row per `ClientDaemonState`, so a new state is a compile-forced row
 *  instead of N independent edits across the dialog, rail, chip, and gate.
 *  Every presentation a consumer needs is derived from this table: the dot
 *  class from `tone` (via {@link toneDot}), the dialog/rail/chip label from
 *  `label`, the App.tsx warming-canvas message from `canvasLabel`, and the
 *  DegradedCanvas narrowing from `down`. The table is client-only — the tones,
 *  labels, and Tailwind classes are projections of the state, not part of the
 *  wire `DaemonStatusSchema`. */
export const DAEMON_STATE_PRESENTATION: Record<
  ClientDaemonState,
  { tone: DaemonTone; label: string; canvasLabel: string; down: boolean }
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
  },
  dead: {
    tone: "down",
    label: "not running",
    canvasLabel: "Not running",
    down: true,
  },
  // ── client-only remote projections (P3) ──
  provisioning: {
    tone: "warming",
    label: "provisioning…",
    canvasLabel: "Provisioning…",
    down: false,
  },
  unreachable: {
    tone: "down",
    label: "unreachable — session preserved",
    canvasLabel: "Unreachable",
    down: true,
  },
};

/** Compact human uptime from a millisecond delta — `45s`, `12m`, `3h 20m`,
 *  `2d 4h`. The one uptime projection for the one daemon: the rail (passing
 *  `clockNow() - startedAt`) and the kaval dialog (`Date.now() - startedAt`)
 *  both call this, so a format tweak reaches both surfaces at once. */
export function formatUptime(ms: number): string {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ${min % 60}m`;
  return `${Math.floor(hr / 24)}d ${hr % 24}h`;
}

/** A tone → status-dot class. The one place `warming`==`animate-pulse` etc. is
 *  spelled, so the dot is derived from {@link DAEMON_STATE_PRESENTATION}'s tone
 *  rather than re-tabulated per display. */
export const toneDot: Record<DaemonTone, string> = {
  ok: "bg-ok",
  warming: "bg-warning animate-pulse",
  down: "bg-danger",
};

/** A WebSocket transport status → its coarse tone — `connecting` is transient
 *  (warming, pulses), `open` is healthy, `closed` is down. The one place the
 *  WS-status→tone mapping lives, so the `srv` liveness dot (desktop rail) and the
 *  mobile connection dot read ONE receptacle instead of two byte-identical maps. */
export const wsTone: Record<WsStatus, DaemonTone> = {
  connecting: "warming",
  open: "ok",
  closed: "down",
};

/** A WebSocket status → its status-dot class, via {@link wsTone} + {@link
 *  toneDot}. Both the desktop rail's `srv` dot and the mobile chrome dot resolve
 *  through this single helper, so a connection-tone change is made once. */
export const wsDot = (status: WsStatus): string => toneDot[wsTone[status]];

// No explicit `keys` ⇒ the framework subscribes to the collection's SERVER keys
// stream, so the client tracks EVERY host the server publishes (local + each
// configured/dialed remote, P3) without the client having to enumerate them.
const sub = app.collections.daemonStatus.use({
  onError: (err) => toast.error(`Daemon status error: ${err.message}`),
});

/** Every host the server is reporting a daemon status for — `["local"]` today,
 *  plus a key per dialed remote (P3). Drives the per-host chip subscriptions and
 *  the command-palette recent-hosts list. */
export function activeHostIds(): string[] {
  return sub.keys();
}

/** A host's daemon status, or undefined before its first server yield. Defaults
 *  to the local host so every existing call site is unchanged. */
export function daemonStatusFor(hostId = LOCAL_HOST): DaemonStatus | undefined {
  return sub.byKey(hostId)?.();
}

/** The local daemon's status, or undefined before the first server yield. */
export function localDaemonStatus(): DaemonStatus | undefined {
  return daemonStatusFor(LOCAL_HOST);
}

/** The CLIENT presentation-state for a host — the wire state for the local host,
 *  but a remote host's ssh lifecycle projected onto the friendlier P3 labels:
 *  a remote that is dialing/provisioning reads `provisioning`, and a remote that
 *  dropped reads `unreachable` (vs the local "starting…/stopped"). Undefined
 *  before the first yield. The chip + per-tile state read through this. */
export function clientDaemonState(
  hostId: string,
): ClientDaemonState | undefined {
  const state = daemonStatusFor(hostId)?.state;
  if (!state) return undefined;
  if (hostId === LOCAL_HOST) return state;
  if (state === "connecting" || state === "restarting") return "provisioning";
  if (state === "degraded" || state === "dead") return "unreachable";
  return state; // connected
}

/** Recent dial-progress lines for a REMOTE host (P3) — the `nix copy`/realise
 *  output + the remote watcher's stderr the server's `HostSession` accumulated
 *  on the way to this state. The host chip renders these so a minute-long cold
 *  dial shows live activity (and a failure shows why) instead of a static dot.
 *  Empty for the local host and before the first yield. */
export function hostProgress(hostId: string): string[] {
  return daemonStatusFor(hostId)?.progress ?? [];
}

/** True until the daemon-status stream has produced its FIRST value — i.e. the
 *  status is genuinely unknown, not "up". The canvas gates on this so a `dead`
 *  boot never flashes the normal empty workspace before the first status lands
 *  (#1034): if `downState()` (undefined while pending) drove the gate alone and
 *  the session cell resolved to zero terminals first, the empty-state would paint
 *  and then snap to DegradedCanvas. `pending` is undefined before `byKey` has a
 *  subscription, which is itself the pre-first-value state, so treat that as
 *  pending too. */
export function daemonStatusPending(hostId = LOCAL_HOST): boolean {
  return sub.byKey(hostId)?.pending() ?? true;
}

/** The single projection of "is the daemon down, and which kind" — `dead`
 *  (never came up) or `degraded` (died mid-session), or `undefined` when it's
 *  up (or still loading, so a brief load never flashes the degraded surface).
 *  Drives the DegradedCanvas gate AND its `state` prop, so the down-sub-union
 *  is named in one place rather than re-derived by an inline ternary. */
export function downState(
  hostId = LOCAL_HOST,
): "dead" | "degraded" | undefined {
  const state = daemonStatusFor(hostId)?.state;
  if (!state) return undefined;
  // The down-sub-union is whichever states the presentation table marks `down`.
  // Today that is exactly `dead`/`degraded`; the cast holds because no non-down
  // state is flagged `down`, and keeping the narrow return type means a future
  // `down` state must be added to this union deliberately, not silently widened.
  return DAEMON_STATE_PRESENTATION[state].down
    ? (state as "dead" | "degraded")
    : undefined;
}

/** Is a daemon state in the transient "warming" bucket — `connecting` (boot) or
 *  `restarting` (a supervised restart in flight)? Derived from the presentation
 *  table so the warming set is named ONCE: both the module-singleton gate
 *  ({@link daemonWarming}) and the param-taking restart-button predicate
 *  (`restartInFlight` in `useDaemonRestart`) project from it, so they can't drift
 *  on what counts as "coming up", and a future warming state is covered for free. */
export function isWarming(state: DaemonState | undefined): boolean {
  return state ? DAEMON_STATE_PRESENTATION[state].tone === "warming" : false;
}

/** True while the local daemon is transiently coming up (its state {@link
 *  isWarming}). Before the first status yield the state is unknown (not warming);
 *  `daemonStatusPending()` owns that pre-first-value gate.
 *
 *  Two consumers share this gate, covering both the visible and the invisible
 *  create paths: the App.tsx canvas reads it to suppress the empty-state welcome
 *  (its enabled Restore / new-terminal affordances) while warming — a restart's
 *  `drain` empties the terminal list, which would otherwise paint EmptyState
 *  while `restarting`; and `useTerminalCrud.handleCreate` reads it to refuse the
 *  keyboard (`Cmd+T`) and command-palette create paths, which stay live over the
 *  neutral warming surface the canvas shows. Without the crud guard a `Cmd+T`
 *  would call `client.terminal.create` against the daemon the recycle is about to
 *  kill (or a momentarily-`current` old connection). Terminal creation must wait
 *  for `connected`. */
export function daemonWarming(hostId = LOCAL_HOST): boolean {
  return isWarming(daemonStatusFor(hostId)?.state);
}

/** The warming-canvas message for the current daemon state — the verbier,
 *  capitalized `canvasLabel` projection the App.tsx warming arm renders (e.g.
 *  "Restarting kaval…" / "Connecting…"). Projects from the presentation table
 *  like every other consumer (so a new warming state's copy lands in one place),
 *  and defaults to the boot-`connecting` copy before the first status yield —
 *  the canvas only shows this while `daemonWarming()`, so the default is moot in
 *  practice but keeps the read total without a non-null assertion. */
export function warmingCanvasLabel(hostId = LOCAL_HOST): string {
  const state = daemonStatusFor(hostId)?.state;
  return DAEMON_STATE_PRESENTATION[state ?? "connecting"].canvasLabel;
}

/** The single warming-refusal gate for terminal creation: if the daemon is
 *  warming, toast the one shared message and report `true` (refused). Both
 *  create paths in `useTerminalCrud` call this so the predicate AND the copy
 *  live once; each caller keeps only its own throw-vs-return decision on the
 *  boolean. */
export function refuseIfWarming(hostId = LOCAL_HOST): boolean {
  if (daemonWarming(hostId)) {
    toast.warning("Daemon is starting — try again in a moment");
    return true;
  }
  return false;
}

// B3.3: a one-shot "N terminals reattached" confirmation when the boot ADOPTED a
// surviving daemon (a redeploy that didn't change kaval's source — the daemon and
// its PTYs outlived the server restart). Adoption is otherwise invisible: the
// terminals are simply still there, no restore card. The server folds the count +
// a per-adoption timestamp onto the first `connected` daemon status
// (`DaemonStatusSchema.adopted`/`adoptedAt`, kolu's soul); this watches for it and
// toasts once PER ADOPTION.
//
// Dedupe is keyed on `adoptedAt`, PERSISTED to localStorage — not an in-memory
// boolean. The `adopted`/`adoptedAt` snapshot is sticky server-side and replayed
// verbatim to every fresh subscription, so a reconnect after a page reload
// (mobile-Safari evicts a backgrounded tab and reloads on return; a desktop hard
// refresh does the same) re-delivered the SAME adoption. The old module boolean
// reset with the JS context and re-fired the toast on every reload
// (juspay/kolu#1365); the persisted high-water mark survives the reload, so a
// replay of the same `adoptedAt` is silent while a genuinely newer adoption
// announces again. The pure `reattachToAnnounce` owns the truth table
// (unit-tested). The detached `createRoot` owns the effect + persisted signal for
// the app's life (like the module `sub` above), so a consumer's teardown can't
// freeze it.
createRoot(() => {
  // The greatest `adoptedAt` already announced; `0` until the first adoption (every
  // real adoptedAt is an ms epoch, so it clears the fallback). `localDaemonStatus()`
  // re-emits on every transition (the rail ticks uptime, restarting→connected), so
  // the persisted guard — not a one-shot latch — keeps it idempotent.
  const [reattachAnnouncedAt, setReattachAnnouncedAt] = persistedPref<number>({
    name: "kolu.kaval.reattachAnnouncedAt",
    fallback: 0,
    parse: (raw) => {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error(`non-numeric: ${raw}`);
      return n;
    },
    // Surface a corrupt mark rather than resetting it silently. Resetting to `0`
    // is benign — at worst the next adoption re-announces once — so a console
    // warning is the right level (no user-facing toast for a recoverable reset).
    onInvalid: (err, raw) =>
      console.warn(
        `[kaval] reattachAnnouncedAt corrupt (${raw}); resetting to 0:`,
        err,
      ),
  });
  createEffect(() => {
    // The glue (`announceReattach`) commits the proven adoptedAt as the new
    // high-water mark BEFORE toasting, so a re-run on the same snapshot is silent
    // — both halves are unit-tested in `reattachAnnounce.test.ts`.
    announceReattach(
      localDaemonStatus(),
      reattachAnnouncedAt(),
      setReattachAnnouncedAt,
      (count) =>
        toast.info(`${count} terminal${count === 1 ? "" : "s"} reattached`),
    );
  });
});
