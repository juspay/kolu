/**
 * How kolu shows agent-distro — pure functions of a host's status, a profile or
 * a setting; no subscriptions. The one fold from a host's status to how its tab
 * mark and Settings line look (`agentMarkOf`), and the words around it. Their
 * volatility is the presentation (a reworded status, a new treatment), apart
 * from the live facts the client subscribes to.
 *
 * The status and setting types are `./schema.ts`'s — the very schemas padi's
 * cells carry — so a field added to the wire is a field these folds handle.
 */

import { formatBytes } from "@kolu/byte-units";
import { agentBundleShortHash } from "./bundle.ts";
import { DEFAULT_AGENT_PROFILE } from "./manifest.ts";
import type {
  AgentDistroFailureReason,
  AgentDistroSetting,
  AgentDistroStatus,
  TerminalAgents,
} from "./schema.ts";
import type { AgentDistroListing, AgentDistroProfile } from "./listing.ts";

/** What "never chosen" means for new terminals: off, on the default profile, so
 *  turning agents on later starts there. ONE shared value, so a reader of the
 *  fold sees no change on an unrelated preference write while nothing is chosen. */
const NEVER_CHOSEN_SETTING: AgentDistroSetting = Object.freeze({
  enabled: false,
  profile: DEFAULT_AGENT_PROFILE,
});

/** Has anyone chosen yet? THE one test for "never chosen" — the absence of a
 *  value. Every fold here that cares asks it; read elsewhere only where that
 *  difference shows: the first-run step and the Agents control's selection and
 *  hint. */
export function agentsChosen(
  stored: AgentDistroSetting | null,
): stored is AgentDistroSetting {
  return stored !== null;
}

/** THE fold from the stored Agents preference to the setting it means. `null`
 *  is "nobody has chosen yet", and it behaves as off ({@link NEVER_CHOSEN_SETTING}).
 *  Every consumer that needs the effective setting (the push to padi, a tile's
 *  pill, the status lines) reads it through here, so `null` is handled in
 *  exactly one place and padi's wire schema never sees it. */
export function agentDistroSettingOf(
  stored: AgentDistroSetting | null,
): AgentDistroSetting {
  return agentsChosen(stored) ? stored : NEVER_CHOSEN_SETTING;
}

/** The whole value a pick on the Agents control writes — the ONE writer both
 *  the Settings row and the first-run step go through. Off keeps the profile
 *  already stored, so turning agents back on returns to it. */
export function agentDistroChoice(
  segment: string,
  stored: AgentDistroSetting | null,
): AgentDistroSetting {
  return segment === AGENTS_OFF
    ? { enabled: false, profile: agentDistroSettingOf(stored).profile }
    : { enabled: true, profile: segment };
}

/** Is the first-run "choose your agents" step done? `undefined` is "not known
 *  yet" — the step is then neither asked nor done: while the profile listing
 *  has not arrived (without it the step could only offer Off), and while this
 *  machine's status has not caught up with a choice (below). Otherwise:
 *
 *   - a kolu built without agents (`unavailable` listing): done — there is
 *     nothing to choose;
 *   - nothing chosen: not done;
 *   - Off chosen, or a stored profile this kolu does not ship (Settings warns
 *     about it; its status would never reach `ready`): done;
 *   - a profile chosen: done once this machine has settled with it — the agents
 *     are there (`ready`) or its padi has none to fetch (`unavailable`). While
 *     this machine is still downloading, or the download failed, the step
 *     stays, so a first-run user watches the agents arrive. Until this
 *     machine's status has caught up with the choice — no frame yet, padi
 *     still `off`, or a status for another profile — it is not known yet
 *     (`undefined`), so a user who already chose never sees the row flash on a
 *     reload or after a kolu-server restart. A padi that never leaves `off`
 *     after a choice therefore leaves the step neither asked nor done, by
 *     design: there is nothing true to show about it.
 *
 *  That last reading is deliberate beyond the first run too: switching to a
 *  profile this machine must download, in Settings while no terminals are open,
 *  brings the row back until the download lands — watching it arrive is the
 *  same job. Fenced over the status kind. */
