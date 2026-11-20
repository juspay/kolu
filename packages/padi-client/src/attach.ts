import type { EndpointGrid, TerminalAttachFrame } from "./surface.ts";

/** The snapshot arm of an attach frame — the one that carries a screen to paint
 *  and a backfill seed to re-seed from. */
export type AttachSnapshotFrame = Extract<
  TerminalAttachFrame,
  { kind: "snapshot" }
>;

/** The `resized` arm of an attach frame — a grid at a position in the stream,
 *  carrying no bytes of its own. */
export type AttachResizedFrame = Extract<
  TerminalAttachFrame,
  { kind: "resized" }
>;

/** The grid this frame SETS the consumer's terminal to, or `undefined` for a
 *  frame that sets nothing (a `delta`). */
export function frameGrid(
  frame: TerminalAttachFrame,
): EndpointGrid | undefined {
  return frame.kind === "delta" ? undefined : frame.grid;
}

/** Narrow a frame to {@link AttachSnapshotFrame}. */
export function isSnapshotFrame(
  frame: TerminalAttachFrame,
): frame is AttachSnapshotFrame {
  return frame.kind === "snapshot";
}

/** Narrow a frame to {@link AttachResizedFrame}. */
export function isResizedFrame(
  frame: TerminalAttachFrame,
): frame is AttachResizedFrame {
  return frame.kind === "resized";
}
