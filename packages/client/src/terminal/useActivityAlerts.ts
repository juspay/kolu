/** Activity alerts — audio + browser notification + in-app toast when a
 *  background terminal's agent finishes. All output channels live here so
 *  `useTerminalAlerts` stays focused on "decide who to alert". */

import { toast } from "solid-sonner";

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
 *  for a terminal that finished. The toast only renders when the finished
 *  terminal is not already the active one — a "Switch" affordance to the
 *  current terminal would be a no-op. `onSwitch` activates the terminal. */
export function fireActivityAlert(
  label: string,
  opts: { isBackground: boolean; onSwitch: () => void },
) {
  playSound();
  if (opts.isBackground) {
    toast.success(`${label} finished`, {
      duration: Number.POSITIVE_INFINITY,
      action: { label: "Switch", onClick: opts.onSwitch },
    });
  }
  if (
    document.hidden &&
    "Notification" in window &&
    Notification.permission === "granted"
  ) {
    const notif = new Notification(`${label} finished`, {
      icon: "/favicon.svg",
    });
    notif.onclick = () => {
      window.focus();
      if (opts.isBackground) opts.onSwitch();
      notif.close();
    };
  }
}
