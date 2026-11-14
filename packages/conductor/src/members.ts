/**
 * A WORK'S MEMBER TERMINALS, and the one decision made about every reading of
 * one: does this wake the Conductor, or not?
 *
 * A PURE module, deliberately. Whether a terminal that just stopped is news
 * depends on exactly six things — what it is doing now, whether an agent was
 * ever seen in it, whether the Conductor has ever spoken to that agent, how
 * the terminal came to be a member, what the conversation has already been
 * told, and whether it is still there at all — and none of them is a socket.
 * The watch upstream turns padi's streams into {@link WatchObservation}s —
 * kolu-server holds the subscriptions (`conductor/watcher.ts`) and
 * `./readings.ts` says what their frames mean; the host downstream
 * (`./conductor.ts`) decides where a ring goes and what it APPENDS to the
 * work. What is WORTH ringing about is here, where it can be tested by calling
 * a function.
 *
 * ## The rules, and the reason for each
 *
 * - **WORKING resets what we were told.** An agent that went back to work will
 *   stop again, and that stop is news. Without the reset a conversation told
 *   once would never hear about the same terminal twice.
 * - **AN AGENT COMING UP IS NOT NEWS; one that is UP is `ready`.** padi
 *   publishes an agent as PRESENT the moment its program takes the foreground:
 *   `starting` while its screen is still being drawn, `fresh` once that screen
 *   has settled with nothing submitted since, and `prompted` (read here as
 *   `working`) once something is. A `starting` reading moves the member and
 *   rings nothing — there is nothing to say to an agent that is still drawing
 *   itself. A `fresh` one rings `ready` DIRECTLY — padi said so, this module
 *   did not deduce it — unless this conversation has spoken to it: then a
 *   `fresh` is a submit that came to nothing, and rings `stopped`.
 * - **AN IDLE AGENT NOBODY HAS SPOKEN TO IS `ready` TOO — by INFERENCE.** That
 *   is the OTHER road to the same word, and it is for one case only: an agent
 *   that was already running when it was adopted into a work (a resumed
 *   session, a terminal a human pointed at), whose first sight is a `stopped`
 *   and never a `fresh`. Without it the Conductor is told its planner STOPPED
 *   before it was ever briefed. An agent kolu watched come up has already been
 *   told `ready` off its `fresh` reading, so the `stopped` that follows when
 *   its transcript lands equals what we were told and is silent.
 * - **A SHELL never rings — except the two kinds that are an ending.** A
 *   terminal with no agent is a prompt somebody left open; it stops being busy
 *   a hundred times an hour and none of them is anything the Conductor can act
 *   on. But a terminal the Conductor created WITH a command, whose command ran
 *   (a non-shell foreground was seen) and which is back at its prompt with no
 *   agent ever detected, is a brief that never started: it rings `ended`. And
 *   a terminal an agent WAS seen in, now back at its own shell prompt, is that
 *   agent having left the foreground — crashed, quit, out of something: it
 *   rings `exited`. That one exists because EVERY WAIT MUST HAVE A WAY OUT
 *   THAT RINGS.
 * - **A TERMINAL PUT TO SLEEP rings once, and STAYS a member.** Its agent is
 *   released with it, which is the end of that agent's work; waking the
 *   terminal puts it back on the ordinary levels, so there is nothing to drop.
 * - **GONE rings only if an agent was ever seen.** Either way the member
 *   LEAVES the work: there is nothing left to watch.
 * - **A level equal to what we were told does not ring again.** This is what
 *   makes a restart safe: kolu looks at every member terminal again, and one
 *   that is still stopped for the same reason it was stopped before the
 *   restart is not news a second time.
 * - **A STATE THE CONDUCTOR ITSELF PUT A TERMINAL IN IS NOT NEWS.** Two ways
 *   in: {@link spokenTo} re-baselines `told` the moment an `agent_say` lands,
 *   and a terminal ADOPTED into a work (`work_adopt`, join `asked`) baselines
 *   on its first reading. Both exist because `agent_say` returns as soon as the
 *   keys are pressed and `work_adopt` names an agent that is already idle:
 *   without them the Conductor is woken about the agent it has just briefed.
 *
 * `told` is set when a wake is DELIVERED (its turn started), never when it is
 * decided — a ring that waited through a turn and then failed to go must still
 * be owed.
 *
 * WHAT IS NOT HERE ANY MORE: the grouping. A piece of work used to be guessed
 * from which watched terminals shared a parent; now membership is STATED
 * (`kolu-work`'s `joinWork`), the work is a record, and this module answers
 * only about the terminal in front of it.
 */

