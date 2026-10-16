/**
 * How kolu shows agent-distro — pure functions of a host's status, the
 * setting, or a profile's resolution; no subscriptions. The one fold from a
 * host's status to how its tab mark and Settings line look (`agentMarkOf`), and
 * the words around it. Their volatility is the presentation (a reworded status,
 * a new treatment), apart from the live facts the client subscribes to.
 *
 * The Agents setting is two things that never fold into one: the HARNESSES
 * (the switch: agent-distro's package on a terminal's PATH) and the PROFILES
 * (an ordered list of references, stacked over them in `AI_PROFILE`). An empty
 * list is the harnesses as agent-distro ships them; nothing names that.
 *
 * The status and setting types are `./schema.ts`'s — the very schemas the
 * cells carry — so a field added to the wire is a field these folds handle.
 */

import { agentBundleShortHash } from "./bundle.ts";
import {
  referencesOf,
  sameSet,
  sameStack,
  setKey,
  stackTitle,
} from "./landing.ts";
import type { AgentDistroListing } from "./listing.ts";
import {
  type AgentUpdateAuthor,
  type AgentUpdateEvent,
  type AgentUpdateRun,
  historyAuthor,
} from "./receipt.ts";
import {
  type AgentDistroReceipt,
  type AgentDistroSetting,
  type AgentDistroStatus,
  type AgentProfileResolution,
  type AgentProfiles,
  type TerminalAgents,
  statusStack,
} from "./schema.ts";

/** Juspay's profile, as a reference — the one profile kolu offers by itself,
 *  as the first suggestion of the list's add field. Never added unless
 *  someone picks it. */
export const JUSPAY_PROFILE = "github:juspay/skills";

/** The Juspay suggestion's words. HERE and not read off the profile: it is
 *  offered before anything has been fetched, and what it brings is what the
 *  suggestion says. */
export const JUSPAY_OFFER = {
  reference: JUSPAY_PROFILE,
  title: "Juspay",
  description: "Juspay skills + Kolu, via Juspay's LiteLLM gateway",
} as const;

/** What "never chosen" means for new terminals: off, with no profiles. ONE
 *  shared value, so a reader of the fold sees no change on an unrelated
 *  preference write while nothing is chosen. */
const NEVER_CHOSEN_SETTING: AgentDistroSetting = Object.freeze({
  enabled: false,
  profiles: Object.freeze([]) as readonly string[],
});

/** Has anyone chosen yet? THE one test for "never chosen" — the absence of a
 *  value. Every fold here that cares asks it; read elsewhere only where that
 *  difference shows: the first-run step and the Agents control's hint. */
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

/** A change to the Agents control: the switch, the profile list, or both at
 *  once (the welcome step's "Turn on" with the profiles it picked). */
export interface AgentsChange {
  readonly on?: boolean;
  readonly profiles?: readonly string[];
}

/** A profile list as it is written: each reference trimmed, empty ones
 *  dropped, and a repeat kept only where it first appears. */
function normalizedProfiles(profiles: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of profiles) {
    const ref = raw.trim();
    if (ref === "" || seen.has(ref)) continue;
    seen.add(ref);
    out.push(ref);
  }
  return out;
}

/** The whole value a change on the Agents control writes — the ONE writer the
 *  Settings row and the first-run step go through. What the change leaves out
 *  keeps the stored value (none while nothing is chosen): the switch keeps the
 *  list, an edit of the list keeps the switch. Whatever a reference says, it
 *  is written: whether it builds is its resolution line's to say
 *  ({@link agentsResolvedLine}), never a refusal here. `undefined` for a
 *  change that names nothing. */
export function agentDistroChoice(
  change: AgentsChange,
  stored: AgentDistroSetting | null,
): AgentDistroSetting | undefined {
  if (change.on === undefined && change.profiles === undefined)
    return undefined;
  const current = agentDistroSettingOf(stored);
  return {
    enabled: change.on ?? current.enabled,
    profiles: normalizedProfiles(change.profiles ?? current.profiles),
  };
}

/** The list with `text` appended (trimmed) — `undefined` when there is
 *  nothing to add: an empty field, or a reference already in the list. */
export function profilesWithAdded(
  profiles: readonly string[],
  text: string,
): readonly string[] | undefined {
  const ref = text.trim();
  if (ref === "" || profiles.includes(ref)) return undefined;
  return [...profiles, ref];
}

/** The list without the entry at `index`. */
export function profilesWithRemoved(
  profiles: readonly string[],
  index: number,
): readonly string[] {
  return profiles.filter((_, i) => i !== index);
}

/** The list with the entry at `from` moved to `to` (both clamped into it). */
export function profilesWithMoved(
  profiles: readonly string[],
  from: number,
  to: number,
): readonly string[] {
  const last = profiles.length - 1;
  const src = Math.max(0, Math.min(last, from));
  const dst = Math.max(0, Math.min(last, to));
  if (src === dst) return profiles;
  const out = [...profiles];
  const [moved] = out.splice(src, 1);
  if (moved === undefined) return profiles;
  out.splice(dst, 0, moved);
  return out;
}