export function firstRunAgentsDone(input: {
  readonly stored: AgentDistroSetting | null;
  /** The profile listing, `undefined` until its first frame. */
  readonly listing: AgentDistroListing | undefined;
  /** This machine's status, `undefined` until its first frame. */
  readonly local: AgentDistroStatus | undefined;
}): boolean | undefined {
  const { stored, listing, local } = input;
  if (listing === undefined) return undefined;
  if (listing.kind === "unavailable") return true;
  if (!agentsChosen(stored)) return false;
  if (!stored.enabled) return true;
  if (unknownProfileOf(stored, listing) !== undefined) return true;
  if (local === undefined) return undefined;
  switch (local.kind) {
    case "unavailable":
      return true;
    case "off":
      return undefined;
    case "ready":
    case "downloading":
    case "error":
      // A status for another profile is one padi has not caught up from.
      if (local.profile !== stored.profile) return undefined;
      return local.kind === "ready";
    default:
      return local satisfies never;
  }
}

/** The first-run step's title — what the welcome card asks. */
export const AGENTS_FIRST_RUN_TITLE = "Choose your coding agents";

/** The welcome card's done line for the first-run step, from the choice —
 *  `undefined` in a kolu built without agents, where nobody chose anything and
 *  the step is done only because there is nothing to choose. */
export function agentsChosenLabel(
  setting: AgentDistroSetting,
  listing: AgentDistroListing | undefined,
): string | undefined {
  if (listing?.kind === "unavailable") return undefined;
  return setting.enabled ? `Agents: ${setting.profile} ✓` : `Agents off ✓`;
}

/** What the Settings hint adds while nothing is chosen. */
export const AGENTS_NOT_CHOSEN =
  "Nothing chosen yet, so new terminals get no coding agents until you pick.";

/** "1.1 GiB of 2.0 GiB" for a download's progress (`@kolu/byte-units`' binary
 *  units — the units Nix reports the bundle in), or `undefined` when there are no
 *  numbers to say. A total of 0 is a run with nothing left to fetch (the host
 *  already had every path): "0 MB of 0 MB" would be noise, not progress. */
export function downloadBytes(
  progress: { readonly done: number; readonly total: number } | undefined,
): string | undefined {
  return progress === undefined || progress.total === 0
    ? undefined
    : `${formatBytes(progress.done)} of ${formatBytes(progress.total)}`;
}

/** The least a download's ring and bar ever show, so "downloading, nothing
 *  counted yet" never looks the same as an empty track. */
export const DOWNLOAD_MIN_FILL = 0.06;

/** How much of a download is done, {@link DOWNLOAD_MIN_FILL} to 1 — the fill of
 *  the tab's ring and of the Settings bar. */
