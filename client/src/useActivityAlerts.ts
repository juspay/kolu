/**
 * Activity alerts — out-of-tab feedback when a terminal session ends.
 *
 * In-app feedback is the sidebar glow (notified flag in useTerminals).
 * This module handles audio tone + browser Notification for backgrounded tabs.
 */

import type { Accessor } from "solid-js";
import type { SessionEndEvent } from "kolu-common";

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

export function useActivityAlerts(deps: { enabled: Accessor<boolean> }) {
  /** Called when a background terminal's session ends and the user hasn't seen the activity.
   *  Fires audio + browser notification only when the tab is backgrounded. */
  function onSessionEnd(label: string, event: SessionEndEvent) {
    if (!deps.enabled() || !document.hidden) return;

    const title = `${label} finished`;
    const description = `Active for ${formatDuration(event.durationS)}`;
    playTone();
    showBrowserNotification(title, description);
  }

  return { enabled: deps.enabled, onSessionEnd } as const;
}
