/**
 * Tip state — singleton module. Persists seen tips via server-backed preferences.
 * Owns all tip timing: state-driven triggers live here, not in consuming components.
 */

import { type Accessor, createEffect } from "solid-js";
import { toast } from "solid-sonner";
import { AMBIENT_TIPS, CONTEXTUAL_TIPS, type Tip, type TipId } from "./tips";
import type { TerminalId } from "kolu-common";
import { usePreferences } from "./usePreferences";

const TIP_PREFIX = "💡 ";

export function useTips() {
  const { seenTips, setSeenTips, startupTips, setStartupTips } =
    usePreferences();

  function seen(): Set<TipId> {
    return new Set(seenTips());
  }

  function markSeen(id: TipId) {
    const s = seen();
    s.add(id);
    setSeenTips([...s]);
  }

  /** Show a contextual tip toast if the user hasn't seen it yet. */
  function showTipOnce(tip: Tip) {
    if (seen().has(tip.id)) return;
    markSeen(tip.id);
    toast(TIP_PREFIX + tip.text, { duration: 5000 });
  }

  /** Pick a random ambient tip (prefers unseen, falls back to any). */
  function randomAmbientTip(): string {
    const unseen = AMBIENT_TIPS.filter((t) => !seen().has(t.id));
    const pool = unseen.length > 0 ? unseen : AMBIENT_TIPS;
    const pick = pool[Math.floor(Math.random() * pool.length)]!;
    if (!seen().has(pick.id)) markSeen(pick.id);
    return pick.text;
  }

  /** Show a random tip as a toast (for startup). Respects the startup-tips setting. */
  function showStartupTip() {
    if (!startupTips()) return;
    const text = randomAmbientTip();
    toast(TIP_PREFIX + text, {
      duration: 4000,
      description: "Startup tip · disable in Settings",
    });
  }

  /**
   * Wire up state-driven tip triggers. Call once from the app root.
   * Event-driven tips (sidebar click, theme button) stay at their call sites.
   */
  function initTipTriggers(deps: { terminalIds: Accessor<TerminalId[]> }) {
    // Startup tip — once, 1s after first terminal appears
    let startupFired = false;
    createEffect(() => {
      if (!startupFired && deps.terminalIds().length > 0) {
        startupFired = true;
        setTimeout(showStartupTip, 1000);
      }
    });

    // Mission Control nudge at 3+ terminals
    createEffect(() => {
      if (deps.terminalIds().length >= 3)
        showTipOnce(CONTEXTUAL_TIPS.missionControl);
    });
  }

  return {
    showTipOnce,
    randomAmbientTip,
    initTipTriggers,
    startupTips,
    setStartupTips,
  } as const;
}
