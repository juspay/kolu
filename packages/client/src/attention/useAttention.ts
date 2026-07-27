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
 *      attention class (its agent goes back to work);
 *    • the app badge sums ASKING across live hosts; the host-tab finished mark
 *      (rendered by the chips off the same cell) shows finished work on a host you
 *      aren't looking at.
 *
 *  Delivery (the actual sound + service-worker popup) is NOT owned here — it rides
 *  the shared `notify` seam (`../attentionNotify`) plus a local `playSound`, so
 *  this module only decides WHEN, never re-implements the platform landmines.
 *
 *  Owned-by-caller: constructed once under the app owner (it holds a keyArray of
 *  per-host roots disposed on host removal). See `App.tsx`. */

import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import {
  type AgentInfo,
  agentBucket,
  type TerminalId,
} from "kolu-common/surface";
import "kolu-common/test-hooks";
import { createEffect, mapArray, onCleanup } from "solid-js";
import { createAttentionCore } from "./attentionCore";
import {
  hostAskingIds,
  hostFrame,
  liveAskingTotal,
  markedHosts,
  writeHostMarks,
} from "./attentionMarks";
import { registerAttentionJump } from "./attentionNav";
import { useAttentionFacts } from "./useAttentionFacts";
import { nextAfter } from "../ui/nextAfter";
import { match } from "ts-pattern";
import { notify } from "../attentionNotify";
import { hostLabel, sameHost } from "../host/hostChipTone";
import type { TerminalSubject } from "../terminal/terminalSubject";
import { activeHost, preferences, setActiveHost } from "../wire";

/** What the active host can tell us about its terminals — the rich notification
 *  copy, the dock unread write, and the e2e simulate targets. Background hosts
 *  have none of this (we only mirror their `urgency` cell), so a background finish
 *  gets host-labeled copy and no dock mark — a CONTENT difference from data
 *  availability, never a RULE difference. */
export interface AttentionDeps {
  /** The active host's currently-focused tile (for the `watched` predicate). */
  activeId: () => TerminalId | null;
  /** Focus a terminal on the (post-switch) active host — the notification-click
   *  target, identical to the seam the old cross-host click used. */
  activate: (id: TerminalId) => void;
  /** Mark an active-host background tile unread (the dock corner badge). */
  markUnread: (id: TerminalId) => void;
  /** Rich subject (repo/branch label + description) for an active-host terminal. */
  activeSubject: (id: TerminalId) => TerminalSubject;
  /** The active host's terminal ids (for the e2e simulate hook only). */
  terminalIds: () => TerminalId[];
  /** The active host's live agent state for a terminal (simulate asking-ness). */
  activeAgentState: (id: TerminalId) => AgentInfo["state"] | undefined;
}

function playSound(): void {
  const audio = new Audio("/sounds/notification.mp3");
  audio.play().catch((err: unknown) => {
    // An autoplay-policy block (no user gesture yet) or an unsupported codec is
    // EXPECTED and benign — but surface it (never a silent collapse) so a broken
    // sound channel is distinguishable from success. `debug` keeps the expected
    // autoplay-block out of the warning stream while still being observable.
    console.debug("useAttention: notification sound did not play", err);
  });
}

