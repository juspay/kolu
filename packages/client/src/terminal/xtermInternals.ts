/** The one null-guarded place for xterm's private `_core.*` shape.
 *
 *  Every reach into xterm's undocumented internals — render service,
 *  buffer service, DEC private modes — lives here, behind accessors that
 *  return null (or a null-shaped result) when the shape isn't what we
 *  expect. This is the single volatility axis: when the pinned
 *  `@xterm/xterm` beta bumps and renames a `_core` field, exactly one
 *  module needs editing, and every consumer degrades to a no-op / "unknown"
 *  probe instead of crashing.
 *
 *  Consumers:
 *   - `renderRecovery.ts` uses `renderService`/`readDecPrivateMode` for its
 *     forced sync repaint + render-pipeline probes.
 *   - `Terminal.tsx` uses `readBufferBytes` for the Diagnostic dialog's
 *     per-terminal byte counts. */

import type { Terminal as XTerm } from "@xterm/xterm";

/** Unchecked cast onto xterm's private `_core`. The shape is described
 *  structurally at each call site below; the guards there are what keep us
 *  safe, since this cast asserts nothing. */
function core<T>(term: XTerm): T | undefined {
  return (term as unknown as { _core?: T })._core;
}

/** xterm's private render internals we reach through. Every field optional —
 *  the cast is unchecked, so the guards in the accessors are what keep us safe. */
export interface RenderInternals {
  refreshRows?: (start: number, end: number, sync?: boolean) => void;
  _renderDebouncer?: { _animationFrame?: number };
  _isPaused?: boolean;
}

/** xterm's `_core._renderService`, or null if its shape changed under us. */
export function renderService(term: XTerm): RenderInternals | null {
  const rs = core<{ _renderService?: RenderInternals }>(term)?._renderService;
  return rs ?? null;
}

/** A DEC private mode (e.g. DEC 2026 synchronized-output): true/false if we
 *  can read it; null if xterm's shape changed under us. */
export function readDecPrivateMode(
  term: XTerm,
  field: "synchronizedOutput",
): boolean | null {
  const modes = core<{
    _coreService?: { decPrivateModes?: Record<string, unknown> };
  }>(term)?._coreService?.decPrivateModes;
  if (!modes || !(field in modes)) return null;
  return modes[field] === true;
}

/** Sum `byteLength` of every BufferLine's `Uint32Array` in xterm's primary
 *  and alternate buffers. Reaches through private `_core._bufferService`,
 *  so every access is null-guarded — if xterm renames these fields in a
 *  future version, the probe reports `null` and the UI labels it "unknown"
 *  instead of crashing. Uses `length` + `get(i)` rather than iterating the
 *  private list array, because `CircularList.length` is the public view
 *  into a ring buffer with an arbitrary internal start offset. */
export function readBufferBytes(
  term: XTerm,
): { primary: number; alternate: number } | null {
  const bufSvc = core<{
    _bufferService?: {
      buffers?: {
        normal?: {
          lines?: {
            length: number;
            get(i: number): { _data?: Uint32Array } | undefined;
          };
        };
        alt?: {
          lines?: {
            length: number;
            get(i: number): { _data?: Uint32Array } | undefined;
          };
        };
      };
    };
  }>(term)?._bufferService;
  if (!bufSvc?.buffers) return null;

  function sum(lines: {
    length: number;
    get(i: number): { _data?: Uint32Array } | undefined;
  }) {
    let total = 0;
    for (let i = 0; i < lines.length; i++) {
      const data = lines.get(i)?._data;
      if (data) total += data.byteLength;
    }
    return total;
  }

  const primary = bufSvc.buffers.normal?.lines;
  const alternate = bufSvc.buffers.alt?.lines;
  if (!primary || !alternate) return null;
  return { primary: sum(primary), alternate: sum(alternate) };
}
