/** Terminal alerts — reactively detect agent state transitions and fire notifications.
 *  Watches metadata subscriptions for agent state changes (any AI coding agent). */

import { activeArm, type TerminalMetadata } from "@kolu/padi/surface";
import {
  type AgentInfo,
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

  // Reactively watch agent state for all terminals, keyed by TerminalId.
  //
  // The diff MUST key on identity, not list POSITION. `deps.terminalIds()` is the
  // ACTIVE host's window (`activeWire.terminalListSub`) — a host switch swaps the
  // whole list and even a same-host insert/remove reorders it — so a positional
  // `prevStates[i]` vs `states[i]` diff compared two DIFFERENT terminals across a
  // tick: an already-`awaiting_user` terminal (e.g. `nixos-config` on zest) whose
  // index-peer on the prior list was `thinking` read as a fresh entry into the
  // notify class and re-fired on every switch back. A `Map<TerminalId, state>` diff
  // pairs each terminal with its OWN previous state, so a reshuffled list can't
  // manufacture a transition. A first-sighting id (host switch, late metadata) has
  // no entry in `prevStates`, so its `prev` is undefined and `checkAgentFinished`
  // skips it — the only terminals that can "transition" are ones we were already
  // tracking last tick, on the same host.
  createEffect(
    on(
      () =>
        new Map(
          deps
            .terminalIds()
            .map(
              (id) =>
                [id, activeArm(deps.getMetadata(id))?.agent?.state] as const,
            ),
        ),
      (states, prevStates) => {
        if (!prevStates) return;
        for (const [id, next] of states) {
          const prev = prevStates.get(id);
          if (prev !== undefined) checkAgentFinished(id, prev, next);
        }
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

  function checkAgentFinished(
    id: TerminalId,
    prev: string | undefined,
    next: string | undefined,
  ) {
    if (!activityAlerts()) return;
    // Fire on ENTRY into the notify class (waiting or awaiting_user). Treating
    // the two as one class means we don't double-alert when the agent flips
    // between them in one session.
    if (!notifies(next) || notifies(prev)) return;
    alertForTerminal(id);
  }

  function alertForTerminal(id: TerminalId) {
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
    if (isBackground || !document.hasFocus())
      fireActivityAlert(deps.getSubject(id), id, encodeHostKey(activeHost()));
  }

  function simulateAlert(options?: { target?: "active" | "inactive" }) {
    if (!activityAlerts()) return;
    const ids =
      options?.target === "active"
        ? deps.terminalIds().filter((id) => id === deps.activeId())
        : deps.terminalIds().filter((id) => id !== deps.activeId());
    const pick = ids[Math.floor(Math.random() * ids.length)];
    if (pick === undefined) return;
    alertForTerminal(pick);
  }

  // Expose for e2e test access (type from "kolu-common/test-hooks"). Installed
  // by the producer — App.tsx neither produces nor consumes this bridge.
  // useTerminalAlerts is constructed unconditionally on the App-startup path
  // (via useTerminals), so the hook is present before any scenario runs, and
  // the singleton lives for the app's lifetime — same timing as before.
  window.__koluSimulateAlert = simulateAlert;

  return { simulateAlert };
}
