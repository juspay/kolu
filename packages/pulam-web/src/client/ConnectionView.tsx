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

import type { SurfaceHealth } from "@kolu/surface/solid";
import { HostStatusPip } from "@kolu/surface/solid/HostStatusPip";
import type { ConnectionInfo } from "@kolu/surface-nix-host/connection";
import {
  type Accessor,
  createEffect,
  createSignal,
  type JSX,
  on,
  onCleanup,
  Show,
} from "solid-js";
import { type EffectiveHealth, hostBodyReady } from "./connectionHealth.ts";
import { CONN_STATE, HEALTH_PALETTE } from "./connectionStates.ts";

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

/** The per-host header indicator. Reads the SAME resolved `effectiveHealth` memo
 *  the body gate (`HostGroup`) consumes — the transport-shadows-mirror precedence
 *  lives in that one fold, so the dot and the gate can't disagree about whether a
 *  host is up, and the fold runs once per change with one identity (it allocates
 *  fresh, so a single shared memo is what keeps the five reads below from
 *  re-folding). */
export function HostHealthIndicator(props: {
  /** Presentation: the resolved transport∘mirror fold — the dot's NOT-ready
   *  colors (the rich 5-state amber/red), the label text, and its color. */
  view: () => EffectiveHealth;
  /** The framework FACT — what governs the dot's GREEN, so the honest
   *  connected-or-not color comes from the COMPLETE fact (transport ∧ the mirror
   *  leg, folded by construction), never the raw `connection` cell. */
  fact: Accessor<SurfaceHealth>;
}): JSX.Element {
  const view = props.view;
  return (
    <span
      class="ml-auto flex flex-none items-center gap-1 text-[12px]"
      style={`color:${view().text}`}
    >
      {/* The connection dot is the framework `<HostStatusPip>` — the SAME
          component drishti renders — so the two fleet viewers can't diverge. Its
          GREEN is fact-only: `ready` is the SAME `hostBodyReady` predicate the
          body `<SurfaceGate>` uses (so dot and body agree), and `h.live` carries
          the mirror leg by construction, so a stale `connected` cell can NOT
          paint it green over a dead link. Its NOT-ready color stays pulam-web's
          rich 5-state `effectiveHealth.dot` — except a `degraded` (link up, a sub
          erroring) shows amber rather than the connected green, so the dot never
          reads green while something's broken. */}
      <HostStatusPip
        health={props.fact}
        ready={hostBodyReady}
        readyColor={HEALTH_PALETTE.green}
        notReadyTone={(status) =>
          status === "degraded" ? HEALTH_PALETTE.amber : view().dot
        }
        pulse={view().pending}
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
  health: EffectiveHealth;
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
      <div class="mb-0.5 font-semibold" style={`color:${HEALTH_PALETTE.red}`}>
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
          <div class="mt-2 text-[12px]" style={`color:${HEALTH_PALETTE.red}`}>
            Reconnect request failed: {err()}
          </div>
        )}
      </Show>
    </div>
  );
}
