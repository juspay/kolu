/** WebSocket upgrade passthrough for preview subdomains.
 *
 *  Vite / Next / Astro HMR connects back to the page's origin for live
 *  reload. When the Host header matches `<port>.preview.<anything>`, dial
 *  a client WS to the dev server and pipe frames both ways. Separate
 *  `WebSocketServer` from the caller's oRPC handler so dev-server traffic
 *  never runs through app code.
 *
 *  Implementation is message-level forwarding (on 'message' → send)
 *  rather than raw-socket tunneling — HMR is low-throughput enough that
 *  per-message overhead is invisible, and `ws`'s text-vs-binary bit
 *  carries through cleanly.
 *
 *  Address-family fallback: try IPv4 loopback first, retry with IPv6 on
 *  ECONNREFUSED. Matches the HTTP proxy's strategy so dev servers that
 *  bind to `::1` only (Vite default on some systems) still work without
 *  user config.
 *
 *  Pre-open buffering: frames the browser sends before the upstream
 *  handshake completes are stashed in `pending` and flushed on `open`.
 *  Without this, Vite's first HMR ping can race the upstream dial. */

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket as WsClient, WebSocketServer } from "ws";
import { matchPreviewHost } from "./hostMatch.ts";

export interface PreviewWsLogger {
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
    wss.handleUpgrade(req, socket, head, (downstream) => {
      const path = req.url ?? "/";
      const proto = req.headers["sec-websocket-protocol"];
      const origin = req.headers["origin"];
      const headers = {
        ...(proto && { "sec-websocket-protocol": String(proto) }),
        ...(origin && { origin: String(origin) }),
      };

      const pending: Array<{ data: WsClient.RawData; isBinary: boolean }> = [];
      let upstreamRef: WsClient | null = null;

      // Wire the downstream event handlers exactly once. They reference
      // `upstreamRef` by closure, so they always act on whichever
      // upstream is currently live (v4 initially, then v6 if we fell back).
      downstream.on("message", (data, isBinary) => {
        if (upstreamRef && upstreamRef.readyState === upstreamRef.OPEN) {
          upstreamRef.send(data, { binary: isBinary });
        } else {
          pending.push({ data, isBinary });
        }
      });
      downstream.on("close", (code, reason) => {
        if (upstreamRef && isClosable(upstreamRef)) {
          upstreamRef.close(code, reason);
        }
      });
      downstream.on("error", (err) => {
        log.error({ err, port }, "preview ws downstream error");
        if (upstreamRef && isClosable(upstreamRef)) {
          upstreamRef.close(1011);
        }
      });

      dial(0);

      function dial(hostIdx: number): void {
        const host = UPSTREAM_HOSTS[hostIdx];
        if (host === undefined) {
          // Exhausted every loopback family; fail the downstream with
          // the "internal server error" close code so clients that care
          // (HMR) can log it.
          if (isClosable(downstream)) {
            downstream.close(1011, Buffer.from("preview upstream unreachable"));
          }
          return;
        }
        const upstream = new WsClient(`ws://${host}:${port}${path}`, {
          headers,
        });

        upstream.once("open", () => {
          upstreamRef = upstream;
          for (const { data, isBinary } of pending) {
            upstream.send(data, { binary: isBinary });
          }
          pending.length = 0;

          upstream.on("message", (data, isBinary) => {
            if (downstream.readyState === downstream.OPEN) {
              downstream.send(data, { binary: isBinary });
            }
          });
          upstream.on("close", (code, reason) => {
            if (isClosable(downstream)) downstream.close(code, reason);
          });
          upstream.on("error", (err) => {
            log.error({ err, port, host }, "preview ws upstream error");
            if (isClosable(downstream)) downstream.close(1011);
          });
        });

        // Pre-open error: retry v6 on ECONNREFUSED, otherwise give up.
        // Once `open` fires, `upstreamRef` is set and the "real" error
        // handler wired above takes over.
        upstream.once("error", (err) => {
          if (upstreamRef !== null) return;
          const code = (err as NodeJS.ErrnoException).code;
          if (code === "ECONNREFUSED") {
            dial(hostIdx + 1);
            return;
          }
          log.error({ err, port, host }, "preview ws upstream error");
          if (isClosable(downstream)) downstream.close(1011);
        });
      }
    });
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