/** Is the first-run "choose your agents" step done? `undefined` is "not known
 *  yet" — the step is then neither asked nor done: while the listing has not
 *  arrived, and while this machine's status has not caught up with a choice
 *  (below). Otherwise:
 *
 *   - a kolu built without agents (`unavailable` listing): done — there is
 *     nothing to choose;
 *   - agents off — nothing chosen yet, or Off picked: not done. Off is not a
 *     final answer: until agents are on, the welcome card keeps the choice at
 *     the top;
 *   - agents on: done once this machine has settled with the setting's stack —
 *     the set is there (`ready`) or its padi has none to fetch
 *     (`unavailable`). While this machine is still being delivered it, or the
 *     delivery failed, the step stays, so a first-run user watches the agents
 *     arrive. Until this machine's status has caught up with the choice — no
 *     frame yet, padi still `off`, or a status for another stack — it is not
 *     known yet (`undefined`), so a user who already chose never sees the row
 *     flash on a reload.
 *
 *  Fenced over the status kind. */
export function firstRunAgentsDone(input: {
  readonly stored: AgentDistroSetting | null;
  /** The listing, `undefined` until its first frame. */
  readonly listing: AgentDistroListing | undefined;
  /** This machine's status, `undefined` until its first frame. */
  readonly local: AgentDistroStatus | undefined;
}): boolean | undefined {
  const { stored, listing, local } = input;
  if (listing === undefined) return undefined;
  if (listing.kind === "unavailable") return true;
  if (!agentsChosen(stored) || !stored.enabled) return false;
  if (local === undefined) return undefined;
  switch (local.kind) {
    case "unavailable":
      return true;
    case "off":
      return undefined;
    case "ready":
    case "undelivered":
    case "downloading":
    case "error":
      // A status for another stack is one padi has not caught up from.
      if (!sameStack(statusStack(local) ?? [], stored.profiles))
        return undefined;
      return local.kind === "ready";
    default:
      return local satisfies never;
  }
}

/** The first-run step's title — what the welcome card asks. */
export const AGENTS_FIRST_RUN_TITLE = "Choose your coding agents";

/** How a profile reference is NAMED before anything is known of it:
 *  {@link JUSPAY_PROFILE} as "Juspay", anything else (a flake reference, a
 *  path) as itself. */
export function agentProfileTitle(reference: string): string {
  return reference === JUSPAY_PROFILE ? JUSPAY_OFFER.title : reference;
}

/** The line under one profile of the list: whether kolu-server could build it
 *  — `pending` until it has answered for THIS reference, then the name and
 *  description its build gives itself, or Nix's / agent-distro's own words. */
export interface AgentsResolvedLine {
  readonly kind: "pending" | "resolved" | "failed";
  /** `failed`: the words of what failed — {@link AGENTS_UNRESOLVED_MEANS}
   *  follows them. */
  readonly text: string;
}

/** What a profile that does not build means for new terminals, under its
 *  words. */
export const AGENTS_UNRESOLVED_MEANS =
  "Until it builds, new terminals get no coding agents — fix it, or remove it from the list.";

/** The resolution kolu-server holds for `reference`, if it has one. */
function resolutionOf(
  reference: string,
  profiles: AgentProfiles | undefined,
): AgentProfileResolution | undefined {
  return profiles?.find((p) => p.reference === reference)?.resolution;
}

/** THE fold from one reference and kolu-server's resolutions to the line
 *  under it. Fenced over the resolution kind. */
export function agentsResolvedLine(
  reference: string,
  profiles: AgentProfiles | undefined,
): AgentsResolvedLine {
  const resolution = resolutionOf(reference, profiles);
  if (resolution === undefined || resolution.kind === "pending")
    return { kind: "pending", text: `resolving ${reference}…` };
  switch (resolution.kind) {
    case "resolved": {
      const rev =
        resolution.rev === undefined ? "" : ` (${resolution.rev.slice(0, 7)})`;
      return {
        kind: "resolved",
        text:
          resolution.description === ""
            ? `${resolution.name}${rev}`
            : `${resolution.name}${rev} · ${resolution.description}`,
      };
    }
    case "failed":
      return { kind: "failed", text: resolution.message };
    default:
      return resolution satisfies never;
  }
}

/** One entry of the profile list as Settings draws it. */
export interface AgentProfileRow {
  readonly reference: string;
  /** How it is named ({@link agentProfileTitle}). */
  readonly title: string;
  readonly line: AgentsResolvedLine;
}

/** The profile list's rows, in stack order. */
export function agentProfileRows(
  setting: AgentDistroSetting,
  profiles: AgentProfiles | undefined,
): readonly AgentProfileRow[] {
  return setting.profiles.map((reference) => ({
    reference,
    title: agentProfileTitle(reference),
    line: agentsResolvedLine(reference, profiles),
  }));
}

/** A stack of references as names, in order: each by the name kolu-server's
 *  build gave it once it has one (`resolutions`), else by
 *  {@link agentProfileTitle}. THE way a setting's stack is named. */
export function referencesTitle(
  references: readonly string[],
  profiles?: AgentProfiles,
): string {
  return references
    .map((reference) => {
      const r = resolutionOf(reference, profiles);
      return r?.kind === "resolved" ? r.name : agentProfileTitle(reference);
    })
    .join(" + ");
}

/** The welcome card's done line for the first-run step: what is on, by name
 *  — "Agents: on" with no profiles, "Agents: Juspay" while its profiles are
 *  resolving, a check once every one built ("Agents: juspay ✓"), and the
 *  first failure's words instead of the check. `undefined` while agents are
 *  off — the step is not done then ({@link firstRunAgentsDone}) — and in a
 *  kolu built without agents. */
