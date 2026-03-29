/** Terminal activity notifications — audio, toast, and browser notifications when a session ends. */

import type { Accessor } from "solid-js";
import { toast } from "solid-sonner";
import type { SessionEndEvent } from "kolu-common";
import { useTips } from "./useTips";
import { CONTEXTUAL_TIPS } from "./tips";

/** Format a duration in seconds to a human-readable string. */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Play a short notification tone via Web Audio API. */
function playTone() {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 800;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => ctx.close();
  } catch {
    // AudioContext blocked by autoplay policy — silent fallback
  }
}

/** Show a browser notification (requests permission lazily on first call). */
function showBrowserNotification(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  const fire = () => new Notification(title, { body, icon: "/favicon.svg" });
  if (Notification.permission === "granted") {
    fire();
  } else if (Notification.permission === "default") {
    void Notification.requestPermission().then(
      (p) => p === "granted" && fire(),
    );
  }
}

export function useNotifications(deps: { enabled: Accessor<boolean> }) {
  const { showTipOnce } = useTips();

  /** Called by useTerminals when the server emits a session-end event for a terminal. */
  function onSessionEnd(label: string, event: SessionEndEvent) {
    if (!deps.enabled()) return;

    const title = `${label} finished`;
    const description = `Active for ${formatDuration(event.durationS)}`;

    // Toast always fires — non-intrusive when tab is visible
    toast(title, { description });
    showTipOnce(CONTEXTUAL_TIPS.notifications);

    // Audio + browser notification only when tab is backgrounded
    if (document.hidden) {
      playTone();
      showBrowserNotification(title, description);
    }
  }

  return { onSessionEnd } as const;
}
