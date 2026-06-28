/**
 * `<HostStatusPip>` — the ONE connection dot, colored from the COMPLETE health
 * FACT and nothing else (the round-5 "single-source the display" collapse).
 *
 * Every prior round, a status dot was painted from a signal NARROWER than the
 * truth it claimed — the browser↔backend ws alone, then `health().live` without
 * the mirror, then drishti's raw `connection.state` over a dead transport. The
 * cure isn't "fold the missing leg in at this dot too" (whack-a-mole against
 * forgetting); it is to make a green-over-a-dead-link dot UNRENDERABLE. So:
 *
 *   - the GREEN ("ready") color is emitted ONLY in the `gateStatus(health()) ===
 *     "ready"` branch — the SAME verdict `<SurfaceGate>` gates the body on
 *     (`gateStatus` lives in the JSX-free `./health`, read by both), so the dot's
 *     green and the body's "show it" are one decision that cannot diverge; and
 *   - the not-ready color comes from {@link HostStatusPipProps.notReadyTone},
 *     whose ARGUMENT is typed `Exclude<GateStatus, "ready">`. The type stops the
 *     green from the argument, but the RETURN is an unconstrained string, so an app
 *     CAN hand back the ready color (the round-5-found hole — pulam-web's
 *     transport∘mirror-only tone was green for a connected link). So the component
 *     ENFORCES the invariant: a not-ready tone equal to `readyColor` is REFUSED
 *     (it throws) rather than painted — green is fact-only by construction, not by
 *     convention. There is no raw-state / cell prop: the only thing this component
 *     reads is the folded fact.
 *
 * The dot owns exactly one pixel of truth — the honest connected-or-not color.
 * An app keeps all its richer PRESENTATION (a 5-state "provisioning…/reconnecting…"
 * label, a failed card, transport-shadow precedence) AROUND the pip, reading its
 * own cell/effectiveHealth — none of which can paint the dot green, because the
 * green branch is fact-only. `health` is an accessor, so one pip covers a single
 * surface (`health={client.health}`) or a composed app
 * (`health={() => surfaceClientsHealth(clients)}`) with no API difference.
 *
 * Shipped from its OWN entry (`@kolu/surface/solid/HostStatusPip`), NOT the
 * JSX-free `@kolu/surface/solid` barrel — like `<SurfaceGate>` — so a consumer
 * importing the barrel for hooks never has to Solid-transform a component it
 * doesn't use.
 */

import { type Accessor, createMemo, type JSX } from "solid-js";
import { type GateStatus, gateStatus, type SurfaceHealth } from "./health";

/** The framework's neutral defaults — apps pass `readyColor`/`notReadyTone` to
 *  match their palette. Green is reachable ONLY as the ready color. */
const DEFAULT_READY_COLOR = "#7ec699";
const DEFAULT_NOT_READY_COLOR = "#e6a23c";

export interface HostStatusPipProps {
  /** The health FACT accessor — `client.health` for one surface, or
   *  `() => surfaceClientsHealth(clients)` for a composed app. The dot reads
   *  ONLY this; there is no raw-state prop, so the fact is the sole truth. */
  health: Accessor<SurfaceHealth>;
  /** The "good color" predicate — the SAME decision the body gate uses, so the
   *  dot's green and `<SurfaceGate>`'s "show it" can't diverge. Default:
   *  `gateStatus(h) === "ready"` (fully ready: live ∧ no pending ∧ no error). An
   *  app whose gate ignores `pending` (a body with its own internal loading
   *  states, like pulam-web) passes the SAME predicate it gives `<SurfaceGate
   *  ready>` — e.g. `(h) => h.live && !h.subs.some((s) => s.error)` — so dot and
   *  gate agree. Whatever the predicate, it reads the FACT (`h.live` carries the
   *  mirror leg by construction); there is no raw-cell input, so green is never
   *  paintable from a stale `.state`. And green is FLOORED on `h.live` regardless of
   *  this predicate: a `ready` that drops the `h.live &&` conjunct (or `() => true`)
   *  can only REFINE green WITHIN a live link, never claim it over a `live:false`
   *  fact — so the dot's green is fact-floored even against a buggy predicate. */
  ready?: (health: SurfaceHealth) => boolean;
  /** The dot color when `ready` holds — the ONLY path to a "good" color.
   *  Default: a framework green. */
  readyColor?: string;
  /** The dot color for a NOT-ready fact. Receives `Exclude<GateStatus, "ready">`
   *  (`"connecting" | "degraded"`), so an app can tint reconnecting vs erroring —
   *  or read its own richer presentation in the closure for a 5-state amber/red.
   *  It MUST NOT return `readyColor`: green is fact-only, and a tone equal to the
   *  ready color is REFUSED (the component throws) rather than painted. A closure
   *  reading a transport∘mirror presentation (e.g. an `effectiveHealth(...).dot`
   *  that is green when the mirror is connected) MUST clamp its connected-green to
   *  a not-ready tone — `() => v.dot === green ? amber : v.dot` — never pass the raw
   *  green straight through (the round-5-found hole). Default: a framework amber. */
  notReadyTone?: (status: Exclude<GateStatus, "ready">) => string;
  /** Pulse the dot while not ready (a living "reconnecting" cue). Default `true`. */
  pulse?: boolean;
  /** Extra classes on the dot span (sizing/spacing live with the app). */
  class?: string;
  /** Tooltip + `aria-label` (e.g. the app's rich status label). */
  title?: string;
}

