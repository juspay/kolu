/**
 * `kolu agent --stdio` — runs LocalBackend behind oRPC over
 * stdin/stdout.
 *
 * Plan B's pivot: the agent is the same kolu binary running with a
 * different transport. Zero remote-specific business logic; the
 * agent serves `agentContract` (narrow subset, see
 * `kolu-common/agentContract.ts`) and `RemoteBackend` is the only
 * consumer.
 *
 * **Why narrow contract**: pre-implementation review finding E.
 * Serving the full `appRouter` would expose `terminal.create` and
 * `surface.*` to the agent's caller, creating recursion risk and
 * leaking client-facing primitives into a server-internal protocol.
 *
 * Prototype scope: file exists, demonstrates the wiring shape, but the
 * `@orpc/server/standard-peer` ServerPeer hookup is sketched. R-3 will
 * complete:
 *  1. `createServerPeerHandleRequestFn(agentRouter, options)` from
 *     `@orpc/server/standard-peer`.
 *  2. Wire `process.stdin` / `process.stdout` as a `ServerPeer`
 *     (`@orpc/standard-server-peer`).
 *  3. On stdin EOF, killAll local terminals + exit 0.
 */

import { implement } from "@orpc/server";
import { agentContract } from "kolu-common/agentContract";
import { localBackend } from "./backend/local.ts";
import { log } from "./log.ts";

/**
 * The agent's oRPC router — every method delegates to `localBackend`.
 * The kolu server's `RemoteBackend` calls these via the standard-peer
 * client; the data flow matches `LocalBackend` invocations one-to-one.
 *
 * The body sketches the shape; runtime correctness is R-3.
 */
