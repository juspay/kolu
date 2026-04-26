/**
 * oRPC client: single WebSocket connection to the server.
 *
 * Uses partysocket for auto-reconnect. All terminal procedures
 * (create, attach, sendInput, resize) go through this link.
 */

import { createORPCClient, ORPCError } from "@orpc/client";
import {
  ClientRetryPlugin,
  type ClientRetryPluginContext,
} from "@orpc/client/plugins";
import { RPCLink } from "@orpc/client/websocket";
import type { ContractRouterClient } from "@orpc/contract";
import type { TerminalId } from "kolu-common";
import type { contract } from "kolu-common/contract";
import { WebSocket as PartySocket } from "partysocket";
import { createMemo, createSignal } from "solid-js";
import { match } from "ts-pattern";

export type WsStatus = "connecting" | "open" | "closed";

// Parameterize with ClientRetryPluginContext so `{ context: STREAM_RETRY }`
// and `onRetry` overrides are type-checked at every call site.
type Client = ContractRouterClient<typeof contract, ClientRetryPluginContext>;

const { protocol, host } = window.location;
const wsUrl = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;

const ws = new PartySocket(wsUrl);

// Expose for e2e tests: the reconnect regression test (#410) needs to
// drop and restore the socket directly. Same pattern as __xterm on the
// terminal container. Harmless in production — just an attribute on window.
(window as Window & { __koluWs?: PartySocket }).__koluWs = ws;

// Cast: PartySocket is API-compatible with WebSocket but types don't overlap.
// Plugin default retry=0: mutations and unary calls fail fast. Streaming
// calls opt into infinite retry via the `stream` namespace below.
const link = new RPCLink<ClientRetryPluginContext>({
  websocket: ws as unknown as WebSocket,
  plugins: [new ClientRetryPlugin()],
});

export const client = createORPCClient<Client>(link);

/**
 * Private retry context for streaming procedures — route new streaming
 * calls through the `stream` namespace below instead of importing this.
 * Transport errors (WS drop → aborted iterator) retry forever; application
 * errors (`ORPCError`) propagate so consumers can handle them. Every kolu
 * streaming procedure is snapshot-then-deltas on every subscribe (see
 * `server/src/router.ts`), so re-invoking resumes with fresh full state.
 */
const STREAM_RETRY: ClientRetryPluginContext = {
  retry: Number.POSITIVE_INFINITY,
  retryDelay: (o) => o.lastEventRetry ?? 1000,
  shouldRetry: ({ error }) => !(error instanceof ORPCError),
};

/**
 * Streaming procedure wrappers. Adding a new streaming procedure = adding
 * one entry here, so retry adherence is mechanical rather than cultural.
 * `attach` takes an `onRetry` callback because `ClientRetryPlugin` fires
 * `onRetry` before the new iterator emits its first yield, and the server's
 * first yield post-reconnect is a fresh `getScreenState()` snapshot that
 * would double-paint onto a stale xterm buffer without an explicit reset.
 */
export const stream = {
  preferences: (signal?: AbortSignal) =>
    client.preferences.get(undefined, { signal, context: STREAM_RETRY }),
  /** Server-derived activity feed (recent repos + recent agents). Used
   *  by the command palette for "recent cwds" and similar entries. */
  activityFeed: (signal?: AbortSignal) =>
    client.activity.get(undefined, { signal, context: STREAM_RETRY }),
  session: (signal?: AbortSignal) =>
    client.session.get(undefined, { signal, context: STREAM_RETRY }),
  terminalList: (signal?: AbortSignal) =>
    client.terminal.list(undefined, { signal, context: STREAM_RETRY }),
  metadata: (id: TerminalId, signal?: AbortSignal) =>
    client.terminal.onMetadataChange({ id }, { signal, context: STREAM_RETRY }),
  exit: (id: TerminalId, signal?: AbortSignal) =>
    client.terminal.onExit({ id }, { signal, context: STREAM_RETRY }),
  attach: (
    id: TerminalId,
    opts: { signal?: AbortSignal; onRetry: () => void },
  ) =>
    client.terminal.attach(
      { id },
      {
        signal: opts.signal,
        context: { ...STREAM_RETRY, onRetry: opts.onRetry },
      },
    ),
  /** Live file-tree stream — `snapshot` immediately, `delta` per
   *  debounced fs change. Subscribe with `createSubscription` and dispatch
   *  events into Pierre's `tree.batch()` for incremental updates. */
  fsWatch: (repoPath: string, signal?: AbortSignal) =>
    client.fs.watch({ repoPath }, { signal, context: STREAM_RETRY }),
};

/**
 * Single discriminated union describing every observable state of the
 * client/server connection. The header indicator, the dim overlay, the
 * session-restore gate, the toast driver, and the About dialog all
 * read this one signal. Variants that carry a `processId` are the ones
 * where the client has a confirmed server identity.
 */
export type ServerLifecycleEvent =
  | { kind: "connecting" }
  | { kind: "connected"; processId: string }
  | { kind: "disconnected" }
  | { kind: "reconnected"; processId: string }
  | { kind: "restarted"; processId: string };

const [lifecycle, setLifecycle] = createSignal<ServerLifecycleEvent>({
  kind: "connecting",
});

export { lifecycle };

/** Transport status for the header dot. */
const wsStatus = createMemo<WsStatus>(() =>
  match(lifecycle().kind)
    .with("connecting", () => "connecting" as const)
    .with("disconnected", () => "closed" as const)
    .with("connected", "reconnected", "restarted", () => "open" as const)
    .exhaustive(),
);

/** The server process UUID, once the identity probe has resolved. `undefined`
 *  only during the initial "connecting" phase before the first `info()` reply. */
const serverProcessId = createMemo(() => {
  const ev = lifecycle();
  return ev.kind === "connecting" || ev.kind === "disconnected"
    ? undefined
    : ev.processId;
});

export { serverProcessId, wsStatus };

// IIFE scopes `connectCount` and `knownProcessId` — no module-level
// mutables leak; external observers read `lifecycle()` instead.
(() => {
  let connectCount = 0;
  let knownProcessId: string | null = null;

  ws.addEventListener("open", () => {
    connectCount++;
    const isFirstConnect = connectCount === 1;
    // server.info() uses the plugin default retry=0, so a not-ready peer
    // fails fast; partysocket will fire another `open` after reconnect.
    client.server
      .info()
      .then(({ processId }) => {
        if (isFirstConnect) {
          knownProcessId = processId;
          setLifecycle({ kind: "connected", processId });
          return;
        }
        const restarted =
          knownProcessId !== null && processId !== knownProcessId;
        knownProcessId = processId;
        setLifecycle({
          kind: restarted ? "restarted" : "reconnected",
          processId,
        });
      })
      .catch((err: unknown) => {
        // Don't transition — the next partysocket `open` will retry. Log
        // so a persistently-broken probe doesn't silently leave the UI
        // stuck in "connecting".
        console.warn("server.info probe failed:", err);
      });
  });

  ws.addEventListener("close", () => {
    // Initial "connecting" phase doesn't count as a drop.
    if (connectCount > 0) setLifecycle({ kind: "disconnected" });
  });
})();
