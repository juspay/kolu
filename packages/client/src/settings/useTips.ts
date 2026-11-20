import type { TerminalId } from "kolu-common/surface";
import { type Accessor, createEffect, createSignal, untrack } from "solid-js";
import { showsAmbientTips } from "../capabilities";
import { preferences, preferencesArrived, updatePreferences } from "../wire";
import { AMBIENT_TIPS, type Tip, type TipId } from "./tips";

const isPWA = window.matchMedia("(display-mode: standalone)").matches;
// Drop the install tip only when already installed. Its "install from your
// browser menu" copy works over plain http too — manual install isn't gated on a
// secure context (only the one-click prompt and the app badge are).
const ambientPool = AMBIENT_TIPS.filter(
  (t) => !(isPWA && t.id === "amb-pwa-install"),
);

const [activeTipSignal, setActiveTip] = createSignal<Tip | null>(null);

export const activeTip: Accessor<Tip | null> = activeTipSignal;

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

export const dismissTip = () => {
  cancelAutoDismiss();
  setActiveTip(null);
};

function arrivedSeen(): Set<TipId> | null {
  return preferencesArrived() ? new Set(preferences().seenTips) : null;
}

function markSeen(seen: Set<TipId>, id: TipId) {
  seen.add(id);
  updatePreferences({ seenTips: [...seen] });
}

const awaitingPreferences: (() => void)[] = [];

function whenPreferencesArrive(fn: () => void) {
  if (preferencesArrived()) fn();
  else awaitingPreferences.push(fn);
}

function showTipOnce(tip: Tip) {
  if (!showsAmbientTips()) return;
  const seen = arrivedSeen();
  if (seen === null) {
    whenPreferencesArrive(() => {
      if (activeTip() === null) showTipOnce(tip);
    });
    return;
  }
  if (seen.has(tip.id)) return;
  markSeen(seen, tip.id);
  present(tip);
}

function pickAmbientTip(seen: Set<TipId>): Tip | null {
  if (!showsAmbientTips()) return null;
  const unseen = ambientPool.filter((t) => !seen.has(t.id));
  const pool = unseen.length > 0 ? unseen : ambientPool;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

function peekAmbientTipText(): string {
  const seen = arrivedSeen();
  return (seen === null ? null : pickAmbientTip(seen))?.text ?? "";
}

function showAmbientTip() {
  const seen = arrivedSeen();
  if (seen === null) return;
  const tip = pickAmbientTip(seen);
  if (!tip) return;
  markSeen(seen, tip.id);
  present(tip);
}

function showStartupTip() {
  if (!preferencesArrived()) {
    whenPreferencesArrive(showStartupTip);
    return;
  }
  if (activeTip() !== null) return;
  if (preferences().startupTips) showAmbientTip();
}

function initTipTriggers(deps: { terminalIds: Accessor<TerminalId[]> }) {
  createEffect(() => {
    if (!preferencesArrived()) return;
    untrack(() => {
      for (const fn of awaitingPreferences.splice(0)) fn();
    });
  });
  let startupFired = false;
  createEffect(() => {
    if (!startupFired && deps.terminalIds().length > 0) {
      startupFired = true;
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
