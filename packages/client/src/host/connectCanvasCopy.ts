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
  /** The headline line. PURE title — there is NO per-phase show/hide knob: ConnectCanvas
   *  renders the live `log` tail + elapsed timer from the frame's own DATA (a non-empty log,
   *  a ≥1s duration), never from a phase flag. So the `probing` window narrates its real
   *  "checking for a cached agent…" log the instant it arrives, instead of a silent wait. */
  title: string;
}

/** Map a narratable phase — or the pre-frame/gap `undefined` — + host to its overlay TITLE.
 *  The ONE copy authority for every not-yet-connected canvas render. Total over
 *  {@link ConnectPhase} PLUS `undefined`: the gap is where no connect phase is known yet — the
 *  connection-cell subscription is still pending, C' floored a stale cell, or a
 *  `connected`/down phase narrowed out at the facts boundary. The gap returns the SAME
 *  "Connecting to <host>…" title as `probing`/`connecting`, so a routing flap between the
 *  boot-gate `connecting` mode and the `warming` overlay produces IDENTICAL pixels — the
 *  flicker srid saw dies WITHOUT hiding the state machine (a real `copying`/`building` still
 *  gets its distinct title, and its tail/elapsed render off the frame's data). */
export function connectCanvasCopy(
  phase: ConnectPhase | undefined,
  host: string,
): ConnectCopy {
  switch (phase) {
    // The gap + the two calm phases collapse to ONE title: the arch probe / post-provision
    // handshake / "nothing known yet".
    case undefined:
    case "probing":
    case "connecting":
      return { title: `Connecting to ${host}…` };
    case "copying":
      return {
        title: `Provisioning kolu onto ${host}… (first connect ships the recipe)`,
      };
    case "building":
      return { title: `Building on ${host}… this can take a few minutes` };
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

/** Is this the ACTIVELY-PROVISIONING phase pair — `nix copy` (`copying`) or the minutes-long
 *  remote `building`? The single authority for "which phases are a cold provision" (vs the quick
 *  `probing`/`connecting` handshake), so `bootDeadline`'s ceiling class and the stalled-leg
 *  derivation read it here instead of re-spelling the `copying || building` literal pair. */
export function isProvisioningPhase(phase: ConnectPhase | undefined): boolean {
  return phase === "copying" || phase === "building";
}
