/** Terminal activity notifications — audio, toast, and browser notifications when long-running activity ceases. */

import type { Accessor } from "solid-js";
import { toast } from "solid-sonner";
import type { TerminalId } from "kolu-common";
import { MIN_ACTIVITY_DURATION_S } from "kolu-common/config";
import { useTips } from "./useTips";
import { CONTEXTUAL_TIPS } from "./tips";

/** Track when each terminal became active. */
const activeStartTimes = new Map<TerminalId, number>();

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

/** Show a browser notification (requests permission lazily). */
function showBrowserNotification(title: string, body: string) {
  if (typeof Notification === "undefined") return;
  if (Notification.permission === "granted") {
    new Notification(title, { body, icon: "/favicon.svg" });
  } else if (Notification.permission === "default") {
    void Notification.requestPermission().then((perm) => {
      if (perm === "granted") {
        new Notification(title, { body, icon: "/favicon.svg" });
      }
    });
  }
}

export function useNotifications(deps: {
  enabled: Accessor<boolean>;
}) {
  const { showTipOnce } = useTips();

  /** Call when a terminal's isActive state changes. */
  function onActivityTransition(
    id: TerminalId,
    isActive: boolean,
    label: string,
  ) {
    if (isActive) {
      activeStartTimes.set(id, Date.now());
      return;
    }

    const startTime = activeStartTimes.get(id);
    activeStartTimes.delete(id);
    if (!startTime || !deps.enabled()) return;

    const durationS = (Date.now() - startTime) / 1000;
    if (durationS < MIN_ACTIVITY_DURATION_S) return;

    const description = `Active for ${formatDuration(durationS)}`;

    // Toast always fires — non-intrusive when tab is visible
    toast(`${label} finished`, { description });
    showTipOnce(CONTEXTUAL_TIPS.notifications);

    // Audio + browser notification only when tab is backgrounded
    if (document.hidden) {
      playTone();
      showBrowserNotification(`${label} finished`, description);
    }
  }

  return { onActivityTransition } as const;
}
