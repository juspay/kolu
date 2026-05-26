/**
 * `StdioRPCLink` — `StandardRPCLink` whose transport is a child
 * process's stdin/stdout. Pairs with the `ServerPeer`-over-stdio
 * adapter in `../agent.ts`.
 *
 * Used by `HostSession` to build a typed oRPC client against
 * `agentContract`: the kolu server spawns `ssh -tt host kolu --stdio`,
 * pipes its stdin/stdout through the ssh transport, and wraps the
 * resulting duplex stream in this link. `createORPCClient(link)`
 * produces a typed client that satisfies the same call shape as the
 * in-process `LocalBackend`.
 */

import { StandardRPCLink } from "@orpc/client/standard";
import { ClientPeer } from "@orpc/standard-server-peer";
import type { Readable, Writable } from "node:stream";
import { log } from "../log.ts";
import { makeStdioSend, readStdioMessages } from "./stdio-peer.ts";

export interface StdioRPCLinkOptions {
  /** Child-process stdin (we write requests here). */
  stdin: Writable;
  /** Child-process stdout (we read responses from here). */
  stdout: Readable;
}

export class StdioRPCLink extends StandardRPCLink<object> {
  private readonly peer: ClientPeer;
  private readonly stopRead: () => void;

  constructor(options: StdioRPCLinkOptions) {
    const peer = new ClientPeer(makeStdioSend(options.stdin));
    const stopRead = readStdioMessages(options.stdout, async (msg) => {
      try {
        await peer.message(msg);
      } catch (err) {
        // Codec mismatch / truncation — log so a protocol error isn't
        // invisible, then continue reading from the next message
        // boundary.
        log.warn(
          { err, frameBytes: msg.byteLength },
          "stdio-client: peer.message threw",
        );
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
    super(linkClient, { url: "http://orpc-agent" });

    this.peer = peer;
    this.stopRead = stopRead;
  }

  dispose(): void {
    this.stopRead();
    this.peer.close();
  }
}
