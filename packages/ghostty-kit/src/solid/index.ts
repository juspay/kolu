/** Browser tile surface — canvas renderer over the libghostty engine.
 *  Imported only by the client; kaval must not load this entry. */

export {
  Ghostty,
  type GhosttyHandle,
  type SearchAddonShim,
} from "./Ghostty.tsx";
export { sameGrid, type TerminalGrid } from "./grid.ts";
export { createScrollLock } from "./scrollLock.ts";
export type { ScrollLockEvent } from "./scrollLock.ts";
export const PAINT_STALL_WARN_MS = 250;
