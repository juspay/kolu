/**
 * The real {@link DeliveryOps}. Two moves, neither of them Nix on this machine:
 *
 *   - which bundle: one HTTPS GET of upstream's content-addressed index
 *     (`@kolu/agent-distro/caIndex`) per system and profile;
 *   - getting it there: `@kolu/surface-remote`'s `pullClosure` — the HOST runs
 *     `nix copy --from <cache>` for the content-addressed path and roots it.
 *     The host's system comes from `resolveSystem`.
 *
 * Why the host pulls and needs no trust: Nix gives an UNTRUSTED user two ways
 * to obtain an input-addressed store path — substitute it from a cache the
 * DAEMON is configured with, or build it. A CONTENT-ADDRESSED path is
 * different: every daemon takes it from anyone, and `nix copy --from` reads a
 * store directly rather than proposing a substituter, so no `trusted-users`
 * entry, no key and no `nix.conf` edit is needed anywhere (`pullClosure`'s
 * header). agent-distro's CI publishes that rewrite for every system it
 * builds, Macs included.
 */

import type { AgentDistroDelivery } from "@kolu/agent-distro/bake";
import { caIndexUrl, parseCaIndexEntry } from "@kolu/agent-distro/caIndex";
import {
  DEFAULT_SSH_KEEPALIVE,
  homeGcRoot,
  isLocalHost,
  makeStepBudget,
  PROVISION_STEP_MAX_EXPIRIES,
  PROVISION_STEP_SILENCE_BASE_MS,
  pullClosure,
  resolveSystem,
} from "@kolu/surface-remote";
import type { DeliveryOps } from "./delivery.ts";

/** How long one index read may take — a small JSON file off a CDN. */
const INDEX_TIMEOUT_MS = 30_000;

/** Read `profile`'s newest published bundle for `system` off the index at
 *  `index` (`fetchText` injectable for tests). Every failure throws in words
 *  the host's failure line carries as is: a 404 says upstream has not
 *  published that bundle; a request that never got an answer, any other
 *  status, or a body that is not an index entry names the URL. */
export async function readPublishedBundle(
  index: string,
  system: string,
  profile: string,
  fetchText: (
    url: string,
  ) => Promise<{ readonly status: number; readonly text: string }> = async (
    url,
  ) => {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(INDEX_TIMEOUT_MS),
    });
    return { status: res.status, text: await res.text() };
  },
) {
  const url = caIndexUrl(index, system, profile);
  let answer: { readonly status: number; readonly text: string };
  try {
    answer = await fetchText(url);
  } catch (err) {
    // `fetch` rejects with a bare "fetch failed" and the real reason (DNS, no
    // egress, TLS, the timeout) on its `cause`.
    const cause =
      err instanceof Error && err.cause !== undefined ? err.cause : err;
    throw new Error(
      `agent-distro's index at ${url} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
      { cause: err },
    );
  }
  const { status, text } = answer;
  if (status === 404)
    throw new Error(
      `agent-distro has not published the ${profile} agents for ${system} yet`,
    );
  if (status !== 200)
    throw new Error(
      `agent-distro's index answered HTTP ${status} for ${url}: ${text.slice(0, 200)}`,
    );
  try {
    return parseCaIndexEntry(text);
  } catch (err) {
    throw new Error(
      `agent-distro's index entry at ${url} is not { rev, ca }: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** The real operations, for `bake`'s index and cache. */
export function realDeliveryOps(bake: AgentDistroDelivery): DeliveryOps {
  // The interactive default on purpose: every ssh to a host shares ONE
  // ControlMaster keyed by its keepalive, padi's own dial's included.
  const keepalive = DEFAULT_SSH_KEEPALIVE;
  return {
    systemOf: (ssh) => resolveSystem(ssh, { onProgress: () => {}, keepalive }),
    published: (system, profile) =>
      readPublishedBundle(bake.index, system, profile),
    pull: ({ ssh, storePath, profile, onProgress }) => {
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
      return pullClosure({
        host: ssh,
        cacheUrl: bake.cache,
        storePath,
        rootPath,
        onProgress,
        onActivity: () => {},
        budget: makeStepBudget(
          PROVISION_STEP_SILENCE_BASE_MS,
          PROVISION_STEP_MAX_EXPIRIES,
        ),
        keepalive,
      });
    },
  };
}
