/** The pure phase → narration mapping for the connect overlay (W6 — "the honest
 *  connect"). Kept dependency-free so the copy + the "which phases show a live tail"
 *  decision are unit-testable without mounting the connection-cell subscription
 *  (see `connectCanvasCopy.test.ts`).
 *
 *  The up-but-not-yet-connected phases narrate here — the ssh connector's atomic
 *  `provisioning` phase (one Nix lifetime for evaluation, transfer, and remote
 *  build) and the brief post-provision `connecting` handshake — plus the reconnect
 *  backoff (`disconnected` while the map keeps the entry warming). `connected` needs
 *  no overlay (the workspace shows); a standing refusal and a terminal `failed` are
 *  owned by the Skew-UX host-down card (a second failure surface is exactly what
 *  this must not build). */

// The phases the connect overlay narrates ride the framework's own `ConnectPhase` (exported
// beside `ConnectionInfo`, its honest owner) — imported through kolu-common's established
// re-export, NOT re-listed here. Adding an `SshProv` provisioning phase then fails
// {@link connectCanvasCopy}'s switch to compile (missing case) — the drift signal.
import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import { match, P } from "ts-pattern";

export interface ConnectCopy {
  /** The headline line. ConnectCanvas renders the live `log` tail from the frame's own
   *  DATA (a non-empty log), never from a phase flag — so the `probing` window narrates
   *  its real "checking for a cached agent…" log the instant it arrives, instead of a
   *  silent wait. */
  title: string;
  /** Does the elapsed timer run for this phase? The ONE per-phase knob, and why it
   *  exists: the timer reads the cell's episode duration, which for a coming-up phase is
   *  how long the connect has taken — but for the reconnect backoff (`disconnected`) it
   *  is the WHOLE episode, a link that dropped after hours connected included, which is
   *  not how long the reconnect has taken. The gap (`undefined`) has no connect phase to
   *  time either. Within a phase that shows it, the timer still renders only from ≥1s. */
  showsElapsed: boolean;
}

/** Map a narratable phase — or the pre-frame/gap `undefined` — + host to its overlay TITLE.
 *  The ONE copy authority for every not-yet-connected canvas render. Total over
 *  {@link ConnectPhase} PLUS `undefined`: the gap is where no connect phase is known yet — the
 *  connection-cell subscription is still pending, C' floored a stale cell, or a
 *  `connected`/down phase narrowed out at the facts boundary. The gap returns the SAME
 *  "Connecting to <host>…" title as `probing`/`connecting`, so a routing flap between the
 *  boot-gate `connecting` mode and the `warming` overlay produces IDENTICAL pixels — the
 *  flicker srid saw dies WITHOUT hiding the state machine (real `provisioning` still
 *  gets its distinct title, and its tail/elapsed render off the frame's data). */
export function connectCanvasCopy(
  phase: NarratedPhase | undefined,
  host: string,
): ConnectCopy {
  return (
    match(phase)
      .with(undefined, () => ({
        title: `Connecting to ${host}…`,
        showsElapsed: false,
      }))
      .with(P.union("probing", "connecting"), () => ({
        title: `Connecting to ${host}…`,
        showsElapsed: true,
      }))
      .with("provisioning", () => ({
        title: `Provisioning kolu on ${host}… this can take a few minutes`,
        showsElapsed: true,
      }))
      // Between attempts. Saying "Connecting…" here hid that an attempt had just
      // ended; the tail under this title carries the session's own "attempt N
      // failed: <reason> — retrying in …" line, so the title only has to say that
      // kolu is going round again.
      .with("disconnected", () => ({
        title: `Reconnecting to ${host}…`,
        showsElapsed: false,
      }))
      .exhaustive()
  );
}

/** What the overlay narrates: the coming-up phases, plus the reconnect BACKOFF
 *  between attempts. A `disconnected` session reaches this overlay only while it
 *  is retrying — the map projects a standing refusal or a terminal give-up to
 *  `failed`, which the host-down card owns — so narrating it here is not a second
 *  failure surface; it is the pause between two attempts, with the reason the
 *  last one ended. */
export type NarratedPhase = ConnectPhase | "disconnected";

/** Is this a phase the overlay narrates (see {@link NarratedPhase})? */
export function isNarratedPhase(phase: string): phase is NarratedPhase {
  return isConnectPhase(phase) || phase === "disconnected";
}

/** Is this a phase the connect overlay narrates? (The provisioning phases + the
 *  post-provision handshake — never a down phase, which the host-down card owns.) */
export function isConnectPhase(phase: string): phase is ConnectPhase {
  return (
    phase === "probing" || phase === "provisioning" || phase === "connecting"
  );
}

/** Is this the actively provisioning phase? The single authority for "which phase is a cold
 *  provision" (vs the quick
 *  `probing`/`connecting` handshake), so `bootDeadline`'s ceiling class and the stalled-leg
 *  derivation reads it here instead of re-spelling the literal. */
export function isProvisioningPhase(phase: ConnectPhase | undefined): boolean {
  return phase === "provisioning";
}
