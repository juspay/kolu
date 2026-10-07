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
      // The first download on a host is the one moment worth a toast: from then
      // on its next new terminal has the agents.
      createEffect(
        on(
          () => sub.value(),
          (now, prev) => {
            if (prev?.kind === "downloading" && now?.kind === "ready")
              toast.success(`Agents ready on ${hostLabel(host)}`);
            if (prev?.kind === "downloading" && now?.kind === "error")
              toast.error(
                `Agents could not be downloaded on ${hostLabel(host)}: ${now.message}`,
              );
          },
        ),
      );
      return { enc, read: () => sub.value() };
    },
  );
  return createMemo(() => new Map(roots().map(({ enc, read }) => [enc, read])));
});

/** `host`'s agent-distro status, or `undefined` until its first frame. */
export function agentDistroStatusOf(
  host: HostKey,
): AgentDistroStatus | undefined {
  return byHost().get(encodeHostKey(host))?.();
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

/** "1.1 GB", "640 MB" — the unit a download reads in. */
export function formatBytes(bytes: number): string {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${Math.round(bytes / 1e6)} MB`;
}

/** The words for a status that needs any: "Downloading agents… 1.1 GB of 2.0 GB",
 *  or the updater's own error message. `undefined` for the quiet states. */
export function agentDistroStatusText(
  status: AgentDistroStatus | undefined,
): { text: string; tone: "busy" | "error" } | undefined {
  if (status === undefined) return undefined;
  switch (status.kind) {
    case "downloading":
      return {
        tone: "busy",
        text:
          status.progress === undefined
            ? "Downloading agents…"
            : `Downloading agents… ${formatBytes(status.progress.done)} of ${formatBytes(status.progress.total)}`,
      };
    case "error":
      return { tone: "error", text: status.message };
    case "off":
    case "unavailable":
    case "ready":
      return undefined;
    default:
      return status satisfies never;
  }
}