export function useAttention(deps: AttentionDeps): {
  simulateAlert: (options?: { target?: "active" | "inactive" }) => void;
} {
  const alertsEnabled = (): boolean => preferences().attentionAlerts;

  // Ask for OS-notification permission REACTIVELY off the same pref that gates
  // delivery — so turning attention on later still prompts, and re-runs are cheap
  // (`requestPermission` is idempotent).
  createEffect(() => {
    if (alertsEnabled()) void notify.requestPermission();
  });

  const isActiveHost = (host: HostKey): boolean => sameHost(host, activeHost());

  // "Seen with your eyes": the active host's focused tile while kolu has focus. A
  // background host's terminal is never watched (it's off-screen), so the axis
  // that split the old modules reduces to this one predicate.
  const watched = (host: HostKey, id: TerminalId): boolean =>
    isActiveHost(host) && id === deps.activeId() && document.hasFocus();

  /** Actually reach the user for one terminal: sound + OS popup, plus the dock
   *  unread when it's an active-host background tile. The `WHEN` gate lives in the
   *  engine; this is the delivery, shared with the simulate hook.
   *
   *  The FUNNEL GUARD: both emission paths (the engine's `hooks.deliver`, fired
   *  from a per-host `createEffect`, and `simulateAlert`) run through here, and the
   *  body calls caller-supplied deps (`activeSubject`, `markUnread`). A throw from
   *  one of those must NOT escape — from the engine path it would kill that host's
   *  attention effect for the rest of its life; from simulate it would throw out of
   *  a command action. Surface it and move on. */
  function deliver(host: HostKey, id: TerminalId, asking: boolean): void {
    try {
      playSound();
      const encHost = encodeHostKey(host);
      const rich = isActiveHost(host) ? deps.activeSubject(id) : undefined;
      const title = rich
        ? asking
          ? `${rich.title} needs your input`
          : `${rich.title} finished`
        : asking
          ? `An agent needs your input on ${hostLabel(host)}`
          : `An agent finished on ${hostLabel(host)}`;
      void notify.show({
        tag: `${encHost}/${id}`,
        title,
        body: rich?.description,
        icon: "/favicon.svg",
        data: { kind: "terminal", host: encHost, terminalId: id },
      });
      // `rich` is non-undefined iff this is the active host, so reuse it rather than
      // a second `sameHost` compare — the dock unread is an active-host background tile.
      if (rich && id !== deps.activeId()) deps.markUnread(id);
    } catch (err) {
      console.error("useAttention: attention delivery failed", err);
    }
  }

  // The detect→fire ENGINE (`attentionCore`) — unit-tested off the wire. It owns
  // the per-host prev-frame, the fire-once latch, and the unseen-finished sets;
  // we hand it the wire-facing side-effects. Hooks take the ENCODED host string
  // (the engine's key) and decode where they need the `HostKey`.
  const core = createAttentionCore({
    alertsEnabled,
    isActiveHost: (encHost) => isActiveHost(decodeHostKey(encHost)),
    isWatched: (encHost, id) => watched(decodeHostKey(encHost), id),
    deliver: (encHost, id, asking) =>
      deliver(decodeHostKey(encHost), id, asking),
    writeMark: (encHost, unseenFinished) =>
      writeHostMarks(encHost, { unseenFinished }),
    // ↑ the engine owns `unseenFinished`; `useAttention`'s root (below) owns
    //   `asking` + `live`. Both merge into the ONE per-host marks record.
  });

  // The per-host MIRROR (one subscription root per host, over the full member
  // set — a background host is precisely the one you must hear from) belongs to
  // `useAttentionFacts`; instantiating it here is what guarantees it is running
  // even when no surface has read a pip yet, because attention must reach you
  // on a host you are not looking at. This module is a CONSUMER of that mirror.
  useAttentionFacts();

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
  // it; the active host is live, so its asking agents are counted too. Serialised
  // through one tail so a rapid set→clear can't land out of order, and de-duped at
  // apply time against the last confirmed count.
  let acked: number | undefined;
  let badgeTail: Promise<unknown> = Promise.resolve();
  const paintBadge = (count: number): void => {
    badgeTail = badgeTail
      .then(async () => {
        if (count === acked) return;
        await (count > 0
          ? navigator.setAppBadge(count)
          : navigator.clearAppBadge());
        acked = count;
      })
      .catch((err) =>
        console.warn("useAttention: app-badge write failed", err),
      );
  };
  createEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    if (!alertsEnabled()) {
      paintBadge(0);
      return;
    }
    paintBadge(liveAskingTotal());
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

  // The SINGLE notification-click router: switch to the originating host first (a
  // notification outlives the active-host selection), then focus. Both the current
  // `terminal` shape and any stale `host` shape route the same way.
  onCleanup(
    notify.onClick((data) =>
      match(data)
        .with({ kind: "terminal" }, ({ host, terminalId }) => {
          setActiveHost(decodeHostKey(host));
          deps.activate(terminalId);
        })
        .with({ kind: "host" }, ({ host, id }) => {
          setActiveHost(decodeHostKey(host));
          deps.activate(id);
        })
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
    deliver(activeHost(), pick, asking);
  };
  window.__koluSimulateAlert = simulateAlert;

  return { simulateAlert };
}
