/** Terminal alerts — reactively detect agent state transitions and fire notifications.
 *  Watches metadata subscriptions for agent state changes (any AI coding agent). */

import { activeArm, type TerminalMetadata } from "@kolu/padi/surface";
import {
  type AgentInfo,
  agentBucket,
  alertClass,
  type TerminalId,
} from "kolu-common/surface";
import "kolu-common/test-hooks";
import { encodeHostKey } from "kolu-common/hostKey";
import { type Accessor, createEffect, on } from "solid-js";
import { activeHost, preferences } from "../wire";
import type { TerminalSubject } from "./terminalSubject";
import { fireActivityAlert } from "./useActivityAlerts";

export function useTerminalAlerts(deps: {
  activeId: Accessor<TerminalId | null>;
  activate: (id: TerminalId) => void;
  getMetadata: (id: TerminalId) => TerminalMetadata | undefined;
  getSubject: (id: TerminalId) => TerminalSubject;
  markUnread: (id: TerminalId) => void;
  terminalIds: Accessor<TerminalId[]>;
}) {
  const activityAlerts = () => preferences().activityAlerts;

  // Notification permission is requested by `useHostAttention`'s single reactive
  // requester (off the same `activityAlerts` rule), so this module no longer asks
  // too — a second startup request while permission is still `default` is a
  // redundant prompt the browser does not coalesce.

  // The OS app badge is no longer written here. It became a CROSS-HOST fact in
  // W5 — the sum of every LIVE host's `urgency.awaitingIds.length`, owned by
  // `useHostAttention` off the urgency projection the host chips already read —
  // so a background host's awaiting agents reach the dock icon too, not only the
  // active host's. This module keeps its per-active-host job: fire the OS
  // notification + dock unread for a terminal you are not actively watching.
  //
  // The click on an OS notification is routed by the SINGLE `notify.onClick`
  // router in `useHostAttention` (the one seam that owns both the per-terminal
  // and cross-host click payloads). This module no longer hand-rolls its own
  // `serviceWorker` message listener — a second listener on the same channel
  // would cross-deliver a `host` payload into a `terminal` handler.

  // Reactively watch agent state for all terminals, keyed by TerminalId AND scoped
  // to the active host.
  //
  // The diff MUST key on identity, not list POSITION. `deps.terminalIds()` is the
  // ACTIVE host's window (`activeWire.terminalListSub`) — a host switch swaps the
  // whole list and even a same-host insert/remove reorders it — so a positional
  // `prevStates[i]` vs `states[i]` diff compared two DIFFERENT terminals across a
  // tick: an already-`awaiting_user` terminal (e.g. `nixos-config` on zest) whose
  // index-peer on the prior list was `thinking` read as a fresh entry into the
  // notify class and re-fired on every switch back. A `Map<TerminalId, state>` diff
  // pairs each terminal with its OWN previous state, so a reshuffled list can't
  // manufacture a transition. Gate on `prevStates.has(id)` (membership), not
  // `prev !== undefined` (value): a first-sighting id (host switch, late metadata)
  // is ABSENT from `prevStates`, so we skip it — the only terminals that can
  // "transition" are ones we were already tracking last tick, on the same host.
  // Splitting membership from value (the same shape `useActiveReconcile` uses)
  // keeps `undefined` from doing two jobs: a terminal we tracked last tick whose
  // agent state was undefined *then* is distinguished from a first sighting, so an
  // agent that appears and jumps straight into the notify class still fires
  // (`advanceAlertEpisode` treats an undefined `prev` as non-notify).
  //
  // Snapshot the ACTIVE HOST alongside the states and SKIP the whole diff on a host
  // change. `has(id)` alone assumes ids are disjoint across hosts, which holds for
  // fresh `crypto.randomUUID()` terminals — but session import/restore preserves a
  // SLEEPING terminal's id (`seedSleepingTerminal` re-seeds `t.id`, and sleep/wake
  // keep the id in place), so the SAME `TerminalId` can live on two hosts. Without
  // the host gate, switching between two hosts that share such an id would pair the
  // one host's `awaiting_user` against the other's non-notify state and re-fire the
  // exact phantom this change removes. Gating on the host makes it impossible by
  // construction: after a switch every terminal is a first sighting on the new host.
  // The attention-EPISODE latch (#1177): per-terminal "we already chimed for the
  // current attention episode." An episode is a maximal run inside the notify
  // class ({waiting, awaiting_user}); it ends only when the agent returns to a
  // WORK state — NOT when it merely drops from `awaiting_user` to `waiting`. That
  // work-state reset is the load-bearing discriminator: a genuinely new gate
  // ALWAYS passes through a work state (the user re-engaged, the agent worked,
  // then asked), whereas scrape/JSONL settle jitter (`awaiting_user → waiting →
  // awaiting_user`, or `thinking → waiting → awaiting_user`) never does. So the
  // latch lets a real gate over an already-`waiting` row chime once (the bug),
  // while collapsing both jitter shapes to a single chime.
  //
  // It's a LEAF, not a volatility boundary: client-only alert bookkeeping over a
  // bounded algorithm, no transport/persistence/reconnect — so it lives here
  // beside the transition diff, never folded into the pure `agentProjection`
  // vocabulary. Host-scoped exactly like that diff: cleared on a host change (so a
  // latch can't cross to a session-imported id that lives on another host) and
  // pruned to the tracked set each run (so a departed id can't leave a ghost latch
  // that a same-host id reuse — drain/restore, sleep-wake re-seed — would inherit).
  const chimed = new Set<TerminalId>();

  createEffect(
    on(
      () => ({
        host: encodeHostKey(activeHost()),
        states: new Map(
          deps
            .terminalIds()
            .map(
              (id) =>
                [id, activeArm(deps.getMetadata(id))?.agent?.state] as const,
            ),
        ),
      }),
      (curr, prev) => {
        // A host change (and the first run) makes every terminal a fresh first
        // sighting: drop all episode memory, the same reason the transition diff
        // can't span hosts.
        const sameHost = prev !== undefined && prev.host === curr.host;
        if (!sameHost) chimed.clear();
        for (const [id, next] of curr.states) {
          if (sameHost && prev.states.has(id)) {
            advanceAlertEpisode(id, prev.states.get(id), next);
          } else if (isAwaiting(next)) {
            // First sighting ALREADY in the awaiting bucket: pre-latch it, so a
            // settle-flap around a first sighting (`awaiting_user → waiting →
            // awaiting_user`) can't manufacture a phantom chime the old entry
            // rule never produced. A first sighting at `waiting` is left
            // UNLATCHED so a genuine gate landing over it still fires (#1177) —
            // only the awaiting bucket pre-latches.
            chimed.add(id);
          }
        }
        // Prune the latch to the tracked set (retain-intersection): an id that
        // left `terminalIds()` must not leave a ghost latch behind.
        for (const id of chimed) if (!curr.states.has(id)) chimed.delete(id);
      },
    ),
  );

  // Whether a reactive-history state value belongs to the shared alert/notify
  // class (`waiting` or `awaiting_user`). Membership rides the projection's
  // compile-fenced `alertClass` fold — a state rename trips its `satisfies never`
  // fence rather than silently dropping the notification. Accepts the
  // `string | undefined` that `createEffect`'s previous-value tracking yields
  // (the literal type is lost); `alertClass`'s own `default` arm handles an
  // unknown string, and `undefined` is never an attention state.
  const notifies = (state: string | undefined): boolean =>
    state !== undefined && alertClass(state as AgentInfo["state"]) === "notify";

  // Whether a reactive-history state value is the `awaiting` paint bucket — a
  // LIVE human gate (`awaiting_user`), as opposed to the post-turn `waiting`
  // lull. Read through the fenced `agentBucket` fold (never a raw `awaiting_user`
  // literal) so a future attention-flavored state — say `awaiting_permission` —
  // must force a decision at the fence rather than silently skipping escalation.
  // Undefined-safe like `notifies`.
  const isAwaiting = (state: string | undefined): boolean =>
    state !== undefined &&
    agentBucket(state as AgentInfo["state"]) === "awaiting";

  function advanceAlertEpisode(
    id: TerminalId,
    prev: string | undefined,
    next: string | undefined,
  ) {
    // The episode RESET runs unconditionally (the latch SET is delivery-gated
    // below). Skipping the reset while alerts are off would freeze the latch —
    // then a genuine gate after re-enable is swallowed by stale memory (the very
    // #1177 symptom, reintroduced through the toggle).
    if (!notifies(next)) {
      // Work / no-agent ends the episode — the next notify entry is genuinely new.
      chimed.delete(id);
      return;
    }
    const nextAwaiting = isAwaiting(next);
    // A candidate to chime is either ENTRY into the notify class (the existing
    // `thinking/waiting → notify` rule) OR an ESCALATION into the awaiting bucket
    // (a live gate) from a non-awaiting state — the latter is what lets a gate
    // landing over an already-`waiting` row chime (#1177).
    const classEntry = !notifies(prev);
    const escalation = nextAwaiting && !isAwaiting(prev);
    if (!classEntry && !escalation) return;
    // At most ONE chime per episode: the latch collapses flap/settle jitter.
    if (chimed.has(id)) return;
    if (activityAlerts()) {
      // Latch when the user has been MADE AWARE of this notify state — through
      // one of two channels:
      //   • `delivered` — an external alert (sound / OS notification / dock
      //     unread) actually fired, i.e. the terminal is backgrounded or kolu is
      //     unfocused; or
      //   • `nextAwaiting` — the candidate is a LIVE gate the user is looking
      //     right at (active tile + focused, so the external alert was suppressed
      //     but their eyes are the channel). Latching it stops a scrape-jitter
      //     flap (`awaiting_user → waiting → awaiting_user`) from re-chiming a
      //     gate they already saw once they look away.
      // A mere `waiting` finish seen while actively watched is NOT latched: a
      // genuine gate arriving after the user looks away is new, actionable info
      // and must still chime (the #1177 class — a delivery-only rule swallowed
      // it). So a `waiting` finish latches on delivery; an `awaiting_user` gate
      // latches on delivery OR on being watched. The episode RESET stays
      // unconditional. In the common background case delivery always succeeds, so
      // flap/settle dedup is unchanged.
      const delivered = alertForTerminal(id, nextAwaiting);
      if (delivered || nextAwaiting) chimed.add(id);
    }
  }

  /** Surface a terminal's alert, returning whether anything actually reached the
   *  user (sound / OS notification / dock unread) — `false` when suppressed
   *  because the user is actively watching this very terminal. The caller latches
   *  the episode only on a `true` return. */
  function alertForTerminal(id: TerminalId, awaiting: boolean): boolean {
    const isBackground = id !== deps.activeId();
    if (isBackground) deps.markUnread(id);
    // Alert unless the user is *actively watching this very terminal* — i.e.
    // it's the active terminal AND kolu has focus. `document.hasFocus()` is the
    // right signal, not `document.hidden`: hidden is only true when kolu is fully
    // off-screen, which on macOS is almost never the case (switching to another
    // app while Chrome stays visible keeps it false via occlusion) — so the old
    // `isBackground || document.hidden` gate meant a banner essentially never
    // fired. `hasFocus()` is false whenever the doc is hidden too, so it
    // subsumes the old check and also covers "switched apps, kolu still visible".
    // The finished terminal lives on the host that is active right now (this
    // module watches the active host's terminals). Stamp that host onto the
    // notification so a click after a host-switch returns to the right padi.
    const deliver = isBackground || !document.hasFocus();
    if (deliver)
      fireActivityAlert(
        deps.getSubject(id),
        id,
        encodeHostKey(activeHost()),
        awaiting,
      );
    return deliver;
  }

  function simulateAlert(options?: { target?: "active" | "inactive" }) {
    if (!activityAlerts()) return;
    const ids =
      options?.target === "active"
        ? deps.terminalIds().filter((id) => id === deps.activeId())
        : deps.terminalIds().filter((id) => id !== deps.activeId());
    const pick = ids[Math.floor(Math.random() * ids.length)];
    if (pick === undefined) return;
    alertForTerminal(
      pick,
      isAwaiting(activeArm(deps.getMetadata(pick))?.agent?.state),
    );
  }

  // Expose for e2e test access (type from "kolu-common/test-hooks"). Installed
  // by the producer — App.tsx neither produces nor consumes this bridge.
  // useTerminalAlerts is constructed unconditionally on the App-startup path
  // (via useTerminals), so the hook is present before any scenario runs, and
  // the singleton lives for the app's lifetime — same timing as before.
  window.__koluSimulateAlert = simulateAlert;

  return { simulateAlert };
}
