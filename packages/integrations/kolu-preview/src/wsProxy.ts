/** WebSocket upgrade passthrough for preview subdomains.
 *
 *  Vite / Next / Astro HMR connects back to the page's origin for live
 *  reload. When the Host header matches `<port>.preview.<anything>`, dial
 *  the dev server *first* and only accept the browser's upgrade after
 *  the upstream handshake completes. On failure, the browser's upgrade
 *  is answered with a plain HTTP 502 carrying the same error page the
 *  HTTP proxy shows — keeps failures visible inside the iframe instead
 *  of hiding in a silent WS close.
 *
 *  Address-family fallback: try IPv4 loopback first, retry with IPv6 on
 *  ECONNREFUSED. Matches the HTTP proxy's strategy so dev servers that
 *  bind to `::1` only (Vite default on some systems) still work without
 *  user config.
 *
 *  Subprotocol handling: `Sec-WebSocket-Protocol` must be passed as the
 *  `WebSocket` constructor's positional `protocols` argument, not as a
 *  raw header — otherwise `ws`'s "expected subprotocols" state stays
 *  empty and the upstream's echo (e.g. Vite's `vite-hmr`) is rejected
 *  with "Server sent a subprotocol but none was requested." */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket as WsClient, WebSocketServer } from "ws";
import { matchPreviewHost } from "./hostMatch.ts";
import { extractErrorCode, writeUpstreamErrorToSocket } from "./errorPage.ts";

export interface PreviewWsLogger {
  warn: (obj: unknown, msg: string) => void;
  error: (obj: unknown, msg: string) => void;
}

export interface PreviewWsProxy {
  /** Returns true if the upgrade was a preview and has been handled.
   *  Callers fall through to their own upgrade routing when this is
   *  false. */
  handle: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
}

const UPSTREAM_HOSTS = ["127.0.0.1", "[::1]"] as const;

function isClosable(ws: WsClient): boolean {
  return ws.readyState === ws.OPEN || ws.readyState === ws.CONNECTING;
}

export function createPreviewWsProxy(log: PreviewWsLogger): PreviewWsProxy {
  // Dedicated WebSocketServer so oRPC's per-connection handler doesn't
  // run for dev-server traffic.
  const wss = new WebSocketServer({ noServer: true });

  function proxyUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    port: number,
  ): void {
    const path = req.url ?? "/";
    const rawProto = req.headers["sec-websocket-protocol"];
    const protocols = rawProto
      ? String(rawProto)
          .split(",")
          .map((p) => p.trim())
          .filter(Boolean)
      : undefined;
    const origin = req.headers["origin"];
    const upstreamHeaders = {
      ...(origin && { origin: String(origin) }),
    };

    dial(0);

    function dial(hostIdx: number): void {
      const host = UPSTREAM_HOSTS[hostIdx];
      if (host === undefined) {
        // Exhausted every loopback family. Because we haven't called
        // `handleUpgrade` yet, the browser's upgrade request is still
        // an in-flight HTTP request on the raw socket — surface a 502
        // with the same HTML page the HTTP proxy uses.
        log.warn({ port }, "preview ws upstream unreachable");
        writeUpstreamErrorToSocket(socket, port, "ECONNREFUSED");
        return;
      }
      const upstream = new WsClient(`ws://${host}:${port}${path}`, protocols, {
        headers: upstreamHeaders,
      });

      const onPreOpenError = (err: Error): void => {
        const code = extractErrorCode(err);
        if (code === "ECONNREFUSED") {
          dial(hostIdx + 1);
          return;
        }
        log.error({ err, port, host }, "preview ws upstream error");
        writeUpstreamErrorToSocket(socket, port, code);
      };

      upstream.once("error", onPreOpenError);
      upstream.once("open", () => {
        upstream.removeListener("error", onPreOpenError);
        onUpstreamOpen(upstream, port);
      });
    }

    /** Wire the relay once upstream is confirmed alive. Only now do we
     *  call `handleUpgrade` on the browser's socket — if we'd upgraded
     *  before the upstream open, the browser would hold an empty WS
     *  we couldn't unwind. */
    function onUpstreamOpen(upstream: WsClient, port: number): void {
      wss.handleUpgrade(req, socket, head, (downstream) => {
        downstream.on("message", (data, isBinary) => {
          if (upstream.readyState === upstream.OPEN) {
            upstream.send(data, { binary: isBinary });
          }
        });
        upstream.on("message", (data, isBinary) => {
          if (downstream.readyState === downstream.OPEN) {
            downstream.send(data, { binary: isBinary });
          }
        });
        downstream.on("close", (code, reason) => {
          if (isClosable(upstream)) upstream.close(code, reason);
        });
        upstream.on("close", (code, reason) => {
          if (isClosable(downstream)) downstream.close(code, reason);
        });
        downstream.on("error", (err) => {
          log.error({ err, port }, "preview ws downstream error");
          if (isClosable(upstream)) upstream.close(1011);
        });
        upstream.on("error", (err) => {
          log.error({ err, port }, "preview ws upstream error");
          if (isClosable(downstream)) downstream.close(1011);
        });
      });
    }
  }

  return {
    handle(req, socket, head) {
      const port = matchPreviewHost(req.headers.host);
      if (port === null) return false;
      proxyUpgrade(req, socket, head, port);
      return true;
    },
  };
}
