/**
 * Stdio link adapter — oRPC client over a `Readable`/`Writable` pair.
 *
 * Wires a `ClientPeer` (from `@orpc/standard-server-peer`) to a Node stream
 * pair via base64+newline framing. Direction-neutral options (`read` /
 * `write`) so client and server use the same shape.
 *
 * Why base64+newline? The underlying peer codec emits `string |
 * ArrayBufferLike | Uint8Array` per message. ssh stdin/stdout is a byte
 * stream with no framing of its own, so two things must hold:
 *   1. Binary safety — message bytes can include `\n`, NUL, etc.; raw
 *      bytes would corrupt frame delineation.
 *   2. Frame boundaries — each message gets exactly one delimiter.
 * Base64 produces ASCII bytes that never contain `\n`, then we append a
 * newline. Decoder reads line-by-line and base64-decodes each line back
 * to the original `Uint8Array` the peer expects.
 *
 * Stdout-is-protocol gotcha (lesson #4): on the *server* side (the
 * subprocess), stdout IS the protocol channel. Any extraneous write to
 * stdout corrupts the next frame and the client peer dies with
 * `SyntaxError: Unexpected token '«'` (the leading byte of base64-decoded
 * garbage). Consumers of `serveOverStdio` must redirect logs to fd 2.
 * See `peer-server.ts` for the symmetric server-side note.
 *
 * Reconnect: this link does not reconnect — the link is bound to one
 * stream pair, and a stream close ends the link. Callers that need
 * reconnect should layer it on top by tearing down and constructing a new
 * link against a fresh stream pair. (R-2's `HostSession` is the
 * canonical example.)
 */

import type { Readable, Writable } from "node:stream";
import type { ClientContext, ClientOptions } from "@orpc/client";
import { createORPCClient, ORPCError } from "@orpc/client";
import {
  ClientRetryPlugin,
  type ClientRetryPluginContext,
} from "@orpc/client/plugins";
import type {
  StandardLinkClient,
  StandardRPCLinkOptions,
} from "@orpc/client/standard";
import { StandardRPCLink } from "@orpc/client/standard";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import type {
  StandardLazyResponse,
  StandardRequest,
} from "@orpc/standard-server";
import { ClientPeer } from "@orpc/standard-server-peer";

/** A `Readable`/`Writable` pair the link reads and writes from. */
export interface StdioLinkOptions {
  /** Stream the link reads inbound messages from. For a subprocess
   *  client, this is `child.stdout`. For a loopback test, the server-side
   *  `read` half of the cross-piped pair. */
  read: Readable;
  /** Stream the link writes outbound messages to. For a subprocess
   *  client, this is `child.stdin`. For a loopback test, the server-side
   *  `write` half of the cross-piped pair. */
  write: Writable;
}

/** Client-side `StandardLinkClient` implementation backed by a stdio pair.
 *  The browser/WebSocket counterpart is `LinkWebsocketClient`. */
export class LinkStdioClient<T extends ClientContext>
  implements StandardLinkClient<T>
{
  private readonly peer: ClientPeer;

  constructor(opts: StdioLinkOptions) {
    this.peer = new ClientPeer(async (message) => {
      const line = `${encodeFrame(message)}\n`;
      await new Promise<void>((resolve, reject) => {
        opts.write.write(line, (err) =>
          err == null ? resolve() : reject(err),
        );
      });
    });
    readFramedLines(opts.read, (frame) => {
      // Swallow per-frame parse errors. A bad inbound frame is most
      // likely an agent-side stdout corruption (lesson #4); the
      // already-in-flight RPCs continue to work, and the consumer can
      // observe the failure via the stream's eventual end or via a
      // request timeout. Logging to stderr keeps the diagnostic visible
      // without crashing the link.
      this.peer.message(frame).catch((err) => {
        process.stderr.write(
          `[@kolu/surface/links/stdio] inbound frame parse failure: ${
            (err as Error).message
          }\n`,
        );
      });
    }).then(
      () => this.peer.close(),
      () => this.peer.close(),
    );
  }

  async call(
    request: StandardRequest,
    _options: ClientOptions<T>,
    _path: readonly string[],
    _input: unknown,
  ): Promise<StandardLazyResponse> {
    const response = await this.peer.request(request);
    return { ...response, body: () => Promise.resolve(response.body) };
  }
}

