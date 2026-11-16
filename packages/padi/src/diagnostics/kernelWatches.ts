/**
 * The file watches the KERNEL says padi holds — beside the watcher rows, which
 * cannot count a recursive `@parcel/watcher` subscription's directories.
 *
 * On Linux every inotify instance is an fd whose `/proc/self/fdinfo/<fd>` has
 * one `inotify wd:…` line per watch. A padi holding 300,000 watches has a file
 * of 300,000 lines, so it is read as a stream and counted as it goes, never
 * made one string. Read only when asked.
 *
 * Agent transcript watchers have no row of their own; their watches are in
 * this count.
 */

import fs from "node:fs";
import type { PadiDiagnostics } from "@kolu/padi-client/surface";
import { measured, unmeasured } from "kolu-io";

const MARKER = Buffer.from("\ninotify ");

/** Count `inotify ` lines in one fdinfo file, chunk by chunk. */
async function countWatches(file: string): Promise<number> {
  let count = 0;
  // A leading newline lets the first line match the same marker; the carry
  // keeps a marker split across two chunks.
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
    } catch {
      // The fd closed between the listing and the read — it holds nothing now.
      continue;
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
