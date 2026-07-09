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

/** The phases the connect overlay narrates — a strict subset of `ConnectionInfo.phase`. */
export type ConnectPhase = "probing" | "copying" | "building" | "connecting";

export interface ConnectCopy {
  /** The headline line. */
  title: string;
  /** Whether to show the live `log` tail + elapsed timer — TRUE for the provisioning
   *  phases (long-but-progressing must never read as hung), FALSE for the brief
   *  `connecting` handshake (no minutes-long output to tail). */
  showProgress: boolean;
}

/** Map a narratable phase + host to its overlay copy. Total over {@link ConnectPhase}. */
export function connectCanvasCopy(
  phase: ConnectPhase,
  host: string,
): ConnectCopy {
  switch (phase) {
    case "probing":
      // The OPENING phase — the ssh arch probe + the warm "is it already here?"
      // check, before any copy exists (and, on a WARM host, the whole story). Calm
      // and progress-less, like `connecting`: nothing is being shipped, so no tail
      // + no elapsed timer that would read as a stalled build.
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
    case "connecting":
      return { title: `Connecting to ${host}…`, showProgress: false };
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
