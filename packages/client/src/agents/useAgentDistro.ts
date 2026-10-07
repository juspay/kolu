/**
 * The client's view of agent-distro — the Agents setting's live facts.
 *
 *   - the profile LISTING kolu-server read from its baked picker (what Settings
 *     offers);
 *   - each host's agent STATUS (padi's `agentDistroStatus` cell): whether the
 *     selected profile's agents are on that machine, being downloaded, or failed.
 *
 * Two app-lifetime reactions ride here too, colocated with the facts they react
 * to: a toast when a host's first download lands ("Agents ready on <host>"), and
 * an error toast when the stored profile is not one this kolu ships (the setting
 * is never silently changed — the user picks a real one in Settings).
 */

import type { AgentDistroStatus } from "@kolu/padi-client/surface";
import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
} from "kolu-common/hostKey";
import type { AgentDistroListing } from "kolu-common/surface";
import { createEffect, createMemo, createRoot, mapArray, on } from "solid-js";
import { toast } from "solid-sonner";
import { hostLabel } from "../host/hostChipTone";
import { app, hostKeys, padiMap, preferences } from "../wire";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import type { HostAgentStatus } from "@kolu/agent-distro/status";
import { watchDownload } from "./firstDownload";

// App-lifetime, owned subscriptions — the `useForwards` reason: a bare module
// `.use()` is torn down a microtask after load and its first frame lands on nobody.
const listingSub = createRoot(() => app.cells.agentDistroListing.use());

/** The profile listing, or `undefined` until its first frame. */
export function agentDistroListing(): AgentDistroListing | undefined {
  return listingSub.value();
}

/** Per-host status reads, one subscription per pool member. */
const byHost = createRoot(() => {
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (enc) => {
      const host = decodeHostKey(enc);
      const sub = padiMap.entry(host).cells.agentDistroStatus.use();
      // A host's download is worth a toast at each of its three moments: one
      // loading toast when it starts, updated in place (`{ id }`) to success —
      // its next new terminal has the agents — or to the error.
      let toastId: string | number | undefined;
      watchDownload(() => sub.value(), {
        onStart: () => {
          toastId = toast.loading(`Downloading agents on ${hostLabel(host)}…`, {
            icon: AgentDistroLogo({ size: 16 }),
          });
        },
        onReady: () =>
          toast.success(`Agents ready on ${hostLabel(host)}`, {
            id: toastId,
            icon: AgentDistroLogo({ size: 16 }),
          }),
        onError: (message) =>
          toast.error(
            `Agents could not be downloaded on ${hostLabel(host)}: ${message}`,
            { id: toastId, icon: AgentDistroLogo({ size: 16 }) },
          ),
      });
      return { enc, host, read: () => sub.value() };
    },
  );
  const index = createMemo(
    () => new Map(roots().map(({ enc, read }) => [enc, read])),
  );
  return { index, roots };
});

/** `host`'s agent-distro status, or `undefined` until its first frame. */
export function agentDistroStatusOf(
  host: HostKey,
): AgentDistroStatus | undefined {
  return byHost.index().get(encodeHostKey(host))?.();
}

/** Every REMOTE pool member's status, for the fleet lines under Settings'
 *  Agents row. */
export function remoteAgentStatuses(): readonly HostAgentStatus[] {
  return byHost
    .roots()
    .filter(({ host }) => host.kind !== "local")
    .map(({ host, read }) => ({ label: hostLabel(host), status: read() }));
}

/** The stored profile, when the listing does not offer it. */
export function unknownAgentProfile(): string | undefined {
  const listing = agentDistroListing();
  if (listing?.kind !== "available") return undefined;
  const { profile } = preferences().agentDistro;
  return listing.profiles.some((p) => p.name === profile) ? undefined : profile;
}

createRoot(() =>
  createEffect(
    on(unknownAgentProfile, (profile) => {
      if (profile === undefined) return;
      toast.error(
        `Agents profile "${profile}" is not one this kolu ships — pick one in Settings → Agents.`,
      );
    }),
  ),
);
