/**
 * How kolu shows agent-distro — pure functions of a host's status, a profile or
 * a setting; no subscriptions. The one fold from a host's status to how its tab
 * mark and Settings line look (`agentMarkOf`), and the words around it. Their
 * volatility is the presentation (a reworded status, a new treatment), apart
 * from the live facts the client subscribes to.
 *
 * The status and setting types here are STRUCTURAL: the wire schemas live in
 * `@kolu/padi-client`'s surface (the cells padi serves), and this package
 * imports nothing from padi, the server or the client. The client asserts at
 * compile time that the wire types and these are the same shape
 * (`client/src/agents/statusShape.ts`), so the two cannot drift.
 */

import { agentBundleShortHash } from "./bundle.ts";
import type { AgentDistroListing, AgentDistroProfile } from "./listing.ts";

/** A host's agent-distro state for the currently selected profile — the
 *  shape of `@kolu/padi-client`'s `AgentDistroStatus`. */
export type AgentDistroStatusShape =
  | { readonly kind: "off" }
  | { readonly kind: "unavailable" }
  | {
      readonly kind: "downloading";
      readonly profile: string;
      readonly progress?: { readonly done: number; readonly total: number };
    }
  | {
      readonly kind: "ready";
      readonly profile: string;
      readonly bundle: string;
    }
  | {
      readonly kind: "error";
      readonly profile: string;
      readonly message: string;
    };

/** The Agents setting — the shape of `@kolu/padi-client`'s
 *  `AgentDistroSetting` and kolu's `agentDistro` preference. */
export interface AgentDistroSettingShape {
  readonly enabled: boolean;
  readonly profile: string;
}

/** "1.1 GB", "640 MB" — the unit a download reads in. */
export function formatBytes(bytes: number): string {
  return bytes >= 1e9
    ? `${(bytes / 1e9).toFixed(1)} GB`
    : `${Math.round(bytes / 1e6)} MB`;
}

/** "1.1 GB of 2.0 GB" for a download's progress, or `undefined` when there are no
 *  numbers to say. A total of 0 is a run with nothing left to fetch (the host
 *  already had every path): "0 MB of 0 MB" would be noise, not progress. */
export function downloadBytes(
  progress: { readonly done: number; readonly total: number } | undefined,
): string | undefined {
  return progress === undefined || progress.total === 0
    ? undefined
    : `${formatBytes(progress.done)} of ${formatBytes(progress.total)}`;
}

/** How much of a download is done, 0 to 1 — the fill of the tab's ring and of
 *  the Settings bar. 0 while there are no numbers yet. */
function downloadFraction(
  progress: { readonly done: number; readonly total: number } | undefined,
): number {
  return progress === undefined || progress.total === 0
    ? 0
    : Math.min(1, progress.done / progress.total);
}

/** How a host shows its agents: the treatment of its tab's agent-distro mark,
 *  and of its line in Settings.
 *
 *   - `none`: no mark at all (agents off on this host, a padi without the bake,
 *     or a host we cannot hear from) — the tab is as it would be without agents;
 *   - `checking`: the host is connected and agents are on, but its status has not
 *     arrived yet (a dimmed mark with a spinning arc);
 *   - `ready`: the selected profile is on the host for new terminals;
 *   - `downloading`: the host is fetching it (a ring filling with bytes);
 *   - `failed`: the download failed (the warning colour and a dot). */
export type AgentMark =
  | { readonly kind: "none" }
  | { readonly kind: "checking" }
  | { readonly kind: "ready"; readonly profile: string; readonly hash: string }
  | {
      readonly kind: "downloading";
      readonly fraction: number;
      readonly bytes: string | undefined;
    }
  | { readonly kind: "failed"; readonly message: string };

/** THE fold from a host's status to how it shows. Every surface that paints a
 *  host's agents (the tab mark, the Settings line) goes through it, and it is
 *  fenced (`satisfies never`): a new status kind must decide here, once.
 *
 *  `checking` is the client's own fact (connected, agents on, and the status
 *  cell has not sent its first frame); there is no server state for it. */
export function agentMarkOf(
  status: AgentDistroStatusShape | undefined,
  checking: boolean,
): AgentMark {
  if (checking) return { kind: "checking" };
  if (status === undefined) return { kind: "none" };
  switch (status.kind) {
    case "off":
    case "unavailable":
      return { kind: "none" };
    case "ready":
      return {
        kind: "ready",
        profile: status.profile,
        hash: agentBundleShortHash(status.bundle),
      };
    case "downloading":
      return {
        kind: "downloading",
        fraction: downloadFraction(status.progress),
        bytes: downloadBytes(status.progress),
      };
    case "error":
      return { kind: "failed", message: status.message };
    default:
      return status satisfies never;
  }
}

/** The one-line fix under a failed download. A failure is remembered per
 *  profile until the setting turns that profile on again — the only retry. */
export const AGENTS_RETRY =
  "Fix that, then turn Agents off and back on in Settings to retry.";

/** A mark's words: its tooltip (beside the bar while downloading) and its
 *  accessible name. `undefined` for `none`, which shows nothing. */
