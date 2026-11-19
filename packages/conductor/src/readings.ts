/**
 * WHAT A HOST'S FRAMES MEAN for the member terminals of a work — the pure half
 * of the watch.
 *
 * kolu-server holds the standing subscriptions (`conductor/watcher.ts`: one leg
 * per connected host that holds a member terminal, re-opened as the host map
 * moves). What a leg's last frames SAY is this module's, and it is a function:
 * padi's urgency fold, the host's roster and the records that were read go in,
 * one {@link WatchObservation} per member terminal comes out. Nothing here
 * subscribes to anything, so every rule below is exercised by calling it rather
 * than by driving a stream — which is the whole reason it is not over there.
 *
 * It REPORTS and never concludes. Two of the wake levels are conclusions drawn
 * one file over, from a sequence of these readings rather than from one of them
 * (`./members.ts`: `ready` is a stop in a terminal nobody has spoken to yet,
 * `ended` is a command that ran and gave the prompt back). The same is true of
 * everything a work's TIMELINE learns here: this module hands over the git fact
 * and the PR as the record states them, and which of those is an EVENT is
 * decided against the work itself (`kolu-work`'s `prOf`, `filesSeen`), never
 * against the last reading — two members looking at one PR must record it once.
 *
 * A terminal is left OUT of the answer when nothing honest can be said about it
 * — its agent is in none of padi's four lists and its record has not arrived to
 * say whether there is an agent in it at all. Silence is the one answer that
 * never misleads: the next frame says more. A whole HOST can be in that
 * position too, which is what {@link HostView} is: `gone` is a word only a host
 * that has finished adopting its terminals has earned, and the roster it is
 * decided against exists on no other arm of that type.
 */

import { frameByClass, frameClassOf } from "@kolu/padi-client/attention";
import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
// The one fold that says what an agent STATE means — the same vocabulary the
// dock and every wait read, so the two presence readings below are padi's word
// for them and not this module's.
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import type { PrResult } from "@kolu/terminal-vocab/schema";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import type {
  WatchGit,
  WatchMerge,
  WatchObservation,
  WatchPr,
} from "./observation.ts";

/** padi's own terminal-id type, read off the urgency cell this module already
 *  takes — the watch list carries plain strings, and the one place they are
 *  handed back to padi's fold is the class read below. Taken from `PadiUrgency`
 *  rather than imported from the vocabulary so this package keeps the two
 *  padi-client leaves it declares and no third edge. */
type PadiTerminalId = PadiUrgency["awaitingIds"][number];

/** ONE HOST, AS THE WATCHER'S LEG FOUND IT — and the reason `gone` cannot be
 *  written down about a host that has not said its roster is a census.
 *
 *  Three states, and only one of them has a roster in it at all:
 *
 *   - **unreachable** — the host is not answering (no leg, or the leg died).
 *     Nothing can be said about its terminals: a machine kolu cannot reach is
 *     not a machine whose terminals are dead.
 *   - **settling** — padi is answering and says its roster is NOT ESTABLISHED
 *     yet (`padiSurface`'s `roster` cell): it is still booting its kaval and
 *     reconciling the saved session, or recycling it. A roster that has not been
 *     established is not an empty roster. This is the state the old shape could
 *     not express — a freshly started padi served ONE information-free frame,
 *     the watcher read "not in the keys" as `gone`, and every member of every
 *     work was recorded as having left on each redeploy (#2376).
 *   - **ready** — padi has finished adopting. NOW the three things a reading is
 *     folded from exist: the roster (what the host has), padi's urgency fold
 *     (what its agents are doing) and the member records. They live on THIS ARM
 *     ONLY, so {@link readingsOf} can reach them — and therefore say `gone` —
 *     nowhere else.
 *
 *  Complete by construction, as the old shape was: a leg says nothing until
 *  padi's urgency fold, the roster and its standing have all landed, because
 *  "in none of the four lists" means nothing before the first fold. The wiring
 *  withholds, this module interprets. */
export type HostView = HostUnreachable | HostSettling | HostReady;

/** What every arm carries: WHICH host, and WHICH of its terminals this watch is
 *  about. True of a host that is not answering as much as of one that is. */
interface HostLeg {
  /** The encoded fleet host key the leg was opened over. */
  readonly host: string;
  /** What a person calls that host. */
  readonly hostName: string;
  /** The ids of the member terminals ON THIS HOST, as the leg was opened for
   *  them — the works' membership, split by the watcher that already holds both
   *  halves of every ref. */
  readonly watched: readonly string[];
}

