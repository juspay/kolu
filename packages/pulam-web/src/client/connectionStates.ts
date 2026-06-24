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
    dot: "#7ec699",
    text: "#7ec699",
    label: "connected",
    message: "Connected.",
    pending: false,
  },
  connecting: {
    dot: "#e6a23c",
    text: "#e6a23c",
    label: "connecting…",
    message: "Connecting…",
    pending: true,
  },
  copying: {
    dot: "#e6a23c",
    text: "#e6a23c",
    label: "provisioning agent…",
    message: "Copying agent to remote…",
    pending: true,
  },
  disconnected: {
    dot: "#e6a23c",
    text: "#e6a23c",
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
    dot: "#ff8d8d",
    text: "#ff8d8d",
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
