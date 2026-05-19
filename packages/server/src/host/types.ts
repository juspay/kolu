import type { HostSummary } from "kolu-common/contract";
import type { Logger } from "../log.ts";
import type { PtyCallbacks, PtyHandle } from "../pty.ts";

/** Terminal execution host. Local and SSH hosts both expose the same PTY-only
 *  lifecycle; host-local git/filesystem/agent IO is intentionally outside this
 *  boundary until there is a separate executor design. */
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
