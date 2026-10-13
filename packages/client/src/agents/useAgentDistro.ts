/**
 * The client's view of agent-distro — the Agents setting's live facts.
 *
 *   - the profile LISTING kolu-server read off the floor's profile bundles
 *     (what Settings offers);
 *   - each host's agent STATUS (padi's `agentDistroStatus` cell): whether the
 *     selected profile's agents are on that machine, being downloaded, or failed
 *     — and whether an update is running there;
 *   - each host's RECEIPT (padi's `agentDistroReceipt` cell): the versions it
 *     serves, its last update run and its recent update history.
 *
 *   - whether the setting's profile RESOLVES on this machine (the local padi's
 *     `agentDistroResolved` cell), for the line under Settings' profile field.
 *
 * One app-lifetime reaction rides here too, colocated with the facts it
 * reacts to: a toast when an update lands on a host (the history's own words,
 * from its receipt). "Check now" is here too: kolu-server delivers, so it is
 * one call to kolu-server, for one host or all.
 */

import {
  decodeHostKey,
  encodeHostKey,
  type HostKey,
  LOCAL_HOST,
} from "kolu-common/hostKey";
import type {
  AgentDistroReceipt,
  AgentDistroResolved,
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
  type HostAgentStatus,
} from "@kolu/agent-distro/status";
import { watchLanding } from "./watchLanding";

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

// This machine's answer only: the field it explains is this machine's
// setting, and a remote host's agents are its status line's to describe.
const resolvedSub = createRoot(() =>
  padiMap.entry(LOCAL_HOST).cells.agentDistroResolved.use(),
);

/** Whether the setting's profile resolves on this machine — `undefined` until
 *  its first frame. */
export function localAgentResolved(): AgentDistroResolved | undefined {
  return resolvedSub.value();
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
      // quoting the history's own words. padi publishes the receipt before the
      // status, but they are two cells — so the edge waits for its receipt.
      const [landed, setLanded] = createSignal<string | undefined>();
      createEffect(() => {
        const bundle = landed();
        if (bundle === undefined) return;
        const receipt = receiptSub.value();
        if (receipt?.bundle !== bundle) return;
        setLanded(undefined);
        const run = receipt.lastRun;
        // Not a landing this padi recorded (say, the bundle moved under it):
        // there are no words to quote, so there is nothing to announce.
        if (run?.outcome !== "updated") return;
        const words = agentToast.updated(agentsWhere(host), run.words);
        toast.success(words.title, {
          description: words.description,
          icon: AgentDistroLogo({ size: 16 }),
        });
      });
      watchLanding(() => sub.value(), setLanded);
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

/** Every pool member's facts, the local machine first, each carrying the host
 *  it is about so a surface can open that machine's details. */
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

/** How `host`'s tab shows its agents — the shared fold over its facts. */
export function hostAgentMark(host: HostKey): AgentMark {
  return agentMarkOf(hostAgentStatusOf(host), hostAgentChecking(host));
}

/** Settings' ONE fleet line: the local machine first, then every remote pool
 *  member, grouped by state (`agentFleetSummary`). */
export function agentFleetNow(): readonly AgentFleetGroup<
  HostAgentStatus & { readonly host: HostKey }
>[] {
  return agentFleetSummary(everyHostAgentStatus());
}

/** What `host`'s details say about its agents (`agentHostDetail`) —
 *  `undefined` when there are no agents to describe there. */
export function hostAgentDetail(host: HostKey): AgentHostDetail | undefined {
  return agentHostDetail({
    host: hostAgentStatus(host, agentsWhere(host)),
    setting: agentDistroSetting(),
    listing: agentDistroListing(),
  });
}

/** Ask kolu-server to deliver the newest agents to `host` (every connected
 *  machine for `null`) now — after a failure too, which is how a fixed machine
 *  is tried again. It answers once the delivery has started; each machine's
 *  status cells say how it ends, so only a call that never reached kolu-server
 *  is a toast. */
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

/** Check ONE machine for newer agents: its host-details row. */
export function checkAgentsOn(host: HostKey): void {
  deliverAgents(host, agentsWhere(host));
}

/** The palette's "Check for newer coding agents": every machine kolu reaches,
 *  in one delivery run (one read of upstream's index per system). */
export function checkAgentsNow(): void {
  deliverAgents(null, "every machine");
}
