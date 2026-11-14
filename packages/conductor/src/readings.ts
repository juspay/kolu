/**
 * WHAT A HOST'S FRAMES MEAN for the terminals a conversation is watching — the
 * pure half of the watch.
 *
 * kolu-server holds the standing subscriptions (`conductor/watcher.ts`: one leg
 * per connected host that holds a watched terminal, re-opened as the host map
 * moves). What a leg's last frames SAY is this module's, and it is a function:
 * padi's urgency fold, the host's roster and the records that were read go in,
 * one {@link WatchObservation} per watched terminal comes out. Nothing here
 * subscribes to anything, so every rule below is exercised by calling it rather
 * than by driving a stream — which is the whole reason it is not over there.
 *
 * It REPORTS and never concludes. Two of the wake levels are conclusions drawn
 * one file over, from a sequence of these readings rather than from one of them
 * (`./watching.ts`: `ready` is a stop in a terminal nobody has spoken to yet,
 * `ended` is a command that ran and gave the prompt back). The split is the
 * same one `foregroundShell` is reported for: a single frame cannot know it.
 *
 * A terminal is left OUT of the answer when nothing honest can be said about it
 * — its agent is in none of padi's four lists and its record has not arrived to
 * say whether there is an agent in it at all. Silence is the one answer that
 * never misleads: the next frame says more.
 */

import { frameByClass, frameClassOf } from "@kolu/padi-client/attention";
import type { PadiTerminal, PadiUrgency } from "@kolu/padi-client/surface";
// The one fold that says what an agent STATE means — the same vocabulary the
// dock and every wait read, so the two presence readings below are padi's word
// for them and not this module's.
import { agentBucket } from "@kolu/terminal-vocab/agentProjection";
import { fleetTerminalRef } from "kolu-mcp/fleetRef";
import type { WatchObservation, WatchRoot } from "./watching.ts";

/** padi's own terminal-id type, read off the urgency cell this module already
 *  takes — the watch list carries plain strings, and the one place they are
 *  handed back to padi's fold is the class read below. Taken from `PadiUrgency`
 *  rather than imported from the vocabulary so this package keeps the two
 *  padi-client leaves it declares and no third edge. */
type PadiTerminalId = PadiUrgency["awaitingIds"][number];

/** ONE HOST'S LAST WORD, as the watcher's leg accumulated it.
 *
 *  Complete by construction: a leg says nothing until padi's urgency fold AND
 *  the host's roster have both landed, because `gone` is only decidable against
 *  a roster that was actually read and "in none of the four lists" means
 *  nothing before the first fold. So there are no nullable frames here to guard
 *  against — the wiring withholds, this module interprets. */
export interface HostReading {
  /** The encoded fleet host key the leg was opened over. */
  readonly host: string;
  /** What a person calls that host. */
  readonly hostName: string;
  /** The ids being watched ON THIS HOST, as the leg was opened for them. The
   *  list is the conversation's, split by the watcher that already holds both
   *  halves of every ref. */
  readonly watched: readonly string[];
  /** padi's own fold over its terminals — who is awaiting a person, who just
   *  finished, who is working. Read rather than re-derived: it is computed once
   *  on the host (`packages/padi/src/activity/urgency.ts`), so a second
   *  derivation here could disagree with the dock. */
  readonly urgency: PadiUrgency;
  /** Which terminals that host still has — what makes `gone` decidable. */
  readonly keys: ReadonlySet<string>;
  /** The record of each watched id, and of every ANCESTOR their `child-of`
   *  edges lead to. The ancestors are nobody's watch list: what they carry is
   *  WHICH PIECE OF WORK a watched terminal is part of, and what to call it. */
  readonly records: ReadonlyMap<string, PadiTerminal>;
}

