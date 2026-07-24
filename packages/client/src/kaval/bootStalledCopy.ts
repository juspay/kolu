/** Plain-language copy for the boot-stalled card — the honest escape when a boot overlay is
 *  held past its ceiling ({@link resolveCanvasMode}). PURE (no JSX, no `wire`), so
 *  `BootStalledCanvas.tsx` renders it and `bootStalledCopy.test.ts` asserts non-empty copy
 *  without mounting a component. Two copy domains, one per {@link BootStalledRecovery} arm:
 *
 *   - The CONNECTOR card ({@link CONNECTOR_STALLED_COPY}) — a warming REMOTE campaign the server
 *     ssh connector is STILL retrying (#1908 D2). NON-terminal tone, recovery verb Reconnect.
 *   - The CLIENT card ({@link BOOT_STALLED_COPY}) — one {title, body} per {@link ClientStalledLeg},
 *     a genuinely client-side leg. Recovery verb Reload.
 *
 *  Sibling of `HOST_DOWN_COPY` (a different key domain — a server-reported `EntryFailedCause`),
 *  so it is its OWN authority, not a case bolted onto that map. `satisfies Record<ClientStalledLeg,
 *  BootStalledCopy>` makes the client map EXHAUSTIVE by construction: adding a future client leg
 *  fails THIS build until its copy is written, so the card can never fall back to a generic
 *  message for a leg the resolver has named. Episode-honest (R5): the phrasing says only what is
 *  true of a stalled boot episode ("hasn't finished" / "still retrying", not "failed"), and the
 *  connector card names the live phase (rendered beside its static body from `mode.recovery.phase`)
 *  rather than pretending a long, still-running campaign failed the instant the ceiling passed. */

import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import type { ClientStalledLeg } from "./canvasModeResolver";

/** A card's copy — a short title and a plain-language body. Both non-empty
 *  (pinned in `bootStalledCopy.test.ts`). */
export interface BootStalledCopy {
  readonly title: string;
  readonly body: string;
}

/** The CONNECTOR-owned card's copy (#1908 D2) — a warming REMOTE host whose ssh connector has
 *  outrun its ceiling but is STILL retrying (PR1's `recheck()` loop owns the dial). NON-TERMINAL
 *  by construction: the entry is `warming`, so the connector has NOT reached its own terminal
 *  `failed` verdict (that would flip the entry to `failed` → the host-down card, a different
 *  surface). The live phase narrates beside this static body via {@link bootStalledPhaseDetail},
 *  and the recovery verb recycles the SERVER connector (`hosts.reconnect`) — a `location.reload()`
 *  could not, so the old terminal "isn't responding / Reload" copy was a lie over a live retry. */
export const CONNECTOR_STALLED_COPY: BootStalledCopy = {
  title: "kolu is still setting up this host",
  body:
    "Setting up this host's agent over ssh is taking longer than usual, but kolu hasn't given " +
    "up — it is still retrying. You can keep waiting, retry the connection now, or switch back " +
    "to your local host.",
};

/** client leg → {title, body}. Exhaustive over {@link ClientStalledLeg} (see the module doc) —
 *  the `provisioning` leg is NOT here: it is the connector-owned card ({@link CONNECTOR_STALLED_COPY}),
 *  a different surface with a different (non-terminal) tone and a different recovery verb. */
export const BOOT_STALLED_COPY = {
  // The `entries` membership snapshot never grounded the active host, so the per-host world
  // never came into being — the canvas had nothing to show but "Connecting…". (Hole A.)
  membership: {
    title: "kolu can't see this host yet",
    body:
      "kolu connected, but the list of hosts hasn't arrived, so it can't open this host's " +
      "workspace. This usually clears on its own — reload to try again.",
  },
  // The host connected but its session / terminal-list subscription hasn't delivered a first
  // frame, so the workspace can't render. (Hole B.)
  session: {
    title: "Your workspace didn't finish loading",
    body:
      "kolu connected to this host, but its saved session and terminal list haven't arrived, " +
      "so the workspace can't open. Reload to try again.",
  },
  // A REMOTE host connected but its kaval status never reported (the local-kaval case takes the
  // byte-identical down/dead DegradedCanvas instead, so this key is the remote daemon stall).
  daemon: {
    title: "This host's agent isn't responding",
    body:
      "kolu reached this host, but its agent (kaval) hasn't reported its status, so the " +
      "workspace can't be trusted yet. Reload to try again, or switch back to your local host.",
  },
} satisfies Record<ClientStalledLeg, BootStalledCopy>;

/** Look up a client leg's card copy. Total over {@link ClientStalledLeg} — every client leg is
 *  a key of {@link BOOT_STALLED_COPY} by construction. (`provisioning` is the connector card's
 *  domain — {@link CONNECTOR_STALLED_COPY} — so it is not a key here and cannot be looked up.) */
export function bootStalledCopy(leg: ClientStalledLeg): BootStalledCopy {
  return BOOT_STALLED_COPY[leg];
}

/** The live connect-phase DETAIL line for the CONNECTOR card, rendered beside its static body so
 *  a wedged-but-retrying remote campaign names WHERE it is (checking / provisioning /
 *  connecting) rather than a bare title. Lives HERE (this is the card's copy authority — the
 *  module doc's own claim) rather than inline in `BootStalledCanvas`, so all of the card's
 *  plain-language copy has one home and one test. Total over {@link ConnectPhase} PLUS `undefined`
 *  (the pre-frame gap has no detail); every arm reads "still …", honest that the connector is
 *  actively retrying, not that a step failed. */
export function bootStalledPhaseDetail(
  phase: ConnectPhase | undefined,
): string | undefined {
  switch (phase) {
    case "probing":
      return "Still checking whether this host already has the agent…";
    case "provisioning":
      return "Still provisioning the agent on the host…";
    case "connecting":
      return "Still connecting to the host's agent…";
    case undefined:
      return undefined;
  }
}