export function agentMarkLabel(mark: AgentMark): string | undefined {
  switch (mark.kind) {
    case "none":
      return undefined;
    case "checking":
      return "Agents: checking…";
    case "ready":
      return `Agents: ${mark.profile} ${mark.hash} · ready for new terminals`;
    case "downloading":
      return mark.bytes === undefined
        ? "Downloading agents…"
        : `Downloading agents… ${mark.bytes}`;
    case "failed":
      return `Agents: ${mark.message}\n${AGENTS_RETRY}`;
    default:
      return mark satisfies never;
  }
}

/** What a profile puts on the PATH, as the Settings hint's second line:
 *  "claude 2.1.291 · codex 0.80.1 · omp 18.7.0 · …" — each harness's command
 *  name (what you type) and version, in the listing's order. */
export function harnessLine(profile: AgentDistroProfile): string {
  return profile.harnesses.map((h) => `${h.name} ${h.version}`).join(" · ");
}

/** The Settings "Agents" segment that means off. Not a profile name: agent-distro
 *  reserves `default` and the harness names, and `agentsSegments` refuses a
 *  listing that ships a profile called this. */
export const AGENTS_OFF = "off";

/** The segments of the one Agents control: Off, then one per profile. */
export function agentsSegments(
  profiles: readonly AgentDistroProfile[],
): readonly { value: string; label: string; hint?: string }[] {
  if (profiles.some((p) => p.name === AGENTS_OFF))
    throw new Error(
      `agent-distro ships a profile named '${AGENTS_OFF}', which Settings uses for Off`,
    );
  return [
    { value: AGENTS_OFF, label: "Off" },
    ...profiles.map((p) => ({
      value: p.name,
      label: p.name,
      hint: p.description,
    })),
  ];
}

/** Which segment the Agents control shows for a setting. */
export function agentsSegmentOf(setting: AgentDistroSettingShape): string {
  return setting.enabled ? setting.profile : AGENTS_OFF;
}

/** One host's agent-distro facts, for its line in Settings. */
export interface HostAgentStatus {
  readonly label: string;
  readonly status: AgentDistroStatusShape | undefined;
  /** Connected, agents on, and no status frame yet (see {@link agentMarkOf}). */
  readonly checking: boolean;
}

/** One status line under the Agents row: the host, a bar, and a short text. */
export interface AgentStatusLine {
  readonly host: string;
  /** The bar's colour: accent while downloading, ok when ready, warning when
   *  failed, and an empty bar when there is nothing to fill. */
  readonly bar: "busy" | "ok" | "warn" | "empty";
  /** The bar's fill, 0 to 1. */
  readonly fill: number;
  readonly text: string;
}

function statusLine(host: HostAgentStatus): AgentStatusLine {
  const mark = agentMarkOf(host.status, host.checking);
  const line = (
    bar: AgentStatusLine["bar"],
    fill: number,
    text: string,
  ): AgentStatusLine => ({ host: host.label, bar, fill, text });
  switch (mark.kind) {
    case "ready":
      return line("ok", 1, `ready · ${mark.profile} ${mark.hash}`);
    case "downloading":
      return line("busy", mark.fraction, mark.bytes ?? "downloading…");
    case "failed":
      return line("warn", 1, mark.message);
    case "checking":
      return line("empty", 0, "checking…");
    case "none":
      return line(
        "empty",
        0,
        host.status === undefined
          ? "not connected"
          : host.status.kind === "unavailable"
            ? "built without agent-distro"
            : "off",
      );
    default:
      return mark satisfies never;
  }
}

/** The status lines under the Agents row: this machine first, then every remote
 *  host that is not ready. When EVERY host is ready they collapse into the first
 *  line ("ready · vanilla 8rcmf6rd · on 3 hosts"), so the row stays short in the
 *  common case. */
export function agentStatusLines(input: {
  readonly local: HostAgentStatus;
  readonly remotes: readonly HostAgentStatus[];
}): readonly AgentStatusLine[] {
  const local = statusLine(input.local);
  const remotes = input.remotes.map(statusLine);
  const notReady = remotes.filter((l) => l.bar !== "ok");
  if (local.bar === "ok" && notReady.length === 0 && remotes.length > 0)
    return [
      { ...local, text: `${local.text} · on ${remotes.length + 1} hosts` },
    ];
  return [local, ...notReady];
}

/** The profile the setting selects, when agents are on and the listing ships
 *  it — the one case where the Agents row shows its status lines. */
export function selectedAgentProfile(
  setting: AgentDistroSettingShape,
  listing: AgentDistroListing | undefined,
): AgentDistroProfile | undefined {
  if (!setting.enabled || listing?.kind !== "available") return undefined;
  return listing.profiles.find((p) => p.name === setting.profile);
}

/** The Agents row's hint:
 *
 *   - off: what turning it on does;
 *   - an unknown stored profile: the warning (never reset);
 *   - on: the profile's description, then its agents with versions. Where each
 *     host stands is the status lines' job ({@link agentStatusLines}). */