/** WHAT A TERMINAL IS CALLED, off its padi record: the name a person gave it,
 *  else the branch it is on, else nothing.
 *
 *  One rule, two callers — the watched terminal's own reading and the heading
 *  of the piece of work it belongs to ({@link walkRoot}) — because a group
 *  whose header named a terminal differently from the row under it would be
 *  two spellings of one fact. A dormant record has no live arm to ask, and
 *  "nothing known" is reported as EMPTY rather than invented: the conversation
 *  keeps whatever its entry already remembered. */
export const recordName = (record: PadiTerminal | undefined): string => {
  const live = record?.state === "active" ? record : undefined;
  const branch = live?.git.kind === "repo" ? live.git.info.branch : "";
  return live?.intent ?? branch;
};

/**
 * WHICH PIECE OF WORK A TERMINAL IS IN — its `child-of` edges followed to the
 * top-level terminal they end at.
 *
 * Over the records the leg has already read, so it is the same walk whether it
 * runs on a frame or in a test. A terminal with no parent is its own root; a
 * chain that runs into a record nobody has read yet stops THERE and names it,
 * which is the furthest honest answer — a split whose parent is known but whose
 * grandparent is not is still not a piece of work of its own. The record that
 * is missing is already being subscribed (the watcher reads a watched
 * terminal's whole lineage), so the next frame walks further.
 *
 * The cycle guard is a belt: padi refuses a parent edge that would close a loop
 * when it is written (`packages/padi/src/terminals.ts`), so this can only fire
 * on a record that got onto a disk some other way — and a walk that span
 * forever on one would take the Conductor's whole watch with it.
 */
export const walkRoot = (
  host: string,
  id: string,
  records: ReadonlyMap<string, PadiTerminal>,
): WatchRoot => {
  let at = id;
  const seen = new Set<string>([id]);
  for (;;) {
    const record = records.get(at);
    if (record === undefined)
      return { ref: fleetTerminalRef(host, at), name: "" };
    const parent = record.parentId;
    if (parent === undefined || seen.has(parent))
      return { ref: fleetTerminalRef(host, at), name: recordName(record) };
    seen.add(parent);
    at = parent;
  }
};

/**
 * ONE HOST'S FRAMES, as the conversation is told about them.
 *
 * Every watched terminal on the host gets at most one reading, in the order the
 * watch list named them. The levels, in the order they are decided:
 *
 *  - **gone** — off the host's roster. Decidable only because the roster was
 *    read; a host that is not answering never reaches this module at all.
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
export const readingsOf = (
  reading: HostReading,
): ReadonlyArray<WatchObservation> => {
  const { host, hostName, urgency, keys, records } = reading;
  // padi's urgency cell, as the CLASSES `@kolu/padi-client/attention` names —
  // the one translation from `awaitingIds`/`finishedIds`/… to what those lists
  // mean. `liveIds` is kaval's byte-motion feed, which a watcher leg does not
  // take and no level below asks about.
  const frame = { byClass: frameByClass(urgency), liveIds: [] };
  const seen: Array<WatchObservation> = [];
  for (const id of reading.watched) {
    const record = records.get(id);
    const live = record?.state === "active" ? record : undefined;
    const base = {
      ref: fleetTerminalRef(host, id),
      host,
      terminalId: id,
      hostName,
      // The name a person gave it, else the branch it is on. Nothing is
      // invented: a terminal with neither keeps whatever the entry already
      // remembered ({@link WatchEntry.name}).
      name: recordName(record),
      agent: live?.agent?.kind ?? null,
      // THE PIECE OF WORK IT IS PART OF, walked on the host's own records
      // because that is the one place every watched terminal's chain can be
      // read — a browser has the parent edges only of the host it has open, and
      // the Conductor watches terminals on machines nobody is looking at.
      root: walkRoot(host, id, records),
      // PADI'S OWN ANSWER about what is in front of the prompt — `shell: true`
      // is an idle prompt with nothing running on it. `null` for a reading with
      // no live arm to ask (a sleeping terminal has released its PTY) or a
      // record padi has not sampled a foreground for yet.
      foregroundShell: live?.foreground?.shell ?? null,
    };
    if (!keys.has(id)) {
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
