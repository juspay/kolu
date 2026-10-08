/**
 * The client's view of agent-distro — the Agents setting's live facts.
 *
 *   - the profile LISTING kolu-server read from its baked picker (what Settings
 *     offers);
 *   - each host's agent STATUS (padi's `agentDistroStatus` cell): whether the
 *     selected profile's agents are on that machine, being downloaded, or failed
 *     — and whether an update is running there;
 *   - each host's RECEIPT (padi's `agentDistroReceipt` cell): the versions it
 *     serves, its last update run and its recent update history.
 *
 * Three app-lifetime reactions ride here too, colocated with the facts they
 * react to: toasts at a host's download moments (its mark's words,
 * `agentMarkWords`), a toast when an update lands on a host (the updater's own
 * words, from its receipt), and an error toast when the stored profile is not
 * one this kolu ships (the setting is never silently changed — the user picks a
 * real one in Settings). "Check now" is here too: one call per host.
 */

import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  LOCAL_HOST,
} from "kolu-common/hostKey";
import type {
  AgentDistroReceipt,
  AgentDistroStatus,
} from "@kolu/agent-distro/schema";
import { agoPhrase } from "@kolu/terminal-vocab/duration";
import { Effect } from "effect";
import type { AgentDistroListing, AgentDistroPrefs } from "kolu-common/surface";
import {
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  mapArray,
  on,
} from "solid-js";
import { toast } from "solid-sonner";
import { hostDisplayName } from "../host/hostChipTone";
import { runAction } from "../runAction";
import { useServerIdentity } from "../useServerIdentity";
import { getNowTicker } from "../terminal/staleness";
import { app, hostKeys, padiMap, preferences } from "../wire";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import {
  type AgentMark,
  type AgentStatusLine,
  type AgentUpdateHistoryRow,
  agentCheckFailed,
  agentDistroSettingOf,
  agentMarkOf,
  agentMarkWords,
  agentStatusLines,
  agentToast,
  agentUpdateCheckable,
  agentUpdateHistoryRows,
  agentUpdateRunning,
  type HostAgentStatus,
  unknownProfileMessage,
  unknownProfileOf,
} from "@kolu/agent-distro/status";
import { watchDownload } from "./firstDownload";

/** The server's identity (its hostname names the local machine), shared. */
const serverIdentity = useServerIdentity();

/** How every agents surface names `host` — the status lines, the History, the
 *  toasts, the tab mark's hover, a tile pill's hover — exactly as the host tab
 *  does (`hostDisplayName`): the local machine by its hostname, a remote by its
 *  target. ONE writer for "what is this host called", so a fleet's lines never
 *  mix a real name with an ambiguous "this machine". */
export function agentsWhere(host: HostKey): string {
  return hostDisplayName(host, serverIdentity.hostname());
}

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
      const entry = padiMap.entry(host);
      const sub = entry.cells.agentDistroStatus.use();
      const receiptSub = entry.cells.agentDistroReceipt.use();
      // "3h ago" for a time this host stamped: through its clock fence (a
      // remote padi's stamps are ITS clock). The shared 60 s tick only re-runs
      // the phrase; the phrase reads the real now — the tick's value can be up
      // to a minute old, older than an event that just happened, which would
      // read as clock skew ("—").
      const tick = getNowTicker();
      const ago = (at: number) => {
        tick();
        return agoPhrase(entry.clock.toLocal(at), Date.now());
      };
      // An update landed: toast once the receipt for that very bundle is in,
      // quoting the updater's own words. padi publishes the receipt before the
      // status, but they are two cells — so the edge waits for its receipt.
      const [landed, setLanded] = createSignal<string | undefined>();
      createEffect(() => {
        const bundle = landed();
        if (bundle === undefined) return;
        const receipt = receiptSub.value();
        if (receipt?.bundle !== bundle) return;
        setLanded(undefined);
        const run = receipt.lastRun;
        // Not an update this padi ran (say, the bundle moved under it): there
        // are no updater words to quote, so there is nothing to announce.
        if (run?.outcome !== "updated") return;
        const words = agentToast.updated(agentsWhere(host), run.words);
        toast.success(words.title, {
          description: words.description,
          icon: AgentDistroLogo({ size: 16 }),
        });
      });
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
          if (moment === "updated") {
            if (status.kind === "ready") setLanded(status.bundle);
            return;
          }
          const words = agentMarkWords(
            agentMarkOf(status, false),
            agentsWhere(host),
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
      return {
        enc,
        host,
        read: () => sub.value(),
        receipt: () => receiptSub.value(),
        ago,
        checking,
      };
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
  const entry = hostEntry(host);
  return {
    label,
    status: hostAgentStatusOf(host),
    checking: hostAgentChecking(host),
    receipt: entry?.receipt(),
    // A host not in the pool yet has no receipt, so no times to phrase; its
    // clock fence is the only honest way to phrase one, so never guess.
    ago:
      entry?.ago ??
      (() => {
        throw new Error(`no clock for agents host ${label}: not in the pool`);
      }),
  };
}

