import type { PtyHandle, SpawnPtyOpts } from "kolu-pty";
import type { Logger } from "kolu-shared";
import type { Executor } from "./executor.ts";

export interface Host extends Executor {
  readonly label: string;
  spawnPty(log: Logger, opts: SpawnPtyOpts): Promise<PtyHandle>;
  shutdown(): Promise<void>;
}
