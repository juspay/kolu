/**
 * The supervisor's `connect` — dial the daemon's socket and hand the endpoint a
 * live, handshaken connection.
 *
 * `connect` is the supervisor's *soul*: the endpoint state machine
 * (`createEndpoint`) is generic over the client `C` and the identity `I` and
 * interprets neither — it only orchestrates gate-read → kill → wait → spawn →
 * connect → transition reports. What "connected" and "identity" MEAN live here.
 *
 * We dial the unix socket via the supervisor's own `dialSocket` (it owns the
 * connect/error race), build a contract-typed oRPC client over the socket's
 * byte stream with `stdioLink` (a connected socket is a Duplex — the same
 * base64+newline framing `serveOverUnixSocket` serves), then prove the link
 * answers by reading the `load` cell's first frame. That read doubles as the
 * handshake and stamps the identity (`cores`) the endpoint reports.
 */

import type { ClientRetryPluginContext } from "@orpc/client/plugins";
import type { ContractRouterClient } from "@orpc/contract";
import { stdioLink } from "@kolu/surface/links/stdio";
import type { DaemonConnection } from "@kolu/surface-daemon-supervisor";
import { dialSocket } from "@kolu/surface-daemon-supervisor";
import type { surface } from "../common/surface";

/** The contract-typed client the endpoint holds. */
export type TopClient = ContractRouterClient<
  typeof surface.contract,
  ClientRetryPluginContext
>;

/** What "identity" means for this daemon — enough to prove the link answered
 *  and show a fact in the status line. */
export interface TopIdentity {
  cores: number;
}

async function firstFrame<T>(
  source: AsyncIterable<T> | Promise<AsyncIterable<T>>,
): Promise<T> {
  for await (const frame of await source) return frame;
  throw new Error("stream closed before its snapshot frame");
}

export async function connectTop(
  socketPath: string,
): Promise<DaemonConnection<TopClient, TopIdentity>> {
  const socket = await dialSocket(socketPath);
  const client: TopClient = stdioLink<typeof surface.contract>({
    read: socket,
    write: socket,
  });

  // Handshake: the first frame of the `load` cell proves the daemon is serving
  // AND yields the identity we report. A dial that connects but never answers
  // would hang here — the endpoint's `socketReadyMs` ceiling covers that.
  const load = await firstFrame(client.surface.load.get({}));

  const closeCbs: Array<() => void> = [];
  let closed = false;
  socket.once("close", () => {
    closed = true;
    for (const cb of closeCbs) cb();
  });

  return {
    client,
    identity: { cores: load.cores },
    startedAt: Date.now(),
    dispose: () => socket.destroy(),
    // The endpoint subscribes to this to flip `connected → degraded` when the
    // daemon dies mid-session (fires at most once).
    onClose: (cb) => {
      if (closed) cb();
      else closeCbs.push(cb);
    },
  };
}
