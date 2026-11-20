import type { WorkFilesListed } from "kolu-common/workFiles";
import type { KeptFile, WorkId } from "kolu-work";

export const workDirOf = (id: WorkId): string => {
  const fnv = (seed: number): string => {
    let hash = seed;
    for (let at = 0; at < id.length; at += 1) {
      hash ^= id.charCodeAt(at);
      hash = Math.imul(hash, 0x01000193) >>> 0;
    }
    return hash.toString(16).padStart(8, "0");
  };
  return `${fnv(0x811c9dc5)}${fnv(0x7fffffff)}`;
};

export interface WorkFilesKept {
  readonly kept: ReadonlyArray<KeptFile>;
  readonly tooBig: ReadonlyArray<string>;
}

export interface WorkFiles {
  list(at: { host: string; worktree: string }): Promise<WorkFilesListed>;
  keep(at: {
    host: string;
    worktree: string;
    work: string;
    paths: ReadonlyArray<string>;
  }): Promise<WorkFilesKept>;
  sweep(keep: ReadonlyArray<string>): Promise<void>;
}
