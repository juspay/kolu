import fs from "node:fs";
import type { PadiDiagnostics } from "@kolu/padi-client/surface";
import { measured, unmeasured } from "kolu-io";

const MARKER = Buffer.from("\ninotify ");

async function countWatches(file: string): Promise<number> {
  let count = 0;
  let carry = Buffer.from("\n");
  for await (const chunk of fs.createReadStream(file)) {
    const buf = Buffer.concat([carry, chunk as Buffer]);
    for (let at = buf.indexOf(MARKER); at !== -1; ) {
      count++;
      at = buf.indexOf(MARKER, at + MARKER.length);
    }
    carry = buf.subarray(Math.max(0, buf.length - (MARKER.length - 1)));
  }
  return count;
}

export async function readKernelWatches(): Promise<
  PadiDiagnostics["kernelWatches"]
> {
  if (process.platform !== "linux") {
    return unmeasured(
      process.platform === "darwin"
        ? "macOS FSEvents has no per-directory watch to count"
        : `no kernel watch count on ${process.platform}`,
    );
  }
  const perInstance: { fd: number; watches: number }[] = [];
  for (const name of await fs.promises.readdir("/proc/self/fd")) {
    let target: string;
    try {
      target = await fs.promises.readlink(`/proc/self/fd/${name}`);
    } catch (err) {
      // The fd closed between the listing and the read — it holds nothing now.
      // Anything else is a real failure and surfaces.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    if (target !== "anon_inode:inotify") continue;
    let watches: number;
    try {
      watches = await countWatches(`/proc/self/fdinfo/${name}`);
    } catch (err) {
      // Closed while being read: likewise holds nothing now. Anything else
      // is a real failure and surfaces.
      if ((err as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw err;
    }
    perInstance.push({ fd: Number(name), watches });
  }
  perInstance.sort((a, b) => b.watches - a.watches);
  return measured({
    total: perInstance.reduce((n, i) => n + i.watches, 0),
    perInstance,
  });
}
