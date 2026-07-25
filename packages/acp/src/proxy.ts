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

import { chmodSync, lstatSync, mkdirSync, rmSync } from "node:fs";
import { type Server, type Socket, connect, createServer } from "node:net";
import { dirname } from "node:path";
import { Readable, Writable } from "node:stream";
import {
  type Agent,
  AgentSideConnection,
  type AgentCapabilities,
  type CancelNotification,
  type InitializeResponse,
  type NewSessionRequest,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptRequest,
  type PromptResponse,
  RequestError,
  type SessionNotification,
} from "@zed-industries/agent-client-protocol";
import { AdapterSession } from "./adapter.ts";
import { parseArgv } from "./argv.ts";
import { describeError } from "./errors.ts";
import { SESSION_CWD_META } from "./connect.ts";
import { socketPathFor } from "./socketPath.ts";
import { type ProxyEvent, TranscriptRenderer } from "./render.ts";

type SessionUpdate = SessionNotification["update"];

/**
 * Claim the socket path. A proxy that crashed leaves its socket file behind
 * and its tile keeps the same id, so a stale file is the ordinary case — but
 * only a file nobody answers on is stale, and one that still accepts a
 * connection belongs to a live proxy we must not evict.
 */
async function claimSocketPath(socketPath: string): Promise<void> {
  const dir = dirname(socketPath);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  // `mkdirSync`'s mode is a no-op on a directory that already exists, and the
  // off-systemd path (`/tmp/kolu-$UID`) is one any local user can pre-create.
  // So verify rather than assume: the directory the socket lives in IS the
  // access control for everything the session can do. `lstat`, not `stat`, so a
  // symlink is judged as itself instead of followed to a target whose `/tmp`
  // component someone else still owns. (The same boundary
  // `@kolu/surface/unix-socket` enforces; this package re-derives it rather
  // than importing the framework — see `socketPath.ts`.)
  const uid = process.getuid?.();
  if (uid !== undefined) {
    const stat = lstatSync(dir);
    if (!stat.isDirectory() || stat.uid !== uid || (stat.mode & 0o077) !== 0) {
      throw new Error(
        `${dir} is not a private directory owned by this user; refusing to serve a session from it`,
      );
    }
  }
  const failure = await new Promise<NodeJS.ErrnoException | null>((resolve) => {
    const probe = connect(socketPath)
      .on("connect", () => {
        probe.destroy();
        resolve(null);
      })
      .on("error", (error) => resolve(error as NodeJS.ErrnoException));
  });
  if (failure === null) {
    throw new Error(`another proxy is already listening on ${socketPath}`);
  }
  // Only "nobody is there" licenses deleting the file. Any other error — a
  // permission problem, a path that is not a socket — means we do not actually
  // know what is at that path, and removing it blind is how a live thing gets
  // evicted by a proxy that never established it was dead.
  if (failure.code !== "ECONNREFUSED" && failure.code !== "ENOENT") {
    throw new Error(
      `cannot determine whether ${socketPath} is in use: ${String(failure)}`,
    );
  }
  // Unlink only a dead socket. Anything else at that path is something we did
  // not put there and do not understand, and deleting it would make this proxy
  // a file-removal tool pointed at a path someone else chose.
  if (failure.code === "ECONNREFUSED" && !lstatSync(socketPath).isSocket()) {
    throw new Error(
      `${socketPath} exists and is not a socket; refusing to remove it`,
    );
  }
  rmSync(socketPath, { force: true });
}

async function main(): Promise<void> {
  const { id, command, args } = parseArgv(process.argv.slice(2));
  const socketPath = socketPathFor(id);
  const cwd = process.cwd();

  const renderer = new TranscriptRenderer((text) => process.stdout.write(text));
  const emit = (event: ProxyEvent) => renderer.event(event);

  /** One session per proxy, and its id outlives every adapter process behind
   *  it — a respawn must not invalidate the id a client is already holding. */
  const sessionId = `acp-${id}`;
  const clients = new Set<AgentSideConnection>();

  let adapterRef: AdapterSession | null = null;
  const die = (error: unknown): never => {
    process.stderr.write(`acp-proxy: ${describeError(error)}\n`);
    // Take the adapter — and the process group it leads — down with us. A
    // proxy that exits alone leaves an orphaned agent holding the host.
    adapterRef?.stop();
    process.exit(1);
  };

  /** Fan a frame out to every attached client. A write that fails is reported,
   *  never dropped: a client whose socket broke mid-turn is a fact worth
   *  seeing, and the fan-out must not let one bad peer stop the others. */
  const broadcast = (update: SessionUpdate): void => {
    for (const client of clients) {
      client.sessionUpdate({ sessionId, update }).catch((error) => {
        process.stderr.write(
          `acp-proxy: could not reach a client: ${describeError(error)}\n`,
        );
      });
    }
  };

  const adapter = new AdapterSession({
    spec: { command, args, cwd },
    emit,
    onUpdate: broadcast,
    onFatal: die,
  });
  adapterRef = adapter;

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
      // Where this proxy's one session is rooted. `session/new` refuses any
      // other directory — rightly, since serving the wrong one silently is
      // worse — but a client cannot obey a rule it has no way to read, so the
      // fact is published rather than left to be guessed.
      _meta: { [SESSION_CWD_META]: cwd },
    };
  };

  const server: Server = createServer((socket: Socket) => {
    socket.on("error", (error) => {
      process.stderr.write(`acp-proxy: client socket: ${String(error)}\n`);
    });

    const agent: Agent = {
      initialize: async () => capabilities(),
      // The session is the proxy's, created against the proxy's own cwd when
      // it launched. A client asking for a different working directory or for
      // MCP servers is asking for a session this proxy cannot give it, so it
      // is told rather than handed a session that quietly ignores what it
      // asked for.
      newSession: async (params: NewSessionRequest) => {
        if (params.cwd !== cwd) {
          throw RequestError.invalidParams({
            reason: `this proxy serves one session, rooted at ${cwd}; it cannot open one at ${params.cwd}`,
          });
        }
        if (params.mcpServers.length > 0) {
          throw RequestError.invalidParams({
            reason:
              "this proxy does not attach MCP servers; configure them on the adapter instead",
          });
        }
        return { sessionId };
      },
      authenticate: async () => {},
      prompt: async (params: PromptRequest): Promise<PromptResponse> => {
        requireSession(params.sessionId);
        const text = params.prompt
          .map((block) =>
            block.type === "text" ? block.text : `<${block.type}>`,
          )
          .join(" ");
        emit({ kind: "prompt", text });
        // Every attached client sees the question, not just the answer. A
        // second `acp-chat` watching alongside the one driving would otherwise
        // render replies to prompts it never saw — and watching is a use the
        // multi-client fan-out exists for.
        for (const block of params.prompt) {
          broadcast({ sessionUpdate: "user_message_chunk", content: block });
        }
        try {
          const response = await adapter.prompt(params.prompt);
          emit({ kind: "turnEnded", stopReason: response.stopReason });
          return response;
        } catch (error) {
          emit({ kind: "turnFailed", message: describeError(error) });
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
