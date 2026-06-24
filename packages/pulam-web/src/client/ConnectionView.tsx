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

/** WHICH leg the resolved health came from — so a consumer can tell a real
 *  mirror failure (the host gave up; show the error card + Reconnect) apart from
 *  a transport-shadowed one (the dashboard ws died; show "reload"), even though
 *  both resolve to `state: "failed"`. The body gate keys the FailedCard on
 *  `source === "mirror"` so a transport-down host whose stale mirror cell still
 *  reads `failed` never paints a stale error + a Reconnect that can't run. */
export type HealthSource = "transport" | "mirror";

/** The single fold over BOTH volatility axes — the browser↔backend transport
 *  (`status`) and the backend↔remote mirror (`info.state`) — into one resolved
 *  health. The precedence is "transport trouble shadows the mirror": a `down` or
 *  `reconnecting` ws makes the mirror cell stale, so report the pipe first; on a
 *  live/connecting pipe the mirror IS the real signal. Resolves to a `state` so
 *  one consumer ("is this host effectively connected?") and the header dot read
 *  the SAME answer — `down`/`reconnecting` resolve to a non-`connected` state so
 *  a transport-down host can never read as connected. It also carries `source`
 *  (transport vs mirror) so the body can render the FailedCard only for a REAL
 *  mirror failure, not a transport-shadowed one. Both `HostHealthIndicator` and
 *  `HostGroup`'s body gate consume this; the precedence lives here, once. */
export function effectiveHealth(
  status: SurfaceConnectionStatus,
  info: ConnectionInfo,
): ConnPresentation & { state: ConnectionState; source: HealthSource } {
  if (status === "down")
    return {
      state: "failed",
      source: "transport",
      dot: "#ff8d8d",
      text: "#ff8d8d",
      label: "disconnected — reload",
      message: "Lost the connection to the dashboard. Reload to reconnect.",
      pending: false,
    };
  if (status === "reconnecting")
    return {
      state: "disconnected",
      source: "transport",
      dot: "#e6a23c",
      text: "#e6a23c",
      label: "reconnecting…",
      message: "Reconnecting to the dashboard…",
      pending: true,
    };
  // Transport live/connecting → the MIRROR's health is the real signal.
  return { state: info.state, source: "mirror", ...CONN_STATE[info.state] };
}

/** Re-arm a host's parent session — the only recovery from terminal `failed`
 *  short of a page reload. Hits the parent's reconnect route, which calls
 *  `registry.getSession(host).reconnect()`. THROWS on a non-2xx response (or a
 *  dead HTTP leg, which rejects `fetch` itself) so the caller can surface the
 *  failure — a silent drop would leave the user thinking the re-arm took. */
async function requestReconnect(host: string): Promise<void> {
  const response = await fetch(
    `/api/reconnect?host=${encodeURIComponent(host)}`,
    { method: "POST" },
  );
  if (!response.ok) {
    // Prefer the route's own `{ error }` body (a 404 unknown-host, sent as JSON
    // by `/api/reconnect`) — parse the JSON and pull `.error` out so the user
    // sees "unknown host: …", not the raw `{"error":"unknown host: …"}`. Fall
    // back to the body text, then to the status line, when it isn't that shape.
    const raw = await response.text().catch(() => "");
    const detail = parseReconnectError(raw);
    throw new Error(
      detail.length > 0
        ? detail
        : `reconnect failed (${response.status} ${response.statusText})`,
    );
  }
}

/** Pull a human message out of a reconnect error body. The route sends JSON
 *  (`{ error: "unknown host: …" }`); read `.error` when the body parses to that
 *  shape, else return the raw text unchanged (an empty/odd body falls through to
 *  the status line in the caller). */
function parseReconnectError(raw: string): string {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "error" in parsed &&
      typeof (parsed as { error: unknown }).error === "string"
    ) {
      return (parsed as { error: string }).error;
    }
  } catch {
    // Not JSON — fall through to the raw text.
  }
  return raw;
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
 *  (`health.state === "failed" && health.source === "mirror"`) — NOT on the raw
 *  `info.state`. When the transport is `down`, the effective health is a
 *  transport `failed` ("reload"); a stale mirror cell that still reads `failed`
 *  must NOT then surface its old error + a Reconnect button that can't run while
 *  the dashboard ws is dead — the `source` discriminator is what splits them. */
export function ConnectionView(props: {
  health: ConnPresentation & { state: ConnectionState; source: HealthSource };
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
        when={
          props.health.state === "failed" && props.health.source === "mirror"
        }
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
  // The reconnect request's OWN error (the route 404'd, the server 500'd, or the
  // HTTP leg is dead) — distinct from the mirror `lastError` above. Surfaced
  // inline so a failed re-arm isn't silently swallowed; cleared on each retry.
  const [reconnectError, setReconnectError] = createSignal<string | null>(null);
  const logTail = (): readonly string[] => props.info.progressLines.slice(-8);
  const onReconnect = (): void => {
    setReconnecting(true);
    setReconnectError(null);
    requestReconnect(props.host)
      .catch((err: unknown) =>
        setReconnectError(err instanceof Error ? err.message : String(err)),
      )
      .finally(() => setReconnecting(false));
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
      <Show when={reconnectError()}>
        {(err) => (
          <div class="mt-2 text-[12px] text-[#ff8d8d]">
            Reconnect request failed: {err()}
          </div>
        )}
      </Show>
    </div>
  );
}
