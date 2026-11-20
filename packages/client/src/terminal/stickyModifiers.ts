/** Sticky terminal modifiers for the mobile key bar: the bar arms Ctrl or Alt,
 *  and the next single character of terminal input is folded into the chord.
 *  Module-level state because the fold runs at two input sites. */

import { controlByte, metaByte } from "@kolu/terminal-protocol";
import { createSignal } from "solid-js";

const [ctrlArmed, setCtrlArmed] = createSignal(false);
const [altArmed, setAltArmed] = createSignal(false);

/** Whether the Ctrl modifier is armed for the next keystroke. */
export const stickyCtrl = ctrlArmed;
/** Whether the Alt modifier is armed for the next keystroke. */
export const stickyAlt = altArmed;

export function toggleStickyCtrl(): void {
  setCtrlArmed((v) => !v);
}

export function toggleStickyAlt(): void {
  setAltArmed((v) => !v);
}

export function clearStickyModifiers(): void {
  setCtrlArmed(false);
  setAltArmed(false);
}

/** Fold any armed modifiers into a single character of input, then disarm.
 *  `data` is returned unchanged when nothing is armed; an armed press is
 *  consumed whether or not it composes. */
export function applyStickyModifiers(data: string): string {
  const ctrl = ctrlArmed();
  const alt = altArmed();
  if (!ctrl && !alt) return data;
  clearStickyModifiers();
  if ([...data].length !== 1) return data;
  let out = data;
  if (ctrl) out = controlByte(data) ?? out;
  if (alt) out = metaByte(out);
  return out;
}