/** Options accepted by `StdioRPCLink`. `read` / `write` come from
 *  `StdioLinkOptions`; the rest mirror `StandardRPCLinkOptions` minus
 *  fields that don't apply to a non-HTTP transport (`url`, `method`,
 *  `fallbackMethod`, `maxUrlLength`). */
export interface StdioRPCLinkOptions<T extends ClientContext>
  extends Omit<
      StandardRPCLinkOptions<T>,
      "url" | "method" | "fallbackMethod" | "maxUrlLength"
    >,
    StdioLinkOptions {}

/** RPC link that communicates over a stdio stream pair using the same
 *  framing as `serveOverStdio` on the other end.
 *
 *  Symmetric with `RPCLink` from `@orpc/client/websocket` — wire shape on
 *  top of the link is the same RPC codec, only the transport changes. */
export class StdioRPCLink<T extends ClientContext> extends StandardRPCLink<T> {
  constructor(options: StdioRPCLinkOptions<T>) {
    super(new LinkStdioClient<T>(options), { ...options, url: "http://orpc" });
  }
}

/** Connect a typed oRPC client over a stdio transport, with the same
 *  `ClientRetryPlugin` install as `websocketLink` does for WebSocket — the
 *  subprocess / ssh member of the link family. The parent-side bridge of
 *  R-1.5's remote-process-monitor demo and R-2's `RemoteTerminalBackend`
 *  both call this. */
export function stdioLink<C extends AnyContractRouter>(
  opts: StdioLinkOptions,
): ContractRouterClient<C, ClientRetryPluginContext> {
  const link = new StdioRPCLink<ClientRetryPluginContext>({
    read: opts.read,
    write: opts.write,
    plugins: [new ClientRetryPlugin()],
  });
  return createORPCClient<ContractRouterClient<C, ClientRetryPluginContext>>(
    link,
  );
}

/** Encode a single peer message into a single base64 line (no trailing
 *  newline — the caller appends it). Exported only for `serveOverStdio`,
 *  not part of the public API. */
export function encodeFrame(
  message: string | ArrayBufferLike | Uint8Array,
): string {
  if (typeof message === "string") {
    return Buffer.from(message, "utf-8").toString("base64");
  }
  if (message instanceof Uint8Array) {
    return Buffer.from(
      message.buffer,
      message.byteOffset,
      message.byteLength,
    ).toString("base64");
  }
  return Buffer.from(message).toString("base64");
}

/** Decode one base64 line back into a `Uint8Array` for the peer codec. */
export function decodeFrame(line: string): Uint8Array {
  return new Uint8Array(Buffer.from(line, "base64"));
}

/** Read line-delimited frames off `read` until the stream ends. Each
 *  non-empty line is base64-decoded and dispatched to `onFrame`. Returns
 *  a Promise that resolves on `'end'` and rejects on `'error'`.
 *
 *  Why hand-roll instead of `readline`: `readline` adds another async
 *  layer and obscures the framing assumption. The whole protocol is
 *  "one base64 line = one frame", and the loop expressing it directly is
 *  20 lines.
 *
 *  Exported so `serveOverStdio` (the server-side counterpart) can share
 *  the exact same framing — base64+newline is the wire shape, not a
 *  client-specific concern, and a divergence between client and server
 *  framing loops would be the worst kind of silent bug. */
export async function readFramedLines(
  read: Readable,
  onFrame: (frame: Uint8Array) => void,
): Promise<void> {
  read.setEncoding("utf-8");
  let buffer = "";
  return new Promise<void>((resolve, reject) => {
    read.on("data", (chunk: string) => {
      buffer += chunk;
      let nl = buffer.indexOf("\n");
      while (nl !== -1) {
        const line = buffer.slice(0, nl).trim();
        buffer = buffer.slice(nl + 1);
        nl = buffer.indexOf("\n");
        if (line.length === 0) continue;
        try {
          onFrame(decodeFrame(line));
        } catch (err) {
          reject(
            new ORPCError("SURFACE_STDIO_FRAME_DECODE_FAILED", {
              message: `Failed to base64-decode an inbound stdio frame. The peer on the other end likely wrote non-protocol bytes to its protocol channel (e.g. logged to stdout instead of stderr — see lesson #4). Underlying error: ${(err as Error).message}`,
              cause: err,
            }),
          );
        }
      }
    });
    read.on("end", resolve);
    read.on("close", resolve);
    read.on("error", reject);
  });
}
