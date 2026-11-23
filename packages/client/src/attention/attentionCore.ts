/** The attention ENGINE — the stateful detect→fire core of `useAttention`, off
 *  the wire so it is unit-testable. It owns the per-host previous-frame, the
 *  fire-once latch, and the unseen-finished sets; the app-facing effects
 *  (`useAttention`) feed it urgency frames and supply the side-effects as `hooks`.
 *
 *  Its memory outlives the page: after each frame it hands that memory back to
 *  be saved (`hooks.remember`), and a page loaded later starts from what was
 *  saved (`hooks.resume`) instead of from nothing — so a reload or a kolu
 *  restart neither forgets what you had not seen nor re-announces what you had.
 *
 *  This is the path `__koluSimulateAlert` (and therefore e2e) BYPASSES — simulate
 *  calls `hooks.deliver` directly — so its only real coverage is the unit tests
 *  that drive `observe` with frames and assert the `deliver` calls. */

import {
  type AttentionFrame,
  type AttentionTransitions,
  createAttentionTransitions,
  type TerminalId,
} from "kolu-common/surface";
import { nextUnseenFinished } from "./unseenFinished";

/** What the engine remembers about one host — everything `observe` needs to
 *  carry on from where a previous page left off. */
export interface AttentionMemory {
  /** The last frame the engine saw. */
  readonly frame: AttentionFrame;
  /** Terminals whose current episode the user has already been made aware of
   *  — the fire-once latch. */
  readonly latched: readonly TerminalId[];
  /** Finished terminals on this host the user has not looked at since — the
   *  host tab's quiet dot. */
  readonly unseenFinished: readonly TerminalId[];
}

export interface AttentionHooks {
  /** The master gate — the `attentionAlerts` preference. */
  alertsEnabled(): boolean;
  /** Is this host the one on screen right now. */
  isActiveHost(encHost: string): boolean;
  /** Is the user looking right AT this terminal (active host + active tile +
   *  focus) — a live gate they've already "seen". */
  isWatched(encHost: string, id: TerminalId): boolean;
  /** Is the Conductor driving this terminal? It answers its own agents (the
   *  Conductor is woken about them), so the terminal is never delivered and
   *  never in its host tab's unread count. Its needs-you count is not this
   *  engine's: a driven terminal blocked on a prompt still counts there. A
   *  terminal the human has taken over is theirs again and reaches them as
   *  any other. */
  isDriven(encHost: string, id: TerminalId): boolean;
  /** Reach the user for one terminal — the channel the engine decides to
   *  fire. `loud` is the sound and the OS popup, held back only on a resumed
   *  first frame; the dock unread is drawn either way. */
  deliver(
    encHost: string,
    id: TerminalId,
    asking: boolean,
    loud: boolean,
  ): void;
  /** Publish a host's unseen-finished count (the quiet host-tab dot). */
  writeMark(encHost: string, unseenFinished: number): void;
  /** Drop one terminal's dock unread mark — its episode is over (`ended`, whose
   *  definition in `attentionTransitions` names every way that happens).
   *  Host-addressed, like every other hook: a mark set on host A must clear while
   *  the user is looking at host B. */
  clearUnread(encHost: string, id: TerminalId): void;
  /** What an earlier page saved for this host, or `null` when this browser has
   *  saved nothing for it. Asked once, on the host's first frame. */
  resume(encHost: string): AttentionMemory | null;
  /** Save the engine's memory of this host — after every frame, and when the
   *  user looks at the host. */
  remember(encHost: string, memory: AttentionMemory): void;
}

export interface AttentionCore {
  /** Feed one host's latest attention frame. The FIRST frame per host either
   *  resumes from what an earlier page saved — diffing against that frame, with
   *  anything new marked but not rung — or, with nothing saved, is the baseline
   *  (records only, never fires — attention is a transition, not a discovery).
   *  Every later frame diffs and may fire. */
  observe(encHost: string, cur: AttentionFrame): void;
  /** The host left the pool — drop all its state. */
  forgetHost(encHost: string): void;
  /** The user switched TO this host — clear its unseen-finished dot ("you looked"). */
  markHostSeen(encHost: string): void;
  /** The Conductor now drives this terminal — it joined a driven work, or the
   *  person handed it back. Its unread mark comes off, and so does its place
   *  in its host tab's unread count. */
  conductorDrives(encHost: string, id: TerminalId): void;
}