export function agentsHint(input: {
  readonly setting: AgentDistroSettingShape;
  readonly listing: AgentDistroListing | undefined;
}): { readonly text: string; readonly tone: "muted" | "warn" } | undefined {
  const { setting, listing } = input;
  if (listing === undefined) return undefined;
  if (listing.kind === "unavailable")
    return {
      text: "This kolu was built without agent-distro, so there are no agents to choose from.",
      tone: "muted",
    };
  if (!setting.enabled)
    return {
      text: "Off. Pick a profile to put agent-distro's agents first on the PATH of new terminals, ahead of agents you installed yourself.",
      tone: "muted",
    };
  const profile = selectedAgentProfile(setting, listing);
  if (profile === undefined)
    return {
      text: `"${setting.profile}" is not a profile this kolu ships — pick one.`,
      tone: "warn",
    };
  return {
    text: [profile.description, harnessLine(profile)].join("\n"),
    tone: "muted",
  };
}

/** The agents a terminal was spawned with — the two fields its record carries
 *  (both set, or neither when agents were off at spawn). */
export interface TerminalAgentsShape {
  readonly agentProfile?: string;
  readonly agentBundle?: string;
}

/** Whether a terminal's agents are still what a NEW terminal on its host would
 *  get. `stale` names what it has and what a new terminal gets now — `off`, or
 *  a profile with its short hash when the host has said which bundle (a host
 *  still downloading the new profile has not). */
export type AgentStaleness =
  | { readonly kind: "current" }
  | {
      readonly kind: "stale";
      readonly had: { readonly profile: string; readonly hash: string };
      readonly now:
        | { readonly kind: "off" }
        | {
            readonly kind: "profile";
            readonly profile: string;
            readonly hash: string | undefined;
          };
    };

/** THE stale test, one fold: a terminal is stale when it has agents and a new
 *  terminal on its host would get different ones —
 *
 *   - agents are now off;
 *   - the setting names a different profile;
 *   - same profile, but the host's ready bundle is a different build (an update
 *     landed).
 *
 *  A terminal without agents is never stale (turning agents on does not nag the
 *  terminals that predate it), and a host that has not settled on a bundle
 *  (downloading, failed, no frame yet) does not make a same-profile terminal
 *  stale: there is nothing yet to restart into. Fenced over the status kind. */
export function agentStalenessOf(input: {
  readonly terminal: TerminalAgentsShape;
  readonly status: AgentDistroStatusShape | undefined;
  readonly setting: AgentDistroSettingShape;
}): AgentStaleness {
  const { agentProfile, agentBundle } = input.terminal;
  if (agentProfile === undefined || agentBundle === undefined)
    return { kind: "current" };
  const had = {
    profile: agentProfile,
    hash: agentBundleShortHash(agentBundle),
  };
  const { setting, status } = input;
  if (!setting.enabled) return { kind: "stale", had, now: { kind: "off" } };
  // The bundle a new terminal gets, when the host has settled on one for the
  // selected profile.
  const ready =
    status?.kind === "ready" && status.profile === setting.profile
      ? status.bundle
      : undefined;
  if (setting.profile !== agentProfile)
    return {
      kind: "stale",
      had,
      now: {
        kind: "profile",
        profile: setting.profile,
        hash: ready === undefined ? undefined : agentBundleShortHash(ready),
      },
    };
  if (status === undefined) return { kind: "current" };
  switch (status.kind) {
    case "ready":
      return ready !== undefined && ready !== agentBundle
        ? {
            kind: "stale",
            had,
            now: {
              kind: "profile",
              profile: setting.profile,
              hash: agentBundleShortHash(ready),
            },
          }
        : { kind: "current" };
    case "off":
    case "unavailable":
    case "downloading":
    case "error":
      return { kind: "current" };
    default:
      return status satisfies never;
  }
}

/** Can a stale terminal restart INTO something right now? Yes when agents are
 *  now off (it restarts as a plain shell), or when the host has settled on the
 *  bundle a new terminal gets. Not while the new profile is still downloading
 *  (or failed): a restart then would come back with no agents at all. */
export function agentRestartReady(
  stale: Extract<AgentStaleness, { kind: "stale" }>,
): boolean {
  return stale.now.kind === "off" || stale.now.hash !== undefined;
}

/** The stale pill's tooltip: what this terminal has, what a new one gets, and
 *  what a restart does — the agent's conversation comes back on the new agents
 *  while agents stay on; with agents now off it comes back as a plain shell. */
export function agentStaleLabel(
  stale: Extract<AgentStaleness, { kind: "stale" }>,
): string {
  const had = `This terminal has ${stale.had.profile} ${stale.had.hash}.`;
  const { now } = stale;
  if (now.kind === "off")
    return `${had} Agents are now off. Restart to switch; it comes back as a plain shell, and running programs end.`;
  if (now.hash === undefined)
    return `${had} New terminals get ${now.profile}, which is still downloading on this host; Restart appears once it is ready.`;
  return `${had} New terminals get ${now.profile} ${now.hash}. Restart to switch; the agent's conversation resumes on the new agents, other programs end.`;
}
