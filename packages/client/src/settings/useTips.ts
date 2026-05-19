/**
 * Tip state — singleton module. Persists seen tips in server state.
 * Tips render via `<TipBanner />` (top-center floating pill), kept
 * separate from the bottom-right toast stream so they don't get lost
 * among success / error notifications.
 */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, createSignal } from "solid-js";
import { isMobile } from "../useMobile";
import { AMBIENT_TIPS, type Tip, type TipId } from "./tips";
import { preferences, updatePreferences } from "../wire";

const isPWA = window.matchMedia("(display-mode: standalone)").matches;
const ambientPool = AMBIENT_TIPS.filter(
  (t) => !(isPWA && t.id === "amb-pwa-install"),
);

const [activeTipSignal, setActiveTip] = createSignal<Tip | null>(null);

/** Reactive accessor for the tip currently displayed by `<TipBanner />`. */
export const activeTip: Accessor<Tip | null> = activeTipSignal;

/** Hide the active tip (banner slides away). */
export const dismissTip = () => setActiveTip(null);

function seen(): Set<TipId> {
  return new Set(preferences().seenTips);
}

function markSeen(id: TipId) {
  const s = seen();
  s.add(id);
  updatePreferences({ seenTips: [...s] });
}

/** Show a contextual tip once. Marks it seen so it never reappears. */
function showTipOnce(tip: Tip) {
  if (isMobile()) return;
  if (seen().has(tip.id)) return;
  markSeen(tip.id);
  setActiveTip(tip);
}

/** Pick a random ambient tip (prefers unseen, falls back to any).
 *  Returns the full tip so callers can show it in the banner; the
 *  palette consumer uses `.text` for its footer string. */
function pickAmbientTip(): Tip | null {
  if (isMobile()) return null;
  const unseen = ambientPool.filter((t) => !seen().has(t.id));
  const pool = unseen.length > 0 ? unseen : ambientPool;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (!pick) return null;
  if (!seen().has(pick.id)) markSeen(pick.id);
  return pick;
}

/** Text-only variant for surfaces that just render a string (palette footer). */
function randomAmbientTip(): string {
  return pickAmbientTip()?.text ?? "";
}

/** Show a random tip in the banner (for startup). Respects the startup-tips setting. */
function showStartupTip() {
  if (isMobile()) return;
  if (!preferences().startupTips) return;
  const tip = pickAmbientTip();
  if (tip) setActiveTip(tip);
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
  return {
    showTipOnce,
    randomAmbientTip,
    initTipTriggers,
    startupTips: () => preferences().startupTips,
    setStartupTips: (on: boolean) => updatePreferences({ startupTips: on }),
  } as const;
}
