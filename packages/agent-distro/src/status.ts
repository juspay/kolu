/**
 * The words kolu shows for agent-distro — pure functions of a host's status, a
 * profile or a setting; no subscriptions. Their volatility is the copy (a
 * reworded status, a new hint line), apart from the live facts the client
 * subscribes to.
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

/** The words for a status that needs any: "Downloading agents… 1.1 GB of 2.0 GB",
 *  or the updater's own error message. `undefined` for the quiet states. */
export function agentDistroStatusText(
  status: AgentDistroStatusShape | undefined,
): { text: string; tone: "busy" | "error" } | undefined {
  if (status === undefined) return undefined;
  switch (status.kind) {
    case "downloading":
      return {
        tone: "busy",
        text:
          // A total of 0 is a run with nothing left to fetch (the host already
          // had every path): "0 MB of 0 MB" would be noise, not progress.
          status.progress === undefined || status.progress.total === 0
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

/** One host's agent-distro status, for the fleet lines under the Agents row. */
export interface HostAgentStatus {
  readonly label: string;
  readonly status: AgentDistroStatusShape | undefined;
}

/** The Agents row's hint, line by line:
 *
 *   - off: what turning it on does;
 *   - an unknown stored profile: the warning (never reset);
 *   - on: the profile's description; its agents with versions; THIS machine's
 *     status ("Ready for new terminals — vanilla 3fa9c2d1", the download bytes,
 *     or the error); then one line per REMOTE host that is downloading or
 *     failed, so the fleet shows from here.
 *
 *  `warn` when anything it reports is an error. */
export function agentsHint(input: {
  readonly setting: AgentDistroSettingShape;
  readonly listing: AgentDistroListing | undefined;
  readonly local: AgentDistroStatusShape | undefined;
  readonly remotes: readonly HostAgentStatus[];
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
  const profile = listing.profiles.find((p) => p.name === setting.profile);
  if (profile === undefined)
    return {
      text: `"${setting.profile}" is not a profile this kolu ships — pick one.`,
      tone: "warn",
    };
  let warn = false;
  const lines = [profile.description, harnessLine(profile)];
  const local = input.local;
  if (local?.kind === "ready")
    lines.push(
      `Ready for new terminals — ${local.profile} ${agentBundleShortHash(local.bundle)}`,
    );
  else {
    const text = agentDistroStatusText(local);
    if (text !== undefined) {
      lines.push(text.text);
      warn ||= text.tone === "error";
    }
  }
  for (const remote of input.remotes) {
    const s = remote.status;
    if (s?.kind === "downloading") {
      const bytes =
        s.progress === undefined || s.progress.total === 0
          ? ""
          : ` ${formatBytes(s.progress.done)} of ${formatBytes(s.progress.total)}`;
      lines.push(`Downloading on ${remote.label}…${bytes}`);
    } else if (s?.kind === "error") {
      lines.push(`Failed on ${remote.label}: ${s.message}`);
      warn = true;
    }
  }
  return { text: lines.join("\n"), tone: warn ? "warn" : "muted" };
}
