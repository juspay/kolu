/**
 * oRPC client: single WebSocket connection to the server.
 *
 * Uses partysocket for auto-reconnect. All terminal procedures
 * (create, attach, sendInput, resize) go through this link.
 */
import { createSignal } from "solid-js";
import { createORPCClient } from "@orpc/client";
import { RPCLink } from "@orpc/client/websocket";
import { WebSocket as PartySocket } from "partysocket";
import { toast } from "solid-sonner";
import type { ContractRouterClient } from "@orpc/contract";
import type { contract } from "kolu-common/contract";

export type WsStatus = "connecting" | "open" | "closed";

type Client = ContractRouterClient<typeof contract>;

const { protocol, host } = window.location;
const wsUrl = `${protocol === "https:" ? "wss:" : "ws:"}//${host}/rpc/ws`;

const ws = new PartySocket(wsUrl);

// Cast: PartySocket is API-compatible with WebSocket but types don't overlap
const link = new RPCLink({ websocket: ws as unknown as WebSocket });

export const client = createORPCClient<Client>(link);

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
