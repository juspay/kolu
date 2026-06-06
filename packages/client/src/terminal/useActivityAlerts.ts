/** Activity alerts — audio + (hidden-window) OS notification when a
 *  background terminal's agent finishes. The on-canvas Dock
 *  surfaces the same transition ambiently with full repo/branch context
 *  and a reply input, so the redundant in-app toast was retired — the
 *  channels left here cover the case the dock can't: the user isn't
 *  looking at the kolu window at all.
 *
 *  All output channels live here so `useTerminalAlerts` stays focused
 *  on "decide who to alert". */

import type { TerminalId } from "kolu-common/surface";
import type { TerminalSubject } from "./terminalSubject";

/** The payload carried on the notification so a click can route back to the
 *  right terminal. The notification worker `postMessage`s it to the page (see
 *  `NOTIFICATION_SW_SOURCE` + the `serviceWorker` message listener in
 *  `useTerminalAlerts`), since an installed-PWA notification is handled in the
 *  worker, not via a page-level `Notification.onclick`. */
export interface ActivityAlertData {
  terminalId: TerminalId;
}

/** Play the notification sound (pre-recorded mp3 in public/sounds/). */
function playSound() {
  const audio = new Audio("/sounds/notification.mp3");
  audio.play().catch(() => {
    // Autoplay policy or unsupported — swallow silently
  });
}

/** Request notification permission eagerly so it's ready when the window is
 *  backgrounded. */
export function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

/** Fire audio + (when the window is hidden) an OS notification for a terminal
 *  that finished. The on-canvas dock handles the in-window case — these channels
 *  are only for when the user isn't looking.
 *
 *  The banner goes through `ServiceWorkerRegistration.showNotification()`, NOT
 *  the page-level `new Notification()` constructor: the latter is an illegal
 *  constructor in `standalone` display mode (an installed PWA) on Chromium, so it
 *  silently threw and no banner ever showed on macOS. The SW path works in both
 *  an installed app and a plain tab. The click is handled by the worker's
 *  `notificationclick`, which focuses the window and posts `data` back. */
export async function fireActivityAlert(
  subject: TerminalSubject,
  data?: ActivityAlertData,
) {
  playSound();
  if (
    !document.hidden ||
    !("Notification" in window) ||
    Notification.permission !== "granted" ||
    !("serviceWorker" in navigator)
  )
    return;
  // Use the actual registration, NOT `navigator.serviceWorker.ready`: `ready`
  // never resolves on an origin that has no active worker (an expected state in
  // dev, where `/sw.js` isn't served and registration was caught), so awaiting it
  // would leak a forever-pending promise and never take the no-banner fallback.
  // `getRegistration()` resolves immediately — to `undefined` when there's none.
  try {
    const reg = await navigator.serviceWorker.getRegistration();
    if (!reg?.active) return; // No worker to host the banner — silent no-op.
    await reg.showNotification(`${subject.title} finished`, {
      body: subject.description,
      icon: "/favicon.svg",
      data,
    });
  } catch {
    // Permission revoked mid-flight, the SW host gone, or showNotification
    // rejecting — callers `void` this, so swallow rather than reject unhandled.
    // The in-app dock + sound already covered the alert.
  }
}
