/** Cross-host attention (padi W5) — roll the per-host "needs you" signal up to
 *  where it can reach you when you are parked on a DIFFERENT host: an OS
 *  notification for a background host, an app-icon badge summed across every
 *  bound host, and a one-action click that switches to the host and focuses the
 *  terminal.
 *
 *  kolu MINTS NOTHING on the wire here. It consumes the SAME `urgency` projection
 *  (`{ awaitingIds }`) the host-strip chips already read — the deliberately tiny
 *  per-host member W7's K1 ruling keeps hot on every bound host (never a full
 *  `terminals` mirror). The framework hands facts; the aggregation, the pixels,
 *  and the click semantics are kolu's, right here. */

import type { PadiUrgency } from "@kolu/padi/surface";
import { createNotify } from "@kolu/surface-app/notify";
import { watchByEntry } from "@kolu/surface-map/client";
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, onCleanup } from "solid-js";
import {
  activeHost,
  hostKeys,
  padiMap,
  preferences,
  setActiveHost,
} from "../wire";
import { hostLabel, sameHost } from "./hostChipTone";

/** Wire cross-host attention. Runs under the app's reactive owner (it holds a
 *  keyArray of per-host watchers). `focusTerminal` is the active host's
 *  activation write path (`useTerminals().activate`) — after a switch it targets
 *  the newly-active host. */
export function useHostAttention(deps: {
  focusTerminal: (id: TerminalId) => void;
}): void {
  const enabled = (): boolean => preferences().activityAlerts;
  // The one delivery seam at the origin's ONE service worker — never per window,
  // so two open windows can't double-ping (the tag replaces, never stacks).
  const notify = createNotify<{ host: string; id: string }>();
  if (enabled()) void notify.requestPermission();

  // The eager per-host watcher: it subscribes EVERY bound host's urgency cell
  // (background hosts included — precisely the ones you need to hear from) and
  // raises newly-awaiting ids by a pure set-diff over the framework's honest
  // change pairs. No hand-held previous frame, no per-window memory.
  const attention = watchByEntry(
    padiMap,
    (entry) => entry.cells.urgency,
    (value: PadiUrgency) => value.awaitingIds,
    (host, raised) => {
      // "Hear about the host you are NOT watching": ping only a BACKGROUND host.
      // The active host is on-screen and its own per-terminal alert covers it.
      if (!enabled() || sameHost(host, activeHost())) return;
      const encoded = encodeHostKey(host);
      const label = hostLabel(host);
      for (const id of raised) {
        void notify.show({
          tag: `${encoded}/${id}`,
          title: `Terminal awaiting on ${label}`,
          data: { host: encoded, id },
        });
      }
    },
  );

  // The app badge = Σ awaitingIds.length over LIVE hosts — kolu's own one-line
  // fold. A dead host's held count never inflates it (its chip dims instead); the
  // active host is a live host, so its awaiting agents are counted too. The
  // effect re-runs on any host's urgency/liveness change; guard the OS write so
  // an unchanged count never re-touches the shell.
  let lastCount = -1;
  createEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    let count = 0;
    for (const host of hostKeys()) {
      const watched = attention.get(host);
      if (watched?.kind === "live") count += watched.value.awaitingIds.length;
    }
    if (count === lastCount) return;
    lastCount = count;
    if (count > 0) void navigator.setAppBadge(count);
    else void navigator.clearAppBadge();
  });

  // The OS notification click is ONE action: switch to that host, then focus the
  // terminal that wants you. After the switch, `focusTerminal` targets the
  // now-active host; the center-on-active impulse pans once the tile renders.
  onCleanup(
    notify.onClick(({ host, id }) => {
      setActiveHost(decodeHostKey(host));
      deps.focusTerminal(id as TerminalId);
    }),
  );
}
