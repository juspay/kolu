/** `useAttention` — the ONE owner of kolu's attention model.
 *
 *  "Attention" is the single concept behind every way kolu reacts when an agent
 *  needs you: the sound + OS popup, the app-icon badge, the host-tab marks, and
 *  (through the terminal store) the dock unread. This module folds the rules that
 *  used to live in THREE places — `useTerminalAlerts` (active host only),
 *  `useHostAttention` (other hosts only), and the active-only unread ledger —
 *  into one place that applies the SAME rules on EVERY host.
 *
 *  The old split was by an accidental axis: whether you were looking at the host.
 *  Here that axis enters in exactly one spot — the `watched` predicate (a tile you
 *  are staring at is "seen"). Everything else is host-agnostic.
 *
 *  ── The rules ──────────────────────────────────────────────────────────────
 *  Two attention states, read cross-host off the per-host attention frame
 *  `useAttentionFacts` mirrors — padi's `attentionClass` partition as four
 *  disjoint id lists (asking · working · linger · finished), the
 *  deliberately-small member kept hot on every bound host, never a full
 *  terminals mirror. This module consumes that store rather than opening its
 *  own subscription, and reads two of the four:
 *    • ASKING (`awaiting_user`) — blocked on your input.
 *    • FINISHED (EF2 quiet) — just ended its turn.
 *  For each host we diff those two lists frame-to-frame and, per terminal:
 *    • fire the loud channels (sound + OS popup) ONCE per attention episode, only
 *      if the terminal isn't currently `watched` and the pref allows it;
 *    • an escalation FINISHED→ASKING re-arms a fire (a real gate over an idle
 *      finish still chimes — #1177), while flap/settle jitter is collapsed by the
 *      per-terminal `latched` set, which clears only when the terminal LEAVES the
 *      attention class (`ended`) — the SAME edge that drops the dock unread mark
 *      that episode raised, so an episode that is over stops looking like
 *      something you left unread;
 *    • the app badge sums ASKING across live hosts; the host-tab finished mark
 *      (rendered by the chips off the same cell) shows finished work on a host you
 *      aren't looking at.
 *
 *  Delivery is `attend.raise` (`./attend.ts`) — the ONE path every source goes
 *  through: this module describes each thing that needs the human as an
 *  {@link AttentionItem}, and the path decides the sound, the popups and the
 *  master switch. Neither this module nor the Conductor's bell touches an
 *  `Audio` or the `notify` seam for an alert.
 *
 *  Owned-by-caller: constructed once under the app owner (it holds a keyArray of
 *  per-host roots disposed on host removal). See `App.tsx`. */

import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  hostKeysEqual as sameHost,
} from "kolu-common/hostKey";
import {
  type AgentInfo,
  agentBucket,
  type TerminalId,
} from "kolu-common/surface";
import "kolu-common/test-hooks";
import { Effect, Semaphore } from "effect";
import { createEffect, mapArray, onCleanup, untrack } from "solid-js";
import { match } from "ts-pattern";
import { notify } from "../attentionNotify";
import { hostLabel } from "../host/hostChipTone";
import { selectHostTab } from "../host/selectHostTab";
import {
  conductorAsks,
  useConductorBadge,
  useConductorFacts,
} from "../conductor/useConductorFacts";
import {
  enterConductorMode,
  conductorMode,
} from "../conductor/useConductorMode";
import { memorySheet, useMemoryNeed } from "../conductor/memory/useMemory";
import { useMembership, useNeedsYou, useWorkMap } from "../conductor/useWorks";
import { showWork } from "../conductor/workListing";
import { drivenByConductor } from "../conductor/workReadings";
import { runAction } from "../runAction";
import type { TerminalSubject } from "../terminal/terminalSubject";
import { nextAfter } from "../ui/nextAfter";
import {
  activeHost,
  preferences,
  preferencesArrived,
  setActiveHost,
} from "../wire";
import { createAttentionCore } from "./attentionCore";
import { createAttend } from "./attend";
import {
  conversationItem,
  memoryItem,
  terminalItem,
  workItem,
} from "./attentionItems";
import { attentionChannels } from "./channels";
import { createConductorBell } from "./conductorAsks";
import {
  hostAskingIds,
  hostFrame,
  liveAskingTotal,
  markedHosts,
  writeHostMarks,
} from "./attentionMarks";
import { registerAttentionJump } from "./attentionNav";
import { isTerminalWatched } from "./attentionWatched";
import { attentionRecordOf } from "./savedAttention";
import { useAttentionFacts } from "./useAttentionFacts";

