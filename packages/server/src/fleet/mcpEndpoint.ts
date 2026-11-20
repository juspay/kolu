import {
  createHash,
  randomBytes,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  createServer,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from "node:http";
import type { AddressInfo } from "node:net";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  isInitializeRequest,
  LATEST_PROTOCOL_VERSION,
} from "@modelcontextprotocol/sdk/types.js";
import { serverVersion } from "../hostname.ts";

const MCP_PATH = "/mcp";

/** The header the streamable-HTTP transport mints on `initialize` and the
 *  client echoes on everything after it. It is this door's routing key. */
const SESSION_HEADER = "mcp-session-id";

const MAX_HANDSHAKE_BYTES = 64 * 1024;

export interface FleetMcpEndpoint {
  readonly url: string;
  readonly token: string;
  close(): Promise<void>;
}

export interface FleetMcpLog {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export interface FleetMcpEndpointOptions {
  serve: (transport: Transport) => Promise<{ close: () => Promise<void> }>;
  log: FleetMcpLog;
}

/** Constant-time bearer comparison over fixed-width digests. `timingSafeEqual`
 *  THROWS on unequal lengths, so a raw comparison would have to branch on
 *  length first and leak it; hashing both sides first makes every comparison
 *  32 bytes wide whatever was presented. */
function bearerMatches(presented: string, expected: string): boolean {
  const digest = (s: string): Buffer =>
    createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(presented), digest(expected));
}

/** The `Authorization` header's bearer value, or null when the header is
 *  absent or is not a bearer. Case-insensitive on the scheme, as RFC 7235
 *  requires. */
function bearerOf(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header === undefined) return null;
  const match = /^Bearer (.+)$/i.exec(header);
  return match?.[1] ?? null;
}

/** A refusal in the shape an MCP client can read. The SDK's own transport
 *  answers its refusals as JSON-RPC errors rather than bare status lines, and
 *  the ones this door answers before any transport exists have to look the
 *  same — a client that gets a naked `400` here reports a transport fault
 *  instead of the sentence that says what was wrong. */
function rpcError(
  res: ServerResponse,
  status: number,
  code: number,
  message: string,
): void {
  res
    .writeHead(status, { "content-type": "application/json" })
    .end(
      JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }),
    );
}

type HandshakeBody =
  | { readonly ok: true; readonly value: unknown }
  | {
      readonly ok: false;
      readonly status: number;
      readonly code: number;
      readonly message: string;
    };

async function handshakeBody(req: IncomingMessage): Promise<HandshakeBody> {
  const chunks: Buffer[] = [];
  let size = 0;
  try {
    for await (const chunk of req) {
      const piece = chunk as Buffer;
      size += piece.byteLength;
      if (size > MAX_HANDSHAKE_BYTES) {
        return {
          ok: false,
          status: 413,
          code: -32_000,
          message: `Payload Too Large: an initialize request may not exceed ${MAX_HANDSHAKE_BYTES} bytes`,
        };
      }
      chunks.push(piece);
    }
  } catch (cause) {
    return {
      ok: false,
      status: 400,
      code: -32_700,
      message: `Parse error: the request body ended early (${cause instanceof Error ? cause.message : String(cause)})`,
    };
  }
  try {
    return {
      ok: true,
      value: JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown,
    };
  } catch {
    return {
      ok: false,
      status: 400,
      code: -32_700,
      message: "Parse error: Invalid JSON",
    };
  }
}

function once(run: () => Promise<void>): () => Promise<void> {
  let started: Promise<void> | null = null;
  return () => (started ??= Promise.resolve().then(run));
}

interface LiveSession {
  readonly transport: StreamableHTTPServerTransport;
  served: { close: () => Promise<void> } | null;
  readonly forget: () => Promise<void>;
}

