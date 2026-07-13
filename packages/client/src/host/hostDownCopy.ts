/** The plain-language copy for the Skew-UX host-down card — one first-class
 *  {title, body} per typed {@link EntryFailedCause}. PURE (no JSX, no `wire`), so
 *  `HostDownCanvas.tsx` renders it and `hostDownCopy.test.ts` asserts every cause
 *  has non-empty copy without mounting a component.
 *
 *  Keyed by the cause the map's `entries` collection reports on a `failed` entry —
 *  a STRUCTURAL classification, never parsed from the `reason` string (that stays
 *  a raw human detail the card shows verbatim under this copy). `satisfies
 *  Record<EntryFailedCause, HostDownCopy>` makes the map EXHAUSTIVE by
 *  construction: adding a future cause to `EntryFailedCause` fails THIS build
 *  until its copy is written, so the card can never fall back to a generic
 *  "something went wrong" for a cause the domain has named. */

import type { EntryFailedCause } from "kolu-common/surfacesWithPadi";

/** A cause's card copy — a short title and a plain-language body. Both non-empty
 *  (pinned in `hostDownCopy.test.ts`). */
export interface HostDownCopy {
  readonly title: string;
  readonly body: string;
}

/** cause → {title, body}. Exhaustive over {@link EntryFailedCause} (see the module
 *  doc). Plain words first — a symbol/knob name (`KOLU_REMOTE_PADI_STATE_DIR`)
 *  appears only where it is the actual lever to pull. */
export const HOST_DOWN_COPY = {
  "contract-skew-refused": {
    title: "This host runs an older kolu",
    body:
      "The padi on this host speaks an older contract than the one your kolu " +
      "expects, so it refused to bind rather than drift out of sync. Update the " +
      "remote host's kolu to match, or switch back to your local host.",
  },
  "cross-supervisor": {
    title: "Another kolu owns this host",
    body:
      "A different kolu supervisor already holds this host's padi, so yours can't " +
      "take it over. Point that other kolu at this host instead, or isolate this " +
      "one with its own KOLU_REMOTE_PADI_STATE_DIR so the two don't contend.",
  },
  "drv-unbaked": {
    title: "This host's padi wasn't built with Nix",
    body:
      "The agent derivations aren't baked into this run (PADI_AGENT_DRVS_JSON is " +
      "unset), so padi has nothing to deploy to the host. Launch kolu through its " +
      "Nix wrapper, which bakes them in, then try again.",
  },
  "drv-missing-for-system": {
    title: "No build for this host's architecture",
    body:
      "The baked agent derivations don't include one for this host's system " +
      "(its CPU/OS pair), so padi can't deploy to it. Rebuild kolu with that " +
      "system included, or switch back to your local host.",
  },
  unconverged: {
    title: "This host's padi never settled",
    body:
      "A newer contract was pushed to this host but the drain never provably " +
      "completed, so its state is unsettled and can't be trusted. Retry from the " +
      "host, or switch back to your local host while it recovers.",
  },
  "link-failed": {
    title: "Can't reach this host",
    body:
      "The connection to this host gave up — it may be unreachable, or its " +
      "provisioning failed partway. Check the host is up and reachable over ssh, " +
      "or switch back to your local host.",
  },
  // PR4: there is deliberately no `other` copy — `EntryFailedCause` dropped its
  // catch-all, so an unclassifiable failure fails loud (a defect to classify) and
  // this `satisfies` stays exhaustive over only the named structural causes.
} satisfies Record<EntryFailedCause, HostDownCopy>;

/** Look up a cause's card copy. Total over {@link EntryFailedCause} — every cause
 *  is a key of {@link HOST_DOWN_COPY} by construction. */
export function hostDownCopy(cause: EntryFailedCause): HostDownCopy {
  return HOST_DOWN_COPY[cause];
}
