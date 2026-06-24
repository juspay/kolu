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

import type {
  ConnectionInfo,
  ConnectionState,
} from "@kolu/surface-nix-host/connection";
import type { SurfaceConnectionStatus } from "@kolu/surface-app/solid";
import {
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { CONN_STATE, type ConnPresentation } from "./connectionStates.ts";

/** The single fold over BOTH volatility axes — the browser↔backend transport
 *  (`status`) and the backend↔remote mirror (`info.state`) — into one resolved
 *  health. The precedence is "transport trouble shadows the mirror": a `down` or
 *  `reconnecting` ws makes the mirror cell stale, so report the pipe first; on a
 *  live/connecting pipe the mirror IS the real signal. Resolves to a `state` so
 *  one consumer ("is this host effectively connected?") and the header dot read
 *  the SAME answer — `down`/`reconnecting` resolve to a non-`connected` state so
 *  a transport-down host can never read as connected. Both `HostHealthIndicator`
 *  and `HostGroup`'s body gate consume this; the precedence lives here, once. */
export function effectiveHealth(
  status: SurfaceConnectionStatus,
  info: ConnectionInfo,
): ConnPresentation & { state: ConnectionState } {
  if (status === "down")
    return {
      state: "failed",
      dot: "#ff8d8d",
      text: "#ff8d8d",
      label: "disconnected — reload",
      message: "Lost the connection to the dashboard. Reload to reconnect.",
      pending: false,
    };
  if (status === "reconnecting")
    return {
      state: "disconnected",
      dot: "#e6a23c",
      text: "#e6a23c",
      label: "reconnecting…",
      message: "Reconnecting to the dashboard…",
      pending: true,
    };
  // Transport live/connecting → the MIRROR's health is the real signal.
  return { state: info.state, ...CONN_STATE[info.state] };
}

/** Re-arm a host's parent session — the only recovery from terminal `failed`
 *  short of a page reload. Hits the parent's reconnect route, which calls
 *  `registry.getSession(host).reconnect()`. */
async function requestReconnect(host: string): Promise<void> {
  await fetch(`/api/reconnect?host=${encodeURIComponent(host)}`, {
    method: "POST",
  });
}

/** The per-host header indicator. Paints the single `effectiveHealth` fold —
 *  the transport-shadows-mirror precedence lives there, not here, so the dot and
 *  the body gate (`HostGroup`) can't disagree about whether a host is up. */
export function HostHealthIndicator(props: {
  status: () => SurfaceConnectionStatus;
  info: () => ConnectionInfo;
}): JSX.Element {
  const view = () => effectiveHealth(props.status(), props.info());
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

/** The host body for every NON-`connected` state. Renders off the EFFECTIVE
 *  `health` (the transport ∘ mirror fold), NOT the raw mirror cell — so a
 *  transport-`down` host whose mirror cell is stale at `connected` reads
 *  "Lost the connection… reload", never a stale "Connected." The failed CARD
 *  (real error + log + Reconnect) keys on a genuine MIRROR failure
 *  (`info.state === "failed"`), the only state that carries those details. */
export function ConnectionView(props: {
  health: ConnPresentation & { state: ConnectionState };
  info: ConnectionInfo;
  host: string;
}): JSX.Element {
  // The body line, off the effective row: a row that varies on `failureCause`
  // carries it as `messageFor` (today only the mirror's `disconnected`); the
  // transport rows have none, so the `?? message` covers them uniformly.
  const message = (): string =>
    props.health.messageFor?.(props.info.failureCause) ?? props.health.message;

  // Seconds in the CURRENT pending phase — reset on every effective-state
  // change, so it counts time-in-this-phase. A connect that drags
  // ("Connecting… 18s") reads as abnormal before the parent's watchdog trips it.
  const [elapsed, setElapsed] = createSignal(0);
  createEffect(
    on(
      () => props.health.state,
      () => {
        setElapsed(0);
        if (!props.health.pending) return;
        const startedAt = performance.now();
        const id = setInterval(
          () => setElapsed(Math.floor((performance.now() - startedAt) / 1000)),
          1000,
        );
        onCleanup(() => clearInterval(id));
      },
    ),
  );

  return (
    <div class="p-3">
      <Show
        when={props.info.state === "failed"}
        fallback={
          <div class="text-[13px]">
            <span style={`color:${props.health.text}`}>{message()}</span>
            <Show when={props.health.pending && elapsed() >= 1}>
              <span class="text-[#5b6678]"> {elapsed()}s</span>
            </Show>
            <Show when={props.health.state === "copying"}>
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
        {CONN_STATE.failed.message}
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
