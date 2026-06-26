/** Per-terminal copy-mode history-pager visibility — singleton via
 *  `createSharedRoot`. The pager is a read-only surface over the on-disk
 *  transcript (PR2); open-state is keyed by `TerminalId` because the title-bar
 *  button targets a specific tile, and (mirroring the find bar) the pager closes
 *  when the active terminal changes.
 *
 *  Both behaviors are the shared per-terminal-visibility axis
 *  ({@link createPerTerminalVisibility}); this shared root owns its own isolated
 *  store + effect, so the pager's open-state stays independent of the find
 *  bar's. */

import { createSharedRoot } from "../createSharedRoot";
import { createPerTerminalVisibility } from "./createPerTerminalVisibility";

export const useHistoryPager = createSharedRoot(() =>
  createPerTerminalVisibility(),
);
