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

import { agentBundleShortHash } from "./bundle.ts";
import type {
  AgentUpdateAuthor,
  AgentUpdateEvent,
  AgentUpdateRun,
} from "./history.ts";
import type {
  AgentDistroFailureReason,
  AgentDistroReceipt,
  AgentDistroResolved,
  AgentDistroSetting,
  AgentDistroStatus,
  TerminalAgents,
} from "./schema.ts";
import type { AgentDistroListing, AgentDistroProfile } from "./listing.ts";
import { DEFAULT_AGENT_PROFILE } from "./manifest.ts";

/** Juspay's profile, as a reference — the one agent-distro reference kolu
 *  names by itself. It rides the vanilla bundle (the listing's first) like any
 *  reference. */
export const JUSPAY_PROFILE = "github:juspay/skills";

/** What Juspay's card says it brings. HERE and not in the listing: Juspay is a
 *  reference kolu names, not a bundle this build ships, so no `profile.json`
 *  describes it. */
export const JUSPAY_DESCRIPTION =
  "Juspay skills + Kolu, via Juspay's LiteLLM gateway";

/** What "never chosen" means for new terminals: off, on the bundle kolu lists
 *  first ({@link DEFAULT_AGENT_PROFILE}, `defaults.json`'s `vanilla`), so
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

/** A change to the Agents control: the switch, or a picked profile. */
export type AgentsChange =
  | { readonly on: boolean }
  | { readonly profile: string };

/** The whole value a change on the Agents control writes — the ONE writer the
 *  Settings row and the first-run step go through. The switch keeps the
 *  profile already stored ({@link DEFAULT_AGENT_PROFILE} while nothing is
 *  chosen), so turning agents back on returns to it. A picked card, or the
 *  Custom field, writes its profile, trimmed, with agents on; `undefined` for
 *  an empty field, which writes nothing. Whatever the text, it is written:
 *  whether agent-distro resolves it is the resolved line's to say
 *  ({@link agentsResolvedLine}), never a refusal here. */
export function agentDistroChoice(
  change: AgentsChange,
  stored: AgentDistroSetting | null,
): AgentDistroSetting | undefined {
  if ("on" in change)
    return {
      enabled: change.on,
      profile: agentDistroSettingOf(stored).profile,
    };
  const profile = change.profile.trim();
  return profile === "" ? undefined : { enabled: true, profile };
}

/** Is the first-run "choose your agents" step done? `undefined` is "not known
 *  yet" — the step is then neither asked nor done: while the profile listing
 *  has not arrived (without it the step could only offer Off), and while this
 *  machine's status has not caught up with a choice (below). Otherwise:
 *
 *   - a kolu built without agents (`unavailable` listing): done — there is
 *     nothing to choose;
 *   - agents off — nothing chosen yet, or Off picked: not done. Off is not a
 *     final answer: until agents are on, the welcome card keeps the choice at
 *     the top, and picking Off leaves it there with no agents added. (Whether
 *     anyone chose still matters elsewhere — {@link agentsChosen} decides the
 *     step's autofocus and Settings' "nothing chosen yet" line.);
 *   - a profile chosen: done once this machine has settled with it — the agents
 *     are there (`ready`) or its padi has none to fetch (`unavailable`). While
 *     this machine is still being delivered, or its delivery failed, the step
 *     stays, so a first-run user watches the agents arrive. Until this
 *     machine's status has caught up with the choice — no frame yet, padi
 *     still `off`, or a status for another profile — it is not known yet
 *     (`undefined`), so a user who already chose never sees the row flash on a
 *     reload or after a kolu-server restart. A padi that never leaves `off`
 *     after a choice therefore leaves the step neither asked nor done, by
 *     design: there is nothing true to show about it.
 *
 *  That last reading is deliberate beyond the first run too: switching to a
 *  profile this machine must be delivered, in Settings while no terminals are open,
 *  brings the row back until the delivery lands — watching it arrive is the
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
  if (!agentsChosen(stored) || !stored.enabled) return false;
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

/** How a profile is NAMED — the one display name every surface shows: a
 *  bundle this build ships by its own name capitalized ("vanilla" →
 *  "Vanilla"), {@link JUSPAY_PROFILE} as "Juspay", and anything else (a flake
 *  reference, a path) as itself. The reference is still what is stored, and
 *  the picker still shows it under the name. */
