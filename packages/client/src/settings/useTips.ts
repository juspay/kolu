/**
 * Tip state — singleton module. Persists seen tips in server state.
 * Owns all tip timing: state-driven triggers live here, not in consuming components.
 */

import type { TerminalId } from "kolu-common";
import { type Accessor, createEffect } from "solid-js";
import { toast } from "solid-sonner";
import { isMobile } from "../useMobile";
import { AMBIENT_TIPS, type Tip, type TipId } from "./tips";
import { usePreferences } from "./usePreferences";

const isPWA = window.matchMedia("(display-mode: standalone)").matches;
const ambientPool = AMBIENT_TIPS.filter(
  (t) => !(isPWA && t.id === "amb-pwa-install"),
);

// Module-level references, set on first useTips() call.
let _prefs: ReturnType<typeof usePreferences>;
let _initialized = false;

function ensureInit() {
  if (_initialized) return;
  _initialized = true;
  _prefs = usePreferences();
}

function seen(): Set<TipId> {
  ensureInit();
  return new Set(_prefs.preferences().seenTips);
}

function markSeen(id: TipId) {
  const s = seen();
  s.add(id);
  _prefs.updatePreferences({ seenTips: [...s] });
}

const TIP_PREFIX = "\u{1F4A1} ";

/** Show a contextual tip toast if the user hasn't seen it yet. */
function showTipOnce(tip: Tip) {
  if (isMobile()) return;
  if (seen().has(tip.id)) return;
  markSeen(tip.id);
  toast(TIP_PREFIX + tip.text, { duration: 5000 });
}

/** Pick a random ambient tip (prefers unseen, falls back to any). */
function randomAmbientTip(): string {
  if (isMobile()) return "";
  const unseen = ambientPool.filter((t) => !seen().has(t.id));
  const pool = unseen.length > 0 ? unseen : ambientPool;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (!pick) return "";
  if (!seen().has(pick.id)) markSeen(pick.id);
  return pick.text;
}

/** Show a random tip as a toast (for startup). Respects the startup-tips setting. */
function showStartupTip() {
  if (isMobile()) return;
  if (!_prefs.preferences().startupTips) return;
  const text = randomAmbientTip();
  toast(TIP_PREFIX + text, {
    duration: 4000,
    description: "Startup tip \u00B7 disable in Settings",
  });
}

/**
 * Wire up state-driven tip triggers. Call once from the app root.
 * Event-driven tips (pill click, theme button) stay at their call sites.
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
}

export function useTips() {
  ensureInit();
  return {
    showTipOnce,
    randomAmbientTip,
    initTipTriggers,
    startupTips: () => _prefs.preferences().startupTips,
    setStartupTips: (on: boolean) =>
      _prefs.updatePreferences({ startupTips: on }),
  } as const;
}
