/** The pool's host list as a reactive accessor, IN THE USER'S ARRANGEMENT — the
 *  standing `padiMap.entries` membership subscription plus its ordered
 *  `HostKey[]` projection, owned once. Both the desktop `HostSelectorStrip` and
 *  the mobile `MobileHostRow` render off this; extracting it keeps the
 *  membership read in ONE place rather than hand-wired at each site. Its error
 *  policy (`Host membership error: …`) rides the map's `entriesClient`
 *  declaration, routed through the ONE interpreter, so the use-site is bare.
 *
 *  The arrangement is the pure `orderHostKeys` overlay (`./hostOrder`) over the
 *  SAME `hostOrder` preference `wire.ts`'s `hostKeys` folds — one rule, so the
 *  strip, the overflow menu, the dropdown switcher, the phone host row and the
 *  palette's Hosts rows cannot disagree about order. Membership still decides
 *  WHO is listed; the preference only WHERE each sits.
 *
 *  Call it synchronously in a component body so the `.use()` subscription runs
 *  under that component's reactive owner. `padiMap.entries.use().keys()` already
 *  mints a fresh `HostKey[]` (with canonical per-encoded-string references, so a
 *  `<For>` over it reconciles only genuinely-changed rows), and `orderHostKeys`
 *  only permutes those same references, so no defensive copy is needed. */

import type { HostKey } from "kolu-common/hostKey";
import { padiMap, preferences } from "../wire";
import { orderHostKeys } from "./hostOrder";

export function useHostMembers(): () => HostKey[] {
  const members = padiMap.entries.use();
  return () => orderHostKeys(members.keys(), preferences().hostOrder);
}
