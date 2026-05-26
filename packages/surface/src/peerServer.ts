/**
 * `serveOverStdio` — serve a typed oRPC router over a stdio-shaped
 * transport.
 *
 * Pairs with the stdio link (`./links/stdio`): a process spawned with
 * `--stdio` (or similar marker) calls `serveOverStdio({ router })` to
 * accept requests from its parent over `process.stdin` and write
 * responses to `process.stdout`. The base64+newline framing matches the
 * client side.
 *
 * Works with any router shape — `implement(contract)` from `@orpc/server`,
 * `implementSurface(surface, deps).router` from `./server`, or a router
 * literal. The function is transport-only; routing semantics are the
 * caller's choice.
 *
 * Returns a Promise that resolves when the input stream ends. Callers
 * typically `await` it from their `--stdio` entry point so the process
 * exits cleanly when the parent closes the pipe.
 *
 * Loopback usage: pass the `server` half of a `LoopbackPair`
 * (`./links/loopback`) for in-process serving — the server runs on the
 * caller's tick alongside an in-process client.
 */

import { StandardRPCHandler } from "@orpc/server/standard";
// biome-ignore lint/correctness/useImportExtensions: tsc resolves implicit subpaths
import { createServerPeerHandleRequestFn } from "@orpc/server/standard-peer";
import { ServerPeer } from "@orpc/standard-server-peer";
import {
  makeStdioSend,
  readStdioMessages,
  type StdioLinkOptions,
} from "./links/stdio";

export interface ServeOverStdioOptions<TContext extends object = object> {
  /** Router as produced by `implement(contract)` or
   *  `implementSurface(...).router`. The framework does not inspect
   *  its shape; oRPC's `StandardRPCHandler` walks it. */
  // biome-ignore lint/suspicious/noExplicitAny: router shape is opaque to this layer
  router: any;
  /** Context threaded into every handler invocation. Empty by default;
   *  use this for `implementSurface`'s `ctx`-style derived context if
   *  the application needs request-scoped values. */
  context?: TContext;
  /** Streams to serve on. Defaults to `process.stdin` / `process.stdout`
   *  (the standard `--stdio` shape). Loopback consumers pass the
   *  `server` half of `createLoopbackPair()`. */
  transport?: StdioLinkOptions;
  /** Invoked when the read stream ends (peer disconnected). Use for
   *  graceful shutdown — typically `() => process.exit(0)`. */
  onClose?: () => void;
  /** Invoked when a message handler throws. Defaults to silently
   *  swallowing; pass a callback to surface protocol-layer errors. */
  onError?: (err: unknown) => void;
}

/** Serve `router` over a stdio-shaped transport. Resolves when the
 *  input stream ends. The transport is the caller's: pass
 *  `process.stdin` / `process.stdout` for a real subprocess server, or
 *  the `server` half of a `LoopbackPair` for in-process testing. */
export function serveOverStdio<TContext extends object = object>(
  opts: ServeOverStdioOptions<TContext>,
): Promise<void> {
  const transport: StdioLinkOptions = opts.transport ?? {
    read: process.stdin,
    write: process.stdout,
  };
  const handler = new StandardRPCHandler(opts.router, {});
  const peerHandle = createServerPeerHandleRequestFn(handler, {
    context: (opts.context ?? ({} as TContext)) as TContext,
  });
  const peer = new ServerPeer(makeStdioSend(transport.write));

  return new Promise<void>((resolve) => {
    const stopRead = readStdioMessages(
      transport.read,
      async (msg) => {
        try {
          await peer.message(msg, peerHandle);
        } catch (err) {
          opts.onError?.(err);
        }
      },
      () => {
        peer.close();
        opts.onClose?.();
      },
    );

    // Some `Readable` implementations need a `resume()` kick (Node's
    // default raw `process.stdin` starts paused). PassThrough already
    // flows; the kick is harmless on already-flowing streams.
    transport.read.resume();

    transport.read.once("close", () => {
      stopRead();
      resolve();
    });
    transport.read.once("end", () => {
      stopRead();
      resolve();
    });
  });
}
