/**
 * The host body + header indicator for the mirror's connection health — the
 * honest replacement for the old "green dot + no terminals" lie.
 *
 * pulam-web is browser ⇄ backend ⇄ remote pulam (over ssh). TWO links can be
 * down independently: the browser↔backend ws (the transport `status`) and the
 * backend↔remote mirror (the `connection` cell, off `session.onState`). The
 * dashboard must gate "show the terminal list" on the MIRROR being connected,
 * never on the transport socket alone — conflating them is the bug this fixes.
 *
 *   - `HostHealthIndicator` — the header dot: transport trouble takes
 *     precedence (a dead ws makes the mirror cell stale), else it paints the
 *     mirror's `connection.state`.
 *   - `ConnectionView` — the body for every NON-`connected` mirror state: an
 *     honest connecting / provisioning / reconnecting line, or — on terminal
 *     `failed` — the real error + the link-log tail + a Reconnect button.
 */

import type { ConnectionInfo } from "@kolu/surface-nix-host/connection";
import type { SurfaceConnectionStatus } from "@kolu/surface-app/solid";
import {
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { CONN_STATE, disconnectedMessage } from "./connectionStates.ts";

/** Re-arm a host's parent session — the only recovery from terminal `failed`
 *  short of a page reload. Hits the parent's reconnect route, which calls
 *  `registry.getSession(host).reconnect()`. */
async function requestReconnect(host: string): Promise<void> {
  await fetch(`/api/reconnect?host=${encodeURIComponent(host)}`, {
    method: "POST",
  });
}

/** The per-host header indicator. Transport (browser↔backend ws) trouble takes
 *  precedence — if the pipe to the backend is down/reconnecting the mirror cell
 *  is stale, so report the pipe first; otherwise paint the MIRROR's health. */
export function HostHealthIndicator(props: {
  status: () => SurfaceConnectionStatus;
  info: () => ConnectionInfo;
}): JSX.Element {
  const view = (): {
    dot: string;
    text: string;
    label: string;
    pending: boolean;
  } => {
    const s = props.status();
    if (s === "down")
      return {
        dot: "#ff8d8d",
        text: "#ff8d8d",
        label: "disconnected — reload",
        pending: false,
      };
    if (s === "reconnecting")
      return {
        dot: "#e6a23c",
        text: "#e6a23c",
        label: "reconnecting…",
        pending: true,
      };
    // Transport live/connecting → the MIRROR's health is the real signal.
    const p = CONN_STATE[props.info().state];
    return { dot: p.dot, text: p.text, label: p.label, pending: p.pending };
  };
  return (
    <span
      class="ml-auto flex flex-none items-center gap-1 text-[12px]"
      style={`color:${view().text}`}
    >
      <span
        class="inline-block h-1.5 w-1.5 rounded-full"
        classList={{ "motion-safe:animate-pulse": view().pending }}
        style={`background:${view().dot}`}
        title={view().label}
      />
      {/* A healthy host reads as a bare green dot (no label), like the Dock. */}
      <Show when={view().label !== "connected"}>{view().label}</Show>
    </span>
  );
}

/** The host body for every NON-`connected` mirror state. Replaces the old
 *  "no terminals" lie a downed mirror used to paint. */
export function ConnectionView(props: {
  info: ConnectionInfo;
  host: string;
}): JSX.Element {
  const state = (): ConnectionInfo["state"] => props.info.state;
  const pres = () => CONN_STATE[state()];
  const message = (): string =>
    state() === "disconnected"
      ? disconnectedMessage(props.info.failureCause)
      : pres().message;

  // Seconds in the CURRENT pending state — reset on every state change, so it
  // counts time-in-this-phase. A connect that drags ("Connecting… 18s") reads
  // as abnormal before the parent's watchdog trips it to `failed`.
  const [elapsed, setElapsed] = createSignal(0);
  createEffect(
    on(state, (s) => {
      setElapsed(0);
      if (!CONN_STATE[s].pending) return;
      const startedAt = performance.now();
      const id = setInterval(
        () => setElapsed(Math.floor((performance.now() - startedAt) / 1000)),
        1000,
      );
      onCleanup(() => clearInterval(id));
    }),
  );

  return (
    <div class="p-3">
      <Show
        when={state() === "failed"}
        fallback={
          <div class="text-[13px]">
            <span style={`color:${pres().text}`}>{message()}</span>
            <Show when={pres().pending && elapsed() >= 1}>
              <span class="text-[#5b6678]"> {elapsed()}s</span>
            </Show>
            <Show when={state() === "copying"}>
              <span class="text-[#5b6678]"> (nix copy)</span>
            </Show>
          </div>
        }
      >
        <FailedCard info={props.info} host={props.host} />
      </Show>
    </div>
  );
}

/** Terminal-failure card: the real error, the link-log tail, and a Reconnect
 *  button. Shown when `connection.state === "failed"`. */
function FailedCard(props: {
  info: ConnectionInfo;
  host: string;
}): JSX.Element {
  const [reconnecting, setReconnecting] = createSignal(false);
  const logTail = (): readonly string[] => props.info.progressLines.slice(-8);
  const onReconnect = (): void => {
    setReconnecting(true);
    void requestReconnect(props.host).finally(() => setReconnecting(false));
  };
  return (
    <div class="rounded-md border border-[#e06c75]/40 bg-[#e06c75]/[0.06] p-3 text-left">
      <div class="mb-0.5 font-semibold text-[#ff8d8d]">
        Couldn't reach this host
      </div>
      <div class="mb-2 text-[12px] text-[#5b6678]">
        Gave up after repeated connection failures.
      </div>
      <Show when={props.info.lastError}>
        {(err) => (
          <pre class="mb-2 overflow-x-auto whitespace-pre-wrap rounded bg-[#0b0d12] p-2 text-[12px] text-[#c7b8b8]">
            {err()}
          </pre>
        )}
      </Show>
      <Show when={logTail().length > 0}>
        <div class="mb-1 text-[12px] text-[#5b6678]">Connection log</div>
        <pre class="mb-2 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[#0b0d12] p-2 text-[12px] text-[#8b94a6]">
          {logTail().join("\n")}
        </pre>
      </Show>
      <button
        type="button"
        onClick={onReconnect}
        disabled={reconnecting()}
        class="rounded border border-[#38507a] px-2.5 py-1 text-[12px] text-[#9fb4d8] hover:border-[#7ec699] disabled:opacity-50"
      >
        {reconnecting() ? "reconnecting…" : "↻ Reconnect"}
      </button>
    </div>
  );
}
