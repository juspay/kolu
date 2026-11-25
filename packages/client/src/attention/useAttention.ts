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
 *  Here that axis enters in exactly one spot — the view's `isWatched` reading
 *  (a tile you are staring at is "seen"). Everything else is host-agnostic.
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
 *      aren't looking at;
 *    • a terminal the Conductor DRIVES makes no sound and no popup, gets no
 *      unread mark and is not in its host tab's unread count, because the
 *      Conductor answers its agents, and a person hearing "finished" for a
 *      planner the Conductor is about to brief again learns to ignore the
 *      bell. When the Conductor starts driving one, its unread mark comes
 *      off. Blocked on a prompt, it still counts as needs-you (the app badge
 *      above, the host tab's violet count). One the person has taken over is
 *      theirs, and reaches them like any other.
 *
 *  Delivery is `attend.raise` (`./attend.ts`) — the ONE path every source goes
 *  through: this module describes each thing that needs the human as an
 *  {@link AttentionItem}, and the path decides the sound, the popups and the
 *  master switch. Neither this module nor the Conductor's bell touches an
 *  `Audio` or the `notify` seam for an alert.
 *
 *  Owned-by-caller: constructed once under the app owner (it holds a keyed
 *  `mapArray` of per-host roots disposed on host removal). See `App.tsx`. */

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
import { fleetTerminalRef, splitFleetTerminalRef } from "kolu-mcp/fleetRef";
import { Effect, Semaphore } from "effect";
import {
  type Accessor,
  createEffect,
  createMemo,
  mapArray,
  onCleanup,
  untrack,
} from "solid-js";
import { match } from "ts-pattern";
import { notify } from "../attentionNotify";
import { hostLabel } from "../host/hostChipTone";
import { landHostSwitch, selectHostTab } from "../host/selectHostTab";
import {
  conductorAsks,
  useConductorBadge,
  useConductorFacts,
} from "../conductor/useConductorFacts";
import {
  enterConductorMode,
  conductorMode,
} from "../conductor/useConductorMode";
import { splitMemberRef } from "../conductor/memberRef";
import { memorySheet, useMemoryNeed } from "../conductor/memory/useMemory";
import { useMembership, useNeedsYou, useWorkMap } from "../conductor/useWorks";
import { showWork } from "../conductor/workListing";
import { drivenByConductor, drivenRefs } from "../conductor/workReadings";
import { typedReply } from "../conductor/typedReply";
import { runAction } from "../runAction";
import type { TerminalSubject } from "../terminal/terminalSubject";
import { nextAfter } from "../ui/nextAfter";
import {
  activeHost,
  preferences,
  preferencesArrived,
  setActiveHost,
} from "../wire";
import { type AttentionView, createAttentionCore } from "./attentionCore";
import { createAttend } from "./attend";
import {
  conversationItem,
  memoryItem,
  replyItems,
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
import { isInFront } from "./attentionWatched";
import { conductorScreensShowing } from "./conductorScreens";
import { attentionRecordOf } from "./savedAttention";
import { useAttentionFacts } from "./useAttentionFacts";

/** What the active host can tell us about its terminals — the rich notification
 *  copy, the focused pane, and the e2e simulate targets. Background hosts have
 *  none of this (we only mirror their `urgency` cell), so a background finish
 *  gets host-labeled copy — a CONTENT difference from data availability, never
 *  a RULE difference: every host's terminals are marked by the same rule. */
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
  const attend = createAttend(attentionChannels());

  // Ask for OS-notification permission REACTIVELY off the same pref that gates
  // delivery — so turning attention on later still prompts, and re-runs are cheap
  // (`requestPermission` is idempotent).
  createEffect(alertsEnabled, (enabled) => {
    if (enabled) void notify.requestPermission();
  });

  const isActiveHost = (host: HostKey): boolean => sameHost(host, activeHost());

  /** Actually reach the user for one terminal: hand the item to the one path
   *  when `loud`, plus its unread mark on its own host's record when it is not
   *  in front of you. The `WHEN` gate lives in the engine — including that a
   *  terminal the Conductor drives is never delivered — and this is the
   *  terminal's own reading of the one path, shared with the simulate hook.
   *
   *  It READS NOTHING REACTIVE: every fact it acts on — the subject, whether
   *  alerts are on, whether the terminal is in front of you — was taken by
   *  the reading that decided to deliver ({@link readAttentionView}), because
   *  delivery itself runs in an effect's imperative phase.
   *
   *  The FUNNEL GUARD: both emission paths (the engine's fold, fired from a
   *  per-host `createEffect`, and `simulateAlert`) run through here, and it
   *  touches the notification seam and this browser's saved record. A throw
   *  must NOT escape — from the engine path it would kill that host's
   *  attention effect for the rest of its life; from simulate it would throw
   *  out of a command action. Surface it and move on. */
  function deliver(at: {
    readonly host: HostKey;
    readonly id: TerminalId;
    readonly asking: boolean;
    readonly loud: boolean;
    readonly alertsEnabled: boolean;
    readonly subject: TerminalSubject | undefined;
    readonly inFront: boolean;
  }): void {
    try {
      const encHost = encodeHostKey(at.host);
      if (at.loud)
        attend.raise(
          [
            terminalItem({
              encHost,
              hostLabel: hostLabel(at.host),
              id: at.id,
              asking: at.asking,
              subject: at.subject,
            }),
          ],
          at.alertsEnabled,
        );
      // THE UNREAD MARK, on any host: a terminal that is not in front of you
      // — on a host you are not on, behind the Conductor, or simply not the
      // pane you are in. Raised on the host's record, not its view state:
      // right after a page loads, padi's first frame can arrive before the
      // host's view state exists, and that is the frame that carries a
      // finish that happened while kolu was down.
      if (!at.inFront) attentionRecordOf(encHost).markUnread(at.id);
    } catch (err) {
      console.error("useAttention: attention delivery failed", err);
    }
  }

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
   *  raises one.
   *
   *  The view facts come WITH the ring (`BellView`, read in the feed's
   *  compute phase below): the delivery runs in the effect's imperative
   *  phase and reads nothing reactive itself. */
  const conductorBell = createConductorBell({
    deliver: ({ items, ownOpen, memory, reply }, view) => {
      // IN FRONT OF THE HUMAN: the conversation on screen in a focused window.
      const inFront = view.conductorShown && document.hasFocus();
      attend.raise(
        [
          ...items.map((item) => workItem(item, inFront)),
          ...(ownOpen === null ? [] : [conversationItem(ownOpen, inFront)]),
          ...(memory === null ? [] : [memoryItem(memory, inFront)]),
          ...(reply === null
            ? []
            : replyItems(reply, view.replyTitle, inFront)),
        ],
        view.alertsEnabled,
      );
    },
  });
  const memoryNeed = useMemoryNeed();
  createEffect(
    () => {
      const asks = conductorAsks();
      // Silence is not an empty list: before the server's first frame there is
      // nothing to compare against, and the real first frame is the baseline.
      if (asks === undefined) return null;
      const works = workMap();
      const reply = typedReply();
      return {
        reading: {
          ...asks,
          works: new Set(works.keys()),
          needs: needs(),
          memory: memoryNeed(),
          reply,
        },
        // The view facts a ring would use, read HERE because the delivery runs
        // in the imperative phase. Both are read UNTRACKED, as they always
        // were at the instant of a ring: whether the conversation is on screen
        // and whether alerts are on are not inputs of this feed — a view
        // change or a flip of the switch must not re-fold a reading.
        view: {
          conductorShown: untrack(conductorMode),
          replyTitle:
            reply === null || reply === undefined || reply.work === null
              ? undefined
              : works.get(reply.work)?.title,
          alertsEnabled: untrack(alertsEnabled),
        },
      };
    },
    (frame) => {
      if (frame === null) return;
      // The bell folds the reading it is handed, with the view facts taken
      // with it; what it reads while doing so (what is already ringing) is
      // not an input of this feed.
      conductorBell.observe(frame.reading, frame.view);
    },
  );

  // WHO DRIVES EACH MEMBER TERMINAL — the one membership index the dock
  // mark, the tile's lock and the attention engine read, keyed by fleet ref.
  const membership = useMembership();

  /** ONE HOST'S VIEW FACTS for the frame about to be folded — where the
   *  person is looking, what the Conductor drives, whether alerts are on, and
   *  the rich copy for the terminals this frame could deliver.
   *
   *  Called from a COMPUTE phase (or from a command), never from the fold
   *  itself: the engine folds in an effect's imperative phase, where reading
   *  reactive state is a strict-read defect, so every reading is taken here
   *  and handed over as plain values.
   *
   *  UNTRACKED as a whole, exactly as these readings always were when the
   *  fold asked for them mid-frame: a host's attention feed follows that
   *  HOST'S FRAME. Which pane has focus, which host is on screen, who drives
   *  what and whether alerts are on must not re-fold a frame that has not
   *  moved. Whether the window has focus is a DOM question, not a reactive
   *  one, and is still asked at the instant of the fold. */
  const readAttentionView = (
    encHost: string,
    ids: readonly TerminalId[],
  ): AttentionView =>
    untrack(() => {
      const host = decodeHostKey(encHost);
      const active = isActiveHost(host);
      const canvasShown = !conductorMode();
      const focusedId = deps.focusedId();
      const showing = new Set(conductorScreensShowing());
      const driving = membership();
      const alerts = alertsEnabled();
      // The rich copy, for the active host's candidates only (a background
      // host has none — see `AttentionDeps`). `activeSubject` is a
      // caller-supplied dep that reads that host's terminal store: its throw
      // costs one terminal its rich copy, never this host's whole feed.
      const subjects = new Map<TerminalId, TerminalSubject>();
      if (active)
        for (const id of ids) {
          try {
            subjects.set(id, deps.activeSubject(id));
          } catch (err) {
            console.error("useAttention: reading a subject failed", err);
          }
        }
      // IN FRONT OF THE PERSON: the canvas on screen and the shown host's
      // focused pane, or a screen of the terminal showing in the Conductor —
      // Look, or a live pane (`./attentionWatched.ts`).
      const inFront = (id: TerminalId): boolean =>
        isInFront({
          canvasShown,
          activeHost: active,
          id,
          focusedId,
          screenShowing: showing.has(fleetTerminalRef(encHost, id)),
        });
      return {
        alertsEnabled: alerts,
        isActiveHost: active,
        // "Seen with your eyes": in front of you while kolu has focus.
        isWatched: (id) => inFront(id) && document.hasFocus(),
        isDriven: (id) => drivenByConductor(driving, encHost, id),
        deliver: (id, asking, loud) =>
          deliver({
            host,
            id,
            asking,
            loud,
            alertsEnabled: alerts,
            subject: subjects.get(id),
            inFront: inFront(id),
          }),
      };
    });

  // The detect→fire ENGINE (`attentionCore`) — unit-tested off the wire. It owns
  // the per-host prev-frame, the fire-once latch, and the unseen-finished sets;
  // we hand it the wire-facing side-effects. Hooks take the ENCODED host string
  // (the engine's key) and decode where they need the `HostKey`. Its memory and
  // the dock marks are one saved record per host (`savedAttention`), so a page
  // loaded after a reload or a kolu restart carries on from the last one.
  const core = createAttentionCore({
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
    // THE FRAME this host's engine is fed, or `null` for silence. A memo, so
    // the fold below runs when the FRAME moves and not on any other tick of
    // the store it is read from.
    const feed = createMemo(() => {
      const frame = hostFrame(encHost);
      // Silence is not an empty frame — see `HostMarks.reported`.
      if (!frame.reported) return null;
      // Nor is a default an answer. A page resuming from what it saved can
      // raise marks on its first frame, and whether it may is the user's
      // **Attention alerts** setting — which reads the defaults (on) until
      // the server's first preferences frame lands. Fed before then, a page
      // would mark a user who had switched alerts off.
      if (!preferencesArrived()) return null;
      // The frame's own class map, handed straight over — the engine's type is
      // a `Pick` of it, so there is no adapter object to mint per host per
      // frame and no second name for the same two lists.
      return frame.byClass;
    });
    createEffect(
      () => {
        const byClass = feed();
        if (byClass === null) return null;
        // The view this frame is folded against — read HERE, in the compute
        // phase, for every terminal the frame could deliver (the two classes
        // the engine fires on).
        return {
          byClass,
          view: readAttentionView(encHost, [
            ...byClass.asking,
            ...byClass.finished,
          ]),
        };
      },
      (next) => {
        if (next === null) return;
        core.observe(encHost, next.byClass, next.view);
      },
    );
    onCleanup(() => core.forgetHost(encHost));
    return null;
  });
  // Instantiate the observers (mapArray is lazy until read): the compute phase
  // is that read, and there is nothing imperative to do with the result.
  createEffect(observers, () => {});

  // Clear a host's unseen-finished dot the moment you switch TO it — "you looked".
  // The engine also zeroes it on any active-host cell tick, but a switch with no
  // accompanying cell change still needs this to clear the mark.
  createEffect(
    () => encodeHostKey(activeHost()),
    (encHost) => core.markHostSeen(encHost),
  );

  /** RUN `onEntered` ONCE PER REF THAT JOINS `refs`, and forget the ones that
   *  leave — the entry half of a `mapArray` mapper, in the effect phase: the
   *  callers below WRITE a record per arrival, imperative work that belongs
   *  there and not in a computation. */
  function onRefsEntered(
    refs: Accessor<readonly string[]>,
    onEntered: (ref: string) => void,
  ): void {
    const served = new Set<string>();
    createEffect(refs, (next) => {
      const current = new Set(next);
      for (const ref of served) if (!current.has(ref)) served.delete(ref);
      for (const ref of current) {
        if (served.has(ref)) continue;
        served.add(ref);
        onEntered(ref);
      }
    });
  }

  // A SCREEN THAT COMES TO SHOW IN THE CONDUCTOR LIFTS ITS TERMINAL'S MARK —
  // Look opened or moved onto it, or its live pane coming on screen — on its
  // own host's record, which that host's Dock reads too. Once per showing:
  // the list keeps a terminal's entry while it stays shown.
  onRefsEntered(conductorScreensShowing, (ref) => {
    const split = splitFleetTerminalRef(ref);
    if (split !== null)
      attentionRecordOf(split.host).clearUnread(split.id as TerminalId);
  });

  // A TERMINAL THE CONDUCTOR STARTS DRIVING LIFTS ITS UNREAD MARK — it
  // joined a driven work, or the person handed it back: the mark, and its
  // place in its host tab's unread count. Once per terminal entering the driven
  // list, not once per work event: the list keeps a terminal's entry while
  // the Conductor keeps driving it. Not gated on the works record arriving —
  // a terminal in no work keeps its marks if it never does; this is what
  // lifts a mark raised in the moment before it did. A member this browser
  // cannot resolve (a host key that is not canonical) is skipped: there is
  // no record of it to lift a mark from, and a throw here would stop the
  // lift for every other member.
  onRefsEntered(
    () => drivenRefs(membership()),
    (ref) => {
      const member = splitMemberRef(ref);
      if (member !== null) core.conductorDrives(member.host, member.id);
    },
  );

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
  createEffect(
    (): number | null => {
      if (!("setAppBadge" in navigator)) return null;
      if (!alertsEnabled()) return 0;
      // Σ asking over LIVE hosts, PLUS what the conversation is waiting on —
      // the SAME number the Conductor tab wears, so the icon and the tab cannot
      // disagree about how many things need you. One number on the icon,
      // because there is one OS slot and a person counting two badges has to
      // add them anyway.
      return liveAskingTotal() + conductorWaiting.waiting();
    },
    (count) => {
      if (count === null) return;
      paintBadge(count);
    },
  );

  // The violet-capsule JUMP verb (see `attentionNav`): switch to the host, then
  // focus the next terminal blocked on you — cycling past the currently-active
  // one so repeated clicks walk every blocked agent. Navigation only; the count
  // clears exclusively when an agent leaves `awaiting_user`.
  onCleanup(
    registerAttentionJump((encHost) => {
      const ids = hostAskingIds(encHost);
      if (ids.length === 0) return;
      setActiveHost(decodeHostKey(encHost));
      // LAND the switch before anything reads the active host's scope: both
      // the cycle anchor (`activeId`, the target host's selected tile) and the
      // landing itself are that host's facts, and a staged switch would give
      // the departing host's. Every capsule calls `jumpToAsking` from a click.
      landHostSwitch();
      const next = nextAfter(ids, deps.activeId());
      if (next !== undefined) deps.activate(next);
    }),
  );

  // The SINGLE notification-click router: switch to the originating host's tab
  // first (a notification outlives the active-host selection, and the person
  // may be reading the Conductor), then focus. Both the current `terminal`
  // shape and any stale `host` shape route the same way. The switch is LANDED
  // between the two, so the focus resolves the host the notification came from
  // rather than the one on screen — an OS notification click is an imperative
  // boundary, so the flush is legal here.
  onCleanup(
    notify.onClick((data) =>
      match(data)
        .with({ kind: "terminal" }, ({ host, terminalId }) => {
          selectHostTab(decodeHostKey(host));
          landHostSwitch();
          deps.activate(terminalId);
        })
        .with({ kind: "host" }, ({ host, id }) => {
          selectHostTab(decodeHostKey(host));
          landHostSwitch();
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
    // A command reads freely; it takes the same view every fold does, for the
    // one terminal it picked, and raises through the same path.
    readAttentionView(encodeHostKey(activeHost()), [pick]).deliver(
      pick,
      asking,
      true,
    );
  };
  window.__koluSimulateAlert = simulateAlert;

  return { simulateAlert };
}