export function createAttentionCore(hooks: AttentionHooks): AttentionCore {
  // The per-host previous-frame MEMORY — the shared vocabulary's stateful form,
  // not a local `Map<encHost, AttentionFrame>` plus a hand-written snapshot rule.
  // padi's settle-event source holds the same thing for the same reason; two
  // copies of "copy the arrays or nothing ever fires" is a silent failure waiting
  // for one of them to be edited.
  const transitionsByHost = new Map<string, AttentionTransitions>();
  // The same frame, kept as the value `remember` saves. The transitions above
  // hold it privately; saving it is this module's concern, not the vocabulary's.
  const frameByHost = new Map<string, AttentionFrame>();
  const unseenByHost = new Map<string, Set<TerminalId>>();
  // Per-host fire-once latch — same `Map<encHost, …>` shape as its two siblings, so
  // a host's latch is data the structure holds directly (a `forgetHost` delete),
  // never something replayed from `prevByHost`.
  const latched = new Map<string, Set<TerminalId>>();
  /** This host's latch set, created on first touch — one place for the get-or-create. */
  const latchOf = (encHost: string): Set<TerminalId> => {
    let set = latched.get(encHost);
    if (!set) {
      set = new Set();
      latched.set(encHost, set);
    }
    return set;
  };

  // What was last handed back per host, serialized: most frames the engine is
  // fed move only the working or linger lists, which it does not remember, and
  // each hand-back is a `localStorage` write.
  const lastSaved = new Map<string, string>();
  /** Hand this host's memory back to be saved, when it changed. */
  const save = (encHost: string): void => {
    const frame = frameByHost.get(encHost);
    if (frame === undefined) return;
    const memory: AttentionMemory = {
      frame,
      latched: [...latchOf(encHost)],
      unseenFinished: [...(unseenByHost.get(encHost) ?? [])],
    };
    const serialized = JSON.stringify(memory);
    if (lastSaved.get(encHost) === serialized) return;
    lastSaved.set(encHost, serialized);
    hooks.remember(encHost, memory);
  };

  const observe = (encHost: string, cur: AttentionFrame): void => {
    // The host's FIRST frame on this page? If an earlier page saved this host,
    // the engine carries on from there instead of starting blank. A RESUMED
    // first frame: what changed since the saved one happened while no page was
    // watching. It is marked for you to find, but nothing rings — five agents
    // that finished while you were away are five marks, not five chimes the
    // moment you open kolu. With nothing saved, it is the BASELINE.
    let transitions = transitionsByHost.get(encHost);
    let baseline = false;
    let resumed = false;
    if (transitions === undefined) {
      const saved = hooks.resume(encHost);
      if (saved !== null) {
        latched.set(encHost, new Set(saved.latched));
        unseenByHost.set(encHost, new Set(saved.unseenFinished));
      }
      transitions = createAttentionTransitions(saved?.frame ?? null);
      transitionsByHost.set(encHost, transitions);
      baseline = saved === null;
      resumed = !baseline;
    }
    const { candidates, ended } = transitions.observe(cur);
    frameByHost.set(encHost, {
      asking: [...cur.asking],
      finished: [...cur.finished],
    });

    // The quiet host-tab dot — folded every frame so it tracks back to zero. Reuses
    // the `candidates` already computed above (the ONE transition per frame) rather
    // than re-diffing prev↔cur inside the fold.
    const unseen = nextUnseenFinished(
      unseenByHost.get(encHost) ?? new Set(),
      candidates,
      cur.finished,
      hooks.isActiveHost(encHost),
      (id) => hooks.isDriven(encHost, id),
    );
    unseenByHost.set(encHost, unseen);
    hooks.writeMark(encHost, unseen.size);

    // Episode end, two consequences, one edge: the terminal's latch drops (so its
    // NEXT finish/ask is a fresh episode that fires again) and so does the dock
    // unread mark that episode raised. `ended` (see `attentionTransitions`) is the
    // only test for both — an escalation finished→asking is NOT an end, so the
    // mark survives it.
    for (const id of ended) {
      latched.get(encHost)?.delete(id);
      hooks.clearUnread(encHost, id);
    }

    // BASELINE pre-latch: on the first frame per host, PRE-LATCH ids already
    // ASKING, so a settle-flap around a PRE-EXISTING gate (asking→waiting→asking
    // — e.g. an app reload that catches a terminal mid-ask) does not phantom-chime
    // on the re-escalation. This is per-terminal, restoring the retired machine's
    // guarantee. A baseline FINISHED id is deliberately NOT pre-latched, so a later
    // genuine finished→asking gate over it still fires (#1177); and the latch clears
    // when the terminal leaves both sets (`ended`), so a real NEW episode chimes.
    if (baseline && cur.asking.length > 0) {
      for (const id of cur.asking) latchOf(encHost).add(id);
    }

    // `candidates` is empty on the baseline (a finish already present when a host
    // binds is a discovery, not a transition — enforced in `attentionTransitions`),
    // so this loop records-only on the first frame with no guard here.
    for (const { id, asking } of candidates) {
      if (latched.get(encHost)?.has(id) ?? false) continue;
      // A terminal the Conductor drives raises nothing, and is not latched
      // either: should the person take it over mid-episode, a question it
      // then asks is the first they hear of it, and rings.
      if (hooks.isDriven(encHost, id)) continue;
      const seen = hooks.isWatched(encHost, id);
      const alerted = hooks.alertsEnabled() && !seen;
      if (alerted) hooks.deliver(encHost, id, asking, !resumed);
      // Latch once the user has been MADE AWARE — an actual alert, OR looking
      // right at a live gate (eyes work with sound off). A `finished` seen
      // while watched is NOT latched, so a later real gate still fires (#1177).
      if (alerted || (asking && seen)) latchOf(encHost).add(id);
    }
    save(encHost);
  };

  const forgetHost = (encHost: string): void => {
    transitionsByHost.delete(encHost);
    frameByHost.delete(encHost);
    lastSaved.delete(encHost);
    unseenByHost.delete(encHost);
    latched.delete(encHost);
    // The mark is cleared by the caller's `onCleanup` (which DELETES the host's
    // record), so the engine does not also write a 0 here — one clear, one place.
  };

  const markHostSeen = (encHost: string): void => {
    const set = unseenByHost.get(encHost);
    if (set && set.size > 0) {
      set.clear();
      hooks.writeMark(encHost, 0);
      save(encHost);
    }
  };

  const conductorDrives = (encHost: string, id: TerminalId): void => {
    const set = unseenByHost.get(encHost);
    if (set?.delete(id)) {
      hooks.writeMark(encHost, set.size);
      save(encHost);
    }
    hooks.clearUnread(encHost, id);
  };

  return { observe, forgetHost, markHostSeen, conductorDrives };
}
