/**
 * oRPC client: single WebSocket connection to the server.
 *
 * Uses partysocket for auto-reconnect. All terminal procedures
 * (create, attach, sendInput, resize) go through this link.
 */
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  on,
} from "solid-js";
import { match } from "ts-pattern";
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
import type { TerminalId } from "kolu-common";

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
// ClientRetryPlugin with default retry=0 means mutations and one-shot unary
// calls (e.g. server.info, terminal.create, terminal.resize) fail fast with
// no retries. Streaming procedures opt into infinite retry via the private
// STREAM_RETRY context, applied through the `stream` namespace below.
const link = new RPCLink<ClientRetryPluginContext>({
  websocket: ws as unknown as WebSocket,
  plugins: [new ClientRetryPlugin()],
});

export const client = createORPCClient<Client>(link);

/**
 * Private retry context for streaming procedures. Do NOT import directly —
 * route new streaming calls through the `stream` namespace below so
 * adherence is mechanical and impossible to forget.
 *
 * - Transport errors (WS drop → AsyncIdQueue aborted) retry forever.
 * - Application errors (`ORPCError`, e.g. `TerminalNotFoundError`) surface
 *   immediately so consumers can handle them.
 * - Every kolu streaming procedure is snapshot-then-deltas and idempotent
 *   on re-subscribe (see `server/src/router.ts`), so re-invoking on retry
 *   transparently resumes with a fresh full state.
 * - `retryDelay` honors server-sent `lastEventRetry` metadata if present
 *   (none of today's procedures set it; future-proofs the config).
 */
const STREAM_RETRY: ClientRetryPluginContext = {
  retry: Number.POSITIVE_INFINITY,
  retryDelay: (o) => o.lastEventRetry ?? 1000,
  shouldRetry: ({ error }) => !(error instanceof ORPCError),
};

/**
 * Streaming procedure wrappers. Every async-iterator RPC the client
 * cares about goes through here, so `STREAM_RETRY` cannot be forgotten
 * at a call site. Adding a new streaming procedure = adding one entry
 * to this object; adherence is mechanical, not cultural.
 *
 * `attach` takes an `onRetry` callback because the server's first yield
 * after re-attach is a fresh `getScreenState()` snapshot — consumers
 * writing imperatively to xterm.js must clear the buffer before the
 * new snapshot lands, or scrollback double-paints. `onRetry` fires
 * before the retried iterator emits its first item.
 */
export const stream = {
  state: (signal?: AbortSignal) =>
    client.state.get(undefined, { signal, context: STREAM_RETRY }),
  terminalList: (signal?: AbortSignal) =>
    client.terminal.list(undefined, { signal, context: STREAM_RETRY }),
  metadata: (id: TerminalId, signal?: AbortSignal) =>
    client.terminal.onMetadataChange({ id }, { signal, context: STREAM_RETRY }),
  activity: (id: TerminalId, signal?: AbortSignal) =>
    client.terminal.onActivityChange({ id }, { signal, context: STREAM_RETRY }),
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
};

/**
 * Server lifecycle — one signal, one discriminated union, one place to
 * describe every observable state of the client/server connection.
 *
 * Replaces an earlier cluster of `wasConnected`/`knownProcessId` module
 * mutables plus a one-shot `serverRestarted` signal plus scattered toast
 * calls inside ws.on('open')/on('close'). Every UI that cares about the
 * lifecycle (header indicator, dim overlay, session-restore gating,
 * toasts) reads this one signal.
 */
export type ServerLifecycleEvent =
  | { kind: "connecting" }
  | { kind: "connected" }
  | { kind: "disconnected" }
  | { kind: "reconnected" }
  | { kind: "restarted" };

const [lifecycle, setLifecycle] = createSignal<ServerLifecycleEvent>({
  kind: "connecting",
});
export { lifecycle };

/** Backwards-compatible transport-status accessor for the header dot. */
const wsStatus = createMemo<WsStatus>(() =>
  match(lifecycle().kind)
    .with("connecting", () => "connecting" as const)
    .with("disconnected", () => "closed" as const)
    .with("connected", "reconnected", "restarted", () => "open" as const)
    .exhaustive(),
);

/** Backwards-compatible "app state is fatally stale" memo. */
const serverRestarted = createMemo(() => lifecycle().kind === "restarted");

export { wsStatus, serverRestarted };

// Transport observer — translates partysocket open/close events into
// lifecycle transitions. Mutables are scoped inside the IIFE so no module
// state leaks out; every external observer reads `lifecycle()` instead.
(() => {
  let connectCount = 0;
  let knownProcessId: string | null = null;

  ws.addEventListener("open", () => {
    connectCount++;
    const isFirstConnect = connectCount === 1;
    // server.info() uses the plugin default retry=0 (mutations/unary) so
    // it fails fast if the peer isn't ready; partysocket will fire open
    // again on the next successful connect.
    client.server
      .info()
      .then(({ processId }) => {
        if (isFirstConnect) {
          knownProcessId = processId;
          setLifecycle({ kind: "connected" });
          return;
        }
        if (knownProcessId && processId !== knownProcessId) {
          setLifecycle({ kind: "restarted" });
        } else {
          setLifecycle({ kind: "reconnected" });
        }
        knownProcessId = processId;
      })
      .catch((err: unknown) => {
        // Probe failed — don't transition. Partysocket will reconnect
        // and the next successful open will try again. Log so a
        // persistently-broken probe (e.g. server 500 on /rpc/server.info)
        // is diagnosable instead of leaving the UI stuck in "connecting".
        console.warn("server.info probe failed:", err);
      });
  });

  ws.addEventListener("close", () => {
    // Only emit disconnected after the first successful connect — the
    // initial "connecting" phase doesn't count as a drop.
    if (connectCount > 0) setLifecycle({ kind: "disconnected" });
  });
})();

// Toast driver — one effect, pattern-matches lifecycle to user-facing
// messaging. Runs under a root because rpc.ts is a module, not a
// component; the effect lives for the lifetime of the page. In dev,
// the HMR dispose hook tears the old root down so a rpc.ts edit doesn't
// leak stacked reactive owners across hot-reloads.
createRoot((dispose) => {
  createEffect(
    on(
      lifecycle,
      (ev) => {
        match(ev)
          .with({ kind: "disconnected" }, () =>
            toast.error("Disconnected from server"),
          )
          .with({ kind: "reconnected" }, () =>
            toast.success("Reconnected to server"),
          )
          .with({ kind: "restarted" }, () =>
            toast.info("Server updated", {
              description: "Reload to apply the latest version.",
              action: {
                label: "Reload",
                onClick: () => location.reload(),
              },
              duration: Infinity,
            }),
          )
          .with({ kind: "connecting" }, { kind: "connected" }, () => {
            // Silent — no toast for initial boot.
          })
          .exhaustive();
      },
      { defer: true },
    ),
  );
  if (import.meta.hot) import.meta.hot.dispose(() => dispose());
});
