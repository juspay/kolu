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
 *  order the daemon produced them. */

export { createOutputCoalesce } from "./outputCoalesce";
export type { OutputCoalesce, OutputSink } from "./outputCoalesce";
export { createScrollLock } from "./scrollLock";
/** The terminal the door writes to, re-exported so a consumer can name it
 *  without declaring `@xterm/xterm` itself — the door's own dependency, not
 *  its caller's. `@xterm/headless` is the same core minus the renderer and
 *  satisfies every member the door touches. */
export type { Terminal as DoorTerminal } from "@xterm/xterm";
