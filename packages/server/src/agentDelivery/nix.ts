/**
 * The real {@link DeliveryOps}: every step is `@kolu/surface-remote`'s — the
 * flake lock and the output-path evaluation run through its one evaluator
 * (`lockFlake`, `resolveFlakeOutPath`: progress liveness, Nix's root error and
 * detail, the retry classification), the host's system through
 * `resolveSystem`, and the copy through `deliverClosure`, the same
 * warm-check · stage · ship · GC-root route padi itself rides to a host,
 * minus the build. This file holds no Nix argv and no Nix wording.
 *
 * Why the binder and not the host: Nix gives an UNTRUSTED user exactly two ways
 * to obtain an input-addressed store path — substitute it from a cache the
 * DAEMON is configured with, or build it. `--extra-substituters`,
 * `--accept-flake-config` and `nix copy --no-check-sigs` are all dropped for a
 * user not in `trusted-users` (the Nix manual's `trusted-users` /
 * `require-sigs`), so a host that ran its own download needed its `nix.conf`
 * edited. A CONTENT-ADDRESSED path needs no trust at all: the binder reads the
 * bundle from agent-distro's cache, rewrites it content-addressed and ships
 * that, and every Linux host's daemon takes it (`deliverClosure`'s header). A
 * Mac is sent the signed bundle as is — rewriting breaks its code signatures —
 * and takes it if it trusts the login or the cache's key.
 */

import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import {
  agentBinaryCache,
  DEFAULT_SSH_KEEPALIVE,
  deliverClosure,
  homeGcRoot,
  isLocalHost,
  lockFlake,
  makeStepBudget,
  PROVISION_STEP_MAX_EXPIRIES,
  PROVISION_STEP_SILENCE_BASE_MS,
  resolveFlakeOutPath,
  resolveSystem,
} from "@kolu/surface-remote";
import type { DeliveryOps } from "./delivery.ts";

/** A fresh budget per step — the provisioning numbers padi's dial uses. */
const budget = () =>
  makeStepBudget(PROVISION_STEP_SILENCE_BASE_MS, PROVISION_STEP_MAX_EXPIRIES);

/** Evaluation hooks: nothing narrates a background delivery but the log. */
const quiet = () => ({
  onProgress: () => {},
  onActivity: () => {},
  budget: budget(),
});

/** The real operations, for `bake`'s flake and cache. */
export function nixDeliveryOps(bake: AgentDistroDelivery): DeliveryOps {
  const binaryCache = agentBinaryCache({
    substituters: [bake.cache.url],
    trustedPublicKeys: [bake.cache.publicKey],
  });
  // The interactive default on purpose: every ssh to a host shares ONE
  // ControlMaster keyed by its keepalive, padi's own dial's included.
  const keepalive = DEFAULT_SSH_KEEPALIVE;
  return {
    lock: () => lockFlake(bake.flake, quiet()),
    systemOf: (ssh) => resolveSystem(ssh, { onProgress: () => {}, keepalive }),
    outPath: (ref, system, profile) =>
      resolveFlakeOutPath(ref, system, profile, quiet()),
    deliver: ({ ssh, system, outPath, profile, onProgress }) => {
      // kolu's own root, one link per profile ("latest", like surface-remote's
      // per-agent roots). Home-relative, never `$XDG_STATE_HOME`: over ssh the
      // login's home is the one place this process can name on a host.
      const rootPath = homeGcRoot(
        isLocalHost(ssh),
        `.local/state/kolu/agent-distro/gcroots/${profile}`,
      );
      if (rootPath === null)
        throw new Error(
          "HOME is unset, so the agents' GC root on this machine cannot be formed",
        );
      return deliverClosure({
        host: ssh,
        system,
        outPath,
        binaryCache,
        rootPath,
        onProgress,
        onActivity: () => {},
        budget: budget(),
        keepalive,
      });
    },
  };
}
