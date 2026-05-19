import type { HostSummary } from "kolu-common/contract";
import type { Logger } from "../log.ts";
import type { PtyCallbacks, PtyHandle } from "../pty.ts";

export interface Host {
  readonly summary?: HostSummary;
  spawnPty(
    tlog: Logger,
    terminalId: string,
    opts: PtyCallbacks,
    cwd?: string,
  ): Promise<PtyHandle>;
  shutdown(): void;
}