export interface HostUnreachable extends HostLeg {
  readonly kind: "unreachable";
}

export interface HostSettling extends HostLeg {
  readonly kind: "settling";
}

export interface HostReady extends HostLeg {
  readonly kind: "ready";
  /** Which terminals that host still has — what makes `gone` decidable, and
   *  why it is on this arm and no other. */
  readonly roster: ReadonlySet<string>;
  /** padi's own fold over its terminals — who is awaiting a person, who just
   *  finished, who is working. Read rather than re-derived: it is computed once
   *  on the host (`packages/padi/src/activity/urgency.ts`), so a second
   *  derivation here could disagree with the dock. */
  readonly urgency: PadiUrgency;
  /** The record of each member terminal on this host. One record per id the
   *  leg was opened for: what a terminal is called, the repository it is in and
   *  the PR it carries are all read off it. */
  readonly records: ReadonlyMap<string, PadiTerminal>;
}

/** WHAT A TERMINAL IS CALLED, off its padi record: the name a person gave it,
 *  else the branch it is on, else nothing.
 *
 *  A dormant record has no live arm to ask, and "nothing known" is reported as
 *  EMPTY rather than invented: the member keeps whatever it already
 *  remembered. */
export const recordName = (record: PadiTerminal | undefined): string => {
  const live = record?.state === "active" ? record : undefined;
  const branch = live?.git.kind === "repo" ? live.git.info.branch : "";
  return live?.intent ?? branch;
};

/** WHERE THE TERMINAL IS WORKING, off the git fact padi already resolved for
 *  it — the worktree a work's `.waterfall/` files are listed from, the branch
 *  and the repository root.
 *
 *  `null` for every case that is not a resolved repository (`unresolved`,
 *  `none`, a dormant record): "nobody has looked" and "it is in no repo" are
 *  both answered by saying nothing, because what reads this only ever acts on
 *  a path it has.  */
const gitOf = (record: PadiTerminal | undefined): WatchGit | null => {
  const live = record?.state === "active" ? record : undefined;
  if (live?.git.kind !== "repo") return null;
  const info = live.git.info;
  return {
    worktree: info.worktreePath,
    branch: info.branch,
    repo: info.repoRoot,
  };
};

/** A pull request as the forge resolved it — the `ok` arm's value. */
type PrValue = Extract<PrResult, { readonly kind: "ok" }>["value"];

/** WHETHER THE FORGE WOULD MERGE IT — GitHub's merge state, in the record's
 *  words. This is the fact that decides "green"; the checks' rollup only says
 *  what the checks that have REPORTED say, and a required check that has not
 *  started is not among them.
 *
 *  - `CLEAN`, `HAS_HOOKS` and `UNSTABLE` can merge;
 *  - `BLOCKED` cannot: on a review when one is required or changes were
 *    requested, otherwise on whatever else the branch's protection still
 *    wants (a required check that has not passed, a conversation);
 *  - `BEHIND` and `DIRTY` cannot, for those reasons, and neither can `DRAFT`
 *    (GitHub's retired word, not said since 2021: whether a PR is a draft is
 *    `isDraft` now, and {@link prReading} calls this only for one that is not);
 *  - `UNKNOWN` is the forge not having worked it out yet (`unsettled`):
 *    recorded once for a commit it has said nothing about, so a push never
 *    inherits the last commit's answer;
 *  - a reading with no merge state at all (`unreported`) is a padi older than
 *    the field, which never says: nothing is recorded, and the card says
 *    GitHub has not answered. */
export const mergeOf = (value: PrValue): WatchMerge => {
  switch (value.mergeStateStatus) {
    case "CLEAN":
    case "HAS_HOOKS":
    case "UNSTABLE":
      return { kind: "can" };
    case "BLOCKED":
      return {
        kind: "cannot",
        why:
          value.reviewDecision === "REVIEW_REQUIRED" ||
          value.reviewDecision === "CHANGES_REQUESTED"
            ? "review"
            : "blocked",
      };
    case "BEHIND":
      return { kind: "cannot", why: "behind" };
    case "DIRTY":
      return { kind: "cannot", why: "conflicts" };
    case "DRAFT":
      return { kind: "cannot", why: "draft" };
    case "UNKNOWN":
      return { kind: "unsettled" };
    case null:
      return { kind: "unreported" };
    default:
      return value.mergeStateStatus satisfies never;
  }
};

