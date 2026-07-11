/** Activity alerts — audio + OS notification when an agent finishes in a
 *  terminal the user isn't actively watching. The on-canvas Dock surfaces the
 *  same transition ambiently with full repo/branch context and a reply input, so
 *  the redundant in-app toast was retired — the channels left here cover the case
 *  the dock can't: the user isn't looking at that terminal (it's a background
 *  terminal, or kolu isn't focused).
 *
 *  All output channels live here so `useTerminalAlerts` stays focused on "decide
 *  who to alert" — including the "are they watching it" gate (see
 *  `alertForTerminal`). This module just plays the channels when asked.
 *
 *  OS-notification delivery is NOT hand-rolled here: it rides the ONE client-wide
 *  `notify` seam (`../attentionNotify`) — the same `createNotify` instance the
 *  cross-host path uses — so the two landmines (`getRegistration()` not `.ready`;
 *  the worker's `showNotification`, never `new Notification()`), the permission
 *  gate, and the tag-keyed multi-window de-dup all live in ONE place. Only
 *  `playSound` stays local: audio is a separate concern the notification seam
 *  does not own. */

import type { TerminalId } from "kolu-common/surface";
import { notify } from "../attentionNotify";
import type { TerminalSubject } from "./terminalSubject";

/** Play the notification sound (pre-recorded mp3 in public/sounds/). */
function playSound() {
  const audio = new Audio("/sounds/notification.mp3");
  audio.play().catch(() => {
    // Autoplay policy or unsupported — swallow silently
  });
}

/** Request notification permission eagerly so it's ready when the window is
 *  backgrounded. Delegates to the one `notify` seam (idempotent). */
export function requestNotificationPermission() {
  void notify.requestPermission();
}

/** Fire audio + an OS notification for a terminal that finished. The caller
 *  (`alertForTerminal`) owns the *when* — it only calls this when the user isn't
 *  actively watching that terminal — so there is NO window-visibility gate here:
 *  the previous `document.hidden` check meant the banner only ever fired when
 *  kolu was fully off-screen, which on macOS is almost never true (switching apps
 *  while Chrome stays visible keeps `document.hidden` false via occlusion), so the
 *  banner was effectively dead. The "are they looking?" decision is now
 *  `document.hasFocus()`-based, in the caller.
 *
 *  Delivery rides the shared `notify` seam: it shows through the service worker
 *  (the page-level `new Notification()` constructor is illegal in `standalone`
 *  display mode on Chromium and silently throws), and keys the banner by `tag`
 *  (`${host}/${terminalId}`) so two open windows REPLACE rather than stack. A
 *  `kind: "terminal"` click routes back through the single `notify.onClick`
 *  router in `useHostAttention`, which switches to `host` before focusing — the
 *  terminal lives on the host that was active when it finished, and a click may
 *  land after the user has switched away. */
export function fireActivityAlert(
  subject: TerminalSubject,
  terminalId: TerminalId,
  host: string,
) {
  playSound();
  void notify.show({
    tag: `${host}/${terminalId}`,
    title: `${subject.title} finished`,
    body: subject.description,
    icon: "/favicon.svg",
    data: { kind: "terminal", host, terminalId },
  });
}
