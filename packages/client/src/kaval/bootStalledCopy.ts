/** Plain-language copy for the #1763 boot-stalled card — one {title, body} per
 *  {@link StalledLeg}, the honest escape when a boot overlay is held past its ceiling
 *  ({@link resolveCanvasMode}). PURE (no JSX, no `wire`), so `BootStalledCanvas.tsx` renders
 *  it and `bootStalledCopy.test.ts` asserts every leg has non-empty copy without mounting a
 *  component. Sibling of `HOST_DOWN_COPY` (a different key domain — the CLIENT-side stalled
 *  boot leg, not a server-reported `EntryFailedCause` — and a different recovery verb: Reload,
 *  not Reconnect), so it is its OWN authority, not a case bolted onto that map.
 *
 *  `satisfies Record<StalledLeg, BootStalledCopy>` makes the map EXHAUSTIVE by construction:
 *  adding a future leg to `StalledLeg` fails THIS build until its copy is written, so the card
 *  can never fall back to a generic message for a leg the resolver has named. Episode-honest
 *  (R5): the phrasing says only what is true of a stalled boot episode ("hasn't finished",
 *  not "failed"), and the wedged-remote-provisioning copy names the phase (rendered beside
 *  this static body from `mode.phase`) rather than pretending a long build failed instantly. */

import type { ConnectPhase } from "kolu-common/surfacesWithPadi";
import type { StalledLeg } from "./canvasModeResolver";

/** A leg's card copy — a short title and a plain-language body. Both non-empty
 *  (pinned in `bootStalledCopy.test.ts`). */
export interface BootStalledCopy {
  readonly title: string;
  readonly body: string;
}

/** leg → {title, body}. Exhaustive over {@link StalledLeg} (see the module doc). */
export const BOOT_STALLED_COPY = {
  // A remote host binding whose provision (copy/build) has outrun even the generous remote
  // ceiling. The card renders `mode.phase` (copying/building) beside this, so it names WHERE
  // it is stuck without pretending the build failed the instant the ceiling passed.
  provisioning: {
    title: "This host is taking too long to provision",
    body:
      "Setting up this host's agent (copying and building over ssh) has run past the time " +
      "kolu waits before checking in. It may still be working — reload to keep watching, or " +
      "switch back to your local host.",
  },
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
  // UNREACHABLE by design today — insurance for a future overlay return that forgets to name
  // its leg. Honest and generic: no leg-specific claim it can't back up.
  unknown: {
    title: "The workspace didn't become ready",
    body:
      "kolu connected, but this host's workspace never finished coming up. Reload to try " +
      "again, or switch back to your local host.",
  },
} satisfies Record<StalledLeg, BootStalledCopy>;

/** Look up a leg's card copy. Total over {@link StalledLeg} — every leg is a key of
 *  {@link BOOT_STALLED_COPY} by construction. */
export function bootStalledCopy(leg: StalledLeg): BootStalledCopy {
  return BOOT_STALLED_COPY[leg];
}

/** The live provisioning-phase DETAIL line, rendered beside the static leg copy so a wedged
 *  remote build names WHERE it is stuck rather than showing a bare title. Lives HERE (this is
 *  the boot-stalled card's copy authority — the module doc's own claim) rather than inline in
 *  `BootStalledCanvas`, so all of the card's plain-language copy has one home and one test.
 *  Only the two provisioning phases narrate a detail; every other phase (and the pre-frame
 *  `undefined`) has none — the leg copy already says enough. */
export function bootStalledPhaseDetail(
  phase: ConnectPhase | undefined,
): string | undefined {
  switch (phase) {
    case "copying":
      return "Still copying the recipe to the host…";
    case "building":
      return "Still building on the host…";
    default:
      return undefined;
  }
}
