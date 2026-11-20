import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  LOCAL_HOST,
} from "kolu-common/hostKey";
import type {
  AgentDistroReceipt,
  AgentDistroStatus,
  AgentProfiles,
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
} from "solid-js";
import { toast } from "solid-sonner";
import { hostDisplayName } from "../host/hostChipTone";
import { runAction } from "../runAction";
import { useServerIdentity } from "../useServerIdentity";
import { getNowTicker } from "../terminal/staleness";
import { app, hostKeys, padiMap, preferences } from "../wire";
import AgentDistroLogo from "@kolu/agent-distro/solid";
import {
  type AgentFleetGroup,
  type AgentHostDetail,
  type AgentMark,
  agentCheckFailed,
  agentDistroSettingOf,
  agentFleetSummary,
  agentHostDetail,
  agentMarkOf,
  agentToast,
  receiptSet,
  updateWords,
  type HostAgentStatus,
} from "@kolu/agent-distro/status";
import { watchLanding } from "./watchLanding";

const serverIdentity = useServerIdentity();

export function agentsWhere(host: HostKey): string {
  return hostDisplayName(host, serverIdentity.hostname());
}

const listingSub = createRoot(() => app.cells.agentDistroListing.use());

export function agentDistroListing(): AgentDistroListing | undefined {
  return listingSub.value();
}

const profilesSub = createRoot(() => app.cells.agentProfiles.use());

export function agentProfilesNow(): AgentProfiles | undefined {
  return profilesSub.value();
}

export function agentDistroStored(): AgentDistroPrefs | null {
  return preferences().agentDistro;
}

export const agentDistroSetting = createRoot(() =>
  createMemo(() => agentDistroSettingOf(agentDistroStored())),
);

function agoOnHostClock(
  clock: { toLocal: (at: number) => number | null },
  tick: () => void,
): (at: number) => string {
  return (at) => {
    tick();
    return agoPhrase(clock.toLocal(at), Date.now());
  };
}

const byHost = createRoot(() => {
  const roots = mapArray(
    () => hostKeys().map(encodeHostKey),
    (enc) => {
      const host = decodeHostKey(enc);
      const entry = padiMap.entry(host);
      const sub = entry.cells.agentDistroStatus.use();
      const receiptSub = entry.cells.agentDistroReceipt.use();
      const tick = getNowTicker();
      const ago = agoOnHostClock(entry.clock, tick);
      const [landed, setLanded] = createSignal<string | undefined>();
      createEffect(() => {
        const set = landed();
        if (set === undefined) return;
        const receipt = receiptSub.value();
        if (receipt === undefined || receiptSet(receipt) !== set) return;
        setLanded(undefined);
        const run = receipt.lastRun;
        if (run?.outcome !== "updated") return;
        const words = agentToast.updated(agentsWhere(host), updateWords(run));
        toast.success(words.title, {
          description: words.description,
          icon: AgentDistroLogo({ size: 16 }),
        });
      });
      watchLanding(() => sub.value(), setLanded);
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

export function hostAgentStatusOf(
  host: HostKey,
): AgentDistroStatus | undefined {
  return hostEntry(host)?.read();
}

function hostAgentChecking(host: HostKey): boolean {
  return hostEntry(host)?.checking() ?? false;
}

function hostAgentStatus(host: HostKey, label: string): HostAgentStatus {
  const entry = hostEntry(host);
  return {
    label,
    status: hostAgentStatusOf(host),
    checking: hostAgentChecking(host),
    receipt: entry?.receipt(),
    ago:
      entry?.ago ??
      (() => {
        throw new Error(`no clock for agents host ${label}: not in the pool`);
      }),
  };
}

export function localAgentReceipt(): AgentDistroReceipt | undefined {
  return hostEntry(LOCAL_HOST)?.receipt();
}

function everyHostAgentStatus(): readonly (HostAgentStatus & {
  readonly host: HostKey;
})[] {
  return [
    {
      host: LOCAL_HOST,
      ...hostAgentStatus(LOCAL_HOST, agentsWhere(LOCAL_HOST)),
    },
    ...byHost
      .roots()
      .filter(({ host }) => host.kind !== "local")
      .map(({ host }) => ({
        host,
        ...hostAgentStatus(host, agentsWhere(host)),
      })),
  ];
}

export function hostAgentMark(host: HostKey): AgentMark {
  return agentMarkOf(
    hostAgentStatusOf(host),
    hostAgentChecking(host),
    hostEntry(host)?.receipt(),
  );
}

export function agentFleetNow(): readonly AgentFleetGroup<
  HostAgentStatus & { readonly host: HostKey }
>[] {
  return agentFleetSummary(everyHostAgentStatus());
}

export function hostAgentDetail(host: HostKey): AgentHostDetail | undefined {
  return agentHostDetail({
    host: hostAgentStatus(host, agentsWhere(host)),
    setting: agentDistroSetting(),
  });
}

function deliverAgents(host: HostKey | null, where: string): void {
  runAction(
    "check for newer agents",
    app.procedures.agentDistro.deliver({ host }).pipe(
      Effect.catch((err) =>
        Effect.sync(() => {
          toast.error(
            agentCheckFailed(
              where,
              err instanceof Error ? err.message : String(err),
            ),
          );
        }),
      ),
    ),
  );
}

export function checkAgentsOn(host: HostKey): void {
  deliverAgents(host, agentsWhere(host));
}

export function checkAgentsNow(): void {
  deliverAgents(null, "every machine");
}
