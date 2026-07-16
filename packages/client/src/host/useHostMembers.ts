/** The pool's host list as a reactive accessor — the standing `padiMap.entries`
 *  membership subscription plus its `HostKey[]` projection, owned once. Both the
 *  desktop `HostSelectorStrip` and the mobile `MobileHostRow` render off this;
 *  extracting it (the sibling of `useHostAwaiting`) keeps the membership read in
 *  ONE place rather than hand-wired at each site. Its error policy (`Host membership
 *  error: …`) rides the map's `entriesClient` declaration, routed through the ONE
 *  interpreter, so the use-site is bare.
 *
 *  Call it synchronously in a component body so the `.use()` subscription runs
 *  under that component's reactive owner. `padiMap.entries.use().keys()` already
 *  mints a fresh `HostKey[]` (with canonical per-encoded-string references, so a
 *  `<For>` over it reconciles only genuinely-changed rows), so no defensive copy
 *  is needed. */

import type { HostKey } from "kolu-common/hostKey";
import { padiMap } from "../wire";

export function useHostMembers(): () => HostKey[] {
  const members = padiMap.entries.use();
  return () => members.keys();
}
