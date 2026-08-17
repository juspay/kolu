/**
 * The scroll-lock FIFO the prepare step creates (`kolu-scroll-fifo-*` + a
 * blocking `cat` reader). Teardown must always kill the reader and remove the
 * dir — including when the fire step never ran (juspay/kolu#2178). `rm` of
 * the FIFO alone leaves `cat` blocked on the unlinked inode forever.
 */

import { execFileSync } from "node:child_process";
import { rm } from "node:fs/promises";
import { dirname } from "node:path";

export const SCROLL_FIFO_DIR_PREFIX = "kolu-scroll-fifo-";

/** SIGKILL every `cat` whose command line names this FIFO path. */
export function killScrollFifoReaders(fifoPath: string): number[] {
  const killed: number[] = [];
  let out: string;
  try {
    out = execFileSync(
      "ps",
      process.platform === "darwin"
        ? ["-Ao", "pid=,command="]
        : ["-eo", "pid=,args="],
      { encoding: "utf8" },
    );
  } catch {
    return killed;
  }
  for (const line of out.split("\n")) {
    if (!line.includes(fifoPath)) continue;
    if (!/\bcat\b/.test(line)) continue;
    const pid = Number.parseInt(line.trim(), 10);
    if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) continue;
    try {
      process.kill(pid, "SIGKILL");
      killed.push(pid);
    } catch {
      // Already gone.
    }
  }
  return killed;
}

/** Kill leftover `cat` readers and remove the FIFO's private directory. */
export async function retireScrollFifo(
  fifoPath: string | undefined,
): Promise<{ killed: number[]; removedDir: string | undefined }> {
  if (fifoPath === undefined) return { killed: [], removedDir: undefined };
  const killed = killScrollFifoReaders(fifoPath);
  const dir = dirname(fifoPath);
  await rm(dir, { recursive: true, force: true });
  return { killed, removedDir: dir };
}
