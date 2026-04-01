/**
 * Tip state — singleton module. Persists seen tips in localStorage.
 * Owns all tip timing: state-driven triggers live here, not in consuming components.
 */

import { type Accessor, createEffect, createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { toast } from "solid-sonner";
import { AMBIENT_TIPS, CONTEXTUAL_TIPS, type Tip, type TipId } from "./tips";
import type { TerminalId } from "kolu-common";

const [seenJson, setSeenJson] = makePersisted(createSignal("[]"), {
  name: "kolu-seen-tips",
});

const [startupTips, setStartupTips] = makePersisted(createSignal(true), {
  name: "kolu-startup-tips",
});

function seen(): Set<TipId> {
  try {
    return new Set(JSON.parse(seenJson()));
  } catch {
    return new Set();
  }
}

function markSeen(id: TipId) {
  const s = seen();
  s.add(id);
  setSeenJson(JSON.stringify([...s]));
}

const TIP_PREFIX = "💡 ";

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
function initTipTriggers(deps: { workspaceIds: Accessor<TerminalId[]> }) {
  // Startup tip — once, 1s after first workspace appears
  let startupFired = false;
  createEffect(() => {
    if (!startupFired && deps.workspaceIds().length > 0) {
      startupFired = true;
      setTimeout(showStartupTip, 1000);
    }
  });

  // Mission Control nudge at 3+ workspaces
  createEffect(() => {
    if (deps.workspaceIds().length >= 3)
      showTipOnce(CONTEXTUAL_TIPS.missionControl);
  });
}

export function useTips() {
  return {
    showTipOnce,
    randomAmbientTip,
    initTipTriggers,
    startupTips,
    setStartupTips,
  } as const;
}
