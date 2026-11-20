/** Soft-keyboard dismissal for touch overlays (drawers, dialogs).
 *
 *  On iOS Safari, moving focus into a focus-trapped overlay does not blur the
 *  text field underneath, so Corvu's `restoreFocus={false}` alone leaves the
 *  keyboard up; blurring the focused element ourselves is the only lever iOS
 *  honours. Two passes: a synchronous blur inside the dismiss gesture (iOS
 *  ignores an async-only blur), and one a frame later, after Corvu's focus
 *  trap tears down in its `afterPaint` callback. No-op on desktop. */

import { isTouch } from "../useMobile";

export function dismissSoftKeyboard(): void {
  if (!isTouch()) return;
  const blur = () => {
    const active = document.activeElement;
    if (active instanceof HTMLElement) active.blur();
  };
  blur();
  requestAnimationFrame(blur);
}

/** Wrap a Corvu overlay's `onOpenChange` (or a bare open-state setter) so it
 *  drops the soft keyboard on close. The consumer still owns its open state. */
export function withKeyboardDismiss(
  onOpenChange: (open: boolean) => void,
): (open: boolean) => void {
  return (open) => {
    onOpenChange(open);
    if (!open) dismissSoftKeyboard();
  };
}
