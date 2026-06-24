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
    pending: true,
  },
  failed: {
    dot: "#ff8d8d",
    text: "#ff8d8d",
    label: "failed",
    message: "Couldn't reach this host",
    pending: false,
  },
};

/** Refine a `disconnected` line by WHY the link is down: a `network` fault means
 *  the host is unreachable (retries forever), which "Reconnecting…" undersells.
 *  Any other cause (or none yet) keeps the base message. */
export function disconnectedMessage(cause: FailureCause | null): string {
  return cause === "network"
    ? "Host unreachable — retrying…"
    : CONN_STATE.disconnected.message;
}