function buildAgentRouter() {
  const t = implement(agentContract);
  return t.router({
    heartbeat: t.heartbeat.handler(async () => ({ ok: true as const })),

    terminal: {
      spawn: t.terminal.spawn.handler(async ({ input }) => {
        const handle = await localBackend.spawnPty({
          cwd: input.cwd,
          initialMetadata: input.initialMetadata,
        });
        return { id: handle.id };
      }),
      // The remaining terminal handlers (kill, write, resize, uploadFile,
      // channel*) follow the same shape: thin wrappers around localBackend
      // methods. Sketched stubs for prototype scope; the architectural
      // intent (the agent IS just LocalBackend wrapped in oRPC) is
      // visible in `spawn` above.
      kill: t.terminal.kill.handler(async ({ input }) =>
        localBackend.killTerminal(input.id),
      ),
      write: t.terminal.write.handler(async () => {
        // localBackend doesn't expose a write-by-id today; the handle's
        // write() is the path. R-3 will adjust LocalBackend to expose
        // terminal-id-keyed control methods.
      }),
      resize: t.terminal.resize.handler(async () => {
        // Same as write.
      }),
      uploadFile: t.terminal.uploadFile.handler(async ({ input }) => ({
        path: await localBackend.uploadFile(
          input.id,
          input.name,
          input.base64Data,
        ),
      })),
      // channel* handlers iterate localBackend.terminalChannel(id, kind)
      // and yield via async generators. Sketched here; the per-kind
      // explicitness keeps the agentContract typed.
      channelData: t.terminal.channelData.handler(async function* ({
        input,
        signal,
      }) {
        for await (const data of localBackend.terminalChannel(
          input.id,
          "data",
          signal,
        )) {
          yield data;
        }
      }),
      channelCwd: t.terminal.channelCwd.handler(async function* ({
        input,
        signal,
      }) {
        for await (const v of localBackend.terminalChannel(
          input.id,
          "cwd",
          signal,
        )) {
          yield v;
        }
      }),
      channelTitle: t.terminal.channelTitle.handler(async function* ({
        input,
        signal,
      }) {
        for await (const v of localBackend.terminalChannel(
          input.id,
          "title",
          signal,
        )) {
          yield v;
        }
      }),
      channelGit: t.terminal.channelGit.handler(async function* ({
        input,
        signal,
      }) {
        for await (const v of localBackend.terminalChannel(
          input.id,
          "git",
          signal,
        )) {
          yield v;
        }
      }),
      channelCommandRun: t.terminal.channelCommandRun.handler(async function* ({
        input,
        signal,
      }) {
        for await (const v of localBackend.terminalChannel(
          input.id,
          "commandRun",
          signal,
        )) {
          yield v;
        }
      }),
      channelAgent: t.terminal.channelAgent.handler(async function* ({
        input,
        signal,
      }) {
        for await (const v of localBackend.terminalChannel(
          input.id,
          "agent",
          signal,
        )) {
          yield v;
        }
      }),
      channelPr: t.terminal.channelPr.handler(async function* ({
        input,
        signal,
      }) {
        for await (const v of localBackend.terminalChannel(
          input.id,
          "pr",
          signal,
        )) {
          yield v;
        }
      }),
      channelForeground: t.terminal.channelForeground.handler(async function* ({
        input,
        signal,
      }) {
        for await (const v of localBackend.terminalChannel(
          input.id,
          "foreground",
          signal,
        )) {
          yield v;
        }
      }),
      channelConnectionState: t.terminal.channelConnectionState.handler(
        async function* ({ input, signal }) {
          for await (const v of localBackend.terminalChannel(
            input.id,
            "connectionState",
            signal,
          )) {
            yield v;
          }
        },
      ),
    },

    fs: {
      listAll: t.fs.listAll.handler(async ({ input }) => ({
        paths: await localBackend.fs.listAll(input.repoPath),
      })),
      readFile: t.fs.readFile.handler(async ({ input }) => {
        const result = await localBackend.fs.readFile(
          input.repoPath,
          input.filePath,
        );
        return { kind: "text" as const, ...result };
      }),
      subscribeRepoChange: t.fs.subscribeRepoChange.handler(async function* ({
        input,
        signal,
      }) {
        for await (const _ of localBackend.fs.subscribeRepoChange(
          input.repoPath,
          signal,
        )) {
          yield;
        }
      }),
      subscribeFileChange: t.fs.subscribeFileChange.handler(async function* ({
        input,
        signal,
      }) {
        for await (const _ of localBackend.fs.subscribeFileChange(
          input.repoPath,
          input.filePath,
          signal,
        )) {
          yield;
        }
      }),
    },

    git: {
      getDiff: t.git.getDiff.handler(async ({ input }) =>
        localBackend.git.getDiff(
          input.repoPath,
          input.filePath,
          input.mode,
          input.oldPath,
        ),
      ),
      getStatus: t.git.getStatus.handler(async ({ input }) =>
        localBackend.git.getStatus(input.repoPath, input.mode),
      ),
      subscribeRepoChange: t.git.subscribeRepoChange.handler(async function* ({
        input,
        signal,
      }) {
        for await (const _ of localBackend.git.subscribeRepoChange(
          input.repoPath,
          signal,
        )) {
          yield;
        }
      }),
    },
  });
}

/**
 * Entry point for `kolu agent --stdio`. The dispatcher in `index.ts`
 * calls this when the `--stdio` flag is set.
 *
 * R-3 wires `@orpc/server/standard-peer` to `process.stdin` /
 * `process.stdout` so the agent reads request envelopes from stdin and
 * writes responses to stdout. The router constructed above is the
 * handler. Sketched for the prototype.
 */
export async function runAgent(): Promise<void> {
  const router = buildAgentRouter();
  log.info(
    { procedures: Object.keys(router).length },
    "kolu agent: built router",
  );
  log.warn(
    "kolu agent --stdio: standard-peer transport wiring is R-3. " +
      "Router shape is in place. Agent exits immediately in prototype mode.",
  );
  // R-3:
  //   const handler = new StandardRPCHandler(router as unknown as Router, { plugins });
  //   const peerHandle = createServerPeerHandleRequestFn(handler, { context: {} });
  //   const peer = new ServerPeer({
  //     send: (msg) => process.stdout.write(JSON.stringify(msg) + "\n"),
  //     receive: <iterator from process.stdin lines>,
  //   });
  //   await peer.serve(peerHandle);
}