export function agentProfileTitle(
  profile: string,
  listing: AgentDistroListing | undefined,
): string {
  if (profile === JUSPAY_PROFILE) return "Juspay";
  return shippedProfile(listing, profile) === undefined
    ? profile
    : capitalize(profile);
}

/** The welcome card's done line for the first-run step, by whether the
 *  profile resolves on this machine ({@link agentsResolvedLine}): the chosen
 *  profile BY NAME at once — the name is known locally the moment the choice
 *  is written — with a check once it resolves ("Agents: Vanilla ✓"), and
 *  agent-distro's words instead of the check when it fails. While the answer
 *  is pending the line is just the name ("Agents: Vanilla"): the ✓ follows
 *  padi, the name does not. `undefined` while agents are off — the step is not
 *  done then ({@link firstRunAgentsDone}) — and in a kolu built without
 *  agents, where nobody chose anything and the step is done only because there
 *  is nothing to choose. */
export function agentsChosenLabel(
  setting: AgentDistroSetting,
  listing: AgentDistroListing | undefined,
  resolved: AgentDistroResolved | undefined,
): string | undefined {
  if (listing?.kind === "unavailable") return undefined;
  const line = agentsResolvedLine(setting, resolved);
  if (line === undefined) return undefined;
  const name = agentProfileTitle(setting.profile, listing);
  switch (line.kind) {
    case "pending":
      return `Agents: ${name}`;
    case "resolved":
      return `Agents: ${name} ✓`;
    case "failed":
      return `Agents: ${name} — ${line.text}`;
    default:
      return line.kind satisfies never;
  }
}

/** How a host shows its agents: the treatment of its tab's agent-distro mark,
 *  and of its line in Settings.
 *
 *   - `none`: no mark at all (agents off on this host, a padi without the bake,
 *     or a host we cannot hear from) — the tab is as it would be without agents;
 *   - `checking`: the host is connected and agents are on, but its status has not
 *     arrived yet (a dimmed mark with a spinning arc);
 *   - `ready`: the selected profile is on the host for new terminals —
 *     `delivering` while kolu delivers a newer set there (the old set keeps
 *     serving; the mark keeps its plain colour, with a turning arc);
 *   - `downloading`: kolu is delivering it to a host that has none yet (a
 *     turning arc — a delivery's copies report no byte counts to fill with);
 *   - `failed`: the delivery failed (the warning colour and a dot). */
export type AgentMark =
  | {
      readonly kind: "none";
      /** Why there is no mark: agents are off on the host, the host's padi has
       *  no agents built in, or we have not heard from the host. */
      readonly why: "off" | "unavailable" | "unheard";
    }
  | { readonly kind: "checking" }
  | {
      readonly kind: "ready";
      readonly profile: string;
      readonly hash: string;
      /** kolu is delivering a newer set there; this one serves until it has
       *  fully landed. */
      readonly delivering: boolean;
    }
  | { readonly kind: "downloading" }
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
        delivering: status.delivering,
      };
    case "downloading":
      return { kind: "downloading" };
    case "error":
      return { kind: "failed", reason: status.reason, message: status.message };
    default:
      return status satisfies never;
  }
}

/** What a refused delivery means, in plain words — the cause behind the
 *  `refused` reason, whatever Nix said. */
export const AGENTS_REFUSED_MEANS =
  "That machine's Nix trusts neither the login kolu connects as nor agent-distro's cache key, so it would not accept the agents kolu copied there.";

/** The host-side fix for a refused delivery — the ONE wording. Either half is
 *  enough; neither is something kolu changes on a machine itself. */
export const AGENTS_REFUSED_FIX =
  "On that machine, add the login to `nix.settings.trusted-users`, or add agent-distro's cache and its key to `nix.settings.substituters` and `nix.settings.trusted-public-keys`.";

/** What a delivery the machine RUNNING kolu refused means — its own Nix would
 *  not take the bundle from agent-distro's cache, so no host was even asked. */
export const AGENTS_BINDER_REFUSED_MEANS =
  "The Nix on the machine running kolu trusts neither the user kolu runs as nor agent-distro's cache key, so it would not take the agents from the cache to pass on.";

/** The fix for that, on the machine running kolu. */
export const AGENTS_BINDER_REFUSED_FIX =
  "On the machine running kolu, add your user to `nix.settings.trusted-users`, or add agent-distro's cache and its key to `nix.settings.substituters` and `nix.settings.trusted-public-keys`.";

