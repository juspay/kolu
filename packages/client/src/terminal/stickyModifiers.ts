/** Sticky terminal modifiers for the mobile key bar.
 *
 *  Soft keyboards can't produce Ctrl/Alt chords (Ctrl+R, Alt+f, …) and the
 *  global app shortcuts never reach the PTY, so on a phone those chords are
 *  otherwise unreachable. The key bar *arms* a modifier here; the next single
 *  character of terminal input — whether typed on the soft keyboard (xterm
 *  `onData`) or sent by a key-bar key — is folded into the chord and the
 *  modifier disarms. One-shot, like a sticky-keys press.
 *
 *  Only the two terminal-meaningful modifiers are offered: Ctrl encodes a
 *  control byte, Alt prefixes ESC (a.k.a. Meta). Shift is left to the keyboard
 *  (it already produces uppercase / shifted symbols), and Cmd/Meta has no PTY
 *  encoding.
 *
 *  State is a module-level singleton: arming happens in the key bar but the
 *  fold is applied at two input sites (the key bar's own `sendInput` and the
 *  terminal's `onData`), so the armed flag can't live inside either. */

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
 *
 *  Returns `data` unchanged (and skips the disarm) when nothing is armed, so
 *  the desktop/no-modifier path is a cheap no-op. When a modifier *is* armed
 *  the press is consumed regardless of whether it composes: escape sequences
 *  and multi-character pastes pass through untouched but still disarm, so a
 *  stray arm never lingers onto a later keystroke. */
export function applyStickyModifiers(data: string): string {
  const ctrl = ctrlArmed();
  const alt = altArmed();
  if (!ctrl && !alt) return data;
  clearStickyModifiers();
  // Only lone characters compose; CSI sequences (arrows, etc.) and pastes are
  // left alone. Spread-count so a surrogate-pair emoji counts as one.
  if ([...data].length !== 1) return data;
  let out = data;
  // Ctrl folds the lone char to its control byte via the shared
  // terminal-protocol table (Ctrl+r === Ctrl+R === 0x12); a char with no control
  // byte (a digit, say) is left as-is. Alt/Meta prefixes ESC.
  if (ctrl) out = controlByte(data) ?? out;
  if (alt) out = metaByte(out);
  return out;
}
