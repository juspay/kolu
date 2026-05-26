/**
 * Stdio transport for `@kolu/surface` clients.
 *
 * Wires an oRPC `ClientPeer` (from `@orpc/standard-server-peer`) to a
 * pair of `Readable` / `Writable` streams via base64+newline framing.
 * The same framing pairs with `serveOverStdio` (`../peerServer.ts`) on
 * the server side.
 *
 * Use case: a process consuming a surface served by another process
 * (typically a child process spawned by the consumer, or a remote peer
 * via `ssh host my-app --stdio`). The Solid client (`../solid`) is
 * browser-coupled; this link is the corresponding plain-Node consumer
 * path.
 *
 * Framing rule: each message is base64-encoded on one line; newlines
 * delimit messages. Base64 never contains a newline, so the framing is
 * unambiguous over a streamed byte transport that may chunk arbitrarily.
 * Handles string and binary payloads uniformly.
 *
 * No `ClientRetryPlugin` is installed by default — stdio is not a
 * transient-faulty transport in the way WebSocket is. If the peer
 * process dies, the entire connection dies; retrying mid-stream over a
 * dead pipe has no meaning. Reconnect, when relevant, is the consumer's
 * concern at a higher level (e.g. a state machine that respawns the
 * subprocess and rebuilds the link).
 */

import { createORPCClient } from "@orpc/client";
import { StandardRPCLink } from "@orpc/client/standard";
import type { AnyContractRouter, ContractRouterClient } from "@orpc/contract";
import type { Readable, Writable } from "node:stream";
import { ClientPeer, type EncodedMessage } from "@orpc/standard-server-peer";

/** Direction-neutral transport options. `read` is the stream the local
 *  side consumes incoming messages from; `write` is the stream it sends
 *  outgoing messages to. Same shape on both client and server sides —
 *  the loopback link (`./loopback.ts`) trades on this. */
export interface StdioLinkOptions {
  /** Stream to read incoming messages from. */
  read: Readable;
  /** Stream to write outgoing messages to. */
  write: Writable;
}

/** Base64+newline `send` adapter. Each message becomes one base64-
 *  encoded line on `out`. Exported so consumers building bespoke
 *  framing wrappers can reuse the encoding. */
export function makeStdioSend(out: Writable): (msg: EncodedMessage) => void {
  return (msg) => {
    const buf =
      typeof msg === "string"
        ? Buffer.from(msg, "utf8")
        : Buffer.isBuffer(msg)
          ? msg
          : Buffer.from(msg as ArrayBufferLike);
    out.write(buf.toString("base64"));
    out.write("\n");
  };
}

/** Base64+newline reader. Hands each decoded message to `onMessage`.
 *  Calls `onClose` when the underlying stream ends or closes. Returns a
 *  stop function that detaches the listener (does not close the
 *  underlying stream). */
export function readStdioMessages(
  inp: Readable,
  onMessage: (msg: Uint8Array) => void | Promise<void>,
  onClose?: () => void,
): () => void {
  let buf = "";
  const onData = (chunk: Buffer | string) => {
    buf += typeof chunk === "string" ? chunk : chunk.toString("utf8");
    let nl = buf.indexOf("\n");
    while (nl !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (line.length > 0) {
        try {
          const decoded = Buffer.from(line, "base64");
          void onMessage(decoded);
        } catch (_err) {
          // Malformed frame — skip and resync at the next newline.
          // No logger dep at this layer; consumers wrap their own
          // `onMessage` to surface protocol errors.
        }
      }
      nl = buf.indexOf("\n");
    }
  };
  inp.on("data", onData);
  if (onClose) {
    inp.once("end", onClose);
    inp.once("close", onClose);
  }
  return () => {
    inp.off("data", onData);
  };
}

/** `StandardRPCLink` whose transport is a pair of streams. Wraps a
 *  `ClientPeer` and bridges its messaging to base64+newline framing. */
export class StdioRPCLink<
  TContext extends Record<PropertyKey, unknown> = Record<PropertyKey, unknown>,
> extends StandardRPCLink<TContext> {
  private readonly peer: ClientPeer;
  private readonly stopRead: () => void;

  constructor(options: StdioLinkOptions) {
    const peer = new ClientPeer(makeStdioSend(options.write));
    const stopRead = readStdioMessages(options.read, async (msg) => {
      try {
        await peer.message(msg);
      } catch (_err) {
        // Codec mismatch / truncation — skip frame and continue.
        // Consumers can wrap with their own protocol-error surfacing.
      }
    });

    const linkClient = {
      async call(request: import("@orpc/standard-server").StandardRequest) {
        const response = await peer.request(request);
        return {
          ...response,
          body: () => Promise.resolve(response.body),
        };
      },
    };
    super(linkClient, { url: "http://orpc-stdio" });

    this.peer = peer;
    this.stopRead = stopRead;
  }

  /** Tear down the read pump and close the peer. The underlying
   *  streams are left untouched (the caller owns subprocess
   *  lifecycle). */
  dispose(): void {
    this.stopRead();
    this.peer.close();
  }
}

/** Build a typed oRPC client wired to a stdio pair. The default context
 *  is empty; consumers that need a plugin context (retry, etc.)
 *  parameterize at the call site:
 *
 *  ```ts
 *  const client = createStdioCellsClient<typeof contract>({ read, write });
 *  ```
 *
 *  Mirrors `createCellsClient` from `../client.ts` (the WebSocket
 *  variant); structural parity makes the two transports interchangeable
 *  at the call site. */
export function createStdioCellsClient<
  C extends AnyContractRouter,
  TContext extends Record<PropertyKey, unknown> = Record<PropertyKey, unknown>,
>(opts: StdioLinkOptions): ContractRouterClient<C, TContext> {
  const link = new StdioRPCLink<TContext>(opts);
  return createORPCClient<ContractRouterClient<C, TContext>>(link);
}