export function agentsChosenLabel(
  setting: AgentDistroSetting,
  listing: AgentDistroListing | undefined,
  profiles: AgentProfiles | undefined,
): string | undefined {
  if (listing?.kind === "unavailable" || !setting.enabled) return undefined;
  if (setting.profiles.length === 0) return "Agents: on";
  const name = referencesTitle(setting.profiles, profiles);
  const lines = setting.profiles.map((r) => agentsResolvedLine(r, profiles));
  const failed = lines.find((l) => l.kind === "failed");
  if (failed !== undefined) return `Agents: ${name} — ${failed.text}`;
  return lines.every((l) => l.kind === "resolved")
    ? `Agents: ${name} ✓`
    : `Agents: ${name}`;
}

/** How a host shows its agents: the treatment of its tab's agent-distro mark,
 *  and of its line in Settings.
 *
 *   - `none`: no mark at all (agents off on this host, a padi without the bake,
 *     a host kolu has delivered nothing to, or a host we cannot hear from) —
 *     the tab is as it would be without agents;
 *   - `checking`: the host is connected and agents are on, but its status has not
 *     arrived yet (a dimmed mark with a spinning arc);
 *   - `ready`: the setting's set is on the host for new terminals —
 *     `delivering` while kolu delivers a newer set there (the old set keeps
 *     serving; the mark keeps its plain colour, with a turning arc);
 *   - `downloading`: kolu is delivering it to a host that has none yet (a
 *     turning arc — a delivery's copies report no byte counts to fill with);
 *   - `failed`: the delivery failed (the warning colour and a dot). */
export type AgentMark =
  | {
      readonly kind: "none";
      /** Why there is no mark: agents are off on the host, the host's padi has
       *  no agents built in, kolu has delivered it none (and is not
       *  delivering), or we have not heard from the host. */
      readonly why: "off" | "unavailable" | "undelivered" | "unheard";
    }
  | { readonly kind: "checking" }
  | {
      readonly kind: "ready";
      /** The profiles that serve, by name ({@link stackTitle}); empty for
       *  none. */
      readonly stack: string;
      /** The package's short hash. */
      readonly hash: string;
      /** kolu is delivering a newer set there; this one serves until it has
       *  fully landed. */
      readonly delivering: boolean;
    }
  | { readonly kind: "downloading" }
  | {
      readonly kind: "failed";
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
    case "undelivered":
      return { kind: "none", why: "undelivered" };
    case "ready":
      return {
        kind: "ready",
        stack: stackTitle(status.set.profiles),
        hash: agentBundleShortHash(status.set.bundle),
        delivering: status.delivering,
      };
    case "downloading":
      return { kind: "downloading" };
    case "error":
      return { kind: "failed", message: status.message };
    default:
      return status satisfies never;
  }
}

/** When kolu tries a failed delivery again — never in a loop of its own. */
export const AGENTS_DELIVERY_AGAIN =
  "kolu tries again at the next scheduled update, or when you check that machine from its host details.";

/** A failed delivery's words, in the one order the mark's hover shows them —
 *  the cause, then when kolu tries again. */
export function agentFailureLines(
  failure: { readonly message: string },
  where: string,
): readonly string[] {
  return [
    `The coding agents could not be delivered to ${where}: ${failure.message}`,
    AGENTS_DELIVERY_AGAIN,
  ];
}

/** A ready host's state line, in its host details, while a newer set is
 *  copied to it. */
export const AGENTS_READY_DELIVERING = "ready · delivering newer agents…";

/** What a ready host says while a newer set is copied to it. */
export const AGENTS_UPDATE_DOWNLOADING =
  "Delivering newer agents — new terminals keep these until they have fully arrived.";

/** What a set is called in a sentence: its package's hash, with its profiles
 *  when it has any — `nd11nx5f with juspay + ekala`. */
function setWords(set: { readonly stack: string; readonly hash: string }) {
  return set.stack === "" ? set.hash : `${set.hash} with ${set.stack}`;
}

/** A mark's words, one line each — its accessible name and its hover.
 *  `where` names the machine as the host tab does (the client's one label
 *  function supplies it). `undefined` for `none`. */
export function agentMarkLabel(
  mark: AgentMark,
  where: string,
): string | undefined {
  switch (mark.kind) {
    case "none":
      return undefined;
    case "checking":
      return `Coding agents: checking ${where}…`;
    case "ready":
      return [
        `Coding agents ready on ${where}: ${setWords(mark)} — new terminals on ${where} start with them`,
        ...(mark.delivering ? [AGENTS_UPDATE_DOWNLOADING] : []),
      ].join("\n");
    case "downloading":
      return `Delivering the coding agents to ${where}…`;
    case "failed":
      return agentFailureLines(mark, where).join("\n");
    default:
      return mark satisfies never;
  }
}

/** A version as agent-distro's picker shows it: without the package's `+`
 *  revision suffix (`1.18.35+53d1eab` → `1.18.35`) — upstream's
 *  `displayVersion` (`lib/picker.nix`), mirrored here once so every version
 *  kolu draws says what `agent-distro` in the same terminal says. Every chip's
 *  version goes through it ({@link agentChips}), whether it comes from the
 *  listing or from a host's receipt. */
function displayVersion(version: string): string {
  return version.split("+")[0] ?? version;
}

/** What Off means, in the one wording every surface uses (the row's hint, the
 *  toast). */
