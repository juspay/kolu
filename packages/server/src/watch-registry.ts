import { log } from "./log.ts";

interface WatchEntry {
  label: string;
  target: string;
}

const watches = new Map<number, WatchEntry>();
let nextId = 0;

export function registerWatch(label: string, target: string): () => void {
  const id = nextId++;
  watches.set(id, { label, target });
  log.debug({ label, target, total: watches.size }, "watch registered");
  return () => {
    if (watches.delete(id)) {
      log.debug({ label, target, total: watches.size }, "watch unregistered");
    }
  };
}

export function getActiveWatches(): WatchEntry[] {
  return [...watches.values()];
}
