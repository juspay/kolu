/**
 * `LocalHost` — the default Host implementation. Wraps the existing
 * `spawnPty` (which uses `node-pty` directly) so the rest of the server
 * can treat local and remote terminals uniformly. No new process,
 * no SSH, no marshaling — this is the same code path Kolu has always
 * used, dressed in the `Host` interface.
 */

import type { Logger } from "../log.ts";
import { spawnPty } from "../pty.ts";
import type { Host, SpawnPtyOpts } from "./types.ts";

/** Sentinel id used when `TerminalCreateInput.hostId` is undefined and on
 *  saved terminals that pre-date the field. Matches the `Location`
 *  discriminator in persisted sessions. */
export const LOCAL_HOST_ID = "local";

export function createLocalHost(): Host {
  return {
    id: LOCAL_HOST_ID,
    label: "Local",
    kind: "local",
    spawnPty: async (tlog: Logger, opts: SpawnPtyOpts) =>
      spawnPty(
        tlog,
        opts.terminalId,
        {
          onData: opts.onData,
          onExit: opts.onExit,
          onCwd: opts.onCwd,
          onTitleChange: opts.onTitleChange,
          onCommandRun: opts.onCommandRun,
        },
        opts.cwd,
      ),
    shutdown: async () => {
      // Local host has no long-lived connection to tear down.
    },
  };
}