import { Schema } from "effect";
import {
  ConductorWakeLevelSchema,
  type ConductorWakeLevel,
} from "kolu-common/conductor";
import { FLEET_WATCH_JOINS } from "kolu-mcp/fleetWatchJoin";
import type { WatchLevel, WatchObservation } from "./observation.ts";

/** HOW A TERMINAL CAME TO BE A MEMBER, which is what the `ready` and `ended`
 *  rules read — the type of the one tuple the word is spelled in
 *  (`kolu-mcp/fleetWatchJoin`, a zero-import leaf), which the fleet face's wire
 *  schema and the stored member both build from. The joins and what each one
 *  means are documented there; what matters HERE is that a fourth one cannot
 *  appear in a tool's answer without appearing in these rules. */
export type WatchJoin = (typeof FLEET_WATCH_JOINS)[number];

/** ONE MEMBER'S WAKE BOOKKEEPING — the half of what kolu knows about a member
 *  terminal that is WRITTEN DOWN.
 *
 *  Declared HERE, in the module that mints every one of them, rather than in
 *  the persistence module that reads them into a file schema: the generative
 *  side owns a type, and `./persisted.ts` spreads this into the `members` key
 *  exactly as it spreads the record's own schemas.
 *
 *  Everything here is a fact a restart cannot re-derive: what kolu last saw
 *  the terminal called, whether an agent was ever seen in it (a terminal that
 *  never held one is silent when it goes), the level the conversation has
 *  already been TOLD about, and the three that say how to read the next
 *  sighting — how the terminal came to be a member, whether anything has been
 *  said to the agent in it, and whether a command was ever seen running in it.
 *
 *  `told` is what makes a restart quiet: kolu looks at every member terminal
 *  again, and one that is still stopped for the reason it was stopped before
 *  the restart does not ring a second time. What is NOT here is the held news
 *  — a restart re-reads the world instead of replaying a queue about one that
 *  has moved on — nor the last reading, which is this process's own, nor the
 *  WORKTREE, which is a fact about the member and lives on the record
 *  (`kolu-work`'s `WorkMemberSchema`) because the files outlive the terminal.
 *
 *  NO DECODING DEFAULTS, here or on any key: the schema says what the file
 *  holds, and making an older file hold it is the ladder's job (`kolu-server`'s
 *  `state.ts`). A file the ladder did not bring here is refused by name, never
 *  read as a guess. */
export const MemberWatchSchema = Schema.Struct({
  /** What kolu last saw the terminal called — so a wake can name it even when
   *  the host it is on has stopped answering. */
  name: Schema.String,
  /** The agent kolu detected in it, or `null` for a terminal no agent has ever
   *  been seen in. STICKY: an agent that exited leaves a shell behind, and the
   *  fact that one was once there is what makes its death worth telling. */
  agent: Schema.NullOr(Schema.String),
  /** The level the conversation has already been told about, or `null`. */
  told: Schema.NullOr(ConductorWakeLevelSchema),
  /** How this terminal came to be a member — built from the one tuple the word
   *  is spelled in (`kolu-mcp/fleetWatchJoin`), which the fleet face's wire
   *  schema and this module's {@link WatchJoin} also build from: a join a tool
   *  can record is a join the file can read back. */
  joined: Schema.Literals([...FLEET_WATCH_JOINS]),
  /** Whether the Conductor has said anything to the agent in it. What `ready`
   *  turns on, and therefore worth surviving a restart: an agent briefed before
   *  the restart must not ring as a fresh one after it. */
  spoken: Schema.Boolean,
  /** Whether a non-shell foreground was ever seen in it — the other half of
   *  `ended`, and across a restart the only way to know that the command kolu
   *  typed ever started. */
  ran: Schema.Boolean,
});
export type MemberWatch = typeof MemberWatchSchema.Type;

/** THE LAST READING of a member terminal — runtime only.
 *
 *  Kept because THREE things are decided outside a reading: {@link spokenTo}
 *  re-baselines `told` at the level the terminal stands at, `ended` needs to
 *  know whether the foreground is the shell RIGHT NOW rather than whether it
 *  ever was, and the card says how long this terminal has stood as it stands
 *  ({@link LastReading.since}). Not persisted: a restart re-reads the world,
 *  and a remembered reading would be the one thing in this module that could
 *  be stale.
 *
 *  WHICH IS WHY THE DURATION IS AS OLD AS THE PROCESS at worst. kolu's watch
 *  is what observes a level change at all — no host stamps one — so after a
 *  restart the first reading is the first sight kolu has of the state, and
 *  that sight is what the clock counts from. An invented earlier instant
 *  would be a number nobody saw. */
