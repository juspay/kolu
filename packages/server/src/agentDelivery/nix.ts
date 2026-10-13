/**
 * The Nix half of a delivery, as kolu-server runs it on its own machine — the
 * real {@link DeliveryOps}: lock upstream's flake ONCE per run (`nix flake
 * metadata --refresh`), evaluate the profile bundle's output path for a host's
 * system (`nix eval`, which builds nothing), and hand that path to
 * `@kolu/surface-remote`'s `deliverClosure` — the same warm-check · prefetch ·
 * ship · GC-root route padi itself rides to reach a host, minus the build.
 *
 * Why the binder and not the host: Nix gives an UNTRUSTED user exactly two ways
 * to obtain a store path — substitute it from a cache the DAEMON is configured
 * with, or build it. `--extra-substituters`, `--accept-flake-config` and `nix
 * copy --no-check-sigs` are all dropped for a user not in `trusted-users` (the
 * Nix manual's `trusted-users` / `require-sigs`; `deliverClosure`'s ship notes).
 * A host that ran its own download therefore needed its `nix.conf` edited. The
 * binder copies the bundle out of agent-distro's cache into its OWN store and
 * ships the signed paths; a host's daemon then takes them if it trusts the
 * login OR the cache's key, and refuses them — typed `refused` — otherwise.
 */

import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import { deliveryGcRootPath } from "@kolu/agent-distro/bundle";
import {
  agentBinaryCache,
  DEFAULT_SSH_KEEPALIVE,
  deliverClosure,
  isLocalHost,
  makeStepBudget,
  resolveSystem,
  runCapture,
} from "@kolu/surface-remote";
import type { DeliveryOps } from "./delivery.ts";

/** How long a lock or an evaluation may run. Evaluating a fresh revision may
 *  fetch its inputs' sources; neither step builds anything. */
const NIX_STEP_DEADLINE_MS = 10 * 60_000;

/** The root commit's silence bound: a quick `nix-store --realise` of a path
 *  already in the store. */
const ROOT_SILENCE_MS = 120_000;

/** Run `nix args…` and return its stdout, or throw with Nix's last words. */
async function nixStdout(
  args: readonly string[],
  signal: AbortSignal | undefined,
): Promise<string> {
  const said: string[] = [];
  const res = await runCapture("nix", args, {
    policy: { kind: "deadline", ms: NIX_STEP_DEADLINE_MS },
    signal,
    onProgress: (line) => {
      if (line.trim() === "") return;
      said.push(line.trim());
      if (said.length > 8) said.shift();
    },
  });
  if (res.ok) return res.stdout;
  const how =
    res.kind === "exit"
      ? `exited ${res.code}`
      : res.kind === "spawn-error"
        ? `could not run: ${res.message}`
        : res.kind;
  const last = said.findLast((l) => l.startsWith("error:")) ?? said.at(-1);
  throw new Error(
    `nix ${args.slice(0, 2).join(" ")} ${how}${last === undefined ? "" : `: ${last}`}`,
  );
}

/** The real operations, for `bake`'s flake and cache. */
export function nixDeliveryOps(bake: AgentDistroDelivery): DeliveryOps {
  const binaryCache = agentBinaryCache({
    substituters: [bake.cache.url],
    trustedPublicKeys: [bake.cache.publicKey],
  });
  return {
    lock: async (signal) => {
      const json = await nixStdout(
        ["flake", "metadata", "--refresh", "--json", bake.flake],
        signal,
      );
      const url = (JSON.parse(json) as { url?: unknown }).url;
      if (typeof url !== "string" || url === "")
        throw new Error(`nix flake metadata ${bake.flake} named no locked url`);
      return url;
    },
    systemOf: (ssh, signal) =>
      resolveSystem(ssh, {
        signal: signal ?? new AbortController().signal,
        onProgress: () => {},
        keepalive: DEFAULT_SSH_KEEPALIVE,
      }),
    outPath: async (ref, system, profile, signal) =>
      (
        await nixStdout(
          ["eval", "--raw", `${ref}#packages.${system}.${profile}.outPath`],
          signal,
        )
      ).trim(),
    deliver: ({ ssh, outPath, profile, onProgress, signal }) => {
      const rel = deliveryGcRootPath(profile);
      const home = process.env.HOME;
      if (isLocalHost(ssh) && (home === undefined || home === ""))
        throw new Error(
          "HOME is unset, so the agents' GC root on this machine cannot be formed",
        );
      return deliverClosure({
        host: ssh,
        outPath,
        binaryCache,
        rootPath: isLocalHost(ssh) ? `${home}/${rel}` : rel,
        onProgress,
        onActivity: () => {},
        budget: makeStepBudget(ROOT_SILENCE_MS, 1),
        keepalive: DEFAULT_SSH_KEEPALIVE,
        signal,
      });
    },
  };
}
