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
  AgentUpdateAuthor,
  AgentUpdateEvent,
  AgentUpdateRun,
} from "./history.ts";
import type {
  AgentDistroFailureReason,
  AgentDistroReceipt,
  AgentDistroSetting,
  AgentDistroStatus,
  TerminalAgents,
} from "./schema.ts";
import type { AgentDistroListing, AgentDistroProfile } from "./listing.ts";
import type { AgentVersion } from "./versions.ts";

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
 *   - agents off — nothing chosen yet, or Off picked: not done. Off is not a
 *     final answer: until agents are on, the welcome card keeps the choice at
 *     the top, and picking Off leaves it there with no agents added. (Whether
 *     anyone chose still matters elsewhere — {@link agentsChosen} decides the
 *     step's autofocus and Settings' "nothing chosen yet" line.);
 *   - a stored profile this kolu does not ship (Settings warns about it; its
 *     status would never reach `ready`): done;
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
  if (!agentsChosen(stored) || !stored.enabled) return false;
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

/** The welcome card's done line for the first-run step: the chosen profile
 *  ("Agents: vanilla ✓"). `undefined` while agents are off — the step is not
 *  done then ({@link firstRunAgentsDone}) — in a kolu built without agents,
 *  where nobody chose anything and the step is done only because there is
 *  nothing to choose, and for a stored profile the listing does not ship (no
 *  check mark on a choice Settings warns about, {@link unknownProfileOf}). */