export const AGENTS_OFF_MEANS =
  "New terminals use only the agents you installed yourself.";

/** How many profile references the field remembers the user added before. */
export const RECENT_PROFILES_CAP = 8;

/** The references the field remembers after `added` were added: they first,
 *  then the others in their order, at most {@link RECENT_PROFILES_CAP}.
 *  {@link JUSPAY_PROFILE} is not remembered — it is always the first
 *  suggestion. */
export function rememberProfiles(
  recent: readonly string[],
  added: readonly string[],
): readonly string[] {
  const fresh = added.filter((p) => p !== JUSPAY_PROFILE);
  return [...fresh, ...recent.filter((p) => !fresh.includes(p))].slice(
    0,
    RECENT_PROFILES_CAP,
  );
}

/** One suggestion in the add field's menu: the reference it adds, the name
 *  it shows by when it has one, and a note beside it. */
export interface ProfileSuggestion {
  readonly value: string;
  readonly title?: string;
  readonly note: string;
}

/** The add field's suggestions, none the list already holds: Juspay's first
 *  ({@link JUSPAY_OFFER} — the one way kolu offers it), then what the user
 *  added before, most recent first. */
export function profileSuggestions(input: {
  readonly recent: readonly string[];
  readonly profiles: readonly string[];
}): readonly ProfileSuggestion[] {
  const juspay: ProfileSuggestion = {
    value: JUSPAY_OFFER.reference,
    title: JUSPAY_OFFER.title,
    note: JUSPAY_OFFER.description,
  };
  return [
    juspay,
    ...input.recent
      .filter((value) => value !== JUSPAY_PROFILE)
      .map((value) => ({ value, note: "used before" })),
  ].filter((s) => !input.profiles.includes(s.value));
}

/** One host's agent-distro facts, for its line in Settings. */
export interface HostAgentStatus {
  readonly label: string;
  readonly status: AgentDistroStatus | undefined;
  /** Connected, agents on, and no status frame yet (see {@link agentMarkOf}). */
  readonly checking: boolean;
  /** What the host keeps of its updates — `undefined` until its first frame. */
  readonly receipt: AgentDistroReceipt | undefined;
  /** "3h ago" for a time the host stamped (epoch ms, on ITS clock). */
  readonly ago: AgoPhrase;
}

/** Formats an epoch-ms time as "3h ago" — the client's ONE relative-time
 *  phrase, bound to one host's clock and handed in, so these folds stay
 *  clock-free. */
export type AgoPhrase = (atMs: number) => string;

/** Who a reason's words are by, as a hover names them (`historyAuthor` says
 *  which writer a history-log line is by). */
const AUTHOR: Record<AgentUpdateAuthor, string> = {
  delivery: "kolu's delivery",
  padi: "padi",
  "agent-distro": "agent-distro's updater",
  log: "the host's update log",
};

/** A hover that quotes `words` as `by`'s, under the short `text`. */
function quoted(text: string, by: AgentUpdateAuthor, words: string): string {
  return `${text} — ${AUTHOR[by]}: ${words}`;
}

/** What a ready host's line adds about its last update run. A skip or a
 *  failure never claims a cause: the note says what happened, and its hover
 *  quotes the reason verbatim, naming who wrote it. */
function lastRunNote(run: AgentUpdateRun, ago: AgoPhrase): AgentStatusNote {
  const when = ago(run.at);
  const words = updateWords(run);
  const note = (text: string, tone: AgentStatusNote["tone"]) => ({
    text,
    title: words === "" ? text : quoted(text, run.by, words),
    tone,
  });
  switch (run.outcome) {
    case "updated":
      return note(`updated ${when}`, "muted");
    case "unchanged":
      return note(`checked ${when}, up to date`, "muted");
    case "skipped":
      return note(`checked ${when}, skipped`, "muted");
    case "failed":
      return note(`last update failed ${when}`, "warn");
    default:
      return run.outcome satisfies never;
  }
}

/** A host whose update history would not read says so on its line. */
export const AGENTS_RECEIPT_UNREADABLE = "could not read its update history";

/** The hover for a receipt that would not read: padi's words for why. */
function unreadableTitle(error: string): string {
  return quoted(AGENTS_RECEIPT_UNREADABLE, "padi", error);
}

/** A status note: its text, its hover (the text, and a skip's or a failure's
 *  reason quoted with who wrote it), and its tone. */
export interface AgentStatusNote {
  readonly text: string;
  readonly title: string;
  readonly tone: "muted" | "warn";
}

/** The words for a host with no mark, by the fold's reason. */
const NONE_LINE: Record<Extract<AgentMark, { kind: "none" }>["why"], string> = {
  off: "agents off",
  unavailable: "no coding agents in this build",
  undelivered: "no coding agents delivered",
  unheard: "not connected",
};

/** One group of the Settings fleet line: the machines in one agent state,
 *  named, with the words that state reads as. Rendered as `lead` · the hosts
 *  (each a link to its host details) · `trail`: "Ready on naiveintent and 2
 *  more", "buildbox delivering", "devbox failed". */
