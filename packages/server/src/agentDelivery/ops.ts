/**
 * The real {@link DeliveryOps}. Which bundle: one HTTPS GET of upstream's
 * content-addressed index per system (`@kolu/surface-remote`'s
 * `readPublishedClosure`, the `latest/` entry). Getting it there:
 * `@kolu/surface-remote`'s `pullClosure` — the host pulls the path from
 * agent-distro's cache and roots it (its header says what trust each form
 * needs), in the form `closureRoute` picks from the host's Nix: the
 * content-addressed rewrite, which needs no trust, or the signed bundle, which
 * needs the host's Nix to trust the login or the cache's key. This machine
 * runs no Nix for either. kolu's own words — the profile, the per-profile GC
 * root, the trust fix a refusal names — stay here.
 */

import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import {
  closureRoute,
  DEFAULT_SSH_KEEPALIVE,
  type FetchText,
  fetchClosureIndex,
  homeGcRoot,
  isLocalHost,
  type PublishedClosure,
  pullClosure,
  readPublishedClosure,
  resolveHostNix,
  signedBecause,
} from "@kolu/surface-remote";
import type { DeliveryOps } from "./delivery.ts";

/** Read `profile`'s newest published bundle for `system` off agent-distro's
 *  index at `index` — its `latest/` entry, through the framework's reader
 *  (`fetchText` injectable for tests). A 404 throws in words the host's
 *  failure line carries as is (upstream has not published that bundle); the
 *  reader's own errors (no answer, another status, not an entry) name the
 *  URL. */
export async function readPublishedBundle(
  index: string,
  system: string,
  profile: string,
  fetchText: FetchText = fetchClosureIndex,
): Promise<PublishedClosure> {
  const read = await readPublishedClosure(
    fetchText,
    { rawBase: index },
    "latest",
    system,
    profile,
  );
  if (read.kind === "not-published")
    throw new Error(
      `agent-distro has not published the ${profile} agents for ${system} yet`,
    );
  return read.entry;
}

/** The real operations, for `bake`'s index and cache. */
export function realDeliveryOps(bake: AgentDistroDelivery): DeliveryOps {
  // The interactive default on purpose: every ssh to a host shares ONE
  // ControlMaster keyed by its keepalive, padi's own dial's included.
  const keepalive = DEFAULT_SSH_KEEPALIVE;
  return {
    hostNixOf: (ssh) =>
      resolveHostNix(ssh, { onProgress: () => {}, keepalive }),
    published: (system, profile) =>
      readPublishedBundle(bake.index, system, profile),
    pull: async ({ ssh, label, hostNix, published, profile, onProgress }) => {
      const route = closureRoute(hostNix, published);
      const { storePath } = route;
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
      const res = await pullClosure({
        host: ssh,
        cacheUrl: bake.cache.url,
        storePath,
        ...(route.kind === "signed" ? { signedBy: bake.cache.publicKey } : {}),
        rootPath,
        onProgress,
        keepalive,
      });
      if (res.ok) return { ok: true, bundle: storePath };
      if (res.kind === "failed") return { ok: false, message: res.reason };
      // Nix's own line inside kolu-server's words — and for a signed bundle,
      // why the host was sent it and the one-line fix for the trust it needs.
      const why = `${label} could not pull the ${profile} agents (${storePath}) from agent-distro's cache (${bake.cache.url}): ${res.reason}`;
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
