/**
 * Tip state — server-backed via conf. Persists seen tips and startup-tips toggle.
 * Owns all tip timing: state-driven triggers live here, not in consuming components.
 */

import { type Accessor, createEffect } from "solid-js";
import { toast } from "solid-sonner";
import { AMBIENT_TIPS, CONTEXTUAL_TIPS, type Tip, type TipId } from "./tips";
import {
  startupTips,
  setStartupTipsPref,
  seenTips,
  markTipSeen,
} from "./usePreferences";
import type { TerminalId } from "kolu-common";

const TIP_PREFIX = "💡 ";

function showTipOnce(tip: Tip) {
  if (new Set(seenTips()).has(tip.id)) return;
  markTipSeen(tip.id);
  toast(TIP_PREFIX + tip.text, { duration: 5000 });
}

function randomAmbientTip(): string {
  const seen = new Set(seenTips());
  const unseen = AMBIENT_TIPS.filter((t) => !seen.has(t.id));
  const pool = unseen.length > 0 ? unseen : AMBIENT_TIPS;
  const pick = pool[Math.floor(Math.random() * pool.length)]!;
  if (!seen.has(pick.id)) markTipSeen(pick.id);
  return pick.text;
}

function showStartupTip() {
  if (!startupTips()) return;
  const text = randomAmbientTip();
  toast(TIP_PREFIX + text, {
    duration: 4000,
    description: "Startup tip · disable in Settings",
  });
}

function initTipTriggers(deps: { terminalIds: Accessor<TerminalId[]> }) {
  let startupFired = false;
  createEffect(() => {
    if (!startupFired && deps.terminalIds().length > 0) {
      startupFired = true;
      setTimeout(showStartupTip, 1000);
    }
  });

  createEffect(() => {
    if (deps.terminalIds().length >= 3)
      showTipOnce(CONTEXTUAL_TIPS.missionControl);
  });
}

export function useTips() {
  return {
    showTipOnce,
    randomAmbientTip,
    initTipTriggers,
    startupTips,
    setStartupTips: setStartupTipsPref,
  } as const;
}