/** This machine's receipt — `undefined` until its first frame. */
export function localAgentReceipt(): AgentDistroReceipt | undefined {
  return hostEntry(LOCAL_HOST)?.receipt();
}

/** Every pool member's facts, the local machine first, labelled as Settings names
 *  them. */
function everyHostAgentStatus(): readonly HostAgentStatus[] {
  return [
    hostAgentStatus(LOCAL_HOST, agentsWhere(LOCAL_HOST)),
    ...byHost
      .roots()
      .filter(({ host }) => host.kind !== "local")
      .map(({ host }) => hostAgentStatus(host, agentsWhere(host))),
  ];
}

/** How `host`'s tab shows its agents — the shared fold over its facts. */
export function hostAgentMark(host: HostKey): AgentMark {
  return agentMarkOf(hostAgentStatusOf(host), hostAgentChecking(host));
}

/** The status lines under Settings' Agents row: the local machine, then the remote
 *  pool members (the fold decides which of them show). */
export function agentStatusLinesNow(): readonly AgentStatusLine[] {
  const [local, ...remotes] = everyHostAgentStatus();
  if (local === undefined) throw new Error("no local host status");
  return agentStatusLines({ local, remotes });
}

/** The History rows under the status lines: each machine's recent update
 *  events for the selected profile. */
export function agentUpdateHistoryNow(): readonly AgentUpdateHistoryRow[] {
  return agentUpdateHistoryRows({
    hosts: everyHostAgentStatus(),
    profile: agentDistroSetting().profile,
  });
}

/** Is a run of the updater going on any machine, for any profile — the Check
 *  now button's busy state. */
export function agentUpdateRunningNow(): boolean {
  return agentUpdateRunning(byHost.roots().map(({ receipt }) => receipt()));
}

/** "Check now": ask every machine that serves agents to run its update check
 *  at once — one call per host. A host that refuses because a run is already
 *  going there is an ordinary answer; any other failure is that host's toast. */
export function checkAgentsNow(): void {
  for (const { host, read } of byHost.roots()) {
    // Only a connected host that is ready with no run there: a disconnected
    // host's last-known `ready` is not a host that can answer (the backups
    // dialog's precedent).
    if (padiMap.entry(host).state().kind !== "connected") continue;
    if (!agentUpdateCheckable(read())) continue;
    runAction(
      "check for newer agents",
      padiMap
        .entry(host)
        .procedures.agentDistro.checkNow()
        .pipe(
          Effect.catchTag("AgentDistroCheckRefused", () => Effect.void),
          Effect.catch((err) =>
            Effect.sync(() => {
              toast.error(
                agentCheckFailed(
                  agentsWhere(host),
                  err instanceof Error ? err.message : String(err),
                ),
              );
            }),
          ),
        ),
    );
  }
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
