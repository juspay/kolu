/** Soft-keyboard dismissal for touch overlays (drawers, dialogs).
 *
 *  The mobile policy — the other half of which is `Terminal.focusOnSelection`'s
 *  no-op-on-touch guard — is: the OS soft keyboard rises ONLY from an explicit
 *  tap on the terminal screen. Dismissing a drawer or dialog must therefore
 *  leave the keyboard DOWN.
 *
 *  Corvu's `restoreFocus={false}` stops Corvu from re-focusing the terminal on
 *  close, but that alone is not enough on iOS Safari: moving focus into a
 *  focus-trapped overlay does NOT reliably blur the text field underneath, so
 *  the keyboard lingers for the drawer's whole lifetime and a backdrop dismiss
 *  leaves it up (the bug PR #1075's `restoreFocus={false}` did not fix). The
 *  only lever iOS treats as authoritative is blurring the focused element
 *  ourselves — so on close we do exactly that.
 *
 *  Two passes:
 *   - a SYNCHRONOUS blur, run inside the dismiss gesture where iOS honours it
 *     (an async-only blur loses the user-activation context); and
 *   - one DEFERRED blur a frame later — Corvu's focus trap tears down in an
 *     `afterPaint` callback and can re-trap focus into the (closing) overlay,
 *     which the second pass clears.
 *
 *  We blur whatever holds focus, not only text inputs: when a drawer traps
 *  focus onto one of its own buttons the keyboard can still linger on iOS, and
 *  dropping focus to `<body>` is what brings it down. This is safe because it
 *  only fires as an overlay closes — its content (and any focus it held) is
 *  being torn down regardless. No-op on desktop, where a hardware keyboard must
 *  keep its focus through an overlay close. */

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