/** What the active host can tell us about its terminals — the rich notification
 *  copy, the dock unread write, and the e2e simulate targets. Background hosts
 *  have none of this (we only mirror their `urgency` cell), so a background finish
 *  gets host-labeled copy and no dock mark — a CONTENT difference from data
 *  availability, never a RULE difference. */
export interface AttentionDeps {
  /** The active host's selected top-level tile (for tile-level navigation). */
  activeId: () => TerminalId | null;
  /** The terminal actually receiving input, whether a top-level tile or split. */
  focusedId: () => TerminalId | null;
  /** Focus a terminal on the (post-switch) active host — the notification-click
   *  target, identical to the seam the old cross-host click used. */
  activate: (id: TerminalId) => void;
  /** Rich subject (repo/branch label + description) for an active-host terminal. */
  activeSubject: (id: TerminalId) => TerminalSubject;
  /** The active host's terminal ids (for the e2e simulate hook only). */
  terminalIds: () => TerminalId[];
  /** The active host's live agent state for a terminal (simulate asking-ness). */
  activeAgentState: (id: TerminalId) => AgentInfo["state"] | undefined;
}

export function useAttention(deps: AttentionDeps): {
  simulateAlert: (options?: { target?: "active" | "inactive" }) => void;
} {
  const alertsEnabled = (): boolean => preferences().attentionAlerts;
  const attend = createAttend(attentionChannels(alertsEnabled));

  // Ask for OS-notification permission REACTIVELY off the same pref that gates
  // delivery — so turning attention on later still prompts, and re-runs are cheap
  // (`requestPermission` is idempotent).
  createEffect(() => {
    if (alertsEnabled()) void notify.requestPermission();
  });

  const isActiveHost = (host: HostKey): boolean => sameHost(host, activeHost());

  // "Seen with your eyes": the active host's focused terminal while kolu has focus. A
  // background host's terminal is never watched (it's off-screen), so the axis
  // that split the old modules reduces to this one predicate.
  const watched = (host: HostKey, id: TerminalId): boolean =>
    isTerminalWatched(
      isActiveHost(host),
      id,
      deps.focusedId(),
      document.hasFocus(),
    );

  /** Actually reach the user for one terminal: sound + OS popup when `loud`,
   *  plus the dock unread when it's an active-host background tile. The `WHEN`
   *  gate lives in the engine; this is the delivery, shared with the simulate
   *  hook. A terminal the Conductor drives is delivered QUIET — the marks and
   *  nothing else — because the Conductor answers its agents, and a person
   *  hearing "finished" for a planner the Conductor is about to brief again
   *  learns to ignore the bell.
   *
   *  The FUNNEL GUARD: both emission paths (the engine's `hooks.deliver`, fired
   *  from a per-host `createEffect`, and `simulateAlert`) run through here, and the
   *  body calls a caller-supplied dep (`activeSubject`). A throw from it must
   *  NOT escape — from the engine path it would kill that host's attention
   *  effect for the rest of its life; from simulate it would throw out of a
   *  command action. Surface it and move on. */
  function deliver(
    host: HostKey,
    id: TerminalId,
    asking: boolean,
    loud: boolean,
  ): void {
    try {
      const encHost = encodeHostKey(host);
      const rich = isActiveHost(host) ? deps.activeSubject(id) : undefined;
      if (loud)
        attend.raise([
          terminalItem({
            encHost,
            hostLabel: hostLabel(host),
            id,
            asking,
            subject: rich,
          }),
        ]);
      // `rich` is non-undefined iff this is the active host, so reuse it rather than
      // a second `sameHost` compare — the dock unread is an active-host terminal
      // other than the pane currently receiving input. Raised on the host's
      // record, not its view state: right after a page loads, padi's first
      // frame can arrive before the host's view state exists, and that is the
      // frame that carries a finish that happened while kolu was down.
      if (rich && id !== deps.focusedId())
        attentionRecordOf(encHost).markUnread(id);
    } catch (err) {
      console.error("useAttention: attention delivery failed", err);
    }
  }

  /** IS THE CONVERSATION IN FRONT OF THE HUMAN — its tab showing in a focused
   *  kolu window. Untracked: it is read at the instant an alert is raised,
   *  and a focus change must not re-run whatever reading raised it. */
  const conductorInFront = (): boolean =>
    untrack(conductorMode) && document.hasFocus();

  const workMap = useWorkMap();
  const needs = useNeedsYou();
  /** WHAT NEEDS YOU, handed to the one path.
   *
   *  A work waiting on you — a question, a green PR handed over — and a
   *  question the conversation asks about no work are `asking` in exactly the
   *  sense the frame already means it, and they count into the same badge
   *  below. WHAT rings is `conductorAsks`'s rule; HOW it reaches the human is
   *  `attend.raise`'s. In front of the Conductor, its own questions, waiting
   *  work and memory chime without a desktop popup; anywhere else, each
   *  raises one. */
  const conductorBell = createConductorBell({
    deliver: ({ items, ownOpen, memory }) => {
      const inFront = conductorInFront();
      attend.raise([
        ...items.map((item) => workItem(item, inFront)),
        ...(ownOpen === null ? [] : [conversationItem(ownOpen, inFront)]),
        ...(memory === null ? [] : [memoryItem(memory, inFront)]),
      ]);
    },
  });
  const memoryNeed = useMemoryNeed();
  createEffect(() => {
    const asks = conductorAsks();
    // Silence is not an empty list: before the server's first frame there is
    // nothing to compare against, and the real first frame is the baseline.
    if (asks === undefined) return;
    conductorBell.observe({
      ...asks,
      works: new Set(workMap().keys()),
      needs: needs(),
      memory: memoryNeed(),
    });
  });

  // WHO DRIVES EACH MEMBER TERMINAL — the one membership index the dock
  // mark and the tile's lock read, keyed by fleet ref.
  const membership = useMembership();

  // The detect→fire ENGINE (`attentionCore`) — unit-tested off the wire. It owns
  // the per-host prev-frame, the fire-once latch, and the unseen-finished sets;
  // we hand it the wire-facing side-effects. Hooks take the ENCODED host string
  // (the engine's key) and decode where they need the `HostKey`. Its memory and
  // the dock marks are one saved record per host (`savedAttention`), so a page
  // loaded after a reload or a kolu restart carries on from the last one.
  const core = createAttentionCore({
    alertsEnabled,
    isActiveHost: (encHost) => isActiveHost(decodeHostKey(encHost)),
    isWatched: (encHost, id) => watched(decodeHostKey(encHost), id),
    // Untracked: asked mid-frame, inside a host's own effect, which must not
    // re-run because some terminal's driver moved.
    isDriven: (encHost, id) =>
      drivenByConductor(untrack(membership), encHost, id),
    deliver: (encHost, id, asking, loud) =>
      deliver(decodeHostKey(encHost), id, asking, loud),
    writeMark: (encHost, unseenFinished) =>
      writeHostMarks(encHost, { unseenFinished }),
    // Host-addressed, through the host's record rather than its view state: a
    // mark raised on host A must come off while the user is viewing host B, and
    // after a reload host A's view state may not have been built at all.
    clearUnread: (encHost, id) => attentionRecordOf(encHost).clearUnread(id),
    resume: (encHost) => attentionRecordOf(encHost).memory(),
    remember: (encHost, memory) => attentionRecordOf(encHost).remember(memory),
  });

  // The per-host MIRROR (one subscription root per host, over the full member
  // set — a background host is precisely the one you must hear from) belongs to
  // `useAttentionFacts`; instantiating it here is what guarantees it is running
  // even when no surface has read a pip yet, because attention must reach you
  // on a host you are not looking at. This module is a CONSUMER of that mirror.
  useAttentionFacts();
  // …and the CONDUCTOR mirror, for the same reason: a conversation blocked
  // on a host nobody is looking at is exactly the one that has to reach you.
  useConductorFacts();
  // …and the one count of "what is waiting on you", shared with the tab that
  // wears it: the OS badge is a second READER of that number, never a second
  // derivation of it.
  const conductorWaiting = useConductorBadge();

  // Feed every host's attention frame to the engine, off the marks store. One
  // owner per marked host (so a host leaving the pool disposes its engine state
  // exactly once), and inside it a thin effect: the engine holds the prev-frame,
  // so the FIRST frame is its baseline (no fire) and every later change diffs
  // and may fire.
  const observers = mapArray(markedHosts, (encHost) => {
    createEffect(() => {
      const frame = hostFrame(encHost);
      // Silence is not an empty frame — see `HostMarks.reported`.
      if (!frame.reported) return;
      // Nor is a default an answer. A page resuming from what it saved can
      // raise marks on its first frame, and whether it may is the user's
      // **Attention alerts** setting — which reads the defaults (on) until
      // the server's first preferences frame lands. Fed before then, a page
      // would mark a user who had switched alerts off.
      if (!preferencesArrived()) return;
      // The frame's own class map, handed straight over — the engine's type is
      // a `Pick` of it, so there is no adapter object to mint per host per
      // frame and no second name for the same two lists.
      core.observe(encHost, frame.byClass);
    });
    onCleanup(() => core.forgetHost(encHost));
    return null;
  });
  // Instantiate the observers (mapArray is lazy until read).
  createEffect(() => void observers());

  // Clear a host's unseen-finished dot the moment you switch TO it — "you looked".
  // The engine also zeroes it on any active-host cell tick, but a switch with no
  // accompanying cell change still needs this to clear the mark.
  createEffect(() => core.markHostSeen(encodeHostKey(activeHost())));

  // App badge = Σ ASKING over LIVE hosts. A dead host's held count never inflates
  // it; the active host is live, so its asking agents are counted too.
  //
  // SERIALISED, because the badge is a single OS-owned slot and the two writes
  // that fill it are independent promises: a rapid set→clear whose clear resolved
  // first would leave a stale count on the app icon forever. A one-permit
  // semaphore IS that rule — where the old `badgeTail = badgeTail.then(...)`
  // chain was a hand-built queue that also had to remember to re-catch on every
  // link, or one rejection would poison every later write.
  //
  // The de-dup reads `acked` INSIDE the critical section, so it compares against
  // the last CONFIRMED count rather than one a concurrent write is still
  // applying.
  let acked: number | undefined;
  const badgeLane = Semaphore.makeUnsafe(1);
  const paintBadge = (count: number): void => {
    runAction(
      "update app badge",
      Effect.suspend(() => {
        if (count === acked) return Effect.void;
        return Effect.tryPromise(() =>
          count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge(),
        ).pipe(Effect.tap(() => Effect.sync(() => (acked = count))));
      }).pipe(
        badgeLane.withPermit,
        Effect.catch((err) =>
          Effect.sync(() => {
            console.warn("useAttention: app-badge write failed", err);
          }),
        ),
      ),
    );
  };
  createEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    if (!alertsEnabled()) {
      paintBadge(0);
      return;
    }
    // Σ asking over LIVE hosts, PLUS what the conversation is waiting on —
    // the SAME number the Conductor tab wears, so the icon and the tab cannot
    // disagree about how many things need you. One number on the icon,
    // because there is one OS slot and a person counting two badges has to
    // add them anyway.
    paintBadge(liveAskingTotal() + conductorWaiting.waiting());
  });

  // The violet-capsule JUMP verb (see `attentionNav`): switch to the host, then
  // focus the next terminal blocked on you — cycling past the currently-active
  // one so repeated clicks walk every blocked agent. Navigation only; the count
  // clears exclusively when an agent leaves `awaiting_user`.
  onCleanup(
    registerAttentionJump((encHost) => {
      const ids = hostAskingIds(encHost);
      if (ids.length === 0) return;
      setActiveHost(decodeHostKey(encHost));
      const next = nextAfter(ids, deps.activeId());
      if (next !== undefined) deps.activate(next);
    }),
  );

  // The SINGLE notification-click router: switch to the originating host's tab
  // first (a notification outlives the active-host selection, and the person
  // may be reading the Conductor), then focus. Both the current `terminal`
  // shape and any stale `host` shape route the same way.
  onCleanup(
    notify.onClick((data) =>
      match(data)
        .with({ kind: "terminal" }, ({ host, terminalId }) => {
          selectHostTab(decodeHostKey(host));
          deps.activate(terminalId);
        })
        .with({ kind: "host" }, ({ host, id }) => {
          selectHostTab(decodeHostKey(host));
          deps.activate(id);
        })
        .with({ kind: "conductor" }, () => {
          // No terminal to focus and no host to switch to — the question
          // belongs to the one conversation, so the click just opens it.
          enterConductorMode();
        })
        // Memory: the conversation, with the Memory sheet open on it.
        .with({ kind: "memory" }, () => {
          enterConductorMode();
          memorySheet.openDialog();
        })
        // A work that needs you: the one route to a work, onto its card and
        // the question the notification was about.
        .with({ kind: "work" }, ({ work, ask }) => showWork(work, ask))
        .exhaustive(),
    ),
  );

  // e2e bridge: fire an alert for a chosen active-host terminal, bypassing the
  // watched/latch gates so a scenario can assert delivery. Faithful to the retired
  // `useTerminalAlerts.simulateAlert` so existing agent-state scenarios pass.
  const simulateAlert = (options?: {
    target?: "active" | "inactive";
  }): void => {
    if (!alertsEnabled()) return;
    const active = deps.activeId();
    const ids =
      options?.target === "active"
        ? deps.terminalIds().filter((id) => id === active)
        : deps.terminalIds().filter((id) => id !== active);
    const pick = ids[Math.floor(Math.random() * ids.length)];
    if (pick === undefined) return;
    const state = deps.activeAgentState(pick);
    const asking = state !== undefined && agentBucket(state) === "awaiting";
    deliver(activeHost(), pick, asking, true);
  };
  window.__koluSimulateAlert = simulateAlert;

  return { simulateAlert };
}
