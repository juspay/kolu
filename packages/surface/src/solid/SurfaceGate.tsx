/**
 * `<SurfaceGate>` — the ONE place subscription-health POLICY lives.
 *
 * `client.health()` (`./health`) is a FACT: `{ live, subs: [{ pending, error }] }`,
 * no triage, no copy. This component is the VERDICT — it derives
 * `connecting | degraded | ready` from the fact and renders accordingly.
 * Splitting fact from verdict is deliberate: two consumers legitimately disagree
 * on the verdict, so the policy is a per-app decision the `ready`/`fallback`/
 * `degraded` props override — while the FACT, and its un-latchable self-clearing,
 * stay framework-owned. Mounting this is what lets every consumer DELETE the
 * hand-rolled error fold that latched in #1564.
 *
 * The DEFAULT policy is **stale-while-degraded**, the gentler of the two the
 * design weighed and the one it judged better: a transient sub error (degraded)
 * keeps the last-good children ON SCREEN with a non-blocking notice, rather than
 * blanking the whole surface over a blip — a stale roster beats a blank one.
 * HARD-GATING (blank the surface the instant anything errors) is the harsher
 * policy, so it is the explicit OPT-IN: pass `ready={(h) => gateStatus(h) ===
 * "ready"}` (or a stricter app predicate, as pulam-web's fleet board does — a
 * dashboard must not paint a stale roster over a broken link). A consumer that
 * overrides `ready` owns the whole not-ready surface via `fallback`; the default
 * `degraded` notice applies only under the default policy.
 *
 * `health` is an accessor, so one `<SurfaceGate health={app.health}>` covers a
 * single surface and `<SurfaceGate health={() => surfaceClientsHealth(clients)}>`
 * a composed/multi-surface app (the Leak D shape) with no API difference.
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
   *  `() => surfaceClientsHealth(clients)` for a composed app (Leak D). */
  health: Accessor<SurfaceHealth>;
  /** Rendered while the surface is ready — and, under the default policy, also
   *  while DEGRADED (stale-while-degraded), alongside the `degraded` notice. */
  children: JSX.Element;
  /** Override the readiness predicate. Default: stale-while-degraded —
   *  `gateStatus(h) !== "connecting"`, so a degraded surface keeps rendering its
   *  children. Pass `(h) => gateStatus(h) === "ready"` to HARD-GATE (blank on
   *  degraded), or a stricter predicate for app policy. A custom `ready` is
   *  BINARY — children when it returns true, `fallback` otherwise — so it owns
   *  the whole not-ready surface and the default `degraded` notice is not used. */
  ready?: (health: SurfaceHealth) => boolean;
  /** Render the not-ready (default: connecting) state. Receives the LIVE health
   *  accessor (not a snapshot) so the fallback stays reactive — `connecting →
   *  degraded` and a changing error message update in place. Default: a minimal
   *  honest line. NOTE: the default fallback surfaces the RAW server error text
   *  (e.g. a literal "Internal server error") when a hard-gate consumer reuses
   *  it; an app that must scrub that supplies its own `fallback`. */
  fallback?: (health: Accessor<SurfaceHealth>) => JSX.Element;
  /** Under the DEFAULT policy only: the NON-blocking notice shown ALONGSIDE the
   *  children while degraded (live + past first-frame, but a sub is erroring), so
   *  a stale view isn't SILENTLY stale. Receives the live accessor, so it
   *  self-clears the instant the fact recovers. Default: a slim strip naming the
   *  first error — which is RAW server text; supply your own to scrub it. Ignored
   *  when a custom `ready` is set (that policy owns its own not-ready UX). */
  degraded?: (health: Accessor<SurfaceHealth>) => JSX.Element;
}

/** Gate children on a surface being ready; render a fallback otherwise. */
export function SurfaceGate(props: SurfaceGateProps): JSX.Element {
  const status = createMemo(() => gateStatus(props.health()));
  const isReady = createMemo(() =>
    props.ready ? props.ready(props.health()) : status() !== "connecting",
  );
  return (
    <Show
      when={isReady()}
      fallback={(props.fallback ?? defaultFallback)(props.health)}
    >
      {props.children}
      {/* Under the DEFAULT policy (stale-while-degraded), surface a non-blocking
          degraded notice next to the children so a stale view announces itself.
          A custom `ready` owns its own not-ready UX (its `fallback`), so skip the
          notice then — `!props.ready` gates it to the default policy only. */}
      <Show when={!props.ready && status() === "degraded"}>
        {(props.degraded ?? defaultDegradedNotice)(props.health)}
      </Show>
    </Show>
  );
}

const defaultFallback = (health: Accessor<SurfaceHealth>): JSX.Element => (
  <DefaultGateFallback health={health} />
);

const defaultDegradedNotice = (
  health: Accessor<SurfaceHealth>,
): JSX.Element => <DefaultDegradedNotice health={health} />;

/** The minimal built-in not-ready view — intentionally unstyled and terse; apps
 *  pass their own `fallback` for anything richer. Reads the live accessor, so it
 *  shifts from "Connecting…" to the degraded line (with the first sub error) as
 *  the fact changes, without remounting.
 *
 *  Under the default policy this only renders while `connecting`; the degraded
 *  branch is reached only when a HARD-GATE consumer reuses this default fallback.
 *  It echoes the RAW server `error.message` (the same `#1564` "Internal server
 *  error" string can land here — self-clearing now, so a matter of degree, not
 *  kind); an app that must scrub server text supplies its own `fallback`. */
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

/** The minimal built-in DEGRADED notice — a non-blocking strip rendered beside
 *  the (still-visible) children under the default stale-while-degraded policy.
 *  Like {@link DefaultGateFallback}, it echoes the RAW server `error.message`;
 *  an app that must scrub server text supplies its own `degraded`. Self-clears
 *  the instant the fact recovers (the underlying `error()` un-latches). */
function DefaultDegradedNotice(props: {
  health: Accessor<SurfaceHealth>;
}): JSX.Element {
  const firstError = createMemo(
    () => props.health().subs.find((s) => s.error)?.error?.message,
  );
  return (
    <div role="status" aria-live="polite">
      <span>Reconnecting…{firstError() ? ` (${firstError()})` : ""}</span>
    </div>
  );
}
