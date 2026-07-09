/** The pure phase → narration mapping for the connect overlay (W6 — "the honest
 *  connect"). Kept dependency-free so the copy + the "which phases show a live tail"
 *  decision are unit-testable without mounting the connection-cell subscription
 *  (see `connectCanvasCopy.test.ts`).
 *
 *  Only the UP-but-not-yet-connected phases narrate here: the ssh connector's two
 *  provisioning phases (`copying` = `nix copy` the derivation; `building` = the remote
 *  `nix-store --realise`, the minutes-long compile) and the brief post-provision
 *  `connecting` handshake. `connected` needs no overlay (the workspace shows), and
 *  `disconnected`/`failed` are owned by the Skew-UX host-down card — NOT narrated here
 *  (a second failure surface is exactly what this must not build). */

// The phases the connect overlay narrates ride the framework's own `ConnectPhase` (exported
// beside `ConnectionInfo`, its honest owner) — imported through kolu-common's established
// re-export, NOT re-listed here. Adding an `SshProv` provisioning phase then fails
// {@link connectCanvasCopy}'s switch to compile (missing case) — the drift signal.
import type { ConnectPhase } from "kolu-common/surfacesWithPadi";

export interface ConnectCopy {
  /** The headline line. */
  title: string;
  /** Whether to show the live `log` tail + elapsed timer — TRUE for the provisioning
   *  phases (long-but-progressing must never read as hung), FALSE for the brief
   *  `connecting` handshake (no minutes-long output to tail). */
  showProgress: boolean;
}

/** Map a narratable phase — or the pre-frame/gap `undefined` — + host to its overlay copy.
 *  The ONE copy authority for every not-yet-connected canvas render. Total over
 *  {@link ConnectPhase} PLUS `undefined`: the gap is where no connect phase is known yet — the
 *  connection-cell subscription is still pending, C' floored a stale cell, or a
 *  `connected`/down phase narrowed out at the facts boundary. The gap returns the SAME
 *  "Connecting to <host>…" copy as `probing`/`connecting`, so a routing flap between the
 *  boot-gate `connecting` mode and the `warming` overlay produces IDENTICAL pixels — the
 *  flicker srid saw dies WITHOUT hiding the state machine (a real `copying`/`building` still
 *  narrates its distinct copy + tail). */
export function connectCanvasCopy(
  phase: ConnectPhase | undefined,
  host: string,
): ConnectCopy {
  switch (phase) {
    // The gap + the two calm phases collapse to ONE copy: the arch probe / post-provision
    // handshake / "nothing known yet" — nothing is being shipped, so no tail + no elapsed
    // timer that would read as a stalled build.
    case undefined:
    case "probing":
    case "connecting":
      return { title: `Connecting to ${host}…`, showProgress: false };
    case "copying":
      return {
        title: `Provisioning kolu onto ${host}… (first connect ships the recipe)`,
        showProgress: true,
      };
    case "building":
      return {
        title: `Building on ${host}… this can take a few minutes`,
        showProgress: true,
      };
  }
}

/** Is this a phase the connect overlay narrates? (The provisioning phases + the
 *  post-provision handshake — never a down phase, which the host-down card owns.) */
export function isConnectPhase(phase: string): phase is ConnectPhase {
  return (
    phase === "probing" ||
    phase === "copying" ||
    phase === "building" ||
    phase === "connecting"
  );
}
