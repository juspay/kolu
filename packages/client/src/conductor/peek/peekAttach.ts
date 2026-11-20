import { frameGrid, isResizedFrame } from "@kolu/padi-client/attach";
import type {
  EndpointGrid,
  TerminalAttachFrame,
} from "@kolu/padi-client/surface";
import type { TerminalId } from "kolu-common/surface";

/** What one attach stream is allowed to do to the peek's screen. */
export interface PeekScreen {
  resize(grid: EndpointGrid): void;
  write(data: string): void;
  reset(): void;
}

/** The attach input of a viewer that asks for nothing: the id, never a size. */
export function peekAttachInput(id: TerminalId): { id: TerminalId } {
  return { id };
}

/** Apply one attach frame in stream order — a stated grid first, then its bytes. */
export function applyPeekFrame(
  screen: PeekScreen,
  frame: TerminalAttachFrame,
): void {
  const grid = frameGrid(frame);
  if (grid) screen.resize(grid);
  if (isResizedFrame(frame)) return;
  screen.write(frame.data);
}