export async function startFleetMcpEndpoint(
  opts: FleetMcpEndpointOptions,
): Promise<FleetMcpEndpoint> {
  const token = randomBytes(32).toString("hex");

  const sessions = new Map<string, LiveSession>();

  const openSession = async (
    req: IncomingMessage,
    res: ServerResponse,
    handshake: unknown,
  ): Promise<void> => {
    const session: LiveSession = {
      transport: new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        // Registered from the transport's OWN callback, which fires INSIDE the
        // handshake it is answering. Registering after `handleRequest` settled
        // would be too late: a client sends `notifications/initialized` the
        // moment it reads the answer, and on an SSE answer `handleRequest`
        // does not settle until that stream ends.
        onsessioninitialized: (id) => {
          sessions.set(id, session);
        },
      }),
      served: null,
      forget: once(async () => {
        const id = session.transport.sessionId;
        if (id !== undefined) sessions.delete(id);
        try {
          await session.served?.close();
        } catch (err) {
          opts.log.error(
            { err, session: id },
            "fleet mcp: a session's face faulted while closing",
          );
        }
      }),
    };
    // BEFORE `serve`: `Protocol.connect` CHAINS onto whatever `onclose` is
    // already here, so this runs beside the server's own. Setting it after
    // would REPLACE the server's and the MCP server would never learn its
    // transport had gone.
    session.transport.onclose = () => {
      void session.forget();
    };
    session.served = await opts.serve(session.transport);
    await session.transport.handleRequest(req, res, handshake);
  };

  const faulted =
    (res: ServerResponse) =>
    (err: unknown): void => {
      opts.log.error({ err }, "fleet mcp: request handling faulted");
      if (!res.headersSent) {
        res
          .writeHead(500, { "content-type": "text/plain" })
          .end("internal error\n");
      } else {
        res.end();
      }
    };

  const bearerGate = (req: IncomingMessage, res: ServerResponse): boolean => {
    const presented = bearerOf(req);
    if (presented !== null && bearerMatches(presented, token)) return true;
    opts.log.warn(
      { method: req.method, hadBearer: presented !== null },
      "fleet mcp: refusing a request with no/wrong bearer token",
    );
    res
      .writeHead(401, {
        "content-type": "text/plain",
        "www-authenticate": "Bearer",
      })
      .end("unauthorized\n");
    return false;
  };

  const sessionRouter = (
    req: IncomingMessage,
    res: ServerResponse,
  ): boolean => {
    // A header sent TWICE arrives as an array, which is not an id this door
    // ever minted — it falls through to the handshake arm and is refused
    // there, rather than being guessed at.
    const named = req.headers[SESSION_HEADER];
    if (typeof named !== "string") return false;
    const session = sessions.get(named);
    if (session === undefined) {
      // `404` is the word the SDK's transport uses for a session it does not
      // hold, and an MCP client's rule on it is to initialize again — which
      // this door will now answer, instead of refusing forever.
      rpcError(res, 404, -32_001, "Session not found");
      return true;
    }
    void session.transport.handleRequest(req, res).catch(faulted(res));
    return true;
  };

  const serveHandshake = async (
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> => {
    const needsSession = (): void => {
      rpcError(
        res,
        400,
        -32_000,
        "Bad Request: Mcp-Session-Id header is required",
      );
    };
    if (req.method !== "POST") {
      needsSession();
      return;
    }
    const body = await handshakeBody(req);
    if (!body.ok) {
      rpcError(res, body.status, body.code, body.message);
      return;
    }
    if (!isInitializeRequest(body.value)) {
      needsSession();
      return;
    }
    await openSession(req, res, body.value);
  };

  const server: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (path !== MCP_PATH) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
        return;
      }
      if (!bearerGate(req, res)) return;
      if (sessionRouter(req, res)) return;
      void serveHandshake(req, res).catch(faulted(res));
    },
  );

  const bound = Promise.withResolvers<void>();
  server.once("error", bound.reject);
  server.listen(0, "127.0.0.1", () => bound.resolve());
  await bound.promise;
  server.removeListener("error", bound.reject);
  server.on("error", (err) =>
    opts.log.error({ err }, "fleet mcp: listener error"),
  );

  const address = server.address() as AddressInfo | null;
  if (address === null || typeof address === "string") {
    throw new Error(
      "fleet mcp: the loopback listener bound to something that is not a TCP address",
    );
  }
  const url = `http://127.0.0.1:${address.port}${MCP_PATH}`;
  opts.log.info({ url }, "fleet mcp listening");

  return {
    url,
    token,
    close: once(async () => {
      await Promise.all([...sessions.values()].map((one) => one.forget()));
      const done = Promise.withResolvers<void>();
      server.close(() => done.resolve());
      // Without this, an adapter that is still holding its GET stream keeps
      // the `close` callback pending forever.
      server.closeAllConnections();
      await done.promise;
    }),
  };
}

type DoorProof =
  | { readonly kind: "serves"; readonly sessionId: string }
  | { readonly kind: "noAnswer"; readonly cause: string }
  | { readonly kind: "refused"; readonly status: number }
  | { readonly kind: "notServing"; readonly what: string };

const whyNotServing = (url: string, proof: DoorProof): string | null => {
  switch (proof.kind) {
    case "serves":
      return null;
    case "noAnswer":
      return `This kolu's conductor cannot reach this kolu's fleet MCP face: nothing answered at ${url} (${proof.cause}). The agent would be handed the same URL, fail to connect, and carry on without the fleet's terminals — so the conversation is refused instead of opened with no hands.`;
    case "refused":
      return `This kolu's conductor was refused by this kolu's fleet MCP face: ${url} answered ${proof.status} to the token this process minted. The agent would be refused the same way and carry on without the fleet's terminals, so the conversation is refused instead.`;
    case "notServing":
      return `This kolu's conductor could not open a session on this kolu's fleet MCP face: ${url} is listening and accepted the token this process minted, but ${proof.what}. The agent's MCP client would be turned away the same way and the conversation would run with no hands, so it is refused instead.`;
  }
};

async function askFleetMcpDoor(
  at: { readonly url: string; readonly token: string },
  log: FleetMcpLog,
): Promise<DoorProof> {
  const authorization = `Bearer ${at.token}`;
  let answer: Response;
  try {
    answer = await fetch(at.url, {
      method: "POST",
      headers: {
        authorization,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: LATEST_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: {
            name: "kolu-conductor-probe",
            version: serverVersion,
          },
        },
      }),
    });
  } catch (cause) {
    return {
      kind: "noAnswer",
      cause: cause instanceof Error ? cause.message : String(cause),
    };
  }
  await answer.body?.cancel();
  if (answer.status === 401 || answer.status === 403) {
    return { kind: "refused", status: answer.status };
  }
  if (!answer.ok) {
    return {
      kind: "notServing",
      what: `it answered ${answer.status} to an \`initialize\``,
    };
  }
  const session = answer.headers.get(SESSION_HEADER);
  if (session === null) {
    return {
      kind: "notServing",
      what: "it answered the `initialize` without opening a session",
    };
  }
  try {
    await fetch(at.url, {
      method: "DELETE",
      headers: { authorization, [SESSION_HEADER]: session },
    }).then((ended) => ended.body?.cancel());
  } catch (cause) {
    log.warn(
      { err: cause, url: at.url, session },
      "conductor: could not close the session its fleet-MCP proof opened",
    );
  }
  return { kind: "serves", sessionId: session };
}

export async function proveFleetMcpEndpoint(
  at: { readonly url: string; readonly token: string },
  log: FleetMcpLog,
): Promise<string | null> {
  return whyNotServing(at.url, await askFleetMcpDoor(at, log));
}