export interface LastReading {
  readonly level: WatchLevel;
  /** Whether the foreground was the terminal's own shell — padi's answer, or
   *  `null` for a reading that carried none (`./observation.ts`). */
  readonly foregroundShell: boolean | null;
  /** The ISO time this terminal ENTERED {@link LastReading.level} — stamped
   *  by the reading that first saw the level, and CARRIED FORWARD by every
   *  reading that repeats it, so the duration counts the state rather than
   *  the poll. */
  readonly since: string;
}

/** ONE MEMBER, as the host holds it while the process runs — ONE value, not a
 *  written half and a runtime half held apart.
 *
 *  The saved half is taken by SUBTRACTION ({@link saved}), never by listing
 *  the fields that survive: a field added to {@link MemberWatchSchema} and to
 *  this record cannot then be left out of what is written. */
export interface MemberState extends MemberWatch {
  /** The last reading of this terminal in THIS process, or `null` before the
   *  first one. */
  readonly last: LastReading | null;
  /** Whether the next reading BASELINES rather than ringing — true only for a
   *  terminal somebody has just asked to adopt, and never for one a restart
   *  restored (whose `told` already says what it was told). */
  readonly baselining: boolean;
}

/** A MEMBER'S SAVED HALF — everything except the two runtime fields.
 *
 *  By subtraction rather than by listing what is kept: this is the one place
 *  the written half is derived, and a field added to the member arrives in the
 *  file without an edit here. Read at the persist boundary
 *  (`./memberStore.ts`) and wherever a rule builds the next watch out of this
 *  one. */
export const saved = ({
  last: _last,
  baselining: _baselining,
  ...watch
}: MemberState): MemberWatch => watch;

/** A member's written half, as it stands the moment it joins: nothing is known
 *  about its terminal until the watcher reads its host. */
export const joinedWatch = (joined: WatchJoin): MemberWatch => ({
  name: "",
  agent: null,
  told: null,
  joined,
  spoken: false,
  ran: false,
});

/** A member just joined. If it was ADOPTED, the first reading is a baseline
 *  rather than news ({@link observed}). */
export const joinedMember = (joined: WatchJoin): MemberState => ({
  ...joinedWatch(joined),
  last: null,
  baselining: joined === "asked",
});

/** A member as a RESTART restores it: everything the record kept, and the two
 *  runtime fields at their empty value.
 *
 *  `baselining` is FALSE, which is the whole point of this function existing
 *  beside {@link joinedMember}: a restored member's `told` already says what
 *  the conversation has been told, and baselining it again would swallow the
 *  one wake a restart owes — the news that waited through a turn, failed to
 *  go, and was written down as still owed. */
export const restoredMember = (watch: MemberWatch): MemberState => ({
  ...watch,
  last: null,
  baselining: false,
});

/** What one reading did to one member. `ring` is the wake level this is worth
 *  waking the Conductor about, or `null`; `drop` is a terminal that is not
 *  there any more and has nothing left to watch. */
export interface Watched {
  readonly member: MemberState;
  readonly ring: ConductorWakeLevel | null;
  readonly drop: boolean;
}

/**
 * HOW A TERMINAL STANDS, as a wake level — or `null` for a reading that is
 * nothing to tell anybody about.
 *
 * The one place a reading becomes a level, so the rule that `agent_say`
 * re-baselines at ({@link spokenTo}) and the rule a watcher's frame is judged
 * by ({@link observed}) cannot drift apart.
 */
const standsAs = (
  watch: MemberWatch,
  last: LastReading | null,
): ConductorWakeLevel | null => {
  if (last === null) return null;
  switch (last.level) {
    case "working":
      return null;
    case "starting":
      // THE AGENT IS COMING UP. padi can see the program in the foreground
      // before its screen has settled, and "a process appeared" is not news a
      // Conductor can act on. The reading is still taken (it moves the member:
      // the agent sticks, the name refreshes, `ran` records that something
      // non-shell is in front), it just never rings.
      return null;
    case "fresh":
      // UP, SETTLED, NOTHING SUBMITTED SINCE — read directly, not inferred
      // from an idle. Who has spoken to it decides what that MEANS, by the
      // same rule as the `stopped` arm below.
      return watch.spoken ? "stopped" : "ready";
    case "shell":
      // THE PROMPT IS BACK IN FRONT. Which of the two endings this is turns
      // on whether an agent was EVER seen in this terminal.
      if (watch.agent !== null)
        return last.foregroundShell === true ? "exited" : null;
      // NO AGENT, EVER: the brief that never started. Every clause is
      // load-bearing — a command kolu typed (`created-run`), which RAN (a
      // non-shell foreground was seen), which is over (the prompt is back in
      // front).
      return watch.joined === "created-run" &&
        watch.ran &&
        last.foregroundShell === true
        ? "ended"
        : null;
    case "asleep":
      // A terminal nobody ever saw an agent in is a tile somebody put away.
      return watch.agent === null ? null : "asleep";
    case "gone":
      return watch.agent === null ? null : "gone";
    case "stopped":
      // AN AGENT NOBODY HAS SPOKEN TO HAS NOT STOPPED — it has arrived. This
      // is the INFERENCE half of `ready`, and the only case left to it now
      // that `fresh` is read directly.
      return watch.spoken || watch.agent === null ? "stopped" : "ready";
    case "asking":
      // Asking a person is news about any terminal, agent detected or not.
      return "asking";
  }
};