export interface AgentFleetGroup<H> {
  /** The group's identity — the agent state it is about ("ready", "failed",
   *  …). The whole fold is re-minted on every read, so a surface keys its
   *  groups on this and the machines inside them on their own host key: a
   *  re-read re-words a group without rebuilding the machine names beside it
   *  (they are buttons, and a rebuilt button drops hover and focus). */
  readonly key: string;
  /** The dot's colour: ok when ready, accent while a delivery runs, warning
   *  when one failed, muted when there are no agents there. */
  readonly tone: "ok" | "busy" | "warn" | "muted";
  /** The words before the names — empty when the names lead. */
  readonly lead: string;
  /** The machines this group names, at most {@link FLEET_NAMED_CAP}; the rest
   *  are counted in `trail`. Never empty — a group IS its machines. */
  readonly hosts: readonly H[];
  /** The words after the names: the state, or "and 2 more". */
  readonly trail: string;
}

/** How many machines a fleet group names before it starts counting them. */
const FLEET_NAMED_CAP = 2;

/** What one agent state reads as on the fleet line. */
interface AgentFleetState {
  /** Which group a host joins — one per state, so two failed hosts share a
   *  group and two `none` hosts with different reasons do not. */
  readonly key: string;
  readonly tone: AgentFleetGroup<never>["tone"];
  readonly lead: string;
  readonly trail: string;
}

/** Which group a host's mark puts it in — the ONE fold from a mark to the
 *  fleet line's vocabulary. Fenced over the mark kind. */
function fleetState(mark: AgentMark): AgentFleetState {
  switch (mark.kind) {
    case "ready":
      return { key: "ready", tone: "ok", lead: "Ready on", trail: "" };
    case "downloading":
      return {
        key: "downloading",
        tone: "busy",
        lead: "",
        trail: "delivering",
      };
    case "checking":
      return { key: "checking", tone: "muted", lead: "", trail: "checking…" };
    case "failed":
      return { key: "failed", tone: "warn", lead: "", trail: "failed" };
    case "none":
      return {
        key: `none:${mark.why}`,
        tone: "muted",
        lead: "",
        trail: NONE_LINE[mark.why],
      };
    default:
      return mark satisfies never;
  }
}

/** THE fleet line under Settings' Agents row: one group per agent state, in
 *  the order the machines are handed in, each naming up to
 *  {@link FLEET_NAMED_CAP} machines and counting the rest. Every host is
 *  carried through by value, so a name can open that machine's details —
 *  which is where everything true of ONE machine lives
 *  ({@link agentHostDetail}); this line holds no per-machine fact of its
 *  own. */
export function agentFleetSummary<H extends HostAgentStatus>(
  hosts: readonly H[],
): readonly AgentFleetGroup<H>[] {
  const groups: { state: AgentFleetState; hosts: H[] }[] = [];
  for (const host of hosts) {
    const state = fleetState(agentMarkOf(host.status, host.checking));
    const group = groups.find((g) => g.state.key === state.key);
    if (group === undefined) groups.push({ state, hosts: [host] });
    else group.hosts.push(host);
  }
  return groups.map(({ state, hosts: members }): AgentFleetGroup<H> => {
    const named = members.slice(0, FLEET_NAMED_CAP);
    const more = members.length - named.length;
    return {
      key: state.key,
      tone: state.tone,
      lead: state.lead,
      hosts: named,
      trail: [more === 0 ? "" : `and ${more} more`, state.trail]
        .filter((w) => w !== "")
        .join(" "),
    };
  });
}

/** A host's last update run as a note — `undefined` when it has run nothing
 *  yet. A receipt that would not read says so instead, in the warning tone. */
function lastRunNoteOf(
  receipt: AgentDistroReceipt | undefined,
  ago: AgoPhrase,
): AgentStatusNote | undefined {
  if (receipt?.error !== undefined)
    return {
      text: AGENTS_RECEIPT_UNREADABLE,
      title: unreadableTitle(receipt.error),
      tone: "warn",
    };
  const run = receipt?.lastRun;
  return run === undefined ? undefined : lastRunNote(run, ago);
}

/** One update event as a host's details lists it: when, what happened, and the
 *  history's own words. `title`, the hover, names who wrote them. */
export interface AgentEventRow {
  readonly when: string;
  readonly kind: AgentUpdateEvent["kind"] | "unreadable";
  readonly text: string;
  readonly title: string;
  readonly tone: "muted" | "warn";
}

/** How a history event's kind reads in a row. */
const EVENT_LABEL: Record<AgentUpdateEvent["kind"], string> = {
  updated: "updated",
  skipped: "skipped",
  failed: "failed",
};

/** An event's or a run's words as kolu shows them: a history line from
 *  before agent-distro was one package names the profile it was about, and
 *  that is said first, so mixed old lines are never read as one profile's. */
export function updateWords(
  run: Pick<AgentUpdateEvent, "words" | "profile">,
): string {
  return run.profile === undefined
    ? run.words
    : `${run.profile} · ${run.words}`;
}

function eventRow(event: AgentUpdateEvent, ago: AgoPhrase): AgentEventRow {
  const text = updateWords(event);
  return {
    when: ago(Date.parse(event.at)),
    kind: event.kind,
    text,
    title: quoted(EVENT_LABEL[event.kind], historyAuthor(event.kind), text),
    tone: event.kind === "failed" ? "warn" : "muted",
  };
}

/** What a machine's host details say about its agents: the profiles new
 *  terminals there get and the package serving them, the state in one line, a
 *  failure's own words, that machine's last update events, and which action it
 *  offers. The per-machine facts live HERE, beside the machine — Settings keeps
 *  only the fleet line ({@link agentFleetSummary}). */
