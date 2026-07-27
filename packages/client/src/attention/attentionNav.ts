/** The attention JUMP seam — "focus the next terminal blocked on you on host X".
 *
 *  Every violet needs-you capsule (host tab, switcher row, mobile chip) is a
 *  NAVIGATION affordance, never a dismissal: clicking it must land you on an
 *  awaiting terminal, and only the agent leaving `awaiting_user` clears the
 *  count. The jump needs the same two moves the OS-notification click router
 *  makes — switch host, then activate a terminal on the (post-switch) active
 *  host — and those verbs live on `useAttention`'s caller-supplied deps, so the
 *  ONE owner registers the implementation here at construction and the chips
 *  call the verb without prop-drilling (the same bridge shape as
 *  `attentionMarks`, store for facts ↔ this module for the verb).
 *
 *  Unregistered calls THROW: a chip that renders a clickable capsule before
 *  `useAttention` mounted is a wiring defect to surface, never a silent no-op
 *  click (fail fast — no fallbacks). */

type JumpToAsking = (encHost: string) => void;

let impl: JumpToAsking | null = null;

/** Called ONCE by `useAttention` at construction with the real implementation. */
export function registerAttentionJump(fn: JumpToAsking): void {
  impl = fn;
}

/** Focus the next terminal blocked on you on `encHost` — cycles through the
 *  host's `askingIds` starting after the currently-active terminal, so repeated
 *  clicks walk every blocked agent. */
export function jumpToAsking(encHost: string): void {
  if (!impl) {
    throw new Error(
      "attentionNav: jumpToAsking called before useAttention registered it",
    );
  }
  impl(encHost);
}
