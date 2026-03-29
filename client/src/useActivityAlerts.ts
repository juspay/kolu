/** Activity alerts — audio tone + browser notification when a background terminal finishes. */

/** Play a short 800 Hz tone using Web Audio API. */
function playTone() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => ctx.close();
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