function downloadFraction(
  progress: { readonly done: number; readonly total: number } | undefined,
): number {
  const done =
    progress === undefined || progress.total === 0
      ? 0
      : progress.done / progress.total;
  return Math.min(1, Math.max(DOWNLOAD_MIN_FILL, done));
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
  | {
      readonly kind: "none";
      /** Why there is no mark: agents are off on the host, the host's padi has
       *  no agents built in, or we have not heard from the host. */
      readonly why: "off" | "unavailable" | "unheard";
    }
  | { readonly kind: "checking" }
  | { readonly kind: "ready"; readonly profile: string; readonly hash: string }
  | {
      readonly kind: "downloading";
      readonly fraction: number;
      readonly bytes: string | undefined;
    }
  | {
      readonly kind: "failed";
      readonly reason: AgentDistroFailureReason;
      readonly message: string;
    };

/** THE fold from a host's status to how it shows. Every surface that paints a
 *  host's agents (the tab mark, the Settings line) goes through it, and it is
 *  fenced (`satisfies never`): a new status kind must decide here, once.
 *
 *  `checking` is the client's own fact (connected, agents on, and the status
 *  cell has not sent its first frame); there is no server state for it. */
export function agentMarkOf(
  status: AgentDistroStatus | undefined,
  checking: boolean,
): AgentMark {
  if (checking) return { kind: "checking" };
  if (status === undefined) return { kind: "none", why: "unheard" };
  switch (status.kind) {
    case "off":
      return { kind: "none", why: "off" };
    case "unavailable":
      return { kind: "none", why: "unavailable" };
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
      return { kind: "failed", reason: status.reason, message: status.message };
    default:
      return status satisfies never;
  }
}

/** The one-line retry under a failed download — worded HERE only (padi's
 *  messages state the cause, never the retry). A failure is remembered per
 *  profile until the setting turns that profile on again — the only retry. */
export const AGENTS_RETRY =
  "Fix that, then switch Agents off and back on in Settings to try again.";

/** The host-setup remedy for a failure, by its typed reason — `undefined` when
 *  the cause (the updater's own words) already says what to do. */
export function agentFailureRemedy(
  reason: AgentDistroFailureReason,
): string | undefined {
  switch (reason) {
    case "nixMissing":
      return "Make `nix` reachable for non-login ssh sessions: add /nix/var/nix/profiles/default/bin to PATH in /etc/environment (or at the very top of ~/.bashrc, before any early return for non-interactive shells).";
    case "updater":
      return undefined;
    default:
      return reason satisfies never;
  }
}

/** A failed download's words, in the one order every surface shows them — the
 *  cause, the remedy (by reason, when there is one), the retry — each once. The
 *  tab mark's hover, the failure toast and the Settings line all read this. */
export function agentFailureLines(
  failure: {
    readonly reason: AgentDistroFailureReason;
    readonly message: string;
  },
  where: string,
): readonly [string, ...string[]] {
  const remedy = agentFailureRemedy(failure.reason);
  return [
    `The coding agents could not be downloaded to ${where}: ${failure.message}`,
    ...(remedy === undefined ? [] : [remedy]),
    AGENTS_RETRY,
  ];
}

/** A mark's words, as a headline and the lines under it — the ONE wording its
 *  hover, the download toasts and the Settings line share. `where` names the
 *  machine — "this machine" for the local tab, the host's own label on a
 *  remote one. A download's bytes are not in it: each surface shows
 *  `mark.bytes` beside its own bar. `undefined` for `none`. */
export function agentMarkWords(
  mark: AgentMark,
  where: string,
): { readonly title: string; readonly detail: readonly string[] } | undefined {
  switch (mark.kind) {
    case "none":
      return undefined;
    case "checking":
      return { title: `Coding agents: checking ${where}…`, detail: [] };
    case "ready":
      return {
        title: `Coding agents ready on ${where}: ${mark.profile} (${mark.hash}) — new terminals there start with them`,
        detail: [],
      };
    case "downloading":
      return {
        title: `Downloading the coding agents to ${where}…`,
        detail: [],
      };
    case "failed": {
      const [title, ...detail] = agentFailureLines(mark, where);
      return { title, detail };
    }
    default:
      return mark satisfies never;
  }
}

/** A mark's words as one text — its accessible name, with a download's bytes
 *  after the headline. `undefined` for `none`. */
export function agentMarkLabel(
  mark: AgentMark,
  where: string,
): string | undefined {
  const words = agentMarkWords(mark, where);
  if (words === undefined) return undefined;
  const bytes =
    mark.kind === "downloading" && mark.bytes !== undefined
      ? ` ${mark.bytes}`
      : "";
  return [`${words.title}${bytes}`, ...words.detail].join("\n");
}

/** The agents a profile brings, named the way people know them, with their
 *  versions: "Claude Code 2.1.291 · Codex 0.160.1 · Oh My Pi 18.6.3 · …" —
 *  each harness's title and version from the listing, in its order. Never
 *  hand-written: it is whatever the pinned agent-distro ships. */
export function harnessLine(profile: AgentDistroProfile): string {
  return profile.harnesses.map((h) => `${h.title} ${h.version}`).join(" · ");
}

/** What each profile kolu ships IS, in plain words, written to sit mid-sentence
 *  (lower-case start unless it opens with a name). Upstream's own descriptions
 *  assume you already know agent-distro ("Upstream harnesses with your own
 *  provider"), so Settings leads with these and keeps upstream's text in the
 *  hover. A profile with no entry is refused at kolu-server boot
 *  (`assertPlainProfiles`): a pin bump that adds one must add its sentence. */
export const PROFILE_PLAIN: Readonly<Record<string, string>> = {
  vanilla: "stock agents, your own API keys",
  juspay: "Juspay's agents and skills, through Juspay's gateway",
};

/** `profile`'s plain description (see {@link PROFILE_PLAIN}); throws for a
 *  profile kolu has no words for. */
export function plainProfileDescription(profile: AgentDistroProfile): string {
  const plain = PROFILE_PLAIN[profile.name];
  if (plain === undefined)
    throw new Error(
      `kolu has no plain description for agent-distro profile '${profile.name}' — add it to PROFILE_PLAIN in @kolu/agent-distro/status`,
    );
  return plain;
}

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** "a", "a or b", "a, b or c". */
function orList(items: readonly string[]): string {
  return items.length <= 1
    ? (items[0] ?? "")
    : `${items.slice(0, -1).join(", ")} or ${items[items.length - 1]}`;
}

/** What Off means, in the one wording every surface uses (the Off segment's
 *  hover, the row's hint, the toast). */
export const AGENTS_OFF_MEANS =
  "New terminals use only the agents you installed yourself.";

/** The Settings "Agents" segment that means off. Not a profile name: agent-distro
 *  reserves `default` and the harness names, and `agentsSegments` refuses a
 *  listing that ships a profile called this. */
export const AGENTS_OFF = "off";

/** The Agents control's test-id prefix: each segment is
 *  `${AGENTS_SEGMENT_TESTID}-${value}` (the client's `SegmentedControl`
 *  convention), so the e2e suite clicks the very segment Settings renders. */
export const AGENTS_SEGMENT_TESTID = "agents-profile";

/** The segments of the one Agents control: Off, then one per profile. */
export function agentsSegments(
  profiles: readonly AgentDistroProfile[],
): readonly { value: string; label: string; hint?: string }[] {
  if (profiles.some((p) => p.name === AGENTS_OFF))
    throw new Error(
      `agent-distro ships a profile named '${AGENTS_OFF}', which Settings uses for Off`,
    );
  return [
    {
      value: AGENTS_OFF,
      label: "Off",
      hint: AGENTS_OFF_MEANS,
    },
    ...profiles.map((p) => ({
      value: p.name,
      label: p.name,
      hint: `${capitalize(plainProfileDescription(p))}.\nagent-distro describes it as: ${p.description}`,
    })),
  ];
}

/** Which segment the Agents control shows for a setting. */
function agentsSegmentOf(setting: AgentDistroSetting): string {
  return setting.enabled ? setting.profile : AGENTS_OFF;
}

/** The segment the Agents control shows PRESSED for the stored value — none
 *  while nothing is chosen, because nothing is. */
export function agentsPressedSegment(
  stored: AgentDistroSetting | null,
): string | undefined {
  return agentsChosen(stored) ? agentsSegmentOf(stored) : undefined;
}

/** kolu's default profile, as the listing carries it — THE one reading of
 *  "the default is the listing's first": kolu-server refuses a listing that
 *  does not lead with kolu's default profile. `undefined` when the listing has
 *  not arrived, the build ships no agents, or it lists no profiles. */
function defaultProfileOf(
  listing: AgentDistroListing | undefined,
): AgentDistroProfile | undefined {
  return listing?.kind === "available" ? listing.profiles[0] : undefined;
}

/** The segment that holds the Agents control's keyboard focus while none is
 *  pressed: the default profile ({@link defaultProfileOf}), so Enter picks it.
 *  Off when there is none. */
export function agentsRestingSegment(
  listing: AgentDistroListing | undefined,
): string {
  return defaultProfileOf(listing)?.name ?? AGENTS_OFF;
}

/** One host's agent-distro facts, for its line in Settings. */
export interface HostAgentStatus {
  readonly label: string;
  readonly status: AgentDistroStatus | undefined;
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

/** A status line's words for a host with no mark, by the fold's reason. */
const NONE_LINE: Record<Extract<AgentMark, { kind: "none" }>["why"], string> = {
  off: "agents off",
  unavailable: "no coding agents in this build",
  unheard: "not connected",
};

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
      // The whole failure text: the line shows its start, its hover all of it.
      return line("warn", 1, agentFailureLines(mark, host.label).join("\n"));
    case "checking":
      return line("empty", 0, "checking…");
    case "none":
      return line("empty", 0, NONE_LINE[mark.why]);
    default:
      return mark satisfies never;
  }
}

