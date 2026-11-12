/**
 * The fleet MCP door — a dedicated loopback HTTP listener whose ONLY route is
 * `/mcp`, serving kolu's fleet-wide MCP face to the ACP adapters this process
 * spawns.
 *
 * WHY ITS OWN DOOR, and not a route on the app listener. The app listener is
 * the BROWSER's: it is TLS-able, it binds wherever the operator asked
 * (`kolu web --bind`), and its one gate is an Origin check — the CSWSH defense
 * that exists because a page in the operator's own browser can reach any
 * address that browser can reach. Every assumption there is a browser
 * assumption. The MCP client here is not a browser: it is a child process on
 * this machine that sends no Origin at all. Hanging it off the app listener
 * would mean the browser's origin gate is the thing standing between two local
 * processes — a gate that passes exactly because the caller is NOT a browser,
 * which is no gate. It would also put the fleet's whole tool surface on
 * whatever interface `--bind` named, so `--bind 0.0.0.0` (a documented way to
 * reach kolu from a phone) would publish it to the LAN. A different client with
 * a different threat model gets a different door with its own gate, bound to
 * `127.0.0.1` and nothing else.
 *
 * THE GATE IS A BEARER TOKEN, minted per process and required on every request.
 * Loopback alone is not a gate: every other process on this box — every agent
 * in every terminal kolu itself runs — can open a socket to `127.0.0.1`, and
 * this endpoint drives every terminal on every host. The token is 32 random
 * bytes, compared in constant time (over SHA-256 digests, so the comparison is
 * fixed-width and a wrong-LENGTH guess leaks no more than a wrong-value one),
 * and it never leaves this process except in the session's `mcpServers[0].headers`.
 *
 * STATEFUL transport (`sessionIdGenerator`), deliberately: the fleet face's
 * `resources/updated` notifications — a host arriving, a terminal appearing —
 * ride the standalone GET SSE stream, which only exists for a session the
 * server can name. Stateless mode would silently drop every one of them.
 *
 * ONE TRANSPORT AND ONE FACE PER SESSION, which is what being stateful costs.
 * A stateful transport answers exactly one `initialize` and refuses every
 * later one with `400 Invalid Request: Server already initialized`. So a door
 * that minted a single transport at boot would serve the FIRST MCP client it
 * ever saw and nobody else: an adapter that crashes and respawns — the very
 * case the conductor's corpse arm exists for — opens a fresh client, is
 * refused, and the replacement conversation runs with no hands for the life of
 * kolu-server. This door therefore routes on `Mcp-Session-Id`: a request
 * carrying one is handed to that session's transport, and a request carrying
 * none may only be an `initialize`, which mints a new transport, a new face
 * behind it, and a new session id. Each face gets its own watch registry for
 * free, which is what `serveKoluFleetMcp` already argues for — two clients are
 * two fleets, and a shared registry would let one close the other's watch by
 * name.
 *
 * AND THE PROOF OF ALL THAT ({@link proveFleetMcpEndpoint}) is here too, for
 * the reason the rest is: it is one `initialize` against this door, routed by
 * the same session header and ended by the same `DELETE`. Those spellings are
 * the MCP SDK's, and they move when it moves — so this file is the whole of
 * what kolu-server has to re-read on a protocol bump, rather than one half of
 * it sitting in a module whose other business is ACP.
 */

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

/** The one path this listener answers. Anything else is a 404 — there is no
 *  index, no health route and no second verb, because the only client is an
 *  MCP adapter that was handed this exact URL. */
const MCP_PATH = "/mcp";

/** The header the streamable-HTTP transport mints on `initialize` and the
 *  client echoes on everything after it. It is this door's routing key. */
const SESSION_HEADER = "mcp-session-id";

/** The widest body this door will read ITSELF.
 *
 *  Every other request's body is read by the session's own transport, under
 *  the SDK's own bound. The one body read here is the handshake — because the
 *  door has to see `initialize` to know a session is being opened at all — and
 *  a handshake is a protocol version, a capabilities object and a client name.
 *  64 KiB is two orders of magnitude of headroom over that, and the bound is
 *  what stops an authenticated caller from making this process hold an
 *  unbounded buffer before any session exists to account for it. */
