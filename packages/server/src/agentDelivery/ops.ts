import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import {
  GC_ROOTS_DIR,
  PACKAGE_GC_ROOT,
  profileGcRoot,
} from "@kolu/agent-distro/gcRoots";
import {
  agentBinaryCache,
  closureRoute,
  DEFAULT_SSH_KEEPALIVE,
  deliverClosure,
  type FetchText,
  fetchClosureIndex,
  homeGcRoot,
  isLocalHost,
  makeStepBudget,
  PROVISION_STEP_MAX_EXPIRIES,
  PROVISION_STEP_SILENCE_BASE_MS,
  type PublishedClosure,
  pullClosure,
  readPublishedClosure,
  resolveHostNix,
  signedBecause,
} from "@kolu/surface-remote";
import type { DeliveryOps, DeliveryStep } from "./delivery.ts";
import { buildProfile, lockProfile } from "./profiles.ts";

const PACKAGE_ATTRIBUTE = "default";

function gcRoot(ssh: string, name: string): string {
  const root = homeGcRoot(isLocalHost(ssh), `${GC_ROOTS_DIR}/${name}`);
  if (root === null)
    throw new Error(
      "HOME is unset, so the agents' GC root on this machine cannot be formed",
    );
  return root;
}

export async function readPublishedPackage(
  index: string,
  system: string,
  fetchText: FetchText = fetchClosureIndex,
): Promise<PublishedClosure> {
  const read = await readPublishedClosure(
    fetchText,
    { rawBase: index },
    "latest",
    system,
    PACKAGE_ATTRIBUTE,
  );
  if (read.kind === "not-published")
    throw new Error(
      `agent-distro has not published its agents for ${system} yet`,
    );
  return read.entry;
}

async function step<T>(
  run: () => Promise<DeliveryStep<T>>,
): Promise<DeliveryStep<T>> {
  try {
    return await run();
  } catch (err) {
    return {
      ok: false,
      message: err instanceof Error ? err.message : String(err),
    };
  }
}

export function realDeliveryOps(bake: AgentDistroDelivery): DeliveryOps {
  const keepalive = DEFAULT_SSH_KEEPALIVE;
  const binaryCache = agentBinaryCache({
    substituters: [bake.cache.url],
    trustedPublicKeys: [bake.cache.publicKey],
  });
  return {
    hostNixOf: (ssh) =>
      step(async () => ({
        ok: true,
        value: await resolveHostNix(ssh, { onProgress: () => {}, keepalive }),
      })),
    published: (system) =>
      step(async () => ({
        ok: true,
        value: await readPublishedPackage(bake.index, system),
      })),
    lock: (reference) =>
      step(async () => ({ ok: true, value: await lockProfile(reference) })),
    build: ({ rev, locked, hostSystem }) =>
      step(async () => ({
        ok: true,
        value: await buildProfile({
          flake: bake.flake,
          rev,
          locked,
          hostSystem,
        }),
      })),
    ship: ({ ssh, label, hostNix, reference, path, onProgress }) =>
      step(async () => {
        const res = await deliverClosure({
          host: ssh,
          system: async () => hostNix.system,
          outPath: path,
          binaryCache,
          published: null,
          rootPath: gcRoot(ssh, profileGcRoot(reference)),
          onProgress,
          onActivity: () => {},
          budget: makeStepBudget(
            PROVISION_STEP_SILENCE_BASE_MS,
            PROVISION_STEP_MAX_EXPIRIES,
          ),
          keepalive,
        });
        if (res.ok) return { ok: true, value: res.outPath };
        if (res.kind === "not-delivered" && res.at === "sender")
          return {
            ok: false,
            message: `the machine running kolu could not stage ${path} for ${label}: ${res.reason}`,
          };
        const why = `${label} could not take ${path}: ${res.reason}`;
        if (
          res.kind === "failed" ||
          res.asBuiltBecause === null ||
          isLocalHost(ssh)
        )
          return { ok: false, message: why };
        return {
          ok: false,
          message: `${why}. ${label} was sent it as built here, signed by no one — ${res.asBuiltBecause} — and takes it only when its Nix trusts the login kolu connects as: on ${label}, add it to \`nix.settings.trusted-users\`.`,
        };
      }),
    pull: ({ ssh, label, hostNix, published, onProgress }) =>
      step(async () => {
        const route = closureRoute(hostNix, published);
        const { storePath } = route;
        const rootPath = gcRoot(ssh, PACKAGE_GC_ROOT);
        const res = await pullClosure({
          host: ssh,
          cacheUrl: bake.cache.url,
          storePath,
          ...(route.kind === "signed"
            ? { signedBy: bake.cache.publicKey }
            : {}),
          rootPath,
          onProgress,
          keepalive,
          budget: makeStepBudget(
            PROVISION_STEP_SILENCE_BASE_MS,
            PROVISION_STEP_MAX_EXPIRIES,
          ),
        });
        if (res.ok) return { ok: true, value: storePath };
        if (res.kind === "failed") return { ok: false, message: res.reason };
        const why = `${label} could not pull the agents (${storePath}) from agent-distro's cache (${bake.cache.url}): ${res.reason}`;
        if (route.kind === "content-addressed")
          return { ok: false, message: why };
        const who = isLocalHost(ssh)
          ? "the user kolu runs as"
          : "the login kolu connects as";
        return {
          ok: false,
          message: `${why}. ${label} is sent the signed agents — ${signedBecause(route.because, hostNix)} — and takes them only if its Nix trusts them: on ${label}, add ${who} to \`nix.settings.trusted-users\`, or agent-distro's cache key (${bake.cache.publicKey}) to \`nix.settings.trusted-public-keys\`.`,
        };
      }),
  };
}
