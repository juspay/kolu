/** Activity alerts — audio + browser notification + in-app toast when a
 *  background terminal's agent finishes. All output channels live here so
 *  `useTerminalAlerts` stays focused on "decide who to alert". */

import { toast } from "solid-sonner";
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

/** Fire audio + in-app toast + (when tab is hidden) browser notification
 *  for a terminal that finished. `onSwitch` (when provided) activates the
 *  terminal and gates the in-app toast — omit it when the finished terminal
 *  is already active, since a "Switch" affordance to the current tile is a
 *  no-op. The sound + native Notification still fire (they target a user
 *  who isn't looking, not a specific tile). */
export function fireActivityAlert(
  subject: TerminalSubject,
  toastId: string,
  onSwitch?: () => void,
) {
  playSound();
  const headline = `${subject.title} finished`;
  if (onSwitch) {
    toast.success(headline, {
      id: toastId,
      description: subject.description,
      duration: Number.POSITIVE_INFINITY,
      action: { label: "Switch", onClick: onSwitch },
    });
  }
  if (
    document.hidden &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    const notif = new Notification(headline, {
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
