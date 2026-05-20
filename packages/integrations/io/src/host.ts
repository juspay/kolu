import type { PtyHandle, SpawnPtyOpts } from "kolu-pty";
import type { Logger } from "kolu-shared";
import type { Executor } from "./executor.ts";

export interface Host extends Executor {
  readonly id: string;
  readonly label: string;
  readonly kind: "local" | "remote-ssh";
  spawnPty(log: Logger, opts: SpawnPtyOpts): Promise<PtyHandle>;
  shutdown(): Promise<void>;
}