/** The status lines under the Agents row: this machine first, then every remote
 *  host that is not ready. When EVERY host is ready they collapse into the first
 *  line ("ready · vanilla 8rcmf6rd · on 3 hosts" — the hash only when every
 *  machine holds that same build), so the row stays short in the common case. */
export function agentStatusLines(input: {
  readonly local: HostAgentStatus;
  readonly remotes: readonly HostAgentStatus[];
}): readonly AgentStatusLine[] {
  const local = statusLine(input.local);
  const remotes = input.remotes.map(statusLine);
  const notReady = remotes.filter((l) => l.bar !== "ok");
  if (local.bar === "ok" && notReady.length === 0 && remotes.length > 0) {
    // Every machine is ready. They name ONE build only when they all hold the
    // same one — this machine's built-in bundle and a remote's download are
    // different store paths of the same profile, and the folded line must not
    // claim the remote has this machine's hash.
    const marks = [input.local, ...input.remotes].map((h) =>
      agentMarkOf(h.status, h.checking),
    );
    const first = marks[0];
    const shared =
      first?.kind === "ready" &&
      marks.every(
        (m) =>
          m.kind === "ready" &&
          m.profile === first.profile &&
          m.hash === first.hash,
      );
    const what =
      first?.kind !== "ready"
        ? local.text
        : shared
          ? `ready · ${first.profile} ${first.hash}`
          : `ready · ${first.profile}`;
    return [{ ...local, text: `${what} · on ${remotes.length + 1} hosts` }];
  }
  return [local, ...notReady];
}

