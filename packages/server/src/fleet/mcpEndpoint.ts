/**
 * The fleet MCP door — a dedicated loopback HTTP listener whose ONLY route is
 * `/mcp`, serving kolu's fleet-wide MCP face to the one ACP adapter this
 * process spawns.
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

/** The one path this listener answers. Anything else is a 404 — there is no
 *  index, no health route and no second verb, because the only client is an
 *  MCP adapter that was handed this exact URL. */
const MCP_PATH = "/mcp";

/** Where the fleet face is listening and the credential to reach it — exactly
 *  what the orchestrator puts on its session's one `http` MCP server. */
export interface FleetMcpEndpoint {
  /** `http://127.0.0.1:<ephemeral>/mcp`. */
  readonly url: string;
  /** The per-process bearer token, as `Authorization: Bearer <token>`. */
  readonly token: string;
  /** Stop serving: close the MCP server (and with it the transport), then the
   *  listener and every socket still on it. Idempotent. */
  close(): Promise<void>;
}

export interface FleetMcpEndpointOptions {
  /** Build + connect the MCP server over the transport this door owns. The
   *  door knows nothing about kolu's fleet — the composition root passes
   *  `serveKoluFleetMcp` bound to its `FleetHosts`, and this module stays a
   *  door. */
  serve: (transport: Transport) => Promise<{ close: () => Promise<void> }>;
  /** Narration sink. A refused request is logged at WARN: on a single-user
   *  machine it means something other than this process's own adapter is
   *  knocking, which is worth a line. */
  log: {
    info(o: unknown, m?: string): void;
    warn(o: unknown, m?: string): void;
    error(o: unknown, m?: string): void;
  };
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

/** Start the fleet MCP door. Resolves once the listener is bound and the MCP
 *  server is connected to its transport — so a caller that has this value can
 *  hand the URL out knowing a request to it will be answered.
 *
 *  A listen failure REJECTS rather than degrading: an orchestrator with no
 *  hands is not a degraded orchestrator, and the boot that called this decides
 *  what to do with the sentence. */
export async function startFleetMcpEndpoint(
  opts: FleetMcpEndpointOptions,
): Promise<FleetMcpEndpoint> {
  const token = randomBytes(32).toString("hex");

  const transport = new StreamableHTTPServerTransport({
    // STATEFUL — see the module doc: the `updated` notifications ride the
    // standalone GET SSE stream, which needs a named session.
    sessionIdGenerator: () => randomUUID(),
  });
  const served = await opts.serve(transport);

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
      // The transport reads the body itself (no pre-parse). Its own faults are
      // answered on the response it was given; a rejection here would be a
      // defect in the transport, and it must not reach the process-wide
      // `unhandledRejection` boundary and take kolu down over one request.
      void transport.handleRequest(req, res).catch((err: unknown) => {
        opts.log.error({ err }, "fleet mcp: request handling faulted");
        if (!res.headersSent) {
          res
            .writeHead(500, { "content-type": "text/plain" })
            .end("internal error\n");
        } else {
          res.end();
        }
      });
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
        // The MCP server first — it owns the transport, and closing the
        // transport is what ends the SSE streams still holding sockets open.
        await served.close();
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