/** THE PULL REQUEST OF A BRANCH, as the work's own watch reads it.
 *
 *  Takes padi's reading — the value its `pullRequest` stream carries for the
 *  work's `(repo, branch)`, which is the same `PrResult` a terminal's record
 *  carries in its `pr` field — and answers what a timeline can learn from it.
 *  Only the RESOLVED arm says anything: `pending`, `absent`, `unsupported` and
 *  `unavailable` are all "kolu does not know", and a work's timeline must not
 *  learn a PR closed because the forge stopped answering. The checks are the
 *  forge's rollup as it is; whether it can merge is {@link mergeOf}. The
 *  failing check NAMES come off the same per-check breakdown the rollup is
 *  folded from, so the `checks-failed` event says which gates are red rather
 *  than that some are — and the head commit comes off the same reading, so a
 *  check says WHICH push it is about.
 *
 *  Pure, and the ONE translation: the watcher subscribes, this says what the
 *  frame means, and `./observing.ts` decides what the work learns from it.
 *  Three answers ({@link PrRead}): nothing known, the PR, or a BROKEN reading
 *  — a resolved PR with no address, which the forge always spells. A broken
 *  reading is said loudly by the one work it was about, and never thrown into
 *  the watch that serves every other work. */
export type PrRead =
  | { readonly kind: "unknown" }
  | { readonly kind: "pr"; readonly pr: WatchPr }
  | { readonly kind: "broken"; readonly why: string };

export const prReading = (pr: PrResult): PrRead => {
  if (pr.kind !== "ok") return { kind: "unknown" };
  const value = pr.value;
  if (value.url === "")
    return {
      kind: "broken",
      why: `the forge's reading of PR #${value.number} carries no address`,
    };
  return {
    kind: "pr",
    pr: {
      number: value.number,
      title: value.title,
      url: value.url,
      state: value.state,
      checks:
        value.checks === null
          ? { kind: "unreported" }
          : { kind: "rollup", rollup: value.checks },
      // A DRAFT HAS NO MERGE ANSWER: GitHub works its merge state out as if
      // it were ready, so a draft with green checks says `CLEAN`.
      readiness: value.isDraft
        ? { kind: "draft" }
        : { kind: "ready", merge: mergeOf(value) },
      failing: value.checkRuns
        .filter((one) => one.outcome === "fail")
        .map((one) => one.name),
      head:
        value.headSha === null
          ? { kind: "unreported" }
          : { kind: "commit", sha: value.headSha },
    },
  };
};

/**
 * ONE HOST'S FRAMES, as the conversation is told about them.
 *
 * A host that is UNREACHABLE or still SETTLING yields nothing at all, and that
 * is the point of the type rather than a rule remembered here: the roster, the
 * urgency fold and the records live on the `ready` arm, so there is nothing to
 * read off the other two — no level can be constructed from them, `gone` least
 * of all. Silence is the one answer that never misleads: the next frame says
 * more.
 *
 * Every watched terminal on a READY host gets at most one reading, in the order
 * the watch list named them. The levels, in the order they are decided:
 *
 *  - **gone** — off the host's roster, where the roster is a CENSUS: padi has
 *    finished adopting its terminals and said so. "Not listed yet" is a
 *    settling host, and never reaches this fold.
 *  - **asleep** — on the roster with its PTY and its agent released. padi
 *    keeps a slept (or boot-parked) terminal listed, so it reads as a terminal
 *    with no agent in it; its agent is dead and whatever it was doing stopped
 *    there. News exactly once, and the entry stays listed because waking the
 *    terminal puts it back on the ordinary levels.
 *  - **asking** / **stopped** / **working** — padi's own partition of the
 *    frame, read through `@kolu/padi-client/attention` (the one place that
 *    names what each urgency list MEANS) rather than off the id arrays. padi
 *    splits a waiting agent into "lingering" and "finished" on its own quiet
 *    rule, and only the second half is the end of a turn: treating the first
 *    as a stop would wake the Conductor while the agent is still printing, so
 *    `linger` reads as `working` here. The switch below is exhaustive — a
 *    sixth attention class stops this compiling instead of silently falling
 *    through to `shell`.
 *  - **shell** — in none of the four lists, with a record that says there is no
 *    agent in it. It never rings; what it carries is the name, and the fact
 *    that the prompt is back.
 *  - **starting** / **fresh** — in none of the four lists, with an agent in it
 *    that padi has published as a PRESENCE: the agent program is in the
 *    foreground and its screen is still being drawn, or it has settled and
 *    nothing has ever been said to it. Read off the record's agent state
 *    through `agentBucket` — the one fold that says what an agent state MEANS
 *    — rather than by matching the two literals here, so a presence state
 *    added to the schema arrives through its own fence. An agent in any OTHER
 *    state that padi lists nowhere still yields nothing: about that one there
 *    is honestly nothing to say.
 */