/** The stored profile, when the listing does not offer it — the ONE test for a
 *  saved choice kolu no longer (or never) ships. The choice is never reset:
 *  Settings warns and a toast says so ({@link unknownProfileMessage}). */
export function unknownProfileOf(
  setting: AgentDistroSetting,
  listing: AgentDistroListing | undefined,
): string | undefined {
  if (listing?.kind !== "available") return undefined;
  return listing.profiles.some((p) => p.name === setting.profile)
    ? undefined
    : setting.profile;
}

/** The one wording of {@link unknownProfileOf}'s answer. */
export function unknownProfileMessage(profile: string): string {
  return `Your saved coding-agents choice "${profile}" is not one this kolu offers — pick one in Settings → Agents.`;
}

/** The profile the setting selects, when agents are on and the listing ships
 *  it — the one case where the Agents row shows its status lines. */
export function selectedAgentProfile(
  setting: AgentDistroSetting,
  listing: AgentDistroListing | undefined,
): AgentDistroProfile | undefined {
  if (!setting.enabled || listing?.kind !== "available") return undefined;
  return listing.profiles.find((p) => p.name === setting.profile);
}

/** The opening of both Agents hints: what kolu can bring. */
const AGENTS_LEAD =
  "Kolu can bring AI coding agents along — kept up to date, nothing to install:";

