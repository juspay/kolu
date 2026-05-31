/**
 * Server lifecycle: distinguishing connecting / connected / disconnected /
 * reconnected / restarted as a single discriminated union, plus the
 * derived facets (transport status, server process identity) Kolu's UI
 * reads. The `server.info()` probe runs on every WebSocket open and
 * compares the returned process UUID against the last-known one to tell
 * a transient drop ("reconnected") from a server restart ("restarted").
 *
 * Transport setup (PartySocket, typed oRPC client) lives in `../wire.ts`.
 * This file is purely the kolu-shaped lifecycle layer above it: it reads
 * `ws` for transport events and `client.server.info` for identity.
 */

import type { ServerInfo } from "kolu-common/contract";
import { createMemo, createSignal } from "solid-js";
import { match } from "ts-pattern";
import { client, ws } from "../wire";

export type WsStatus = "connecting" | "open" | "closed";

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

/** The full `server.info` reply from the latest probe — carries the server's
 *  commit + the in-process pty-host identity for the ChromeBar's `srv · pty`
 *  rail. `null` until the first probe resolves. */
const [serverInfo, setServerInfo] = createSignal<ServerInfo | null>(null);
export { serverInfo };

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
      .then((info) => {
        setServerInfo(info);
        const { processId } = info;
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
