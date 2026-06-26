/** Per-terminal find-bar visibility — singleton via `createSharedRoot` (the
 *  same primitive the other domain singletons use, so the verb object is built
 *  once and the `useTerminalStore` dependency is captured in the shared root
 *  rather than re-read per call). The xterm search overlay is scoped to one
 *  terminal at a time; open-state is keyed by `TerminalId` because `Terminal`
 *  reads `searchOpen` per id and `openFor(id)` targets a specific tile.
 *
 *  The per-terminal-visibility axis (keyed open-state + close-on-active-switch)
 *  lives in {@link createPerTerminalVisibility}, shared with the copy-mode
 *  history pager; this shared root owns its own isolated store + effect, so the
 *  find bar's open-state never bleeds into the pager's. Sub-terminals never open
 *  search (their leaf always passes `searchOpen={false}`). */

import { createSharedRoot } from "../createSharedRoot";
import { createPerTerminalVisibility } from "./createPerTerminalVisibility";

export const useTerminalSearch = createSharedRoot(() =>
  createPerTerminalVisibility(),
);
