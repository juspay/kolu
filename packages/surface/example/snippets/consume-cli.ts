/**
 * Consuming the example surface outside SolidJS — the blocks the
 * "How to consume a surface outside SolidJS" page embeds. A CLI/TUI has no
 * reactive runtime, so it reads the surface directly off the typed client:
 * one transport-blind connection, awaited procedure calls, iterated streams,
 * and a live board folded through `mirrorRemoteSurface`.
 *
 * Typechecked, never executed — the top-level awaits and loops exist only to
 * pin the real call shapes.
 */

import { unenrolledStreamCall } from "@kolu/surface/client";
import { firstFrameOrThrow } from "@kolu/surface/first-frame";
import { unixSocketLink } from "@kolu/surface/links/unix-socket";
import { mirrorRemoteSurface } from "@kolu/surface/mirror";
import type { ContractRouterClient } from "@orpc/contract";
import { type LogFrame, type Pid, type Proc, surface } from "./surface";

const socketPath = "/run/example/daemon.sock";
const nodeId = "node-1";
const pid = 4321;
const signal = new AbortController().signal;

// A plain (non-reactive) board the CLI folds frames into.
const board = {
  set: (_pid: Pid, _proc: Proc): void => {},
  delete: (_pid: Pid): void => {},
  appendLog: (_frame: LogFrame): void => {},
};
const render = (_frame: LogFrame): void => {};
const resetView = (): void => {};

// #region connection
type Connection = {
  client: ContractRouterClient<typeof surface.contract>;
  dispose: () => void;
};

// local: dial the daemon's unix socket
const { client, dispose } = await unixSocketLink<typeof surface.contract>({
  socketPath,
});
// #endregion connection

// #region calls
await client.surface.proc.kill({ pid });
const keys = await firstFrameOrThrow(
  await client.surface.processes.keys({}),
  "processes keys yielded no snapshot frame — link failure",
);
// #endregion calls

// #region iterate
for await (const frame of await client.surface.nodeLog.get({ nodeId })) {
  process.stdout.write(frame.text);
}
// #endregion iterate

// #region unenrolled
const frames = await unenrolledStreamCall(
  client.surface.nodeLog.get,
  { nodeId },
  { signal, onRetry: () => resetView() },
);
for await (const frame of frames) render(frame);
// #endregion unenrolled

// #region mirror
const { procedures, done } = mirrorRemoteSurface(
  surface,
  client,
  {
    collections: {
      processes: {
        upsert: (pid, proc) => board.set(pid, proc),
        remove: (pid) => board.delete(pid),
      },
    },
    streams: { nodeLog: { input: nodeId, onFrame: (f) => board.appendLog(f) } },
  },
  { signal },
);

await procedures.proc.kill({ pid }); // same typed procedures, mirrored
await done;
// #endregion mirror

export type { Connection };
export { dispose, done, keys, procedures };
