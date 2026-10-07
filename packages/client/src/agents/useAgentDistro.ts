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

import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  LOCAL_HOST,
} from "kolu-common/hostKey";
import type { AgentDistroListing } from "kolu-common/surface";
import { createEffect, createMemo, createRoot, mapArray, on } from "solid-js";
import { toast } from "solid-sonner";
import { hostLabel } from "../host/hostChipTone";
import { app, hostKeys, padiMap, preferences } from "../wire";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import {
  type AgentMark,
  type AgentStatusLine,
  agentMarkOf,
  agentStatusLines,
  type HostAgentStatus,
} from "@kolu/agent-distro/status";
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
      // "Checking": the host is up and agents are on, but its status cell has
      // not sent its first frame. Derived here from the cell's own pending
      // state; padi has no such status.
      const checking = () =>
        preferences().agentDistro.enabled &&
        padiMap.entry(host).state().kind === "connected" &&
        sub.pending();
      return { enc, host, read: () => sub.value(), checking };
    },
  );
  const index = createMemo(
    () => new Map(roots().map((entry) => [entry.enc, entry])),
  );
  return { index, roots };
});

/** `host`'s agent-distro facts: its status (`undefined` until the first frame)
 *  and whether we are still waiting for it. `label` is how Settings names it. */
export function hostAgentStatus(host: HostKey, label: string): HostAgentStatus {
  const entry = byHost.index().get(encodeHostKey(host));
  return {
    label,
    status: entry?.read(),
    checking: entry?.checking() ?? false,
  };
}

/** How `host`'s tab shows its agents — the shared fold over its facts. */
export function hostAgentMark(host: HostKey): AgentMark {
  const { status, checking } = hostAgentStatus(host, "");
  return agentMarkOf(status, checking);
}

/** The status lines under Settings' Agents row: this machine, then the remote
 *  pool members (the fold decides which of them show). */
export function agentStatusLinesNow(): readonly AgentStatusLine[] {
  return agentStatusLines({
    local: hostAgentStatus(LOCAL_HOST, "this machine"),
    remotes: byHost
      .roots()
      .filter(({ host }) => host.kind !== "local")
      .map(({ host }) => hostAgentStatus(host, hostLabel(host))),
  });
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
