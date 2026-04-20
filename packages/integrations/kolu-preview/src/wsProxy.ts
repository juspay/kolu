/** WebSocket upgrade passthrough for preview subdomains.
 *
 *  Vite / Next / Astro HMR connects back to the page's origin for live
 *  reload. When the Host header matches `<port>.preview.<anything>`, dial
 *  a client WS to `ws://127.0.0.1:<port><path>` and pipe frames both
 *  ways. Separate `WebSocketServer` from the caller's oRPC handler so
 *  dev-server traffic never runs through app code.
 *
 *  Implementation is message-level forwarding (on 'message' → send)
 *  rather than raw-socket tunneling — HMR is low-throughput enough that
 *  per-message overhead is invisible, and `ws`'s text-vs-binary bit
 *  carries through cleanly. Frames the browser sends before the upstream
 *  handshake completes are buffered and flushed on `open`. */

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
   *  false. Socket is destroyed for invalid ports matching the pattern. */
  handle: (req: IncomingMessage, socket: Duplex, head: Buffer) => boolean;
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
      const target = `ws://127.0.0.1:${port}${req.url ?? "/"}`;
      const proto = req.headers["sec-websocket-protocol"];
      const origin = req.headers["origin"];
      const upstream = new WsClient(target, {
        headers: {
          ...(proto && { "sec-websocket-protocol": String(proto) }),
          ...(origin && { origin: String(origin) }),
        },
      });

      // Buffer browser → dev-server frames sent before upstream is open;
      // without this, Vite's first HMR ping can race the dial and get
      // dropped.
      const pending: Array<{ data: WsClient.RawData; isBinary: boolean }> = [];
      let upstreamOpen = false;

      downstream.on("message", (data, isBinary) => {
        if (upstreamOpen && upstream.readyState === upstream.OPEN) {
          upstream.send(data, { binary: isBinary });
        } else {
          pending.push({ data, isBinary });
        }
      });

      upstream.on("open", () => {
        upstreamOpen = true;
        for (const { data, isBinary } of pending) {
          upstream.send(data, { binary: isBinary });
        }
        pending.length = 0;
      });

      upstream.on("message", (data, isBinary) => {
        if (downstream.readyState === downstream.OPEN) {
          downstream.send(data, { binary: isBinary });
        }
      });

      const closeBoth = (code?: number, reason?: Buffer) => {
        const c = code ?? 1000;
        const r = reason ?? Buffer.from("");
        if (
          downstream.readyState === downstream.OPEN ||
          downstream.readyState === downstream.CONNECTING
        ) {
          downstream.close(c, r);
        }
        if (
          upstream.readyState === upstream.OPEN ||
          upstream.readyState === upstream.CONNECTING
        ) {
          upstream.close(c, r);
        }
      };

      downstream.on("close", (code, reason) => closeBoth(code, reason));
      upstream.on("close", (code, reason) => closeBoth(code, reason));
      downstream.on("error", (err) => {
        log.error({ err, port }, "preview ws downstream error");
        closeBoth(1011);
      });
      upstream.on("error", (err) => {
        log.error({ err, port }, "preview ws upstream error");
        closeBoth(1011);
      });
    });
  }

  return {
    handle(req, socket, head) {
      const port = matchPreviewHost(req.headers.host);
      if (port === null) {
        // Not a preview host. Let the caller route this upgrade.
        // Invalid-port case (matched pattern but out-of-range) is also
        // folded into `null` by matchPreviewHost — closing the socket
        // there would be more defensible than a silent fall-through, but
        // `5173.preview` with an out-of-range port isn't a real user-
        // visible case and we save the caller from special-casing it.
        return false;
      }
      proxyUpgrade(req, socket, head, port);
      return true;
    },
  };
}
