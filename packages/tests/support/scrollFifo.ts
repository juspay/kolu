/**
 * The scroll-lock FIFO the prepare step creates (`kolu-scroll-fifo-*` + a
 * blocking `cat` reader). Teardown must always kill the reader and remove the
 * dir — including when the fire step never ran (juspay/kolu#2178). `rm` of
 * the FIFO alone leaves `cat` blocked on the unlinked inode forever.
 */

import { rm } from "node:fs/promises";
import { dirname } from "node:path";
import {
  killScrollFifoReaders,
  SCROLL_FIFO_DIR_PREFIX,
} from "@kolu/daemon-test-gate/ciReap";

export { SCROLL_FIFO_DIR_PREFIX };

/** Kill leftover `cat` readers and remove the FIFO's private directory. */
export async function retireScrollFifo(
  fifoPath: string,
): Promise<{ killed: number[]; removedDir: string }> {
  const killed = killScrollFifoReaders(fifoPath);
  const dir = dirname(fifoPath);
  await rm(dir, { recursive: true, force: true });
  return { killed, removedDir: dir };
}

/** Extract, clear, and retire a world's FIFO. Both the fire/After paths use this. */
export async function retireWorldScrollFifo(world: {
  _scrollFifo?: string;
}): Promise<void> {
  const fifo = world._scrollFifo;
  world._scrollFifo = undefined;
  if (fifo === undefined) return;
  await retireScrollFifo(fifo);
}