/** What Off means, as a choice's line in both hints. */
const AGENTS_OFF_LINE = `Off — ${AGENTS_OFF_MEANS}`;

/** The welcome card's form of the Agents hint — the same vocabulary as
 *  {@link agentsHint}, laid out for a welcome row: the lead with the agents of
 *  the profile in view on ONE line, then ONE line for `segment` — the control's
 *  keyboard tab stop, which it reports — so ← → read each choice out and the
 *  two lines never disagree. On Off the lead names the default profile's
 *  agents, what kolu would bring. `undefined` until the listing arrives, and
 *  for a kolu built without agents (the step does not ask there). */
export function agentsStepHint(input: {
  readonly listing: AgentDistroListing | undefined;
  readonly segment: string | undefined;
}): { readonly lead: string; readonly choice: string | undefined } | undefined {
  const { listing, segment } = input;
  if (listing?.kind !== "available") return undefined;
  const profile = listing.profiles.find((p) => p.name === segment);
  const inView = profile ?? defaultProfileOf(listing);
  const agents = inView === undefined ? "" : harnessLine(inView);
  const lead = agents === "" ? AGENTS_LEAD : `${AGENTS_LEAD} ${agents}`;
  if (segment === AGENTS_OFF) return { lead, choice: AGENTS_OFF_LINE };
  return {
    lead,
    choice:
      profile === undefined
        ? undefined
        : `${profile.name} — ${plainProfileDescription(profile)}`,
  };
}

/** The Agents row's hint, written for someone who has never heard of
 *  agent-distro, a profile or the PATH — what they get, then what to do:
 *
 *   - off: that kolu can bring AI coding agents along, which ones (the default
 *     profile's, from the listing, with versions), what each choice means, what
 *     happens to new terminals, and what Off means;
 *   - nothing chosen yet: the same, then that nothing is chosen
 *     ({@link AGENTS_NOT_CHOSEN});
 *   - an unknown stored choice: the warning (never reset);
 *   - on: what the chosen profile is, in plain words, then its agents with
 *     versions. Where each machine stands is the status lines' job
 *     ({@link agentStatusLines}).
 *
 *  It takes the STORED value — `null` while nothing is chosen — because that
 *  difference is one of the things it says. */
export function agentsHint(input: {
  readonly stored: AgentDistroSetting | null;
  readonly listing: AgentDistroListing | undefined;
}): { readonly text: string; readonly tone: "muted" | "warn" } | undefined {
  const { listing } = input;
  const setting = agentDistroSettingOf(input.stored);
  if (listing === undefined) return undefined;
  if (listing.kind === "unavailable")
    return {
      text: "This kolu was built without coding agents, so there is nothing to choose here.",
      tone: "muted",
    };
  if (!setting.enabled) {
    // The default profile's agents: the one a first choice most likely is.
    const lead = defaultProfileOf(listing);
    const choices = listing.profiles.map(
      (p) => `${p.name} (${plainProfileDescription(p)})`,
    );
    return {
      text: [
        AGENTS_LEAD,
        ...(lead === undefined ? [] : [harnessLine(lead)]),
        `Pick ${orList(choices)}. New terminals then start with those agents; what you installed yourself stays as a fallback.`,
        AGENTS_OFF_LINE,
        ...(agentsChosen(input.stored) ? [] : [AGENTS_NOT_CHOSEN]),
      ].join("\n"),
      tone: "muted",
    };
  }
  const unknown = unknownProfileOf(setting, listing);
  if (unknown !== undefined)
    return { text: unknownProfileMessage(unknown), tone: "warn" };
  const profile = selectedAgentProfile(setting, listing);
  if (profile === undefined) return undefined;
  return {
    text: [
      `${capitalize(plainProfileDescription(profile))}.`,
      harnessLine(profile),
    ].join("\n"),
    tone: "muted",
  };
}