/**
 * One reading of one member terminal: what the member becomes, and whether it
 * is worth waking the Conductor about.
 *
 * The member carries forward what the reading does not say: a name is kept when
 * a reading has none, an agent is kept for good once one has been seen, and
 * `ran` is kept once a command has been seen in front of the shell. Where the
 * terminal is WORKING is not here: the worktree is a fact of the member on the
 * record (`kolu-work`'s `sawWorktree`), written by the observation loop off the
 * same reading, because a work's files have to outlive the terminal that wrote
 * them.
 */
export const observed = (
  member: MemberState,
  seen: WatchObservation,
): Watched => {
  const named = seen.name === "" ? member.name : seen.name;
  // STICKY: `null` from a reading means "no agent in it right now", which for
  // a terminal that had one is the agent having exited — the thing its death
  // is worth reporting for.
  const agent = seen.agent ?? member.agent;
  const moved: MemberWatch = {
    ...saved(member),
    name: named,
    agent,
    ran: member.ran || seen.foregroundShell === false,
  };
  // WHEN THIS LEVEL BEGAN. The clock is read only where the level CHANGES,
  // which is the whole accuracy claim: a reading that says the same thing
  // again carries the stamp of the one that first said it, so "working 4m" is
  // four minutes of working rather than four minutes of polling.
  const last: LastReading = {
    level: seen.level,
    foregroundShell: seen.foregroundShell,
    since:
      member.last?.level === seen.level
        ? member.last.since
        : new Date().toISOString(),
  };
  // A terminal that is gone has nothing left to watch, whatever else this
  // reading says about it.
  const drop = seen.level === "gone";
  if (member.baselining) {
    // THE FIRST READING OF AN ADOPTED TERMINAL is the state it was FOUND in,
    // and the Conductor is told that by the tool's own answer rather than by a
    // wake a second later. An agent already in it counts as spoken to: it is
    // somebody else's conversation, and its next idle is not this
    // conversation's briefing arriving.
    const based: MemberWatch = { ...moved, spoken: agent !== null };
    return {
      member: {
        ...based,
        told: standsAs(based, last),
        last,
        baselining: false,
      },
      ring: null,
      drop,
    };
  }
  if (seen.level === "working") {
    // It will stop again, and that stop is news.
    return {
      member: { ...moved, told: null, last, baselining: false },
      ring: null,
      drop: false,
    };
  }
  const stands = standsAs(moved, last);
  // `told` is left exactly as it was — it is set when a wake is DELIVERED —
  // and a level equal to it is the same news twice.
  return {
    member: { ...moved, last, baselining: false },
    ring: stands === null || stands === member.told ? null : stands,
    drop,
  };
};

/**
 * THE CONDUCTOR JUST SPOKE TO THE AGENT IN THIS TERMINAL.
 *
 * `agent_say` answers as soon as the keys are pressed, so the agent's state
 * has usually not flipped to `working` yet: left alone, the terminal would
 * ring about the idle it was sitting in when it was briefed, the instant the
 * Conductor's turn ends. So the member re-baselines at the level it STANDS at —
 * which, now that something has been said to it, is `stopped` rather than
 * `ready` for a terminal read as idle.
 *
 * A terminal NOBODY HAS READ YET keeps whatever it was told. There is no
 * state to suppress — the baseline is the thing being computed, and there is
 * nothing to compute it from — and clearing it would make a say the one
 * gesture that makes a terminal MORE likely to ring.
 *
 * The held slot is withdrawn by the caller (`./conductor.ts`): what is here is
 * only what the MEMBER becomes. A later `working` resets `told` as it always
 * did, so the next real stop is news again.
 */
export const spokenTo = (member: MemberState): MemberState => {
  const spoken: MemberWatch = { ...saved(member), spoken: true };
  return {
    ...spoken,
    told: standsAs(spoken, member.last) ?? spoken.told,
    last: member.last,
    baselining: false,
  };
};