export interface AgentHostDetail {
  /** The profiles serving there, by name (`juspay + ekala`) — the setting's
   *  references until a set has landed; empty for none. */
  readonly stack: string;
  /** The package serving them — only a ready host has one. */
  readonly hash?: string;
  readonly state: AgentStatusNote;
  /** A failed delivery's words — kolu-server's, with Nix's own line. Trying
   *  again is the section's button; `means` says when kolu tries on its own. */
  readonly cause?: string;
  /** What a failure means for new terminals on THAT machine. */
  readonly means?: string;
  /** That machine's last update events, newest first — empty when it has run
   *  nothing, or is not ready. */
  readonly events: readonly AgentEventRow[];
  /** Whether the section offers its one action, delivering to that machine
   *  now ({@link AGENTS_HOST_CHECK}) — after a failure too, which is how the
   *  user asks kolu to try again once the machine is fixed. Not while a
   *  delivery already runs there, nor with nothing to deliver. */
  readonly canCheck: boolean;
}

/** THE fold from one machine's agent facts to its host-details section.
 *  `undefined` when there are no agents to describe there — a padi built
 *  without them, or a machine we cannot hear from (whose own `state` row says
 *  so). Fenced over the mark kind. */
export function agentHostDetail(input: {
  readonly host: HostAgentStatus;
  readonly setting: AgentDistroSetting;
}): AgentHostDetail | undefined {
  const { host, setting } = input;
  const mark = agentMarkOf(host.status, host.checking);
  if (mark.kind === "none" && mark.why !== "off" && mark.why !== "undelivered")
    return undefined;
  const plain = (text: string): AgentStatusNote => ({
    text,
    title: text,
    tone: "muted",
  });
  const base = {
    stack: referencesTitle(setting.profiles),
    events: [],
  } as const;
  switch (mark.kind) {
    case "none":
      return { ...base, state: plain(NONE_LINE[mark.why]), canCheck: false };
    case "checking":
      return { ...base, state: plain("checking…"), canCheck: false };
    case "downloading":
      return { ...base, state: plain("delivering…"), canCheck: false };
    case "failed":
      return {
        ...base,
        state: { text: "delivery failed", title: mark.message, tone: "warn" },
        cause: mark.message,
        means: `New terminals on ${host.label} get no coding agents until this is fixed. ${AGENTS_DELIVERY_AGAIN}`,
        canCheck: true,
      };
    case "ready": {
      const { receipt } = host;
      const run = lastRunNoteOf(receipt, host.ago);
      const state: AgentStatusNote = mark.delivering
        ? plain(AGENTS_READY_DELIVERING)
        : run === undefined
          ? plain("ready")
          : { ...run, text: `ready · ${run.text}` };
      return {
        ...base,
        stack: mark.stack,
        hash: mark.hash,
        state,
        events:
          receipt?.error !== undefined
            ? [
                {
                  when: "",
                  kind: "unreadable",
                  text: AGENTS_RECEIPT_UNREADABLE,
                  title: unreadableTitle(receipt.error),
                  tone: "warn",
                },
              ]
            : (receipt?.events ?? []).map((e) => eventRow(e, host.ago)),
        canCheck: !mark.delivering,
      };
    }
    default:
      return mark satisfies never;
  }
}

/** The harnesses the package brings, named only — "Claude Code, Codex,
 *  OpenCode, Pi and Oh My Pi", in the listing's order. */
function harnessNames(
  listing: Extract<AgentDistroListing, { kind: "available" }>,
): string {
  const names = listing.harnesses.map((h) => h.title);
  const last = names.at(-1);
  if (last === undefined) return "";
  return names.length === 1
    ? last
    : `${names.slice(0, -1).join(", ")} and ${last}`;
}

/** What the welcome card's Agents step says it brings: the harnesses by name,
 *  then what kolu does with them. `undefined` until the listing arrives, and
 *  for a kolu built without agents (the step does not ask there). */
export function agentsStepHint(
  listing: AgentDistroListing | undefined,
): string | undefined {
  if (listing?.kind !== "available") return undefined;
  return `${harnessNames(listing)} in every new terminal. Kept up to date, nothing to install.`;
}

/** The Agents row's hint while agents are off: ONE sentence — what off means,
 *  and that turning it on starts new terminals with the agents the chips under
 *  it name. Once agents are on the row says nothing here: the list and its
 *  chips do. */
export function agentsHint(input: {
  readonly stored: AgentDistroSetting | null;
  readonly listing: AgentDistroListing | undefined;
}): { readonly text: string; readonly tone: "muted" } | undefined {
  const { listing } = input;
  if (listing === undefined) return undefined;
  if (listing.kind === "unavailable")
    return {
      text: "This kolu was built without coding agents, so there is nothing to choose here.",
      tone: "muted",
    };
  if (agentDistroSettingOf(input.stored).enabled) return undefined;
  return {
    text: `Off. ${AGENTS_OFF_MEANS} Turn on and they start with these, kept up to date:`,
    tone: "muted",
  };
}

/** One agent chip: the agent as people know it, and the version this machine
 *  has — `undefined` while agents are off, where the set is what kolu would
 *  bring rather than what any machine holds. */
export interface AgentChip {
  readonly title: string;
  readonly version?: string;
}