/** Whether a terminal's agents are still what a NEW terminal on its host would
 *  get. `stale` names what it has and what a new terminal gets now: `off`; a
 *  profile with its short hash, once the host is ready with it; or a profile the
 *  host is still `waiting` on — downloading it, or failed to — when a new
 *  terminal there gets no agents at all. */
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
            readonly hash: string;
          }
        | {
            readonly kind: "waiting";
            readonly profile: string;
            readonly on: "downloading" | "failed";
          };
    };

/** THE stale test, one fold: a terminal is stale when it has agents and a new
 *  terminal on its host would get something else —
 *
 *   - agents are now off;
 *   - the host is ready with a different bundle (another profile, or an update
 *     of the same one);
 *   - the host is downloading the selected profile, or failed to: a new
 *     terminal there gets no agents (padi's status is the spawn's own answer).
 *
 *  A terminal without agents is never stale (turning agents on does not nag the
 *  terminals that predate it), and with no word from the host yet — no status,
 *  or one that has not caught up with the setting — a same-profile terminal is
 *  current and another profile's wait is a download not heard of yet. Fenced
 *  over the status kind. */
export function agentStalenessOf(input: {
  /** The terminal's record (its one `agents` field). */
  readonly terminal: { readonly agents?: TerminalAgents };
  readonly status: AgentDistroStatus | undefined;
  readonly setting: AgentDistroSetting;
}): AgentStaleness {
  const agents = input.terminal.agents;
  if (agents === undefined) return { kind: "current" };
  const had = {
    profile: agents.profile,
    hash: agentBundleShortHash(agents.bundle),
  };
  const { setting } = input;
  if (!setting.enabled) return { kind: "stale", had, now: { kind: "off" } };
  const stale = (now: Extract<AgentStaleness, { kind: "stale" }>["now"]) =>
    ({ kind: "stale", had, now }) as const;
  const waiting = (on: "downloading" | "failed") =>
    stale({ kind: "waiting", profile: setting.profile, on });
  const sameProfile = setting.profile === agents.profile;
  // A status for another profile is one the host has not caught up from.
  const status =
    input.status === undefined ||
    ("profile" in input.status && input.status.profile !== setting.profile)
      ? undefined
      : input.status;
  if (status === undefined)
    return sameProfile ? { kind: "current" } : waiting("downloading");
  switch (status.kind) {
    case "ready":
      return status.bundle === agents.bundle
        ? { kind: "current" }
        : stale({
            kind: "profile",
            profile: status.profile,
            hash: agentBundleShortHash(status.bundle),
          });
    case "downloading":
      return waiting("downloading");
    case "error":
      return waiting("failed");
    case "off":
    case "unavailable":
      // The host gives nothing — a status the setting will move it off; there
      // is nothing yet to restart into, and no profile to name.
      return sameProfile ? { kind: "current" } : waiting("downloading");
    default:
      return status satisfies never;
  }
}

/** Can a stale terminal restart INTO something right now? Yes when agents are
 *  now off (it restarts as a plain shell), or when the host is ready with the
 *  bundle a new terminal gets. Not while it is still `waiting`: a restart then
 *  would come back with no agents at all. */
export function agentRestartReady(
  stale: Extract<AgentStaleness, { kind: "stale" }>,
): boolean {
  return stale.now.kind !== "waiting";
}

/** What the stale pill's restart does, decided ONCE: while agents stay on, the
 *  agent's conversation resumes on the new agents (padi replays its resume
 *  command); with agents now off it comes back as a plain shell, so a live
 *  agent ends — `destructive`, painted in the warning colour. padi makes the
 *  same decision from the same fact (the setting) and reports what it did
 *  (`lifecycle.restart`'s `resumed`). `outcome` is that decision in words. */
