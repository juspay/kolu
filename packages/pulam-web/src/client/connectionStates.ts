/**
 * Per-(mirror)-connection-state presentation — pulam-web-local, the leaf the
 * lens panel keeps app-local: the framework supplies the honest SIGNAL (the
 * `connection` cell), each app paints it its own way. One `Record` row per
 * state forces every aspect (dot colour, label, message, pulse) to be filled in
 * together, so they can't drift and a new state is one row, not four edits.
 *
 * Mirrors kolu's connection vocabulary and drishti's `connectionColors.ts`; the
 * colours are pulam-web's own dashboard palette (the hexes the rows and the
 * header already use).
 */

import type {
  ConnectionState,
  FailureCause,
} from "@kolu/surface-nix-host/connection";

/**
 * pulam-web's health palette — the ONE home for the dashboard's link-health
 * hexes. CONN_STATE's rows and `effectiveHealth`'s transport branches both read
 * these, so a re-theme of the failed/pending/healthy colour is a single edit
 * here, not a hunt across two modules for a hand-spelled `#ff8d8d`.
 */
export const HEALTH_PALETTE = {
  red: "#ff8d8d",
  amber: "#e6a23c",
  green: "#7ec699",
} as const;

export interface ConnPresentation {
  /** Status-dot colour. */
  dot: string;
  /** Label / message text colour. */
  text: string;
  /** Terse header label. */
  label: string;
  /** Verbose body line (the full-pane connecting / failed view). */
  message: string;
  /** When a state's body line varies on a SECOND axis (`failureCause`), the row
   *  carries that whole variation as data here, so the per-state message stays
   *  single-sourced in this table — the consumer reads `messageFor?.(cause) ??
   *  message` uniformly and never special-cases a state. */
  messageFor?: (cause: FailureCause | null) => string;
  /** In-flight state whose dot should pulse. */
  pending: boolean;
}

export const CONN_STATE: Record<ConnectionState, ConnPresentation> = {
  connected: {
    // NOT green. The `dot` field feeds ONLY the `<HostStatusPip>`'s NOT-ready tone
    // (the pip emits its green solely from the fact-`ready` branch, via its own
    // `readyColor={HEALTH_PALETTE.green}`). `notReadyTone` is reached only when the
    // host is NOT ready — a connected mirror with an erroring/pending sub — where
    // amber is the honest colour. A green here was dead re-spelling material (the
    // round-7 review's residual): never painted, but a raw-state green a future
    // widget could read. The connected `text` stays green (the status WORD's colour
    // is legitimate presentation, fact-independent).
    dot: HEALTH_PALETTE.amber,
    text: HEALTH_PALETTE.green,
    label: "connected",
    message: "Connected.",
    pending: false,
  },
  connecting: {
    dot: HEALTH_PALETTE.amber,
    text: HEALTH_PALETTE.amber,
    label: "connecting…",
    message: "Connecting…",
    pending: true,
  },
  copying: {
    dot: HEALTH_PALETTE.amber,
    text: HEALTH_PALETTE.amber,
    label: "provisioning agent…",
    message: "Copying agent to remote…",
    pending: true,
  },
  disconnected: {
    dot: HEALTH_PALETTE.amber,
    text: HEALTH_PALETTE.amber,
    label: "reconnecting…",
    message: "Reconnecting…",
    // The body line varies on WHY the link is down: a `network` fault means the
    // host is unreachable (retries forever), which the base "Reconnecting…"
    // undersells; any other cause (or none yet) keeps the base message. This
    // (state × cause) variation lives in the table as data, not a bolt-on.
    messageFor: (cause) =>
      cause === "network" ? "Host unreachable — retrying…" : "Reconnecting…",
    pending: true,
  },
  failed: {
    dot: HEALTH_PALETTE.red,
    text: HEALTH_PALETTE.red,
    label: "failed",
    // Terminal `failed` is ALWAYS a `remote` fault: the host WAS reached but
    // rejected the session or its agent crashed (e.g. the pty-host build skew),
    // and the reconnect budget then ran out. A `network` fault (unreachable
    // host) retries forever and never lands here — see `connection.ts`'s
    // `CONNECTION_STATES` note. So "couldn't reach this host" would point the
    // user at a network diagnosis when the real cause is remote config/build
    // skew; the neutral heading keeps that honest, with the real error below.
    message: "Remote connection failed",
    pending: false,
  },
};
