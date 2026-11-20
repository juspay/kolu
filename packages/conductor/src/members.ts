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
 *  terminal that is WRITTEN DOWN. */
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

/** THE LAST READING of a member terminal — runtime only. */
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
 *  written half and a runtime half held apart. */
export interface MemberState extends MemberWatch {
  /** The last reading of this terminal in THIS process, or `null` before the
   *  first one. */
  readonly last: LastReading | null;
  /** Whether the next reading BASELINES rather than ringing — true only for a
   *  terminal somebody has just asked to adopt, and never for one a restart
   *  restored (whose `told` already says what it was told). */
  readonly baselining: boolean;
}

const WATCH_FIELDS = Object.keys(MemberWatchSchema.fields) as ReadonlyArray<
  keyof MemberWatch
>;

/** A MEMBER'S SAVED HALF — the watch's own six fields, and nothing else. */
export const saved = (member: MemberState): MemberWatch => {
  const watch: Record<string, unknown> = {};
  for (const key of WATCH_FIELDS) watch[key] = member[key];
  return watch as MemberWatch;
};

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
 *  runtime fields at their empty value. */
export const restoredMember = (watch: MemberWatch): MemberState => ({
  ...watch,
  last: null,
  baselining: false,
});

/** What one reading did to one member. `ring` is the wake level this is worth
 *  waking the Conductor about, or `null`; `drop` is a terminal that is not
 *  there any more and has nothing left to watch. */
export interface Watched<M extends MemberState> {
  readonly member: M;
  readonly ring: ConductorWakeLevel | null;
  readonly drop: boolean;
}

const briefNeverStarted = (watch: MemberWatch, last: LastReading): boolean =>
  watch.joined === "created-run" && watch.ran && last.foregroundShell === true;

const standsAs = (
  watch: MemberWatch,
  last: LastReading | null,
): ConductorWakeLevel | null => {
  if (last === null) return null;
  switch (last.level) {
    case "working":
      return null;
    case "starting":
      return null;
    case "fresh":
      return watch.spoken ? "stopped" : "ready";
    case "shell":
      if (watch.agent !== null)
        return last.foregroundShell === true ? "exited" : null;
      return briefNeverStarted(watch, last) ? "ended" : null;
    case "asleep":
      return watch.agent === null ? null : "asleep";
    case "gone":
      return watch.agent === null ? null : "gone";
    case "stopped":
      return watch.spoken || watch.agent === null ? "stopped" : "ready";
    case "asking":
      return "asking";
  }
};

/** One reading of one member terminal: what the member becomes, and whether it
 *  is worth waking the Conductor about. */
export const observed = <M extends MemberState>(
  member: M,
  seen: WatchObservation,
): Watched<M> => {
  const named = seen.name === "" ? member.name : seen.name;

  const agent = seen.agent ?? member.agent;
  const moved: MemberWatch = {
    ...saved(member),
    name: named,
    agent,
    ran: member.ran || seen.foregroundShell === false,
  };

  const last: LastReading = {
    level: seen.level,
    foregroundShell: seen.foregroundShell,
    since:
      member.last?.level === seen.level
        ? member.last.since
        : new Date().toISOString(),
  };

  const drop = seen.level === "gone";
  if (member.baselining) {
    const based: MemberWatch = { ...moved, spoken: agent !== null };
    return {
      member: {
        ...member,
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
    return {
      member: { ...member, ...moved, told: null, last, baselining: false },
      ring: null,
      drop: false,
    };
  }
  const stands = standsAs(moved, last);

  return {
    member: { ...member, ...moved, last, baselining: false },
    ring: stands === null || stands === member.told ? null : stands,
    drop,
  };
};

/** THE CONDUCTOR JUST SPOKE TO THE AGENT IN THIS TERMINAL. */
export const spokenTo = <M extends MemberState>(member: M): M => {
  const spoken: MemberWatch = { ...saved(member), spoken: true };
  return {
    ...member,
    ...spoken,
    told: standsAs(spoken, member.last) ?? spoken.told,
    last: member.last,
    baselining: false,
  };
};
