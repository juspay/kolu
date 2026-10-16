/**
 * The real {@link DeliveryOps}. Which package: one HTTPS GET of upstream's
 * content-addressed index per system (`@kolu/surface-remote`'s
 * `readPublishedClosure`, the `latest/` entry of its one package). Getting it
 * there: `@kolu/surface-remote`'s `pullClosure` — the host pulls the path from
 * agent-distro's cache and roots it (its header says what trust each form
 * needs), in the form `closureRoute` picks from the host's Nix: the
 * content-addressed rewrite, which needs no trust, or the signed package,
 * which needs the host's Nix to trust the login or the cache's key.
 *
 * A profile is locked and built on THIS machine (`./profiles.ts`), and shipped
 * with `@kolu/surface-remote`'s `deliverClosure` — the same route an agent's
 * closure takes: content-addressed to a Linux host (no trust needed), signed
 * input-addressed to a Mac (which must trust the login), rooted either way.
 * kolu's own words — the GC roots, the trust fix a refusal names — stay here.
 */

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
  isDarwinSystem,
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
import type { DeliveryOps } from "./delivery.ts";
import { buildProfile, lockProfile } from "./profiles.ts";

/** The attribute upstream's index publishes its one package under
 *  (`<rev>/<system>/default.json`, and `latest/` on main). */
const PACKAGE_ATTRIBUTE = "default";

/** Where kolu roots a delivered path on the host `ssh` reaches
 *  (`@kolu/agent-distro/gcRoots`: the package, and each profile by its
 *  reference — padi prunes the profiles' as a stack lands). */
function gcRoot(ssh: string, name: string): string {
  const root = homeGcRoot(isLocalHost(ssh), `${GC_ROOTS_DIR}/${name}`);
  if (root === null)
    throw new Error(
      "HOME is unset, so the agents' GC root on this machine cannot be formed",
    );
  return root;
}

/** Read the newest published package for `system` off agent-distro's index
 *  at `index` — its `latest/` entry, through the framework's reader
 *  (`fetchText` injectable for tests). A 404 throws in words the host's
 *  failure line carries as is (upstream has not published that package); the
 *  reader's own errors (no answer, another status, not an entry) name the
 *  URL. */
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

/** The real operations, for `bake`'s index and cache. */
export function realDeliveryOps(bake: AgentDistroDelivery): DeliveryOps {
  // The interactive default on purpose: every ssh to a host shares ONE
  // ControlMaster keyed by its keepalive, padi's own dial's included.
  const keepalive = DEFAULT_SSH_KEEPALIVE;
  const binaryCache = agentBinaryCache({
    substituters: [bake.cache.url],
    trustedPublicKeys: [bake.cache.publicKey],
  });
  return {
    hostNixOf: (ssh) =>
      resolveHostNix(ssh, { onProgress: () => {}, keepalive }),
    published: (system) => readPublishedPackage(bake.index, system),
    lock: lockProfile,
    build: ({ rev, locked, hostSystem }) =>
      buildProfile({ flake: bake.flake, rev, locked, hostSystem }),
    ship: async ({ ssh, label, hostNix, reference, path, onProgress }) => {
      const res = await deliverClosure({
        host: ssh,
        system: async () => hostNix.system,
        outPath: path,
        // Built on this machine, so held here: the cache is never read for
        // it. Named because a delivery is never cache-blind.
        binaryCache,
        published: null,
        // One root per reference ("latest", like the package's).
        rootPath: gcRoot(ssh, profileGcRoot(reference)),
        onProgress,
        onActivity: () => {},
        budget: makeStepBudget(
          PROVISION_STEP_SILENCE_BASE_MS,
          PROVISION_STEP_MAX_EXPIRIES,
        ),
        keepalive,
      });
      if (res.ok) return { ok: true, path: res.outPath };
      const why = `${label} could not take ${path}: ${res.reason}`;
      if (
        res.kind === "failed" ||
        isLocalHost(ssh) ||
        !isDarwinSystem(hostNix.system)
      )
        return { ok: false, message: why };
      // A Mac takes only the signed form, and this machine's build is signed
      // by no one: its Nix must trust the login.
      return {
        ok: false,
        message: `${why}. ${label} takes a profile built here only when its Nix trusts the login kolu connects as: on ${label}, add it to \`nix.settings.trusted-users\`.`,
      };
    },
    pull: async ({ ssh, label, hostNix, published, onProgress }) => {
      const route = closureRoute(hostNix, published);
      const { storePath } = route;
      // kolu's own root ("latest", like surface-remote's per-agent roots).
      const rootPath = gcRoot(ssh, PACKAGE_GC_ROOT);
      const res = await pullClosure({
        host: ssh,
        cacheUrl: bake.cache.url,
        storePath,
        ...(route.kind === "signed" ? { signedBy: bake.cache.publicKey } : {}),
        rootPath,
        onProgress,
        keepalive,
        // One delivery is one attempt: its root commit gets a fresh budget,
        // and upstream's schedule (not a redial loop) is what retries it.
        budget: makeStepBudget(
          PROVISION_STEP_SILENCE_BASE_MS,
          PROVISION_STEP_MAX_EXPIRIES,
        ),
      });
      if (res.ok) return { ok: true, bundle: storePath };
      if (res.kind === "failed") return { ok: false, message: res.reason };
      // Nix's own line inside kolu-server's words — and for a signed bundle,
      // why the host was sent it and the one-line fix for the trust it needs.
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
    },
  };
}