/** When kolu tries a failed delivery again — never in a loop of its own. */
export const AGENTS_DELIVERY_AGAIN =
  "kolu tries again at the next scheduled update, or when you check that machine from its host details.";

/** The host-setup remedy for a failure, by its typed reason — empty when the
 *  cause (kolu-server's words, with Nix's own line) says it all. */
export function agentFailureRemedy(
  reason: AgentDistroFailureReason,
): readonly string[] {
  switch (reason) {
    case "refused":
      return [AGENTS_REFUSED_MEANS, AGENTS_REFUSED_FIX];
    case "binderRefused":
      return [AGENTS_BINDER_REFUSED_MEANS, AGENTS_BINDER_REFUSED_FIX];
    case "delivery":
      return [];
    default:
      return reason satisfies never;
  }
}

/** A failed delivery's words, in the one order every surface shows them — the
 *  cause, the remedy (by reason, when there is one), when kolu tries again —
 *  each once. The tab mark's hover and the host details read this. */
export function agentFailureLines(
  failure: {
    readonly reason: AgentDistroFailureReason;
    readonly message: string;
  },
  where: string,
): readonly [string, ...string[]] {
  return [
    `The coding agents could not be delivered to ${where}: ${failure.message}`,
    ...agentFailureRemedy(failure.reason),
    AGENTS_DELIVERY_AGAIN,
  ];
}