export function agentsChosenLabel(
  setting: AgentDistroSetting,
  listing: AgentDistroListing | undefined,
): string | undefined {
  if (listing?.kind === "unavailable" || !setting.enabled) return undefined;
  if (unknownProfileOf(setting, listing) !== undefined) return undefined;
  return `Agents: ${setting.profile} ✓`;
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
 *   - `ready`: the selected profile is on the host for new terminals — with
 *     `update` while the updater runs there (the old set keeps serving; a ring
 *     fills with bytes once a newer set downloads, the mark keeps its plain
 *     colour);
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
  | {
      readonly kind: "ready";
      readonly profile: string;
      readonly hash: string;
      /** The updater is running there; `download` once a newer set is coming
       *  down (its ring fill and bytes). */
      readonly update?: {
        readonly download?: {
          readonly fraction: number;
          readonly bytes: string | undefined;
        };
      };
    }
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
    case "ready": {
      const ready = {
        kind: "ready",
        profile: status.profile,
        hash: agentBundleShortHash(status.bundle),
      } as const;
      if (status.update === undefined) return ready;
      const progress = status.update.progress;
      return {
        ...ready,
        update:
          progress === undefined
            ? {}
            : {
                download: {
                  fraction: downloadFraction(progress),
                  bytes: downloadBytes(progress),
                },
              },
      };
    }
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
 *  machine as the host tab does — the local machine by its hostname, a remote
 *  by its own label; the client's one label function supplies it. A download's bytes are not in it: each surface shows
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
        title: `Coding agents ready on ${where}: ${mark.profile} (${mark.hash}) — new terminals on ${where} start with them`,
        detail:
          mark.update === undefined
            ? []
            : [
                mark.update.download === undefined
                  ? capitalize(AGENTS_UPDATE_CHECKING)
                  : AGENTS_UPDATE_DOWNLOADING,
              ],
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

/** What a ready host says while the updater looks for a newer set. */
export const AGENTS_UPDATE_CHECKING = "checking for newer agents…";

/** What a ready host says while a newer set downloads. */
export const AGENTS_UPDATE_DOWNLOADING =
  "Downloading newer agents — new terminals keep these until they have fully arrived.";

/** The words beside a mark's bar while it fills — a first download's headline,
 *  or a ready host's update line — `undefined` when no bar fills. The ONE
 *  choice of text for the tab's hover beside its bar. */
export function agentMarkFillWords(
  mark: AgentMark,
  where: string,
): string | undefined {
  if (agentMarkFill(mark) === undefined) return undefined;
  const words = agentMarkWords(mark, where);
  switch (mark.kind) {
    case "ready":
      return words?.detail.join(" ");
    case "downloading":
      return words?.title;
    case "none":
    case "checking":
    case "failed":
      return undefined;
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
  const shown =
    mark.kind === "downloading"
      ? mark.bytes
      : mark.kind === "ready"
        ? mark.update?.download?.bytes
        : undefined;
  const bytes = shown === undefined ? "" : ` ${shown}`;
  return [`${words.title}${bytes}`, ...words.detail].join("\n");
}

/** The agents a profile brings, named the way people know them, with their
 *  versions: "Claude Code 2.1.291 · Codex 0.160.1 · Oh My Pi 18.6.3 · …" —
 *  each harness's title and version from the listing, in its order. Never
 *  hand-written: it is whatever the pinned agent-distro ships. */
export function harnessLine(profile: AgentDistroProfile): string {
  return versionsLine(profile.harnesses);
}

/** A version as agent-distro's picker shows it: without the package's `+`
 *  revision suffix (`1.18.35+53d1eab` → `1.18.35`) — upstream's
 *  `displayVersion` (`lib/picker.nix`), mirrored here once so every line kolu
 *  draws says what `agent-distro` in the same terminal says. */
export function displayVersion(version: string): string {
  return version.split("+")[0] ?? version;
}

/** The same line for any list of agents with versions — a host's receipt
 *  (`AgentDistroReceipt.versions`), what that machine actually has now. */
export function versionsLine(
  agents: readonly Pick<AgentVersion, "title" | "version">[],
): string {
  return agents
    .map((h) => `${h.title} ${displayVersion(h.version)}`)
    .join(" · ");
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

/** Where the welcome card's Agents control — the row that asks — rests the
 *  keyboard while agents are off (nothing chosen, or Off pressed): the default
 *  profile ({@link defaultProfileOf}), so
 *  Enter turns agents on with it. Off when there is none. */
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

/** Who a reason's words are by, as a hover names them: the updater's own
 *  result line or history, or padi's words about a run that gave none. */
const AUTHOR: Record<AgentUpdateAuthor, string> = {
  updater: "agent-distro's updater",
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

/** How a mark is filling — a first download's bytes, or an update's on a ready
 *  host — `undefined` when nothing is coming down. THE one reading the tab's
 *  ring and the Settings line share. */
export function agentMarkFill(
  mark: AgentMark,
):
  | { readonly fraction: number; readonly bytes: string | undefined }
  | undefined {
  switch (mark.kind) {
    case "downloading":
      return { fraction: mark.fraction, bytes: mark.bytes };
    case "ready":
      return mark.update?.download;
    case "none":
    case "checking":
    case "failed":
      return undefined;
    default:
      return mark satisfies never;
  }
}

/** A ready host's update phase — checking for a newer set, or downloading
 *  one — or `undefined` when none runs (or the host is not ready). */
export function agentMarkUpdate(
  mark: AgentMark,
): "checking" | "downloading" | undefined {
  switch (mark.kind) {
    case "ready":
      return mark.update === undefined
        ? undefined
        : mark.update.download === undefined
          ? "checking"
          : "downloading";
    case "none":
    case "checking":
    case "downloading":
    case "failed":
      return undefined;
    default:
      return mark satisfies never;
  }
}

/** One status line under the Agents row: the host, a bar, and a short text. */
export interface AgentStatusLine {
  readonly host: string;
  /** An update running there: still checking, or downloading a newer set. */
  readonly update?: "checking" | "downloading";
  /** How the last update run there ended, when the line says it. */
  readonly lastRun?: AgentUpdateRun["outcome"];
  /** The bar's colour: accent while downloading, ok when ready, warning when
   *  failed, and an empty bar when there is nothing to fill. */
  readonly bar: "busy" | "ok" | "warn" | "empty";
  /** The bar's fill, 0 to 1. */
  readonly fill: number;
  readonly text: string;
  /** A second, quieter line under `text`: a ready host's update running
   *  ("updating · 1.1 GiB of 2.0 GiB") or its last run ("updated 3h ago"). */
  readonly note?: AgentStatusNote;
}

/** A status line's note: its text, its hover (the text, and a skip's or a
 *  failure's reason quoted with who wrote it), and its tone. */
export interface AgentStatusNote {
  readonly text: string;
  readonly title: string;
  readonly tone: "muted" | "warn";
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
    case "ready": {
      const ready = `ready · ${mark.profile} ${mark.hash}`;
      // The host IS ready while an update runs: the bar stays full and
      // green; the note (and the tab's ring) carry the run.
      const update = agentMarkUpdate(mark);
      switch (update) {
        case "checking":
          return {
            ...line("ok", 1, ready),
            note: {
              text: AGENTS_UPDATE_CHECKING,
              title: AGENTS_UPDATE_CHECKING,
              tone: "muted",
            },
            update,
          };
        case "downloading": {
          const bytes = agentMarkFill(mark)?.bytes;
          const text = `updating${bytes === undefined ? "…" : ` · ${bytes}`}`;
          return {
            ...line("ok", 1, ready),
            note: { text, title: text, tone: "muted" },
            update,
          };
        }
        case undefined:
          break;
        default:
          return update satisfies never;
      }
      const receipt = receiptFor(host.receipt, mark.profile);
      if (receipt?.error !== undefined)
        return {
          ...line("ok", 1, ready),
          note: {
            text: AGENTS_RECEIPT_UNREADABLE,
            title: unreadableTitle(receipt.error),
            tone: "warn",
          },
        };
      const run = receipt?.lastRun;
      return run === undefined
        ? line("ok", 1, ready)
        : {
            ...line("ok", 1, ready),
            note: lastRunNote(run, host.ago),
            lastRun: run.outcome,
          };
    }
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

/** Is the host ready with nothing to say on its own line: no update running,
 *  its update history readable, and its last run not a failure? A host that
 *  is not keeps its own line, note and all. */
function settledReady(host: HostAgentStatus): boolean {
  const mark = agentMarkOf(host.status, host.checking);
  if (mark.kind !== "ready" || agentMarkUpdate(mark) !== undefined)
    return false;
  const receipt = receiptFor(host.receipt, mark.profile);
  return receipt?.error === undefined && receipt?.lastRun?.outcome !== "failed";
}

/** The label of the one line every host folds into. */
export const AGENTS_ALL_HOSTS = "all hosts";

/** The status lines under the Agents row: the machine running kolu first, then
 *  every remote host that is not settled — not ready, updating, its history
 *  unreadable, or its last run failed. A ready line carries a note: its update
 *  running, or its last run ("updated 3h ago", "checked 2h ago, up to date").
 *  When EVERY host is settled they collapse into one line, labelled
 *  {@link AGENTS_ALL_HOSTS} ("ready · vanilla 8rcmf6rd · on 3 hosts" — the hash
 *  only when every machine holds that same build), so the row stays short in
 *  the common case; the History lists each machine's runs. */
export function agentStatusLines(input: {
  readonly local: HostAgentStatus;
  readonly remotes: readonly HostAgentStatus[];
}): readonly AgentStatusLine[] {
  const local = statusLine(input.local);
  const remoteLines = input.remotes.map((host) => ({
    host,
    line: statusLine(host),
  }));
  const notReady = remoteLines
    .filter(({ host }) => !settledReady(host))
    .map(({ line }) => line);
  const remotes = remoteLines.map(({ line }) => line);
  if (
    settledReady(input.local) &&
    notReady.length === 0 &&
    remotes.length > 0
  ) {
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
    // Folded: one line for many machines, so no one machine's name or note.
    const { note: _note, lastRun: _lastRun, ...folded } = local;
    return [
      {
        ...folded,
        host: AGENTS_ALL_HOSTS,
        text: `${what} · on ${remotes.length + 1} hosts`,
      },
    ];
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
 *     versions — this machine's own, from its receipt, once it has one (an
 *     update moves them past the listing's). Where each machine stands is the status lines' job
 *     ({@link agentStatusLines}).
 *
 *  It takes the STORED value — `null` while nothing is chosen — because that
 *  difference is one of the things it says. */
export function agentsHint(input: {
  readonly stored: AgentDistroSetting | null;
  readonly listing: AgentDistroListing | undefined;
  /** This machine's receipt: once agents are on, its versions name what this
   *  machine has now — the listing's are the set kolu was built with, which an
   *  update leaves behind. */
  readonly localReceipt: AgentDistroReceipt | undefined;
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
  // This machine's own versions once its receipt is in — never the floor's
  // passed off as this machine's: a bundle with no versions file names none.
  // Before the receipt's first frame, the set kolu ships.
  const receipt = receiptFor(input.localReceipt, profile.name);
  const agents =
    receipt === undefined
      ? harnessLine(profile)
      : versionsLine(receipt.versions);
  return {
    text: [
      `${capitalize(plainProfileDescription(profile))}.`,
      ...(agents === "" ? [] : [agents]),
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
        ? `${had} New terminals get ${now.profile}, which is still downloading to ${where}; Restart appears once it is ready.`
        : `${had} ${now.profile} could not be downloaded to ${where}, so new terminals get no coding agents; Restart appears once it is ready.`;
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
  /** An update landed on `host` (the {@link downloadEdge} `updated` moment):
   *  the change in the updater's own words, and what it means for terminals. */
  updated: (host: string, words: string) =>
    ({
      title: `Coding agents updated on ${host}`,
      description: `${words} — new terminals on ${host} start with them; open ones offer Restart.`,
    }) as const,
} as const;

/** The Settings button that runs the update check on every machine now. */
export const AGENTS_CHECK_NOW = {
  label: "Check now",
  /** While no connected machine can be asked and one is running an update
   *  ({@link agentCheckNowLabel}). */
  busyLabel: "Checking…",
  hint: "Look for newer coding agents on every machine now. Nothing is compiled: a newer set is downloaded only once agent-distro's cache holds all of it, and terminals already open keep theirs.",
} as const;

/** A Check now that could not reach a host (a transport drop, a host gone). */
export function agentCheckFailed(host: string, message: string): string {
  return `Could not check for newer coding agents on ${host}: ${message}`;
}

/** Can `status`'s host run an update check now — ready, with no update
 *  running there? Read through the mark, as the status line and the tab are. */
export function agentUpdateCheckable(
  status: AgentDistroStatus | undefined,
): boolean {
  const mark = agentMarkOf(status, false);
  return mark.kind === "ready" && agentMarkUpdate(mark) === undefined;
}

/** One host as Check now sees it: whether it is connected, and its status. */
export interface AgentCheckHost {
  readonly connected: boolean;
  readonly status: AgentDistroStatus | undefined;
}

/** Will Check now ask this host — connected (a disconnected host's last-known
 *  `ready` cannot answer), ready, with no update running there? The ONE
 *  per-host test the button's call and its busy state share. */
export function agentHostCheckable(host: AgentCheckHost): boolean {
  return host.connected && agentUpdateCheckable(host.status);
}

/** Is Check now busy — no connected host it could ask now? A first download
 *  elsewhere, or a run of a profile no longer selected, does not make it
 *  busy: only a fleet with nothing to ask does. */
export function agentCheckNowBusy(hosts: readonly AgentCheckHost[]): boolean {
  return !hosts.some(agentHostCheckable);
}

/** Check now's words: "Checking…" only while it is busy AND a connected host
 *  is running an update — a fleet busy with first downloads, or not ready at
 *  all, is not checking, so the button keeps its own label (disabled). */
export function agentCheckNowLabel(hosts: readonly AgentCheckHost[]): string {
  const checking =
    agentCheckNowBusy(hosts) &&
    hosts.some((h) => {
      if (!h.connected) return false;
      const mark = agentMarkOf(h.status, false);
      return agentMarkUpdate(mark) !== undefined;
    });
  return checking ? AGENTS_CHECK_NOW.busyLabel : AGENTS_CHECK_NOW.label;
}

/** Is a run of the updater in flight on any of these hosts, for any profile —
 *  a first download or an update? Read off each host's receipt (its
 *  `running`), which covers every profile, not only the selected one — what
 *  the e2e reset waits on before it deletes the updater's state. */
export function agentUpdateRunning(
  receipts: readonly (AgentDistroReceipt | undefined)[],
): boolean {
  return receipts.some((r) => r !== undefined && r.running.length > 0);
}

/** The History disclosure under the status lines. */
export const AGENTS_HISTORY = {
  /** The disclosure's summary — with how many rows it holds, so a closed one
   *  says there is something inside. */
  title: (count: number) => (count === 0 ? "History" : `History (${count})`),
  empty: "No updates yet.",
} as const;

/** How a history event's kind reads in a row. */
const EVENT_LABEL: Record<AgentUpdateEvent["kind"], string> = {
  updated: "updated",
  skipped: "skipped",
  failed: "failed",
};

/** One row of the History: which machine, when, and what happened — an
 *  event in the updater's own words, or (`unreadable`) a host whose history
 *  would not read. One line: `text` may be cut short; `title`, the hover, is
 *  all of it, naming who wrote the words. `warn` for a failure. */
export interface AgentUpdateHistoryRow {
  readonly host: string;
  readonly when: string;
  readonly kind: AgentUpdateEvent["kind"] | "unreadable";
  readonly text: string;
  readonly title: string;
  readonly tone: "muted" | "warn";
}

function historyRow(
  host: string,
  event: AgentUpdateEvent,
  ago: AgoPhrase,
): AgentUpdateHistoryRow {
  const label = EVENT_LABEL[event.kind];
  return {
    host,
    when: ago(Date.parse(event.at)),
    kind: event.kind,
    text: `${label}: ${event.words}`,
    title: quoted(label, "updater", event.words),
    tone: event.kind === "failed" ? "warn" : "muted",
  };
}

/** The History's rows: each machine's last events (its receipt's, for the
 *  selected profile), the machine running kolu first, newest first within
 *  each. A host whose history would not read gets one row saying so — never
 *  an empty History that reads as "no updates yet". */
export function agentUpdateHistoryRows(input: {
  readonly hosts: readonly Pick<HostAgentStatus, "label" | "receipt" | "ago">[];
  readonly profile: string;
}): readonly AgentUpdateHistoryRow[] {
  return input.hosts.flatMap((h): readonly AgentUpdateHistoryRow[] => {
    const receipt = receiptFor(h.receipt, input.profile);
    if (receipt?.error !== undefined)
      return [
        {
          host: h.label,
          when: "",
          kind: "unreadable",
          text: AGENTS_RECEIPT_UNREADABLE,
          title: unreadableTitle(receipt.error),
          tone: "warn",
        },
      ];
    return (receipt?.events ?? []).map((e) => historyRow(h.label, e, h.ago));
  });
}

/** The facts of a status that its moments are read from — plain strings, so a
 *  watcher can track them by value (a cell's value is one reconciled store
 *  object, the same before and after a change). */
export interface DownloadEdgeFacts {
  readonly kind: AgentDistroStatus["kind"];
  /** The profile, for a status that names one. */
  readonly profile?: string;
  /** The bundle new terminals get, while `ready`. */
  readonly bundle?: string;
}

/** A status's {@link DownloadEdgeFacts}. */
export function downloadEdgeFacts(
  status: AgentDistroStatus | undefined,
): DownloadEdgeFacts | undefined {
  if (status === undefined) return undefined;
  switch (status.kind) {
    case "off":
    case "unavailable":
      return { kind: status.kind };
    case "downloading":
    case "error":
      return { kind: status.kind, profile: status.profile };
    case "ready":
      return {
        kind: status.kind,
        profile: status.profile,
        bundle: status.bundle,
      };
    default:
      return status satisfies never;
  }
}

/** The moments a host's download is worth a toast, read off two consecutive
 *  statuses — ONE fold, fenced, so the client keeps only the effect that
 *  watches the cell:
 *
 *   - `start`: anything else (including nothing yet) → downloading — a
 *     download began, or is under way when the host is first heard from;
 *   - `ready`: downloading → ready;
 *   - `updated`: ready → ready with ANOTHER bundle of the SAME profile — an
 *     update landed while the old set served (a switch to another profile is
 *     not one);
 *   - `failed`: downloading → error;
 *   - `dropped`: downloading → off / unavailable — the user turned agents off
 *     mid-download, so its standing toast goes away;
 *   - `none`: everything else (a first frame, a progress tick, an update run
 *     starting or finding nothing, an unrelated change). */
export function downloadEdge(
  prev: DownloadEdgeFacts | undefined,
  now: DownloadEdgeFacts | undefined,
): "start" | "ready" | "updated" | "failed" | "dropped" | "none" {
  if (now === undefined) return "none";
  switch (now.kind) {
    case "downloading":
      return prev?.kind !== "downloading" ? "start" : "none";
    case "ready":
      if (prev?.kind === "downloading") return "ready";
      return prev?.kind === "ready" &&
        prev.profile === now.profile &&
        prev.bundle !== now.bundle
        ? "updated"
        : "none";
    case "error":
      return prev?.kind === "downloading" ? "failed" : "none";
    case "off":
    case "unavailable":
      return prev?.kind === "downloading" ? "dropped" : "none";
    default:
      return now.kind satisfies never;
  }
}
