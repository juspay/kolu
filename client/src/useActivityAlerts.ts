/** Activity alerts — audio + browser notification when a background terminal finishes. */

/** Play the notification sound (pre-recorded mp3 in public/sounds/). */
function playTone() {
  try {
    new Audio("/sounds/notification.mp3").play();
  } catch {
    // Autoplay policy or unsupported — ignore
  }
}

/** Request notification permission eagerly so it's ready when tab is backgrounded. */
export function requestNotificationPermission() {
  if ("Notification" in window && Notification.permission === "default") {
    void Notification.requestPermission();
  }
}

/** Show a browser notification (permission must already be granted). */
function showBrowserNotification(title: string, body?: string) {
  if (!("Notification" in window)) return;
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.svg" });
  }
}

/** Fire audio + browser notification for a terminal that finished. */
export function fireActivityAlert(label: string) {
  playTone();
  if (document.hidden) {
    showBrowserNotification(`${label} finished`);
  }
}
