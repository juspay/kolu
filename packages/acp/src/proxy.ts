/**
 * `acp-proxy` — run an ACP agent in a tile.
 *
 * Spawns an ACP adapter over stdio, re-serves the same ACP protocol on a unix
 * socket, and renders every frame that crosses either face to its own stdout.
 * The tile therefore *shows* the session without being the thing you type
 * into: all input arrives as ACP calls on the socket.
 *
 *     acp-proxy --id <id> -- <adapter-command> [args...]
 *
 * The adapter is argv, so nothing here is specific to any vendor's agent.
 *
 * stdout is the transcript and nothing else. Diagnostics go to stderr.
 */

import { chmodSync, mkdirSync, rmSync } from "node:fs";
import { type Server, type Socket, connect, createServer } from "node:net";
import { dirname } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  type Agent,
  AgentSideConnection,
  type AgentCapabilities,
  type CancelNotification,
  type InitializeResponse,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptRequest,
  type PromptResponse,
  RequestError,
} from "@zed-industries/agent-client-protocol";
import { AdapterSession } from "./adapter.ts";
import { socketPathFor } from "./socketPath.ts";
import { type ProxyEvent, TranscriptRenderer } from "./render.ts";

const USAGE = "usage: acp-proxy --id <id> -- <adapter-command> [args...]";

interface Argv {
  id: string;
  command: string;
  args: string[];
}

/** `--id <id> -- <command> [args...]`. Everything after `--` is the adapter,
 *  verbatim; nothing before it is optional. */
export function parseArgv(argv: string[]): Argv {
  const separator = argv.indexOf("--");
  if (separator === -1) {
    throw new Error(`the adapter command must follow \`--\`\n${USAGE}`);
  }
  const flags = argv.slice(0, separator);
  const [command, ...args] = argv.slice(separator + 1);
  if (!command) {
    throw new Error(`no adapter command after \`--\`\n${USAGE}`);
  }
  if (flags[0] !== "--id" || !flags[1] || flags.length !== 2) {
    throw new Error(`--id <id> is required\n${USAGE}`);
  }
  return { id: flags[1], command, args };
}

/**
 * Claim the socket path. A proxy that crashed leaves its socket file behind
 * and its tile keeps the same id, so a stale file is the ordinary case — but
 * only a file nobody answers on is stale, and one that still accepts a
 * connection belongs to a live proxy we must not evict.
 */
async function claimSocketPath(socketPath: string): Promise<void> {
  mkdirSync(dirname(socketPath), { recursive: true, mode: 0o700 });
  const live = await new Promise<boolean>((resolve) => {
    const probe = connect(socketPath)
      .on("connect", () => {
        probe.destroy();
        resolve(true);
      })
      .on("error", () => resolve(false));
  });
  if (live) {
    throw new Error(`another proxy is already listening on ${socketPath}`);
  }
  rmSync(socketPath, { force: true });
}

async function main(): Promise<void> {
  const { id, command, args } = parseArgv(process.argv.slice(2));
  const socketPath = socketPathFor(id);

  const renderer = new TranscriptRenderer((text) => process.stdout.write(text));
  const emit = (event: ProxyEvent) => renderer.event(event);

  /** One session per proxy, and its id outlives every adapter process behind
   *  it — a respawn must not invalidate the id a client is already holding. */
  const sessionId = `acp-${id}`;
  const clients = new Set<AgentSideConnection>();

  const die = (error: unknown): never => {
    process.stderr.write(`acp-proxy: ${String(error)}\n`);
    process.exit(1);
  };

  const adapter = new AdapterSession({
    spec: { command, args, cwd: process.cwd() },
    emit,
    onUpdate: (update) => {
      for (const client of clients) {
        void client.sessionUpdate({ sessionId, update });
      }
    },
    onFatal: die,
  });

  await adapter.start().catch(die);
  emit({ kind: "sessionReady", sessionId });

  const requireSession = (given: string): void => {
    if (given === sessionId) return;
    throw RequestError.invalidParams({
      reason: `unknown session ${given}; this proxy serves ${sessionId}`,
    });
  };

  /** What this proxy can do, which is the adapter's capabilities minus the
   *  ones the proxy does not forward. `loadSession` is the adapter's to offer
   *  and not yet the proxy's to serve, so it is advertised off rather than
   *  advertised and then refused. */
  const capabilities = (): InitializeResponse => {
    const agentCapabilities: AgentCapabilities = {
      ...adapter.agentCapabilities,
      loadSession: false,
    };
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentCapabilities,
      // The adapter inherits the host's own login; there is no second
      // authentication step at this hop, and offering one would be a lie.
      authMethods: [],
    };
  };

  const server: Server = createServer((socket: Socket) => {
    socket.on("error", (error) => {
      process.stderr.write(`acp-proxy: client socket: ${String(error)}\n`);
    });

    const agent: Agent = {
      initialize: async () => capabilities(),
      newSession: async () => ({ sessionId }),
      authenticate: async () => {},
      prompt: async (params: PromptRequest): Promise<PromptResponse> => {
        requireSession(params.sessionId);
        const text = params.prompt
          .map((block) =>
            block.type === "text" ? block.text : `<${block.type}>`,
          )
          .join(" ");
        emit({ kind: "prompt", text });
        try {
          const response = await adapter.prompt(params.prompt);
          emit({ kind: "turnEnded", stopReason: response.stopReason });
          return response;
        } catch (error) {
          emit({ kind: "turnFailed", message: String(error) });
          throw error;
        }
      },
      cancel: async (params: CancelNotification) => {
        requireSession(params.sessionId);
        adapter.cancel();
      },
    };

    const connection = new AgentSideConnection(
      () => agent,
      ndJsonStream(Writable.toWeb(socket), Readable.toWeb(socket)),
    );
    clients.add(connection);
    emit({ kind: "clientConnected", clients: clients.size });
    socket.once("close", () => {
      clients.delete(connection);
      emit({ kind: "clientDisconnected", clients: clients.size });
    });
  });

  await claimSocketPath(socketPath).catch(die);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(socketPath, resolve);
  }).catch(die);
  chmodSync(socketPath, 0o600);
  emit({ kind: "listening", socketPath });

  const shutdown = () => {
    adapter.stop();
    server.close();
    rmSync(socketPath, { force: true });
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

await main();
