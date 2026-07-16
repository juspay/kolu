/** The terminal a deep link wants focused, exposed so session restore's
 *  cold-boot hydration can PICK it as the active tile — instead of racing the
 *  deep-link router for the `activeId` write.
 *
 *  On a cold boot both the deep-link settle effect and restore fire as terminal
 *  metadata streams in. The deep link enacts as soon as ITS target's record
 *  composes; restore's `hydrateFromTerminals` waits for EVERY terminal's
 *  metadata, so its `setActiveSilently` commonly runs on a LATER flush and
 *  overwrites the deep link's focus — a bookmark landing on the last-active
 *  terminal instead of the linked one (a flaky "wrong tile" on boot). Feeding
 *  the intent INTO restore's `picked` selection makes ONE writer choose the
 *  deep-link target, so the race is gone by construction — the same shape as the
 *  host-level `requestActivateOnJoin` (`wire.ts`), one level down.
 *
 *  Restore honors it only when the id is a member of ITS terminal list (so a
 *  stale cross-host intent is safely ignored), and resolves a sub-terminal
 *  target to its owning tile. Cleared on every NON-ENACTED termination of an
 *  in-flight route (`useDeepLinks`'s `disarmInFlightRoute` — supersession by a
 *  traversal, a newer command, or a manual host switch, AND the fault verdicts:
 *  list error, terminal gone, backstop timeout — so a cancelled or failed
 *  command can't steer a later hydration); an ENACTED intent survives, so
 *  hydration keeps preferring the view the user actually reached. */

import type { TerminalId } from "kolu-common/surface";
import { createSignal } from "solid-js";

export const [deepLinkFocusIntent, setDeepLinkFocusIntent] =
  createSignal<TerminalId | null>(null);