/** The chips under the Agents row — the harnesses the package brings, each
 *  once:
 *
 *   - agents OFF: by name, no versions (nothing is installed, so no version is
 *     this machine's);
 *   - agents ON: with their versions — this machine's own, from its receipt,
 *     once it has one (an update moves them past the listing's).
 *
 *  Empty until the listing arrives, and for a kolu built without agents. */
export function agentChips(input: {
  readonly setting: AgentDistroSetting;
  readonly listing: AgentDistroListing | undefined;
  /** This machine's receipt: its versions name what this machine has now —
   *  the listing's are the set kolu was built with, which an update leaves
   *  behind. */
  readonly localReceipt: AgentDistroReceipt | undefined;
}): readonly AgentChip[] {
  const { setting, listing } = input;
  if (listing?.kind !== "available") return [];
  if (!setting.enabled)
    return listing.harnesses.map(({ title }) => ({ title }));
  const versions = input.localReceipt?.serving?.versions ?? listing.harnesses;
  return versions.map((h) => ({
    title: h.title,
    version: displayVersion(h.version),
  }));
}

/** A set as a staleness names it: its profiles by name and its package's
 *  short hash. */
interface SetName {
  readonly stack: string;
  readonly hash: string;
}

/** Whether a terminal's agents are still what a NEW terminal on its host would
 *  get. `stale` names what it has and what a new terminal gets now: `off`; a
 *  set, once the host is ready with it; or the setting's stack the host is
 *  still `waiting` on — delivering it, or failed to — when a new terminal
 *  there gets no agents at all. */
export type AgentStaleness =
  | { readonly kind: "current" }
  | {
      readonly kind: "stale";
      readonly had: SetName;
      readonly now:
        | { readonly kind: "off" }
        | ({ readonly kind: "set" } & SetName)
        | {
            readonly kind: "waiting";
            readonly stack: string;
            readonly on: "downloading" | "failed";
          };
    };

/** THE stale test, one fold: a terminal is stale when it has agents and a new
 *  terminal on its host would get something else —
 *
 *   - agents are now off;
 *   - the host is ready with a different set (another package, or other
 *     profiles, or newer builds of the same ones);
 *   - the host is delivering the setting's stack, or failed to: a new terminal
 *     there gets no agents (padi's status is the spawn's own answer).
 *
 *  A terminal without agents is never stale (turning agents on does not nag the
 *  terminals that predate it), and with no word from the host yet — no status,
 *  or one that has not caught up with the setting — a terminal of the same
 *  stack is current and another stack's wait is a delivery not heard of yet.
 *  Fenced over the status kind. */
export function agentStalenessOf(input: {
  /** The terminal's record (its one `agents` field). */
  readonly terminal: { readonly agents?: TerminalAgents };
  readonly status: AgentDistroStatus | undefined;
  readonly setting: AgentDistroSetting;
}): AgentStaleness {
  const agents = input.terminal.agents;
  if (agents === undefined) return { kind: "current" };
  const had: SetName = {
    stack: stackTitle(agents.profiles),
    hash: agentBundleShortHash(agents.bundle),
  };
  const { setting } = input;
  if (!setting.enabled) return { kind: "stale", had, now: { kind: "off" } };
  const stale = (now: Extract<AgentStaleness, { kind: "stale" }>["now"]) =>
    ({ kind: "stale", had, now }) as const;
  const waiting = (on: "downloading" | "failed") =>
    stale({
      kind: "waiting",
      stack: referencesTitle(setting.profiles),
      on,
    });
  const sameReferences = sameStack(
    referencesOf(agents.profiles),
    setting.profiles,
  );
  // A status for another stack is one the host has not caught up from.
  const stack =
    input.status === undefined ? undefined : statusStack(input.status);
  const status =
    input.status === undefined ||
    (stack !== undefined && !sameStack(stack, setting.profiles))
      ? undefined
      : input.status;
  if (status === undefined)
    return sameReferences ? { kind: "current" } : waiting("downloading");
  switch (status.kind) {
    case "ready":
      return sameSet(status.set, agents)
        ? { kind: "current" }
        : stale({
            kind: "set",
            stack: stackTitle(status.set.profiles),
            hash: agentBundleShortHash(status.set.bundle),
          });
    case "downloading":
      return waiting("downloading");
    case "error":
      return waiting("failed");
    case "off":
    case "unavailable":
    case "undelivered":
      // The host gives nothing — a status the setting will move it off; there
      // is nothing yet to restart into, and no set to name.
      return sameReferences ? { kind: "current" } : waiting("downloading");
    default:
      return status satisfies never;
  }
}

/** Can a stale terminal restart INTO something right now? Yes when agents are
 *  now off (it restarts as a plain shell), or when the host is ready with the
 *  set a new terminal gets. Not while it is still `waiting`: a restart then
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
 *  ({@link agentRestartAction}'s `outcome`). `where` names the terminal's host,
 *  as the host tab does. */
export function agentStaleLabel(
  stale: Extract<AgentStaleness, { kind: "stale" }>,
  where: string,
): string {
  const had = `This terminal has the coding agents ${setWords(stale.had)}.`;
  const { now } = stale;
  const waitingFor = (stack: string) => (stack === "" ? "newer agents" : stack);
  switch (now.kind) {
    case "waiting":
      return now.on === "downloading"
        ? `${had} New terminals get ${waitingFor(now.stack)}, which is still being delivered to ${where}; Restart appears once it is ready.`
        : `${had} ${waitingFor(now.stack)} could not be delivered to ${where}, so new terminals get no coding agents; Restart appears once it is ready.`;
    case "off":
      return `${had} Coding agents are now off. Restart to switch; ${agentRestartAction(stale).outcome}.`;
    case "set":
      return `${had} New terminals get ${setWords(now)}. Restart to switch; ${agentRestartAction(stale).outcome}.`;
    default:
      return now satisfies never;
  }
}