export const readingsOf = (view: HostView): ReadonlyArray<WatchObservation> => {
  // THE ONE GATE, and it is the type's: a host whose roster is not a census
  // has no roster, no fold and no records to read, so nothing is said about
  // its terminals. Not a guard that could be forgotten at a second call site —
  // the fields simply are not there to reach.
  if (view.kind !== "ready") return [];
  const { host, hostName, urgency, roster, records } = view;
  // padi's urgency cell, as the CLASSES `@kolu/padi-client/attention` names —
  // the one translation from `awaitingIds`/`finishedIds`/… to what those lists
  // mean. `liveIds` is kaval's byte-motion feed, which a watcher leg does not
  // take and no level below asks about.
  const frame = { byClass: frameByClass(urgency), liveIds: [] };
  const seen: Array<WatchObservation> = [];
  for (const id of view.watched) {
    const record = records.get(id);
    const live = record?.state === "active" ? record : undefined;
    const base = {
      ref: fleetTerminalRef(host, id),
      host,
      terminalId: id,
      hostName,
      // The name a person gave it, else the branch it is on. Nothing is
      // invented: a terminal with neither keeps whatever the member already
      // remembered ({@link MemberWatch.name}).
      name: recordName(record),
      agent: live?.agent?.kind ?? null,
      // WHERE IT IS WORKING, off the record this leg has already read, because
      // the watcher is the one reader of every host: a work whose members are
      // on a machine nobody has a browser on still gets its files listed. The
      // PULL REQUEST is not here — it belongs to the work's branch, and the
      // same watcher reads it once for the work ({@link prReading}).
      git: gitOf(record),
      // PADI'S OWN ANSWER about what is in front of the prompt — `shell: true`
      // is an idle prompt with nothing running on it. `null` for a reading with
      // no live arm to ask (a sleeping terminal has released its PTY) or a
      // record padi has not sampled a foreground for yet.
      foregroundShell: live?.foreground?.shell ?? null,
    };
    if (!roster.has(id)) {
      seen.push({ ...base, level: "gone" });
      continue;
    }
    if (record !== undefined && record.state !== "active") {
      seen.push({ ...base, level: "asleep" });
      continue;
    }
    const klass = frameClassOf(frame, id as PadiTerminalId);
    switch (klass) {
      case "asking":
        seen.push({ ...base, level: "asking" });
        continue;
      case "finished":
        seen.push({ ...base, level: "stopped" });
        continue;
      // padi's own split of a waiting agent: only `finished` is the end of a
      // turn, so a lingering one is still work in progress here.
      case "linger":
      case "working":
        seen.push({ ...base, level: "working" });
        continue;
      case "idle":
        // Mentioned by no list — decided against the record just below.
        break;
      default: {
        // A sixth attention class reaches this file as a compile error rather
        // than as a terminal that silently reads `shell`.
        const unknownClass: never = klass;
        throw new Error(`unhandled attention class: ${String(unknownClass)}`);
      }
    }
    // In none of the four lists. Three cases, and the record tells them apart:
    // no agent in it (a shell, which never rings), an agent padi has published
    // as a PRESENCE — up but with no transcript yet — or an agent in some
    // other state no list holds, about which there is nothing to say.
    if (record === undefined) continue;
    const agent = live?.agent ?? null;
    if (agent === null) {
      seen.push({ ...base, level: "shell" });
      continue;
    }
    // The fold, not a pair of literals read by hand: `agentBucket` is where a
    // state becomes a word, and its exhaustiveness fence is what keeps a third
    // presence state from quietly reading as nothing here.
    const bucket = agentBucket(agent.state);
    if (bucket === "starting" || bucket === "fresh") {
      seen.push({ ...base, level: bucket });
    }
  }
  return seen;
};
