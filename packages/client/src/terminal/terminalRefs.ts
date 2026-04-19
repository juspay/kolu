/** Per-terminal runtime refs (xterm instance + addons).
 *
 *  Handlers outside the Terminal component sometimes need the live xterm
 *  instance or one of its addons — e.g. "Export session as PDF" needs the
 *  SerializeAddon to produce themed HTML. Rather than drill callbacks through
 *  CanvasTile or reach into the DOM, Terminal.tsx registers its refs here on
 *  mount and unregisters on cleanup. The `__xterm` DOM attachment on the
 *  container stays as an e2e-only affordance; production code looks up refs
 *  by id through this module. */

import type { Terminal as XTerm } from "@xterm/xterm";
import type { SerializeAddon } from "@xterm/addon-serialize";
import type { TerminalId } from "kolu-common";

/** Volatile per-terminal probes. Unlike the stable `xterm`/`serialize`
 *  handles above, these accessors may return null even during the terminal's
 *  lifetime (e.g. `webglAtlas` when the tile is unfocused and no WebGL addon
 *  is live). Namespaced under `probes` so the volatility contrast stays
 *  visible in the type. */
export interface TerminalProbes {
  /** Dimensions of the live WebGL texture atlas canvas, or null if the
   *  terminal currently has no WebGL addon. */
  webglAtlas: () => { w: number; h: number } | null;
  /** Summed `Uint32Array.byteLength` of every BufferLine in xterm's primary
   *  and alternate buffers — the literal bytes held by xterm's cell grid.
   *  Reads through a private `_core._bufferService` path; returns null if
   *  that shape has changed under us so callers fall back to "unknown"
   *  instead of crashing. */
  bufferBytes: () => { primary: number; alternate: number } | null;
}

export interface TerminalRefs {
  xterm: XTerm;
  serialize: SerializeAddon;
  probes: TerminalProbes;
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