/** The profile a tile's pill names: the one in effect, as agent-distro
 *  answered for this terminal, else the stack it was spawned with —
 *  `undefined` when it has neither (the harnesses as they ship, and no
 *  repository profile): the pill then shows the package's hash alone. */
export function agentChipProfile(agents: TerminalAgents): string | undefined {
  const name = agents.effective?.name ?? stackTitle(agents.profiles);
  return name === "" ? undefined : name;
}

/** A current pill's hover: what this terminal started with — the profile in
 *  effect and where agent-distro composed it from, when it said (asked once,
 *  at the spawn; a later `cd` is not followed) — and what a click does. */
export function agentChipLabel(
  agents: Pick<TerminalAgents, "profiles" | "bundle" | "effective">,
): string {
  const hash = agentBundleShortHash(agents.bundle);
  const { effective } = agents;
  const stack = stackTitle(agents.profiles);
  const started =
    effective !== undefined
      ? `This terminal started with the ${effective.name} profile (${hash}), ${effective.source}.`
      : stack === ""
        ? `This terminal started with the coding agents (${hash}), no profile.`
        : `This terminal started with the coding agents (${hash}) and ${stack}.`;
  return `${started} Click to choose what new terminals get.`;
}

/** The toast after a restart, from what padi reports it did: `agents` is the
 *  set it came back with (its profiles by name; empty for none), absent for a
 *  plain shell. */
export function restartedLabel(restarted: {
  readonly agents: string | undefined;
  readonly resumed: boolean;
}): string {
  if (restarted.agents === undefined) return "Restarted as a plain shell";
  const what =
    restarted.agents === ""
      ? "the coding agents"
      : `the coding agents and ${restarted.agents}`;
  return restarted.resumed
    ? `Restarted with ${what}; the conversation resumed`
    : `Restarted with ${what}`;
}

/** The Agents setting's own toasts, worded once. */
export const agentToast = {
  /** Agents on, or a new list: what new terminals get, by the references'
   *  names ({@link agentProfileTitle}). */
  on: (profiles: readonly string[]) =>
    profiles.length === 0
      ? "New terminals get the coding agents"
      : `New terminals get the coding agents with ${referencesTitle(profiles)}`,
  /** A switch to Off (title; {@link AGENTS_OFF_MEANS} is its description). */
  off: "Coding agents off",
  /** An update landed on `host` ({@link updateLanded}): the change in the
   *  history's own words, and what it means for terminals. */
  updated: (host: string, words: string) =>
    ({
      title: `Coding agents updated on ${host}`,
      description: `${words} — new terminals on ${host} start with them; open ones offer Restart.`,
    }) as const,
} as const;

/** The palette command that delivers the newest agents to EVERY machine now. */
export const AGENTS_CHECK_NOW = {
  label: "Check for newer coding agents",
  note: "every machine",
  hint: "Look for newer coding agents and profiles, and deliver them to every machine now. Nothing is compiled on a machine: a newer package is delivered only once agent-distro's cache holds all of it, and terminals already open keep theirs.",
} as const;

/** The host-details row that delivers the newest agents to THAT machine now —
 *  also how a machine whose delivery failed is tried again. */
export const AGENTS_HOST_CHECK = {
  label: "check for newer agents",
  hint: "Look for newer coding agents and profiles, and deliver them to this machine now. Terminals already open keep theirs.",
} as const;

/** A check kolu-server would not run (a run already going, or nothing set). */
export function agentCheckFailed(host: string, message: string): string {
  return `Could not check for newer coding agents on ${host}: ${message}`;
}

/** The facts of a ready status an update is read from — plain strings, so a
 *  watcher can track them by value (a cell's value is one reconciled store
 *  object, the same before and after a change). `undefined` for any status
 *  that is not ready. */
export interface LandedFacts {
  /** The stack's references, as one string. */
  readonly stack: string;
  /** The set, as `./landing.ts`' `setKey` writes it. */
  readonly set: string;
}

/** A status's {@link LandedFacts}. */
export function landedFacts(
  status: AgentDistroStatus | undefined,
): LandedFacts | undefined {
  return status?.kind === "ready"
    ? {
        stack: JSON.stringify(referencesOf(status.set.profiles)),
        set: setKey(status.set),
      }
    : undefined;
}

/** The set a receipt is about, as {@link LandedFacts}' `set` — `undefined`
 *  when nothing serves. A watcher that saw a set land waits for the receipt
 *  of that very set. */
export function receiptSet(receipt: AgentDistroReceipt): string | undefined {
  return receipt.serving === undefined
    ? undefined
    : setKey(receipt.serving.set);
}

/** Did an update land between two statuses — ready → ready with ANOTHER set
 *  for the SAME stack, while the old set served? A first delivery, a change of
 *  the stack, or anything not ready is not one. */
export function updateLanded(
  prev: LandedFacts | undefined,
  now: LandedFacts | undefined,
): boolean {
  return (
    prev !== undefined &&
    now !== undefined &&
    prev.stack === now.stack &&
    prev.set !== now.set
  );
}
