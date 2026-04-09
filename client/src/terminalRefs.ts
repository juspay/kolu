/** Per-terminal runtime refs (xterm instance + addons).
 *
 *  Handlers outside the Terminal component sometimes need the live xterm
 *  instance or one of its addons — e.g. "Export session as PDF" needs the
 *  SerializeAddon to produce themed HTML. Rather than drill callbacks through
 *  TerminalPane or reach into the DOM, Terminal.tsx registers its refs here
 *  on mount and unregisters on cleanup. The `__xterm` DOM attachment on the
 *  container stays as an e2e-only affordance; production code looks up refs
 *  by id through this module. */

import type { Terminal as XTerm } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";
import type { TerminalId } from "kolu-common";

export interface TerminalRefs {
  xterm: XTerm;
  serialize: SerializeAddon;
}

const refs = new Map<TerminalId, TerminalRefs>();

export function registerTerminalRefs(id: TerminalId, r: TerminalRefs): void {
  refs.set(id, r);
}

export function unregisterTerminalRefs(id: TerminalId): void {
  refs.delete(id);
}

export function getTerminalRefs(id: TerminalId): TerminalRefs | undefined {
  return refs.get(id);
}
