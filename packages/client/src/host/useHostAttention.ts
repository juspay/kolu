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
import { watchByEntry } from "@kolu/surface-map/client";
import { decodeHostKey, encodeHostKey } from "kolu-common/hostKey";
import type { TerminalId } from "kolu-common/surface";
import { createEffect, onCleanup } from "solid-js";
import { match } from "ts-pattern";
import { notify } from "../attentionNotify";
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
  // The one delivery seam at the origin's ONE service worker (`../attentionNotify`,
  // shared with the per-terminal path) — never per window, so two open windows
  // can't double-ping (the tag replaces, never stacks).
  //
  // Request permission REACTIVELY off the same `enabled()` rule that gates every
  // other leg: a one-shot read at construction would never ask when the user
  // turns alerts on later (until a reload). The effect covers both construction
  // and runtime-enable; `requestPermission` is idempotent, so re-runs are cheap.
  createEffect(() => {
    if (enabled()) void notify.requestPermission();
  });

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
          data: { kind: "host", host: encoded, id },
        });
      }
    },
  );

  // The app badge = Σ awaitingIds.length over LIVE hosts — kolu's own one-line
  // fold. A dead host's held count never inflates it (its chip dims instead); the
  // active host is a live host, so its awaiting agents are counted too. The
  // effect re-runs on any host's urgency/liveness change; `paintBadge` (below)
  // dedups an unchanged count and serialises the async shell writes so a rapid
  // set→clear can't land out of order.
  //
  // `lastCount` is the count last HANDED to the shell (undefined = never written
  // yet — a distinct "no write" state, not a magic `-1` inside the real domain).
  let lastCount: number | undefined;
  // Badge writes are async and order-sensitive: chained through one tail so a
  // later write always applies after an earlier one (never a stale set winning a
  // race with a newer clear), and a rejection is reported, not left unhandled.
  let badgeTail: Promise<unknown> = Promise.resolve();
  const paintBadge = (count: number): void => {
    if (count === lastCount) return;
    lastCount = count;
    badgeTail = badgeTail
      .then(() =>
        count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge(),
      )
      .catch((err) =>
        console.warn("useHostAttention: app-badge write failed", err),
      );
  };
  createEffect(() => {
    if (!("setAppBadge" in navigator)) return;
    // Gate the badge on the SAME single `activityAlerts` decision that gates the
    // notification leg — one user choice, both outputs. With alerts off, clear
    // any live badge so a later re-enable repaints from a clean count.
    if (!enabled()) {
      paintBadge(0);
      return;
    }
    let count = 0;
    for (const host of hostKeys()) {
      const watched = attention.get(host);
      if (watched?.kind === "live") count += watched.value.awaitingIds.length;
    }
    paintBadge(count);
  });

  // The SINGLE `notify.onClick` router for the whole client — one listener on the
  // origin's one service-worker message channel, switching on the discriminated
  // payload so a per-terminal click and a cross-host click can never
  // cross-deliver. BOTH clicks are ONE action and BOTH switch to the originating
  // host first: a notification outlives the active-host selection, so focusing
  // without switching would route the terminal id against whatever host is active
  // now. After `setActiveHost`, `focusTerminal` targets the now-correct host (the
  // center-on-active impulse pans once the tile renders).
  onCleanup(
    notify.onClick((data) =>
      match(data)
        .with({ kind: "host" }, ({ host, id }) => {
          setActiveHost(decodeHostKey(host));
          deps.focusTerminal(id as TerminalId);
        })
        .with({ kind: "terminal" }, ({ host, terminalId }) => {
          setActiveHost(decodeHostKey(host));
          deps.focusTerminal(terminalId);
        })
        .exhaustive(),
    ),
  );
}
