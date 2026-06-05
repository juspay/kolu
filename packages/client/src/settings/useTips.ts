/**
 * Tip state — singleton module. Persists seen tips in server state.
 * Tips render via `<TipBanner />` (top-center floating pill), kept
 * separate from the bottom-right toast stream so they don't get lost
 * among success / error notifications.
 */

import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, createSignal } from "solid-js";
import { showsAmbientTips } from "../capabilities";
import { preferences, updatePreferences } from "../wire";
import { AMBIENT_TIPS, type Tip, type TipId } from "./tips";

const isPWA = window.matchMedia("(display-mode: standalone)").matches;
// The install tip is dead unless install can actually work: not already
// installed, and a secure context (plain http:// on a LAN/Tailscale IP can't
// install — only https + localhost qualify). Drop it otherwise.
const canInstallPwa = window.isSecureContext && !isPWA;
const ambientPool = AMBIENT_TIPS.filter(
  (t) => t.id !== "amb-pwa-install" || canInstallPwa,
);

const [activeTipSignal, setActiveTip] = createSignal<Tip | null>(null);

/** Reactive accessor for the tip currently displayed by `<TipBanner />`. */
export const activeTip: Accessor<Tip | null> = activeTipSignal;

/** How long a tip stays on screen before the banner auto-dismisses it.
 *  Owned here (not in the banner) so the state module fully controls
 *  "how a tip is displayed and for how long" — the banner is just the
 *  rendering surface. */
const TIP_DURATION_MS = 8000;
let autoDismissTimer: number | null = null;

function cancelAutoDismiss() {
  if (autoDismissTimer !== null) {
    window.clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }
}

function present(tip: Tip) {
  cancelAutoDismiss();
  setActiveTip(tip);
  autoDismissTimer = window.setTimeout(() => {
    autoDismissTimer = null;
    setActiveTip(null);
  }, TIP_DURATION_MS);
}

/** Hide the active tip (banner slides away). */
export const dismissTip = () => {
  cancelAutoDismiss();
  setActiveTip(null);
};

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
  if (!showsAmbientTips()) return;
  if (seen().has(tip.id)) return;
  markSeen(tip.id);
  present(tip);
}

/** Internal pure peek — picks a tip without marking it seen. */
function pickAmbientTip(): Tip | null {
  if (!showsAmbientTips()) return null;
  const unseen = ambientPool.filter((t) => !seen().has(t.id));
  const pool = unseen.length > 0 ? unseen : ambientPool;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

/** Text-only peek for surfaces that render tip text without "consuming"
 *  the tip (palette footer). Does not mark the tip seen so the banner's
 *  unseen pool is not drained by incidental glances. */
function peekAmbientTipText(): string {
  return pickAmbientTip()?.text ?? "";
}

/** Atomic: pick an ambient tip, mark it seen, show it in the banner. */
function showAmbientTip() {
  const tip = pickAmbientTip();
  if (!tip) return;
  markSeen(tip.id);
  present(tip);
}

/** Show a random tip in the banner on startup, if the setting is on. */
function showStartupTip() {
  if (preferences().startupTips) showAmbientTip();
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
      // Fire-and-forget: the createEffect re-runs when terminalIds changes,
      // and onCleanup would cancel the pending timeout before it fires.
      // startupFired already guards against re-entry, so no cleanup needed.
      window.setTimeout(showStartupTip, 1000);
    }
  });
}

export function useTips() {
  return {
    showTipOnce,
    peekAmbientTipText,
    initTipTriggers,
    startupTips: () => preferences().startupTips,
    setStartupTips: (on: boolean) => updatePreferences({ startupTips: on }),
  } as const;
}
