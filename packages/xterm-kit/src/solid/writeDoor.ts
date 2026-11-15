/** `@kolu/xterm-kit/write-door` — the pane's WRITE DOOR, without the component.
 *
 *  Everything a stream's items pass through on their way into an xterm, and
 *  nothing else: the unfocused rate coalescer and the scroll lock, in that
 *  order. `<Xterm>` wires exactly this pair ({@link createOutputCoalesce} over
 *  {@link createScrollLock}'s `writeData` / `resizeInOrder`) and adds a
 *  terminal, a renderer, touch and a reactive owner around it.
 *
 *  It is a subpath of its own because the door is the thing with the ORDERING
 *  CONTRACT — bytes and the resizes between them reach the terminal in the
 *  order the daemon produced them — and a consumer that wants to hold that
 *  contract to account should not have to load a JSX component and a DOM to do
 *  it. kaval's `lockstepMirror.test.ts` is that consumer: it replays one real
 *  PTY attachment through this door and compares the resulting screen with the
 *  daemon's own mirror.
 *
 *  Still Solid-dependent (the lock's state is signals) and therefore still
 *  under `/solid`, which is what keeps it out of the runtime-neutral core
 *  barrel the daemon imports — see `../noSolidInDaemon.test.ts`. */

export {
  createOutputCoalesce,
  UNFOCUSED_COALESCE_MS,
} from "./outputCoalesce";
export type {
  OutputCoalesce,
  OutputCoalesceDeps,
  OutputSink,
} from "./outputCoalesce";
export { createScrollLock, SCROLL_INTENT_WINDOW_MS } from "./scrollLock";
export type { PendingItem, ScrollIntentSource } from "./scrollLock";
/** The terminal the door writes to, re-exported so a consumer can name it
 *  without declaring `@xterm/xterm` itself — the door's own dependency, not
 *  its caller's. `@xterm/headless` is the same core minus the renderer and
 *  satisfies every member the door touches. */
export type { Terminal as DoorTerminal } from "@xterm/xterm";
