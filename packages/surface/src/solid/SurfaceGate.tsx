/**
 * `<SurfaceGate>` — the ONE place subscription-health POLICY lives.
 *
 * `client.health()` (`./health`) is a FACT: `{ live, subs: [{ pending, error }] }`,
 * no triage, no copy. This component is the VERDICT — it derives
 * `connecting | degraded | ready` from the fact and renders its children only
 * when ready, else a fallback. Splitting fact from verdict is deliberate: two
 * consumers legitimately disagree on the verdict (drishti keeps rendering while
 * degraded + toasts; pulam-web hard-gates), so the policy is a per-app decision
 * the `ready`/`fallback` props override — while the FACT, and its un-latchable
 * self-clearing, stay framework-owned. Mounting this is what lets every consumer
 * DELETE the hand-rolled error fold that latched in #1564.
 *
 * `health` is an accessor, so one `<SurfaceGate health={app.health}>` covers a
 * single surface and `<SurfaceGate health={() => mergeSurfaceHealth(...)}>` a
 * composed/multi-surface app (the Leak D shape) with no API difference.
 */

import { type Accessor, createMemo, type JSX, Show } from "solid-js";
import type { SurfaceHealth } from "./health";

/** The readiness verdict derived from a health fact. */
export type GateStatus = "connecting" | "degraded" | "ready";

/** Derive the default verdict from the health FACT:
 *   - `connecting` — the transport isn't live, OR some subscription is still
 *     waiting for its first frame (a fresh or reconnecting surface);
 *   - `degraded`  — live and past first-frame, but some subscription is erroring;
 *   - `ready`     — live, every sub past first-frame, none erroring.
 *  This is POLICY: an app overrides it via `<SurfaceGate ready={…}>`. Exported so
 *  a consumer can reuse the same triage when rendering its own fallback. */
export function gateStatus(health: SurfaceHealth): GateStatus {
  if (!health.live || health.subs.some((s) => s.pending)) return "connecting";
  if (health.subs.some((s) => s.error)) return "degraded";
  return "ready";
}

export interface SurfaceGateProps {
  /** The health FACT accessor — `client.health` for one surface, or
   *  `() => mergeSurfaceHealth(entries)` for a composed app (Leak D). */
  health: Accessor<SurfaceHealth>;
  /** Rendered only when the surface is ready. */
  children: JSX.Element;
  /** Override the readiness predicate. Default: `gateStatus(h) === "ready"`. */
  ready?: (health: SurfaceHealth) => boolean;
  /** Render the not-ready state. Receives the LIVE health accessor (not a
   *  snapshot) so the fallback stays reactive — `connecting → degraded` and a
   *  changing error message update in place. Default: a minimal honest line. */
  fallback?: (health: Accessor<SurfaceHealth>) => JSX.Element;
}

/** Gate children on a surface being ready; render a fallback otherwise. */
export function SurfaceGate(props: SurfaceGateProps): JSX.Element {
  const isReady = createMemo(() =>
    props.ready
      ? props.ready(props.health())
      : gateStatus(props.health()) === "ready",
  );
  return (
    <Show
      when={isReady()}
      fallback={(props.fallback ?? defaultFallback)(props.health)}
    >
      {props.children}
    </Show>
  );
}

const defaultFallback = (health: Accessor<SurfaceHealth>): JSX.Element => (
  <DefaultGateFallback health={health} />
);

/** The minimal built-in not-ready view — intentionally unstyled and terse; apps
 *  pass their own `fallback` for anything richer. Reads the live accessor, so it
 *  shifts from "Connecting…" to the degraded line (with the first sub error) as
 *  the fact changes, without remounting. */
function DefaultGateFallback(props: {
  health: Accessor<SurfaceHealth>;
}): JSX.Element {
  const degraded = createMemo(() => gateStatus(props.health()) === "degraded");
  const firstError = createMemo(
    () => props.health().subs.find((s) => s.error)?.error?.message,
  );
  return (
    <div role="status" aria-live="polite">
      <Show when={degraded()} fallback={<span>Connecting…</span>}>
        <span>
          Something isn't responding{firstError() ? `: ${firstError()}` : ""}
        </span>
      </Show>
    </div>
  );
}
