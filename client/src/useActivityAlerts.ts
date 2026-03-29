/** Activity alerts — audio + browser notification when a background terminal finishes. */

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

/** Fire audio + browser notification for a terminal that finished. */
export function fireActivityAlert(label: string) {
  playSound();
  if (document.hidden) {
    if ("Notification" in window && Notification.permission === "granted") {
      new Notification(`${label} finished`, { icon: "/favicon.svg" });
    }
  }
}
