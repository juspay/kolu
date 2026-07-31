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
  "agent-source-unbaked": {
    title: "This kolu run is missing its agent source",
    body:
      "The agent source isn't baked into this run (SURFACE_AGENT_FLAKE_REF is " +
      "unset), so padi cannot resolve the matching build for this host. Launch " +
      "kolu through its Nix wrapper (nix run github:juspay/kolu), which bakes " +
      "the source in, then try again.",
  },
  "agent-cache-unbaked": {
    title: "This kolu build predates the agent binary-cache contract",
    body:
      "The agent source IS baked into this run, but it carries no binary-cache " +
      "declaration, which padi needs to fetch this host's agent instead of " +
      "compiling it. That means the build is older than the contract. Update " +
      "kolu (rebuild or re-run it from a current commit), then try again.",
  },
  "agent-drv-unavailable": {
    title: "Kolu couldn't prepare padi for this host",
    body:
      "The baked agent source could not resolve padi for this host. The detail " +
      "below has the Nix error, including an unsupported CPU/OS pair when that " +
      "is the cause. Fix that source error, or switch back to your local host.",
  },
  unconverged: {
    title: "This host's padi never settled",
    body:
      "A newer contract was pushed to this host but the drain never provably " +
      "completed, so its state is unsettled and can't be trusted. Retry from the " +
      "host, or switch back to your local host while it recovers.",
  },
  // The two ssh refusals: kolu is strictly non-interactive over ssh, so a
  // gate only a typed answer could pass (a password, a trust prompt) is a
  // terminal, operator-actionable fault — named here with its actual remedy,
  // never left masquerading as a generic reachability problem.
  "auth-required": {
    title: "This host needs passwordless ssh",
    body:
      "The host refused kolu's ssh sign-in, and kolu connects " +
      "non-interactively — it can never type a password. Set up key-based " +
      "access (for example with ssh-copy-id), confirm plain ssh connects " +
      "without prompting, then reconnect.",
  },
  "host-key-unverified": {
    title: "This host isn't trusted yet",
    body:
      "ssh doesn't recognize this host's identity key, and kolu never " +
      "answers the trust prompt itself. Run ssh to this host once in a " +
      "terminal to review and accept its key — or resolve a changed-key " +
      "warning — then reconnect.",
  },
  // ssh worked; the host just has no Nix to provision padi with. A distinct
  // prerequisite from the two above, with a distinct fix — and the "installed
  // but not on the non-interactive PATH" case is named, because it is the more
  // common one and looks identical to "not installed" from here.
  "nix-unavailable": {
    title: "This host has no Nix that kolu can run",
    body:
      "kolu reached the host over ssh, but its shell couldn't run " +
      "nix-instantiate — kolu builds padi with the host's own Nix, so it has " +
      "nothing to install from. Either Nix isn't installed there, or it isn't " +
      "on the PATH of a non-interactive ssh session, which is common for a " +
      "single-user install. Check with ssh <host> nix-instantiate --version, " +
      "and install it from https://nixos.asia/en/install if it's missing.",
  },
  // Two causes, so the copy must not give one remedy as if it were the answer: the
  // card now carries the failed episode's own output, which is what tells the two
  // apart. Point at it rather than sending everyone to check ssh — the case this fix
  // came from had a reachable host and a build that failed on a type error.
  "link-failed": {
    title: "Can't reach this host",
    body:
      "The connection to this host gave up — it may be unreachable, or its " +
      "provisioning failed partway. The output below says which: check the host " +
      "is up and reachable over ssh, or fix what the build reported. You can also " +
      "switch back to your local host.",
  },
  // The LOCAL padi couldn't start on this machine — a distinct producer from the
  // remote `link-failed` (a local spawn/connect give-up, not a network reach). Its
  // copy is master's pre-PR4 catch-all card verbatim: that card only ever rendered
  // for a local terminal give-up (a remote give-up always classified `link-failed`),
  // so reusing it keeps this reachable case byte-identical on screen (PR4 neutrality).
  "local-start-failed": {
    title: "This host's padi couldn't start",
    body:
      "This host's padi failed to come up for a reason kolu couldn't classify " +
      "further. The detail below has what the host reported; switch back to your " +
      "local host to keep working.",
  },
  // PR4: there is deliberately no `other` catch-all copy — `EntryFailedCause` dropped
  // its catch-all, so an unclassifiable failure fails loud (a defect to classify) and
  // this `satisfies` stays exhaustive over only the named structural causes.
} satisfies Record<EntryFailedCause, HostDownCopy>;

/** Look up a cause's card copy. Total over {@link EntryFailedCause} — every cause
 *  is a key of {@link HOST_DOWN_COPY} by construction. */
export function hostDownCopy(cause: EntryFailedCause): HostDownCopy {
  return HOST_DOWN_COPY[cause];
}
