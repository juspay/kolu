/** Per-terminal runtime refs (xterm instance + addons), registered by
 *  Terminal.tsx on mount and unregistered on cleanup. */

import type { SerializeAddon } from "@xterm/addon-serialize";
import type { Terminal as XTerm } from "@xterm/xterm";
import type { TerminalId } from "kolu-common/surface";
import type {
  RenderRecoveryProbes,
  ScrollLockEvent,
} from "@kolu/xterm-kit/solid";

/** Volatile per-terminal probes: unlike the stable `xterm`/`serialize` handles,
 *  these accessors may return null during the terminal's lifetime. */
export interface TerminalProbes extends RenderRecoveryProbes {
  /** Dimensions of the live WebGL texture atlas canvas, or null if the
   *  terminal currently has no WebGL addon. */
  webglAtlas: () => { w: number; h: number } | null;
  /** Summed `Uint32Array.byteLength` of every BufferLine in xterm's primary and
   *  alternate buffers. Reads a private `_core._bufferService` path, so it
   *  returns null when that shape has changed under us. */
  bufferBytes: () => { primary: number; alternate: number } | null;
  /** Scroll-lock transition ring, newest last. */
  scrollLockEvents: () => ScrollLockEvent[];
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
