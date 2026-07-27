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
 *  click (fail fast — no fallbacks). A SECOND registration throws too — there
 *  is exactly one attention owner, and two would mean a click reaching
 *  whichever mounted last, which is not a thing to discover from behaviour.
 *  Registration hands back a disposer so a torn-down owner empties the slot
 *  instead of leaving a closure over its disposed deps behind it. */

type JumpToAsking = (encHost: string) => void;

let impl: JumpToAsking | null = null;

/** Called ONCE by `useAttention` at construction with the real implementation.
 *  Returns the disposer for that owner's `onCleanup`. */
export function registerAttentionJump(fn: JumpToAsking): () => void {
  if (impl !== null) {
    throw new Error(
      "attentionNav: a second useAttention tried to register the jump seam — there is exactly one attention owner",
    );
  }
  impl = fn;
  // No identity check on the way out: the throw above means two owners can
  // never hold the slot at once, so the only thing this can be clearing is
  // its own registration.
  return () => {
    impl = null;
  };
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