export function agentRestartAction(
  stale: Extract<AgentStaleness, { kind: "stale" }>,
): {
  readonly label: string;
  readonly armedLabel: string;
  readonly destructive: boolean;
  readonly outcome: string;
} {
  const destructive = stale.now.kind === "off";
  return {
    label: "Restart",
    armedLabel: destructive ? "Kill agent and restart" : "Restart agent",
    destructive,
    outcome: destructive
      ? "it comes back as a plain shell, and running programs end"
      : "the agent's conversation resumes on the new agents, other programs end",
  };
}

/** The stale pill's tooltip: what this terminal has, what a new one gets, and
 *  — when it can restart into it — what a restart does
 *  ({@link agentRestartAction}'s `outcome`). */
export function agentStaleLabel(
  stale: Extract<AgentStaleness, { kind: "stale" }>,
): string {
  const had = `This terminal has the ${stale.had.profile} coding agents (${stale.had.hash}).`;
  const { now } = stale;
  switch (now.kind) {
    case "waiting":
      return now.on === "downloading"
        ? `${had} New terminals get ${now.profile}, which is still downloading to this machine; Restart appears once it is ready.`
        : `${had} ${now.profile} could not be downloaded to this machine, so new terminals get no coding agents; Restart appears once it is ready.`;
    case "off":
      return `${had} Coding agents are now off. Restart to switch; ${agentRestartAction(stale).outcome}.`;
    case "profile":
      return `${had} New terminals get ${now.profile} (${now.hash}). Restart to switch; ${agentRestartAction(stale).outcome}.`;
    default:
      return now satisfies never;
  }
}

/** A current pill's hover: what this terminal got, and what a click does. */
export function agentChipLabel(profile: string, bundle: string): string {
  return `This terminal started with the ${profile} coding agents (${agentBundleShortHash(bundle)}). Click to choose what new terminals get.`;
}

/** The toast after a restart, from what padi reports it did. */
export function restartedLabel(restarted: {
  readonly agentProfile: string | undefined;
  readonly resumed: boolean;
}): string {
  if (restarted.agentProfile === undefined) return "Restarted as a plain shell";
  return restarted.resumed
    ? `Restarted with the ${restarted.agentProfile} agents; the conversation resumed`
    : `Restarted with the ${restarted.agentProfile} agents`;
}

/** The Agents setting's own toasts, worded once. A host's download toasts are
 *  its mark's words ({@link agentMarkWords}), raised at {@link downloadEdge}. */
export const agentToast = {
  /** A switch to a profile. */
  on: (profile: string) => `New terminals get the ${profile} agents`,
  /** A switch to Off (title; {@link AGENTS_OFF_MEANS} is its description). */
  off: "Coding agents off",
} as const;

/** The moments a host's download is worth a toast, read off two consecutive
 *  statuses — ONE fold, fenced, so the client keeps only the effect that
 *  watches the cell:
 *
 *   - `start`: anything else (including nothing yet) → downloading — a
 *     download began, or is under way when the host is first heard from;
 *   - `ready`: downloading → ready;
 *   - `failed`: downloading → error;
 *   - `dropped`: downloading → off / unavailable — the user turned agents off
 *     mid-download, so its standing toast goes away;
 *   - `none`: everything else (a first frame, a progress tick, an unrelated
 *     change). */
export function downloadEdge(
  prev: AgentDistroStatus["kind"] | undefined,
  now: AgentDistroStatus["kind"] | undefined,
): "start" | "ready" | "failed" | "dropped" | "none" {
  if (now === undefined) return "none";
  switch (now) {
    case "downloading":
      return prev !== "downloading" ? "start" : "none";
    case "ready":
      return prev === "downloading" ? "ready" : "none";
    case "error":
      return prev === "downloading" ? "failed" : "none";
    case "off":
    case "unavailable":
      return prev === "downloading" ? "dropped" : "none";
    default:
      return now satisfies never;
  }
}
