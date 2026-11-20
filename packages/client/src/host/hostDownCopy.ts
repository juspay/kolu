import type { EntryFailedCause } from "kolu-common/surfacesWithPadi";

export interface HostDownCopy {
  readonly title: string;
  readonly body: string;
}

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
      "Kolu couldn't work out which padi build this host needs. The detail " +
      "below has the error: the host's own Nix failing to report its CPU/OS " +
      "pair, output that isn't one, or the baked source failing to resolve " +
      "padi for it (including an unsupported CPU/OS pair). Fix that, or switch " +
      "back to your local host.",
  },
  unconverged: {
    title: "This host's padi never settled",
    body:
      "A newer contract was pushed to this host but the drain never provably " +
      "completed, so its state is unsettled and can't be trusted. Retry from the " +
      "host, or switch back to your local host while it recovers.",
  },
  "previous-protocol-epoch": {
    title: "This host runs a kolu from before the protocol change",
    body:
      "The padi already running on this host speaks an older wire protocol — " +
      "old enough that this kolu can't even ask it its version. Kolu tried to " +
      "take it over and replace it with a current one, and couldn't. Update the " +
      "host's kolu (or stop the padi running there so a fresh one can start), " +
      "then reconnect. Retrying on its own won't help.",
  },
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
  "connect-stalled": {
    title: "Connecting to this host kept stalling",
    body:
      "A step of connecting to this host went quiet for too long, too many " +
      "times, so kolu stopped retrying. The detail below names the step. The " +
      "host may be asleep or off the network, or a download may have stalled — " +
      "reconnect once it's reachable, or switch back to your local host.",
  },
  "host-setup-failed": {
    title: "Kolu couldn't set up this host",
    body:
      "The host answered, but bringing padi up there kept failing, so kolu " +
      "stopped retrying. The detail below is the error that stopped it, and the " +
      "output under it is what led up to it. Fix that, then reconnect, or switch " +
      "back to your local host.",
  },
  "local-start-failed": {
    title: "This host's padi couldn't start",
    body:
      "This host's padi failed to come up for a reason kolu couldn't classify " +
      "further. The detail below has what the host reported; switch back to your " +
      "local host to keep working.",
  },
} satisfies Record<EntryFailedCause, HostDownCopy>;

export function hostDownCopy(cause: EntryFailedCause): HostDownCopy {
  return HOST_DOWN_COPY[cause];
}
