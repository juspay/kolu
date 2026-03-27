/** Tip state — singleton module. Persists seen tips in localStorage. */

import { createSignal } from "solid-js";
import { makePersisted } from "@solid-primitives/storage";
import { toast } from "solid-sonner";
import { AMBIENT_TIPS, type Tip, type TipId } from "./tips";

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

/** Show a contextual tip toast if the user hasn't seen it yet. */
function showTipOnce(tip: Tip) {
  if (seen().has(tip.id)) return;
  markSeen(tip.id);
  toast(tip.text, { duration: 5000 });
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
  toast(text, { duration: 6000 });
}

export function useTips() {
  return {
    showTipOnce,
    randomAmbientTip,
    showStartupTip,
    startupTips,
    setStartupTips,
  } as const;
}