const MAX_HANDSHAKE_BYTES = 64 * 1024;

/** Where the fleet face is listening and the credential to reach it — exactly
 *  what the conductor puts on its session's one `http` MCP server. */
export interface FleetMcpEndpoint {
  /** `http://127.0.0.1:<ephemeral>/mcp`. */
  readonly url: string;
  /** The per-process bearer token, as `Authorization: Bearer <token>`. */
  readonly token: string;
  /** Stop serving: close every live session's MCP server (and with it its
   *  transport), then the listener and every socket still on it. Idempotent. */
  close(): Promise<void>;
}

/** The narration this module needs — kolu's three levels, structurally, so a
 *  caller may hand it a pino logger and a test may hand it three no-ops. Named
 *  rather than spelled twice, now that the proof below narrates too. */
export interface FleetMcpLog {
  info(o: unknown, m?: string): void;
  warn(o: unknown, m?: string): void;
  error(o: unknown, m?: string): void;
}

export interface FleetMcpEndpointOptions {
  /** Build + connect an MCP server over a transport this door owns. Called
   *  ONCE PER SESSION — see the module header: a stateful transport serves one
   *  client, so a second client is a second face. The door knows nothing about
   *  kolu's fleet — the composition root passes `serveKoluFleetMcp` bound to
   *  its `FleetHosts`, and this module stays a door. */
  serve: (transport: Transport) => Promise<{ close: () => Promise<void> }>;
  /** Narration sink. A refused request is logged at WARN: on a single-user
   *  machine it means something other than this process's own adapter is
   *  knocking, which is worth a line. */
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

/** The handshake body, read by the door because only the door can see whether
 *  a session is being opened. Every outcome is a JSON-RPC refusal rather than
 *  a throw: these are the client's mistakes, not this process's. */
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

/** One client's MCP session: the transport it talks to and the face served
 *  over that transport. The two die together — a transport whose server is
 *  gone answers every request with silence, and a face whose transport is gone
 *  holds fleet subscriptions for a reader that will never come back. */
interface LiveSession {
  readonly transport: StreamableHTTPServerTransport;
  /** The served face, from the instant `serve` resolves — which is before the
   *  transport is handed its first request, so every session the map can name
   *  has one. */
  served: { close: () => Promise<void> } | null;
  /** The ONE teardown, from the instant it begins — `null` until then. It is
   *  both the re-entry guard and what a later `close()` awaits: closing the
   *  face closes the transport, whose `onclose` lands straight back in
   *  `forget`, and a teardown that is already a promise makes that re-entry a
   *  no-op instead of a recursion. */
  teardown: Promise<void> | null;
}

/** Start the fleet MCP door. Resolves once the listener is bound — so a caller
 *  that has this value can hand the URL out knowing a request to it will be
 *  answered.
 *
 *  A listen failure REJECTS rather than degrading: a conductor with no
 *  hands is not a degraded conductor, and the boot that called this decides
 *  what to do with the sentence. */
export async function startFleetMcpEndpoint(
  opts: FleetMcpEndpointOptions,
): Promise<FleetMcpEndpoint> {
  const token = randomBytes(32).toString("hex");

  /** Live sessions by the id their transport minted. Registered from the
   *  transport's own `onsessioninitialized`, dropped on its `onclose`. */
  const sessions = new Map<string, LiveSession>();

  const forget = (session: LiveSession): Promise<void> => {
    if (session.teardown !== null) return session.teardown;
    const id = session.transport.sessionId;
    if (id !== undefined) sessions.delete(id);
    // DEFERRED BY A MICROTASK so the assignment below lands FIRST: closing the
    // face closes the transport synchronously, whose `onclose` re-enters here
    // before any `await` would have yielded, and the field it reads has to be
    // set by then or the re-entry recurses.
    session.teardown = Promise.resolve().then(async () => {
      try {
        await session.served?.close();
      } catch (err) {
        // A face that will not shut down must not take the door's teardown —
        // or the process's — down with it; this line is the whole of the lead.
        opts.log.error(
          { err, session: id },
          "fleet mcp: a session's face faulted while closing",
        );
      }
    });
    return session.teardown;
  };

  /** The first request of a conversation: mint a transport, serve a face over
   *  it, and let the transport answer the handshake that brought us here. */
  const openSession = async (
    req: IncomingMessage,
    res: ServerResponse,
    handshake: unknown,
  ): Promise<void> => {
    const session: LiveSession = {
      transport: new StreamableHTTPServerTransport({
        // STATEFUL — see the module doc: the `updated` notifications ride the
        // standalone GET SSE stream, which needs a named session.
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
      teardown: null,
    };
    // BEFORE `serve`: `Protocol.connect` CHAINS onto whatever `onclose` is
    // already here, so this runs beside the server's own. Setting it after
    // would REPLACE the server's and the MCP server would never learn its
    // transport had gone.
    session.transport.onclose = () => {
      void forget(session);
    };
    session.served = await opts.serve(session.transport);
    await session.transport.handleRequest(req, res, handshake);
  };

  /** A fault in the transport is this process's defect, not the caller's, and
   *  it must not reach the process-wide `unhandledRejection` boundary and take
   *  kolu down over one request. */
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

  const server: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      // `req.url` is a path, never absolute, on a plain HTTP server; the base
      // is a parse convenience and names nothing real.
      const path = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
      if (path !== MCP_PATH) {
        res.writeHead(404, { "content-type": "text/plain" }).end("not found\n");
        return;
      }
      const presented = bearerOf(req);
      if (presented === null || !bearerMatches(presented, token)) {
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
        return;
      }

      // A named session owns the request. A header sent TWICE arrives as an
      // array, which is not an id this door ever minted — it falls through to
      // the handshake arm and is refused there, rather than being guessed at.
      const named = req.headers[SESSION_HEADER];
      if (typeof named === "string") {
        const session = sessions.get(named);
        if (session === undefined) {
          // `404` is the word the SDK's transport uses for a session it does
          // not hold, and an MCP client's rule on it is to initialize again —
          // which this door will now answer, instead of refusing forever.
          rpcError(res, 404, -32_001, "Session not found");
          return;
        }
        // The transport reads the body itself here (no pre-parse): only the
        // handshake is this door's to read.
        void session.transport.handleRequest(req, res).catch(faulted(res));
        return;
      }

      // No session named, so the only thing this may be is the handshake that
      // opens one.
      if (req.method !== "POST") {
        rpcError(
          res,
          400,
          -32_000,
          "Bad Request: Mcp-Session-Id header is required",
        );
        return;
      }
      void (async () => {
        const body = await handshakeBody(req);
        if (!body.ok) {
          rpcError(res, body.status, body.code, body.message);
          return;
        }
        if (!isInitializeRequest(body.value)) {
          rpcError(
            res,
            400,
            -32_000,
            "Bad Request: Mcp-Session-Id header is required",
          );
          return;
        }
        await openSession(req, res, body.value);
      })().catch(faulted(res));
    },
  );

  const bound = Promise.withResolvers<void>();
  server.once("error", bound.reject);
  // Port 0 — the kernel picks. NOTHING else may name this port, so there is no
  // configured one to collide with and nothing to put in a flag.
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

  let closed: Promise<void> | null = null;
  return {
    url,
    token,
    close: () => {
      // Idempotent by memoizing the first teardown: a second caller awaits the
      // same close rather than closing a closed server (which errors).
      closed ??= (async () => {
        // Every live session first — each owns an MCP server, and closing that
        // is what ends the SSE streams still holding sockets open.
        await Promise.all([...sessions.values()].map((one) => forget(one)));
        const done = Promise.withResolvers<void>();
        server.close(() => done.resolve());
        // Without this, an adapter that is still holding its GET stream keeps
        // the `close` callback pending forever.
        server.closeAllConnections();
        await done.promise;
      })();
      return closed;
    },
  };
}

/** The sentence a kolu whose own fleet endpoint will not answer says. It names
 *  the URL, because the person who can see this is holding a server whose
 *  listener and whose conductor disagree, and the URL is the whole of the
 *  lead. */
const noAnswerAt = (url: string, cause: string): string =>
  `This kolu's conductor cannot reach this kolu's fleet MCP face: nothing answered at ${url} (${cause}). The agent would be handed the same URL, fail to connect, and carry on without the fleet's terminals — so the conversation is refused instead of opened with no hands.`;

/** The sentence a kolu whose own endpoint REFUSED the token says. Separate
 *  from "nothing answered" because it is a different defect with a different
 *  lead: something IS listening there and it does not accept the credential
 *  this process minted, which can only mean the two halves of this boot
 *  disagree about who they are. */
const refusedAt = (url: string, status: number): string =>
  `This kolu's conductor was refused by this kolu's fleet MCP face: ${url} answered ${status} to the token this process minted. The agent would be refused the same way and carry on without the fleet's terminals, so the conversation is refused instead.`;

/** The sentence a kolu whose own endpoint is listening and will not SERVE
 *  says. A third defect with a third lead: the door is open, the gate let us
 *  through, and no session came back — a face that is wedged, or a door whose
 *  one session has already been given away. */
const notServingAt = (url: string, what: string): string =>
  `This kolu's conductor could not open a session on this kolu's fleet MCP face: ${url} is listening and accepted the token this process minted, but ${what}. The agent's MCP client would be turned away the same way and the conversation would run with no hands, so it is refused instead.`;

/** Will this door SERVE THIS CALLER? `null` when it will, the whole sentence
 *  when it will not.
 *
 *  REPORTED, NOT RAISED — the shape `FleetHosts` already uses for a host that
 *  is not connected: this module answers what it saw and the conductor is
 *  what turns that into its own refusal, so the door never has to know the
 *  conversation's error vocabulary.
 *
 *  ONE REAL HANDSHAKE, not a reachability guess and not a liveness ping: the
 *  `initialize` the adapter's own MCP client sends as its first word, carrying
 *  the bearer token this process is about to hand over. What has to be proved
 *  is "I will serve you", and nothing weaker says it — a `400` is what a
 *  listening streamable-HTTP endpoint answers whether it is about to open a
 *  session or has already given its one away, so passing on any HTTP answer
 *  would wave through exactly the failure a proof-before-handover exists to
 *  catch. A SESSION ID in the answer is the one thing only a door that minted
 *  a transport and connected a face behind it can produce.
 *
 *  THE PROBE CLOSES ITS OWN SESSION (`DELETE`, the protocol's own
 *  termination), so proving the face works does not leave an abandoned face
 *  holding fleet subscriptions behind every bring-up.
 *
 *  NO DEADLINE, and that is not an oversight: the listener is in THIS process.
 *  A request that never comes back means this process's own event loop is
 *  wedged, and a timer running on that same wedged loop could not fire to tell
 *  anybody. A second clock here could only ever be wrong. */
export async function proveFleetMcpEndpoint(
  at: { readonly url: string; readonly token: string },
  log: FleetMcpLog,
): Promise<string | null> {
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
    return noAnswerAt(
      at.url,
      cause instanceof Error ? cause.message : String(cause),
    );
  }
  // The body is never read — the session id rides the headers, and the
  // `initialize` RESULT is the agent's business, not ours — but it is
  // cancelled rather than dropped, so the probe holds no SSE stream open
  // behind the conversation it was clearing the way for.
  await answer.body?.cancel();
  if (answer.status === 401 || answer.status === 403) {
    return refusedAt(at.url, answer.status);
  }
  if (!answer.ok) {
    return notServingAt(
      at.url,
      `it answered ${answer.status} to an \`initialize\``,
    );
  }
  const session = answer.headers.get(SESSION_HEADER);
  if (session === null) {
    return notServingAt(
      at.url,
      "it answered the `initialize` without opening a session",
    );
  }
  // The probe's session, ended by the probe. A teardown that fails is NOT a
  // reason to refuse the conversation — the face answered, which is the whole
  // of what was being proved — but it is not swallowed either: a session this
  // process opened and could not close is a face holding fleet subscriptions
  // nobody will ever read, and this line is where it shows up.
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
  return null;
}