/** A mark's words, as a headline and the lines under it — the ONE wording its
 *  hover and the Settings line share. `where` names the
 *  machine as the host tab does — the local machine by its hostname, a remote
 *  by its own label; the client's one label function supplies it. `undefined`
 *  for `none`. */
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
        title: `Coding agents ready on ${where}: ${mark.profile} (${mark.hash}) — new terminals on ${where} start with them`,
        detail: mark.delivering ? [AGENTS_UPDATE_DOWNLOADING] : [],
      };
    case "downloading":
      return {
        title: `Delivering the coding agents to ${where}…`,
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

/** What a ready host says while a newer set is copied to it. */
export const AGENTS_UPDATE_DOWNLOADING =
  "Delivering newer agents — new terminals keep these until they have fully arrived.";

/** A mark's words as one text — its accessible name and its hover.
 *  `undefined` for `none`. */
export function agentMarkLabel(
  mark: AgentMark,
  where: string,
): string | undefined {
  const words = agentMarkWords(mark, where);
  if (words === undefined) return undefined;
  return [words.title, ...words.detail].join("\n");
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

function capitalize(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** What Off means, in the one wording every surface uses (the row's hint, the
 *  toast). */
export const AGENTS_OFF_MEANS =
  "New terminals use only the agents you installed yourself.";

/** How many profiles the field remembers the user set before. */
export const RECENT_PROFILES_CAP = 8;

/** The profiles the field remembers after `profile` was set: it first, then
 *  the others in their order, at most {@link RECENT_PROFILES_CAP}. A shipped
 *  bundle's name is not remembered — the suggestions always offer it. */
export function rememberProfile(
  recent: readonly string[],
  profile: string,
  listing: AgentDistroListing | undefined,
): readonly string[] {
  if (shippedProfile(listing, profile) !== undefined) return recent;
  return [profile, ...recent.filter((p) => p !== profile)].slice(
    0,
    RECENT_PROFILES_CAP,
  );
}

/** The profile this kolu ships under `name`, if it does. */
function shippedProfile(
  listing: AgentDistroListing | undefined,
  name: string,
): AgentDistroProfile | undefined {
  return listing?.kind === "available"
    ? listing.profiles.find((p) => p.name === name)
    : undefined;
}

/** One card in the Agents picker: a profile kolu offers by name, or the
 *  Custom… card that reveals the reference field. */
export interface AgentProfileCard {
  /** The profile the card writes when picked — `undefined` for Custom…, which
   *  writes whatever its field holds. */
  readonly profile: string | undefined;
  /** The name the card is read by ({@link agentProfileTitle}). */
  readonly title: string;
  /** One line of what it brings — a shipped bundle's own `profile.json`
   *  description, {@link JUSPAY_DESCRIPTION}, or Custom…'s own words. */
  readonly description: string;
  /** What is actually stored, shown under the name when the name is not it —
   *  only a reference kolu names itself has one. */
  readonly reference?: string;
  /** The card a never-chosen kolu starts on, marked `Default`. */
  readonly isDefault: boolean;
}

/** The Custom… card's own words — the one place in the UI a flake reference
 *  belongs. */
export const AGENTS_CUSTOM = {
  title: "Custom…",
  description: "A flake reference or a path to your own agent-distro.nix",
} as const;

/** The picker's cards, in this order: the bundle kolu lists first
 *  ({@link DEFAULT_AGENT_PROFILE}, marked Default), every other bundle this
 *  build ships, {@link JUSPAY_PROFILE} as a named reference, then Custom….
 *  Empty until the listing arrives, and for a kolu built without agents
 *  (nothing to pick). */
export function agentProfileCards(
  listing: AgentDistroListing | undefined,
): readonly AgentProfileCard[] {
  if (listing?.kind !== "available") return [];
  // The listing is already default-first (the Nix half writes it so), but the
  // order the picker shows is this fold's own promise, not a borrowed one.
  const byDefaultFirst = [
    ...listing.profiles.filter((p) => p.name === DEFAULT_AGENT_PROFILE),
    ...listing.profiles.filter((p) => p.name !== DEFAULT_AGENT_PROFILE),
  ];
  const shipped = byDefaultFirst.map(
    (p): AgentProfileCard => ({
      profile: p.name,
      title: agentProfileTitle(p.name, listing),
      description: p.description,
      isDefault: p.name === DEFAULT_AGENT_PROFILE,
    }),
  );
  const juspay: AgentProfileCard = {
    profile: JUSPAY_PROFILE,
    title: agentProfileTitle(JUSPAY_PROFILE, listing),
    description: JUSPAY_DESCRIPTION,
    reference: JUSPAY_PROFILE,
    isDefault: false,
  };
  return [
    ...shipped,
    juspay,
    {
      profile: undefined,
      title: AGENTS_CUSTOM.title,
      description: AGENTS_CUSTOM.description,
      isDefault: false,
    },
  ];
}

/** Which of these cards the setting selects: the one whose profile it is,
 *  else Custom… (a reference of the user's own), else the default one — the
 *  last clause answers a list that HAS no Custom… card, which the welcome
 *  step's picker is. `undefined` until the listing arrives (no cards at
 *  all). */
export function agentSelectedCard(
  setting: AgentDistroSetting,
  cards: readonly AgentProfileCard[],
): AgentProfileCard | undefined {
  return (
    cards.find((c) => c.profile === setting.profile) ??
    cards.find((c) => c.profile === undefined) ??
    cards.find((c) => c.isDefault)
  );
}

/** One suggestion under the Custom… field: the reference it writes, and a note
 *  beside it. */
export interface ProfileSuggestion {
  readonly value: string;
  readonly note: string;
}

/** The Custom… field's suggestions: what the user set before, most recent
 *  first. The shipped bundles and Juspay are CARDS
 *  ({@link agentProfileCards}), so the menu never repeats them. */
export function profileSuggestions(input: {
  readonly recent: readonly string[];
}): readonly ProfileSuggestion[] {
  return input.recent.map((value) => ({ value, note: "used before" }));
}

/** The line under the profile field: whether agent-distro resolves the
 *  setting's profile on this machine — `undefined` while agents are off.
 *  Until this machine's padi has answered for THIS profile (no frame yet, an
 *  answer about the previous one, or nothing to ask while its bundle is still
 *  on the way) it is `pending`. */
export interface AgentsResolvedLine {
  readonly kind: "pending" | "resolved" | "failed";
  /** `failed`: agent-distro's own words — {@link AGENTS_UNRESOLVED_MEANS}
   *  follows them. */
  readonly text: string;
}

/** What a profile that does not resolve means for new terminals, under
 *  agent-distro's words. */
export const AGENTS_UNRESOLVED_MEANS =
  "New terminals still get it, and their agents will not start until it resolves — except in a repository with its own agent-distro.nix.";

/** THE fold from the setting and this machine's resolved cell to the line
 *  under the profile field. Fenced over the cell's kind. */
export function agentsResolvedLine(
  setting: AgentDistroSetting,
  resolved: AgentDistroResolved | undefined,
): AgentsResolvedLine | undefined {
  if (!setting.enabled) return undefined;
  const pending = {
    kind: "pending",
    text: `resolving ${setting.profile}…`,
  } as const;
  // An answer about another profile is one padi has not caught up from.
  if (
    resolved === undefined ||
    resolved.kind === "none" ||
    resolved.kind === "pending" ||
    resolved.profile !== setting.profile
  )
    return pending;
  switch (resolved.kind) {
    case "resolved":
      return {
        kind: "resolved",
        text:
          resolved.description === ""
            ? resolved.name
            : `${resolved.name} · ${resolved.description}`,
      };
    case "failed":
      return { kind: "failed", text: resolved.message };
    default:
      return resolved satisfies never;
  }
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

/** The receipt, when it is about `profile` — a receipt for another profile is
 *  one the host has not caught up from. */
function receiptFor(
  receipt: AgentDistroReceipt | undefined,
  profile: string,
): AgentDistroReceipt | undefined {
  return receipt?.profile === profile ? receipt : undefined;
}

/** Who a reason's words are by, as a hover names them: kolu's delivery (the
 *  history and its reports), or padi's words about a delivery its host could
 *  not take. */
const AUTHOR: Record<AgentUpdateAuthor, string> = {
  delivery: "kolu's delivery",
  padi: "padi",
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
  const note = (text: string, tone: AgentStatusNote["tone"]) => ({
    text,
    title: run.words === "" ? text : quoted(text, run.by, run.words),
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

/** A host's last update run as a note, from the receipt its caller resolved —
 *  `undefined` when it has run nothing yet. A receipt that would not read says
 *  so instead, in the warning tone. */
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

function eventRow(event: AgentUpdateEvent, ago: AgoPhrase): AgentEventRow {
  return {
    when: ago(Date.parse(event.at)),
    kind: event.kind,
    text: event.words,
    title: quoted(EVENT_LABEL[event.kind], "delivery", event.words),
    tone: event.kind === "failed" ? "warn" : "muted",
  };
}

/** A failed delivery's state, in a word or two, by its reason. */
const FAILED_STATE: Record<AgentDistroFailureReason, string> = {
  refused: "refused by its Nix",
  binderRefused: "refused by kolu's own Nix",
  delivery: "delivery failed",
};

/** What a machine's host details say about its agents: the profile new
 *  terminals there get and the build serving it, the state in one line, a
 *  failure's own words, that machine's last update events, and which action it
 *  offers. The per-machine facts live HERE, beside the machine — Settings keeps
 *  only the fleet line ({@link agentFleetSummary}). */
export interface AgentHostDetail {
  /** The profile, as the picker names it. */
  readonly profile: string;
  /** The build serving it — only a ready host has one. */
  readonly hash?: string;
  readonly state: AgentStatusNote;
  /** A failed delivery's words: the cause, and the remedy when its reason has
   *  one (which the section follows with its one doc link). Trying again is
   *  the section's button; `means` says when kolu tries on its own. */
  readonly cause: readonly string[];
  /** The failure has a fix someone makes in a machine's Nix settings (a
   *  refusal, here or at the machine running kolu) — the section then links
   *  to the docs that explain it. */
  readonly hasFix: boolean;
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
 *  so). `profile` is the SETTING's, named by {@link agentProfileTitle}: a host
 *  that has not caught up still says which profile it is meant to have. Fenced
 *  over the mark kind. */
export function agentHostDetail(input: {
  readonly host: HostAgentStatus;
  readonly setting: AgentDistroSetting;
  readonly listing: AgentDistroListing | undefined;
}): AgentHostDetail | undefined {
  const { host, setting } = input;
  const mark = agentMarkOf(host.status, host.checking);
  if (mark.kind === "none" && mark.why !== "off") return undefined;
  const plain = (text: string): AgentStatusNote => ({
    text,
    title: text,
    tone: "muted",
  });
  const base = {
    profile: agentProfileTitle(setting.profile, input.listing),
    cause: [],
    hasFix: false,
    events: [],
  } as const;
  switch (mark.kind) {
    case "none":
      return { ...base, state: plain(NONE_LINE.off), canCheck: false };
    case "checking":
      return { ...base, state: plain("checking…"), canCheck: false };
    case "downloading":
      return { ...base, state: plain("delivering…"), canCheck: false };
    case "failed":
      return {
        ...base,
        state: {
          text: FAILED_STATE[mark.reason],
          title: mark.message,
          tone: "warn",
        },
        cause: [mark.message, ...agentFailureRemedy(mark.reason)],
        hasFix: agentFailureRemedy(mark.reason).length > 0,
        means: `New terminals on ${host.label} get no coding agents until this is fixed. ${AGENTS_DELIVERY_AGAIN}`,
        canCheck: true,
      };
    case "ready": {
      const receipt = receiptFor(host.receipt, mark.profile);
      const run = lastRunNoteOf(receipt, host.ago);
      const state: AgentStatusNote = mark.delivering
        ? plain("ready · delivering newer agents…")
        : run === undefined
          ? plain("ready")
          : { ...run, text: `ready · ${run.text}` };
      return {
        ...base,
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

/** The agents a profile brings, named only — "Claude Code, Codex, OpenCode, Pi
 *  and Oh My Pi", in the listing's order. The welcome step's line reads this;
 *  the chips beside it are the same set, one per agent. */
function harnessNames(profile: AgentDistroProfile): string {
  const names = profile.harnesses.map((h) => h.title);
  const last = names.at(-1);
  if (last === undefined) return "";
  return names.length === 1
    ? last
    : `${names.slice(0, -1).join(", ")} and ${last}`;
}

/** What the welcome card's Agents step says it brings: the default bundle's
 *  agents by name, then what kolu does with them. `undefined` until the
 *  listing arrives, and for a kolu built without agents (the step does not ask
 *  there). */
export function agentsStepHint(
  listing: AgentDistroListing | undefined,
): string | undefined {
  if (listing?.kind !== "available") return undefined;
  const lead = shippedProfile(listing, DEFAULT_AGENT_PROFILE);
  const names = lead === undefined ? "" : harnessNames(lead);
  const what = names === "" ? "Coding agents" : names;
  return `${what} in every new terminal. Kept up to date, nothing to install.`;
}

/** The Agents row's hint while agents are off: ONE sentence — what off means,
 *  and that turning it on starts new terminals with the agents the chips under
 *  it name. Once agents are on the row says nothing here: the picker and its
 *  chips do. It takes the STORED value — `null` while nothing is chosen — and
 *  says the same thing either way: the welcome card carries the "nothing
 *  chosen yet" state, so the row does not repeat it. */
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

/** What the picker's own fine print adds under the chips. */
export const AGENTS_REPO_OVERRIDES =
  "A repository with its own agent-distro.nix overrides this.";

/** One agent chip: the agent as people know it, and the version this machine
 *  has — `undefined` while agents are off, where the set is what kolu would
 *  bring rather than what any machine holds. */
export interface AgentChip {
  readonly title: string;
  readonly version?: string;
}

/** The chips under the Agents row — the agents the SETTING's bundle brings,
 *  each once. The bundle is the one the setting names, or the default when it
 *  names a reference, exactly as padi's `bundleProfileOf` (`./schema`)
 *  resolves it — the switch being off changes only the words, never which
 *  bundle:
 *
 *   - agents OFF: its agents by name, no versions (nothing is installed, so
 *     no version is this machine's);
 *   - agents ON: its agents with their versions — this machine's own, from
 *     its receipt, once it has one (an update moves them past the listing's).
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
  const bundle =
    shippedProfile(listing, setting.profile) ??
    shippedProfile(listing, DEFAULT_AGENT_PROFILE);
  if (bundle === undefined) return [];
  if (!setting.enabled) return bundle.harnesses.map(({ title }) => ({ title }));
  // Padi names the receipt for the setting's profile; a receipt for another is
  // one this machine has not caught up from.
  const receipt = receiptFor(input.localReceipt, setting.profile);
  return (receipt?.versions ?? bundle.harnesses).map((h) => ({
    title: h.title,
    version: displayVersion(h.version),
  }));
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
      // Same bundle, same profile: a reference switch keeps the bundle but
      // changes the terminal's `AI_PROFILE`.
      return status.bundle === agents.bundle &&
        status.profile === agents.profile
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
 *  ({@link agentRestartAction}'s `outcome`). `where` names the terminal's host,
 *  as the host tab does. */
export function agentStaleLabel(
  stale: Extract<AgentStaleness, { kind: "stale" }>,
  where: string,
): string {
  const had = `This terminal has the ${stale.had.profile} coding agents (${stale.had.hash}).`;
  const { now } = stale;
  switch (now.kind) {
    case "waiting":
      return now.on === "downloading"
        ? `${had} New terminals get ${now.profile}, which is still being delivered to ${where}; Restart appears once it is ready.`
        : `${had} ${now.profile} could not be delivered to ${where}, so new terminals get no coding agents; Restart appears once it is ready.`;
    case "off":
      return `${had} Coding agents are now off. Restart to switch; ${agentRestartAction(stale).outcome}.`;
    case "profile":
      return `${had} New terminals get ${now.profile} (${now.hash}). Restart to switch; ${agentRestartAction(stale).outcome}.`;
    default:
      return now satisfies never;
  }
}

/** The profile a tile's pill names: the one in effect, as agent-distro
 *  answered for this terminal, else the setting's profile it was spawned
 *  with (no answer yet, or none to be had). */
export function agentChipProfile(agents: TerminalAgents): string {
  return agents.effective?.name ?? agents.profile;
}

/** A current pill's hover: what this terminal started with — the profile in
 *  effect and where agent-distro resolved it from, when it said (asked once,
 *  at the spawn; a later `cd` is not followed) — and what a click does. */
export function agentChipLabel(
  agents: Pick<TerminalAgents, "profile" | "bundle" | "effective">,
): string {
  const hash = agentBundleShortHash(agents.bundle);
  const { effective } = agents;
  const started =
    effective === undefined
      ? `This terminal started with the ${agents.profile} coding agents (${hash}).`
      : `This terminal started with the ${effective.name} profile (${hash}), from ${effective.origin}.`;
  return `${started} Click to choose what new terminals get.`;
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

/** The Agents setting's own toasts, worded once. */
export const agentToast = {
  /** Agents on, or a new profile. */
  on: (profile: string) => `New terminals get the ${profile} profile`,
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
  hint: "Look for newer coding agents and deliver them to every machine now. Nothing is compiled: a newer set is delivered only once agent-distro's cache holds all of it, and terminals already open keep theirs.",
} as const;

/** The host-details row that delivers the newest agents to THAT machine now —
 *  also how a machine whose delivery failed is tried again. */
export const AGENTS_HOST_CHECK = {
  label: "check for newer agents",
  hint: "Look for newer coding agents and deliver them to this machine now. Terminals already open keep theirs.",
} as const;

/** A check kolu-server would not run (a run already going, or nothing set). */
export function agentCheckFailed(host: string, message: string): string {
  return `Could not check for newer coding agents on ${host}: ${message}`;
}

/** Can `status`'s host be checked now — ready with no delivery running there,
 *  or failed (checking is how it is tried again)? Read through the mark, as the
 *  status line and the tab are. */
export function agentUpdateCheckable(
  status: AgentDistroStatus | undefined,
): boolean {
  const mark = agentMarkOf(status, false);
  return (mark.kind === "ready" && !mark.delivering) || mark.kind === "failed";
}

/** One host as Check now sees it: whether it is connected, and its status. */
export interface AgentCheckHost {
  readonly connected: boolean;
  readonly status: AgentDistroStatus | undefined;
}

/** Will Check now ask this host — connected (a disconnected host's last-known
 *  `ready` cannot answer), and ready with no delivery running there, or
 *  failed ({@link agentUpdateCheckable})? The ONE
 *  per-host test the button's call and its busy state share. */
export function agentHostCheckable(host: AgentCheckHost): boolean {
  return host.connected && agentUpdateCheckable(host.status);
}

/** The facts of a ready status an update is read from — plain strings, so a
 *  watcher can track them by value (a cell's value is one reconciled store
 *  object, the same before and after a change). `undefined` for any status
 *  that is not ready. */
export interface LandedFacts {
  readonly profile: string;
  readonly bundle: string;
}

/** A status's {@link LandedFacts}. */
export function landedFacts(
  status: AgentDistroStatus | undefined,
): LandedFacts | undefined {
  return status?.kind === "ready"
    ? { profile: status.profile, bundle: status.bundle }
    : undefined;
}

/** Did an update land between two statuses — ready → ready with ANOTHER bundle
 *  of the SAME profile, while the old set served? A first delivery, a switch
 *  to another profile, or anything not ready is not one. */
export function updateLanded(
  prev: LandedFacts | undefined,
  now: LandedFacts | undefined,
): boolean {
  return (
    prev !== undefined &&
    now !== undefined &&
    prev.profile === now.profile &&
    prev.bundle !== now.bundle
  );
}
