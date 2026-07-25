/**
 * Talking to a proxy, from the client's side.
 *
 * Connecting is more than opening a socket, and every one of the extra rules is
 * knowledge only this package has: the session's working directory is the
 * proxy's and is published in the `initialize` response; the ACP library leaves
 * requests pending forever when its transport ends, so the socket's death has to
 * be raced explicitly; one turn runs at a time, so a second is refused rather
 * than queued; and permission requests are never forwarded, so being asked one
 * is a contract break rather than something to answer.
 *
 * Those rules were hand-rolled three times before this module existed — in
 * `acp-chat`, in the test client, and next in pesu. This is the plug they all
 * share.
 */

import { connect as connectSocket, type Socket } from "node:net";
import { Readable, Writable } from "node:stream";
import {
  type ClientSideConnection as ClientSideConnectionType,
  ClientSideConnection,
  type ContentBlock,
  ndJsonStream,
  PROTOCOL_VERSION,
  type PromptResponse,
  RequestError,
  type RequestPermissionRequest,
  type SessionNotification,
} from "@zed-industries/agent-client-protocol";

/** Where the proxy publishes the working directory its session is rooted at. */
export const SESSION_CWD_META = "kolu.acp/cwd";

type SessionUpdate = SessionNotification["update"];

export interface ProxyClient {
  /** The proxy's single session. */
  readonly sessionId: string;
  /** The directory that session runs in — the proxy's, not the caller's. */
  readonly cwd: string;
  /** Run one turn. Rejects if the proxy dies rather than hanging on it. */
  prompt(text: string | ContentBlock[]): Promise<PromptResponse>;
  /** Ask the proxy to end the turn in flight. */
  cancel(): void;
  /** Watch the session's frames. Returns an unsubscribe. */
  onUpdate(listener: (update: SessionUpdate) => void): () => void;
  /** Resolves if the proxy goes away first — never resolves on a healthy link. */
  readonly closed: Promise<void>;
  close(): void;
}

/** Open a session on the proxy listening at `socketPath`. */
export async function connectToProxy(socketPath: string): Promise<ProxyClient> {
  const socket = await new Promise<Socket>((resolve, reject) => {
    const s = connectSocket(socketPath)
      .once("connect", () => resolve(s))
      .once("error", reject);
  });

  const listeners = new Set<(update: SessionUpdate) => void>();
  let leaving = false;

  let markClosed: () => void = () => {};
  const closed = new Promise<void>((resolve) => {
    markClosed = resolve;
  });
  /** Rejects when the proxy goes away, so no request outlives the transport. */
  let died: (error: unknown) => void = () => {};
  const gone = new Promise<never>((_resolve, reject) => {
    died = reject;
  });
  gone.catch(() => {});
  socket.once("close", () => {
    if (!leaving) {
      markClosed();
      died(new Error("the proxy closed the connection"));
    }
  });
  const untilGone = async <T>(work: Promise<T>): Promise<T> =>
    await Promise.race([work, gone]);

  const connection: ClientSideConnectionType = new ClientSideConnection(
    () => ({
      sessionUpdate: async (params: SessionNotification) => {
        for (const listener of listeners) listener(params.update);
      },
      // The proxy answers permission requests itself, so reaching this is a
      // contract break rather than a prompt to guess at a policy.
      requestPermission: async (params: RequestPermissionRequest) => {
        throw RequestError.internalError({
          reason: `the proxy forwarded a permission request this client cannot answer: ${
            params.toolCall.title ?? params.toolCall.toolCallId
          }`,
        });
      },
    }),
    ndJsonStream(Writable.toWeb(socket), Readable.toWeb(socket)),
  );

  const initialized = await untilGone(
    connection.initialize({ protocolVersion: PROTOCOL_VERSION }),
  );
  const published = initialized._meta?.[SESSION_CWD_META];
  if (typeof published !== "string") {
    throw new Error(
      `the server at ${socketPath} did not publish ${SESSION_CWD_META}; it does not look like an acp-proxy`,
    );
  }

  const session = await untilGone(
    connection.newSession({ cwd: published, mcpServers: [] }),
  );

  /** One turn at a time, because the proxy refuses a second rather than
   *  queueing it — so the queue lives here, once, instead of in each caller. */
  let turns: Promise<unknown> = Promise.resolve();

  return {
    sessionId: session.sessionId,
    cwd: published,
    closed,
    prompt: (text) => {
      const prompt: ContentBlock[] =
        typeof text === "string" ? [{ type: "text", text }] : text;
      const run = turns.then(() =>
        untilGone(connection.prompt({ sessionId: session.sessionId, prompt })),
      );
      // The queue must survive a failed turn, or one error wedges the session.
      turns = run.catch(() => {});
      return run;
    },
    cancel: () => {
      void connection.cancel({ sessionId: session.sessionId }).catch(() => {
        // The proxy is already gone; `closed` is the authority on that.
      });
    },
    onUpdate: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    close: () => {
      leaving = true;
      socket.destroy();
    },
  };
}
