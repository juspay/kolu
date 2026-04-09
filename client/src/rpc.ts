/**
 * oRPC client: single WebSocket connection to the server.
 *
 * Uses partysocket for auto-reconnect. All terminal procedures
 * (create, attach, sendInput, resize) go through this link.
 */
import { createSignal } from "solid-js";
import { createORPCClient, ORPCError } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import {
  ClientRetryPlugin,
  type ClientRetryPluginContext,
} from "@orpc/client/plugins";
import { WebSocket as PartySocket } from "partysocket";
import { toast } from "solid-sonner";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "kolu-common/contract";

export type WsStatus = "connecting" | "open" | "closed";

// Client context carries per-call retry config. All fields are optional,
// so unary calls (mutations) omit it and fail fast per the plugin default.
type Client = ContractRouterClient<typeof contract, ClientRetryPluginContext>;

const { protocol, host } = window.location;
const wsUrl = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;

const ws = new PartySocket(wsUrl);

// Expose for e2e tests: the reconnect regression test (#410) needs to
// drop and restore the socket directly. Same pattern as __xterm on the
// terminal container. Harmless in production — just an attribute on window.
(window as Window & { __koluWs?: PartySocket }).__koluWs = ws;

// Cast: PartySocket is API-compatible with WebSocket but types don't overlap.
// ClientRetryPlugin with default retry=0: mutations fail fast. Streaming
// procedures opt into infinite retry via the STREAM_RETRY context below —
// see client/src/createSubscription.ts callers and Terminal.tsx attach.
const link = new RPCLink<ClientRetryPluginContext>({
  websocket: ws as unknown as WebSocket,
  plugins: [new ClientRetryPlugin()],
});

export const client = createORPCClient<Client>(link);

/**
 * Per-call retry context for streaming procedures. Pass as
 * `{ context: STREAM_RETRY }` on the call options of any event iterator
 * that should survive WebSocket reconnects.
 *
 * Transport errors (WS drop → AsyncIdQueue aborted) retry forever;
 * application errors (`ORPCError`, e.g. `TerminalNotFoundError`) surface
 * immediately so consumers can handle them.
 *
 * Every kolu streaming procedure is snapshot-then-deltas and idempotent
 * on re-subscribe (see server/src/router.ts), so re-invoking on retry
 * transparently resumes with a fresh full state.
 */
export const STREAM_RETRY: ClientRetryPluginContext = {
  retry: Number.POSITIVE_INFINITY,
  retryDelay: 1000,
  shouldRetry: ({ error }) => !(error instanceof ORPCError),
};

// Track WebSocket connection status as a reactive signal
const [wsStatus, setWsStatus] = createSignal<WsStatus>("connecting");
/** True when the server process has changed — app state is stale. */
const [serverRestarted, setServerRestarted] = createSignal(false);
let wasConnected = false;
let knownProcessId: string | null = null;

ws.addEventListener("open", () => {
  setWsStatus("open");
  const isReconnect = wasConnected;
  wasConnected = true;
  // Fetch server identity on every connect to detect restarts
  client.server
    .info()
    .then(({ processId }) => {
      if (isReconnect) {
        if (knownProcessId && processId !== knownProcessId) {
          setServerRestarted(true);
          toast.info("Server updated", {
            description: "Reload to apply the latest version.",
            action: { label: "Reload", onClick: () => location.reload() },
            duration: Infinity,
          });
        } else {
          toast.success("Reconnected to server");
        }
      }
      knownProcessId = processId;
    })
    .catch(() => {
      // Server not fully ready — PartySocket will reconnect and retry
      if (isReconnect) toast.success("Reconnected to server");
    });
});
ws.addEventListener("close", () => {
  setWsStatus("closed");
  if (wasConnected) toast.error("Disconnected from server");
});

export { wsStatus, serverRestarted };
