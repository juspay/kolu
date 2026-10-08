/**
 * The client's view of agent-distro — the Agents setting's live facts.
 *
 *   - the profile LISTING kolu-server read from its baked picker (what Settings
 *     offers);
 *   - each host's agent STATUS (padi's `agentDistroStatus` cell): whether the
 *     selected profile's agents are on that machine, being downloaded, or failed.
 *
 * Two app-lifetime reactions ride here too, colocated with the facts they react
 * to: toasts at a host's download moments (its mark's words, `agentMarkWords`), and an error
 * toast when the stored profile is not one this kolu ships (the setting
 * is never silently changed — the user picks a real one in Settings).
 */

import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  LOCAL_HOST,
} from "kolu-common/hostKey";
import type { AgentDistroStatus } from "@kolu/agent-distro/schema";
import type { AgentDistroListing, AgentDistroPrefs } from "kolu-common/surface";
import { createEffect, createMemo, createRoot, mapArray, on } from "solid-js";
import { toast } from "solid-sonner";
import { hostLabel } from "../host/hostChipTone";
import { app, hostKeys, padiMap, preferences } from "../wire";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import {
  type AgentMark,
  type AgentStatusLine,
  agentDistroSettingOf,
  agentMarkOf,
  agentMarkWords,
  agentStatusLines,
  type HostAgentStatus,
  unknownProfileMessage,
  unknownProfileOf,
} from "@kolu/agent-distro/status";
import { watchDownload } from "./firstDownload";

// App-lifetime, owned subscriptions — the `useForwards` reason: a bare module
// `.use()` is torn down a microtask after load and its first frame lands on nobody.
const listingSub = createRoot(() => app.cells.agentDistroListing.use());

/** The profile listing, or `undefined` until its first frame. */
export function agentDistroListing(): AgentDistroListing | undefined {
  return listingSub.value();
}

/** The STORED Agents preference — `null` while nobody has chosen. Read only
 *  where that difference shows: the first-run step and the Agents control. */
export function agentDistroStored(): AgentDistroPrefs | null {
  return preferences().agentDistro;
}

/** The Agents setting new terminals get — the stored value through the one fold
 *  (`agentDistroSettingOf`: never chosen is off). Every other reader uses this. */
export const agentDistroSetting = createRoot(() =>
  createMemo(() => agentDistroSettingOf(agentDistroStored())),
);

/** Per-host status reads, one subscription per pool member. */
const byHost = createRoot(() => {
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (enc) => {
      const host = decodeHostKey(enc);
      const sub = padiMap.entry(host).cells.agentDistroStatus.use();
      // A host's download is worth a toast at each of its moments: one loading
      // toast when it starts, updated in place (`{ id }`) to success — its next
      // new terminal has the agents — or to the error, or closed when agents
      // are turned off under it. Its words are the host mark's own.
      let toastId: string | number | undefined;
      watchDownload(
        () => sub.value(),
        (moment, status) => {
          if (moment === "dropped") {
            if (toastId !== undefined) toast.dismiss(toastId);
            toastId = undefined;
            return;
          }
          const words = agentMarkWords(
            agentMarkOf(status, false),
            hostLabel(host),
          );
          if (words === undefined)
            throw new Error(`a ${moment} download moment with no words`);
          const options = {
            description: words.detail.join("\n") || undefined,
            icon: AgentDistroLogo({ size: 16 }),
          };
          switch (moment) {
            case "start":
              // No timeout: it stands until the download settles, then
              // becomes the success or the error below (same id).
              toastId = toast.loading(words.title, {
                ...options,
                duration: Number.POSITIVE_INFINITY,
              });
              return;
            case "ready":
              toast.success(words.title, { ...options, id: toastId });
              return;
            case "failed":
              toast.error(words.title, { ...options, id: toastId });
              return;
            default:
              return moment satisfies never;
          }
        },
      );
      // "Checking": the host is up and agents are on, but its status cell has
      // not sent its first frame. Derived here from the cell's own pending
      // state; padi has no such status.
      const checking = () =>
        agentDistroSetting().enabled &&
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

function hostEntry(host: HostKey) {
  return byHost.index().get(encodeHostKey(host));
}

/** `host`'s agent-distro status — `undefined` until its first frame. The plain
 *  read, for a reader that needs only that fact. */
export function hostAgentStatusOf(
  host: HostKey,
): AgentDistroStatus | undefined {
  return hostEntry(host)?.read();
}

/** Still waiting for `host`'s first status frame (see `checking` above). */
function hostAgentChecking(host: HostKey): boolean {
  return hostEntry(host)?.checking() ?? false;
}

/** `host`'s agent-distro facts for its line in Settings: its status, whether we
 *  are still waiting for it, and `label`, how Settings names the host. */
function hostAgentStatus(host: HostKey, label: string): HostAgentStatus {
  return {
    label,
    status: hostAgentStatusOf(host),
    checking: hostAgentChecking(host),
  };
}

/** How `host`'s tab shows its agents — the shared fold over its facts. */
export function hostAgentMark(host: HostKey): AgentMark {
  return agentMarkOf(hostAgentStatusOf(host), hostAgentChecking(host));
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

/** The stored profile, when the listing does not offer it (`unknownProfileOf`). */
export function unknownAgentProfile(): string | undefined {
  return unknownProfileOf(agentDistroSetting(), agentDistroListing());
}

createRoot(() =>
  createEffect(
    on(unknownAgentProfile, (profile) => {
      if (profile === undefined) return;
      toast.error(unknownProfileMessage(profile));
    }),
  ),
);