/** The fact-governed connection dot. Green ⇔ the `ready` predicate (default
 *  `gateStatus(health()) === "ready"`) holds over the FACT; every other state is
 *  `notReadyTone`'s, which is REFUSED (throws) if it equals `readyColor`, so the
 *  green is fact-only by construction, not by convention. */
export function HostStatusPip(props: HostStatusPipProps): JSX.Element {
  const status = createMemo(() => gateStatus(props.health()));
  const ready = createMemo(() => {
    // Green requires a LIVE fact, FLOORED here so it can't be overridden: a custom
    // `ready` predicate may only REFINE the verdict WITHIN a live link (withhold
    // green — pulam-web ignores `pending`), NEVER claim ready over a `live:false`
    // fact. The default branch (`gateStatus(h) === "ready"`) already implies live;
    // the explicit `h.live` floor catches a CUSTOM predicate that dropped the
    // conjunct (or a blunt `() => true`), so green is fact-FLOORED, not merely
    // fact-derived — the #1564 green-over-a-dead-link lie has no `ready`-prop escape.
    const h = props.health();
    if (!h.live) return false;
    return props.ready ? props.ready(h) : status() === "ready";
  });
  // The verdict actually RENDERED: `ready` when the predicate holds; otherwise
  // the fact's coarse status, clamped off `ready` so a STRICTER custom predicate
  // (one that withholds green while `gateStatus` already says ready) still reads
  // as not-good (`degraded`) and keeps `notReadyTone`'s argument sound.
  const display = createMemo<GateStatus>(() => {
    if (ready()) return "ready";
    const s = status();
    return s === "ready" ? "degraded" : s;
  });
  const color = createMemo(() => {
    const readyColor = props.readyColor ?? DEFAULT_READY_COLOR;
    if (display() === "ready") return readyColor;
    // The `notReadyTone` ARGUMENT is typed `Exclude<GateStatus,"ready">`, but its
    // RETURN is an unconstrained string — so an app CAN hand back the ready color
    // here (the round-5-found hole: pulam-web's transport∘mirror-only tone was
    // green for a connected link, so a degraded host with a pending sibling painted
    // a green dot while a sub was silently dead). The type stops the green from the
    // ARGUMENT, not the RETURN — so the component enforces it: a not-ready tone that
    // equals the ready color is REFUSED loudly (a misconfigured tone is a defect,
    // not a state to silently degrade) rather than emit the one green this component
    // makes fact-only over a fact that reports the link down.
    const notReady = display() as Exclude<GateStatus, "ready">;
    const tone = props.notReadyTone
      ? props.notReadyTone(notReady)
      : DEFAULT_NOT_READY_COLOR;
    if (tone === readyColor) {
      throw new Error(
        `HostStatusPip: notReadyTone returned the readyColor ("${tone}") for a ` +
          `"${notReady}" (not-ready) fact. Green is emitted ONLY from the fact's ` +
          `ready verdict; a not-ready tone must be visually distinct, so a dot can ` +
          `never read green over a link the fact reports down.`,
      );
    }
    return tone;
  });
  return (
    <span
      class={`inline-block h-1.5 w-1.5 rounded-full ${props.class ?? ""}`}
      classList={{
        "motion-safe:animate-pulse":
          (props.pulse ?? true) && display() !== "ready",
      }}
      style={{ background: color() }}
      // The folded verdict, exposed for CSS theming — green is CSS-ownable via
      // `[data-health="ready"]` without an app being able to set it imperatively.
      data-health={display()}
      // A status dot is an image-with-a-text-alternative (the rich label), not an
      // interactive control — `role="img"` is what makes `aria-label` valid on the
      // span and gives a screen reader the connection state.
      role="img"
      title={props.title}
      aria-label={props.title}
    />
  );
}
