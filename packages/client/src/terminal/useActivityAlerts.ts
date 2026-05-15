/** Activity alerts — audio + (hidden-tab) browser notification when a
 *  background terminal's agent finishes. The on-canvas Dock
 *  surfaces the same transition ambiently with full repo/branch context
 *  and a reply input, so the redundant in-app toast was retired — the
 *  channels left here cover the case the dock can't: the user isn't
 *  looking at the kolu window at all.
 *
 *  All output channels live here so `useTerminalAlerts` stays focused
 *  on "decide who to alert". */

import type { TerminalSubject } from "./terminalSubject";

/** Play the notification sound (pre-recorded mp3 in public/sounds/). */
function playSound() {
  const audio = new Audio("/sounds/notification.mp3");
  audio.play().catch(() => {
    // Autoplay policy or unsupported — swallow silently
  });
}

/** Request notification permission eagerly so it's ready when tab is backgrounded. */
export function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

/** Fire audio + (when tab is hidden) browser notification for a
 *  terminal that finished. The on-canvas dock handles the in-window
 *  case — these channels are only for when the user isn't looking. */
export function fireActivityAlert(
  subject: TerminalSubject,
  onSwitch?: () => void,
) {
  playSound();
  if (
    document.hidden &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    const notif = new Notification(`${subject.title} finished`, {
      body: subject.description,
      icon: "/favicon.svg",
    });
    notif.onclick = () => {
      window.focus();
      onSwitch?.();
      notif.close();
    };
  }
}
