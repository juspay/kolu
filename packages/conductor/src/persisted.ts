/**
 * WHAT SURVIVES A kolu-server RESTART about the one conversation.
 *
 * kolu-server is restarted on every upgrade, so a restart is the NORMAL path
 * rather than a crash recovery: a person who was mid-conversation when a new
 * kolu landed should come back to the same conversation, not to an empty panel
 * with a sentence about why. That makes resume the default and this record the
 * thing that makes it possible.
 *
 * WHAT IS HERE, and why each of the four:
 *
 *  - `sessionId` — the agent's own id for the conversation, replayed with
 *    `session/load`. It means nothing to any other agent, so a stored id is
 *    only ever handed back to the agent that minted it.
 *  - `cwd` — the directory the session was opened in. It is what makes a stored
 *    session findable at all (Claude scopes its store by prefix), so a
 *    kolu-server whose `$HOME` moved must open a fresh session rather than ask
 *    for one the agent will refuse.
 *  - `model` — the model a person CHOSE. The agent re-asserts its own default
 *    over a resumed conversation's model (`ANTHROPIC_MODEL`, then
 *    `settings.json`, then what the conversation was running), so a choice made
 *    here is the half that loses unless it is re-applied. Only a switch kolu
 *    SAW is remembered: a conversation that never left the machine's default
 *    comes back on the machine's default, because pinning a conversation to
 *    whatever the default resolved to that day would be inventing a choice
 *    nobody made.
 *  - `rows` — the transcript. The agent replays its own messages on
 *    `session/load`, but it replays the CONVERSATION, not kolu's reading of it:
 *    the kolu-aware tool cards, the background-task lanes, the notices this
 *    panel wrote about itself. Those are ours and they are only here.
 *  - `fleet` — which terminals this conversation has touched, as FLEET REFS
 *    (`host/id`). Membership only; every live fact about those terminals is
 *    read from that host's `terminals` collection, so a stale row cannot
 *    outlive the terminal it names.
 *
 * WHAT IS DELIBERATELY NOT HERE: the phase, the usage, the roster, the open
 * asks, the sign-in attempt. Every one of them is a fact about a subprocess
 * that no longer exists, and a restored one would be a lie with a timestamp on
 * it. They come back from the live agent or they do not come back.
 */

import {
  type ConductorRow,
  ConductorRowSchema,
  type ConductorState,
  ConductorWakeLevelSchema,
} from "kolu-common/conductor";
import type { CellStore } from "@kolu/surface/server";
import { Result, Schema } from "effect";
import { FLEET_WATCH_JOINS } from "kolu-mcp/fleetWatchJoin";

/** The record's SHAPE, as a schema rather than as an interface alone.
 *
 *  `confStore` hands back whatever is on disk under a cast — it decodes
 *  nothing — so without this the conductor would restore a hand-edited (or
 *  half-written) `conductor` key straight into a served cell and a replayed
 *  transcript, and the first thing to notice would be a row the panel cannot
 *  draw. Re-validated where it is READ ({@link readPersistedConductor}),
 *  exactly as `getPersistedHosts` re-validates the server's `hosts` key: a
 *  parseable-but-invalid value is REFUSED loud, never normalized away and
 *  never collapsed to an empty conversation.
 *
 *  `rows` is the WIRE row on the `koluSurface` ladder, read back off a file on
 *  the kolu-server `SCHEMA_VERSION` one — so the first NON-ADDITIVE change to
 *  `ConductorRowSchema` owes that ladder a rung DROPPING
 *  `conductor.rows` ({@link ROW_CAP} bounds what is lost); nothing else can
 *  repair a file this schema no longer decodes. */
export const PersistedConductorSchema = Schema.Struct({
  sessionId: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  model: Schema.NullOr(Schema.String),
  rows: Schema.Array(ConductorRowSchema),
  /** Fleet refs (`<encodedHostKey>/<terminalId>`), not bare ids — one
   *  conversation spans every host, and a bare id would name two terminals on
   *  a two-host fleet. */
  fleet: Schema.Array(Schema.String),
  /** THE TERMINALS KOLU WAKES THIS CONVERSATION ABOUT, in the order they were
   *  added — and per entry the facts a restart cannot re-derive: what kolu
   *  last saw the terminal called, whether an agent was ever seen in it (a
   *  terminal that never held one drops off in silence when it goes), the
   *  level the conversation has already been TOLD about, and the three that
   *  say how to read the next sighting — how it came to be watched, whether
   *  anything has been said to the agent in it, and whether a command was
   *  ever seen running in it — and when it joined, which is where a piece of
   *  work's age is counted from.
   *
   *  `told` is what makes a restart quiet: kolu looks at every watched
   *  terminal again, and one that is still stopped for the reason it was
   *  stopped before the restart does not ring a second time. What is NOT here
   *  is the held news — a restart re-reads the world instead of replaying a
   *  queue about one that has moved on.
   *
   *  NO DECODING DEFAULTS, here or on any entry's key: the schema says what
   *  the file holds, and making an older file hold it is the ladder's job
   *  (`kolu-server`'s `state.ts`, the 1.49.0 rung — it seeds the key and
   *  fills an entry's missing `joined`/`spoken`/`ran`/`root`/`since`). A file
   *  the ladder did not bring here is refused by name, never read as a
   *  guess. */
  watched: Schema.Array(
    Schema.Struct({
      ref: Schema.String,
      name: Schema.String,
      agent: Schema.NullOr(Schema.String),
      told: Schema.NullOr(ConductorWakeLevelSchema),
      /** How it came to be watched — built from the one tuple the word is
       *  spelled in (`kolu-mcp/fleetWatchJoin`), which the fleet face's wire
       *  schema and this module's `WatchJoin` also build from: a join a tool
       *  can record is a join this file can read back. What `ended` turns on:
       *  only a terminal kolu opened WITH a command can be said to have
       *  finished one. */
      joined: Schema.Literals([...FLEET_WATCH_JOINS]),
      /** Whether the Conductor has said anything to the agent in it. What
       *  `ready` turns on, and therefore worth surviving a restart: an agent
       *  briefed before the restart must not ring as a fresh one after it. */
      spoken: Schema.Boolean,
      /** Whether a non-shell foreground was ever seen in it — the other half
       *  of `ended`, and across a restart the only way to know that the
       *  command kolu typed ever started. */
      ran: Schema.Boolean,
      /** WHEN IT JOINED THE WATCH LIST, as an ISO time
       *  (`kolu-conductor`'s `WatchEntry.since`). Saved because a piece of
       *  work's age is counted from it: a restart that re-stamped every entry
       *  with boot time would tell a person their hour-old waterfall had just
       *  started. */
      since: Schema.String,
      /** THE PIECE OF WORK it belongs to — the top-level terminal its
       *  `child-of` edges end at, by fleet ref, and what that terminal was
       *  last called (`kolu-conductor`'s `WatchRoot`); `null` for an entry
       *  nothing has read the host of yet.
       *
       *  Saved because the alternative is the watching panel coming apart on
       *  every restart: the edges live on the HOSTS, a host that is away
       *  cannot be asked, and a boot that forgot the grouping would show four
       *  separate pieces of work until every machine answered again. */
      root: Schema.NullOr(
        Schema.Struct({ ref: Schema.String, name: Schema.String }),
      ),
    }),
  ),
});

/** The record as a value. Derived from the schema rather than declared beside
 *  it, so the two cannot drift into disagreeing about what is on disk. */
export type PersistedConductor = typeof PersistedConductorSchema.Type;

/** An untouched state dir's record: no conversation, nothing to resume. */
export const EMPTY_PERSISTED_CONDUCTOR: PersistedConductor = {
  sessionId: null,
  cwd: "",
  model: null,
  rows: [],
  fleet: [],
  watched: [],
};

/** The re-validation, compiled once. `decodeUnknownResult` is a BRANCH rather
 *  than a throw, which is what lets the failure arm name the FILE — the one
 *  thing a person holding a corrupt state file has to act on. */
const decodePersisted = Schema.decodeUnknownResult(PersistedConductorSchema);

/** Read the remembered conversation out of kolu-server's state, or CRASH naming
 *  the file.
 *
 *  There is no recovery arm on purpose. The two silent alternatives are both
 *  worse than a loud stop: dropping the offending rows would hand a person a
 *  transcript with holes in it and no way to know, and starting empty would
 *  throw away a conversation that is still on disk and still readable by hand.
 *  `conf` itself is fail-fast about an UNPARSEABLE file; this is the
 *  parseable-but-wrong case it cannot see. */
export function readPersistedConductor(
  store: CellStore<PersistedConductor>,
  path: string,
): PersistedConductor {
  const result = decodePersisted(store.get());
  if (Result.isFailure(result)) {
    throw new Error(
      `the remembered conductor in ${path} does not match schema (${String(result.failure)}). Fix the \`conductor\` key to recover.`,
    );
  }
  const record = result.success;
  return { ...record, rows: oneDividerPerReset(record.rows) };
}

/** Collapse every RUN of consecutive dividers to the first of them.
 *
 *  A divider means one thing — the agent's memory was reset — so a run of
 *  four in a row cannot be four resets with nothing between them: it is one
 *  reset written four times, by however many bring-ups wrote it. The first is
 *  the one kept, because the reset happened at the first; keeping the last
 *  would draw the line later than the event it marks.
 *
 *  On the READ rather than only at the writer, and deliberately: the records
 *  already on disk carry the runs, and a fix that only stopped new ones from
 *  being written would leave every state file that saw the bug showing them
 *  forever. `rows` arrives in `seq` order ({@link persistedFrom} writes the
 *  host's sorted array), so "consecutive" is a neighbour test and not a sort. */
function oneDividerPerReset(
  rows: ReadonlyArray<ConductorRow>,
): ReadonlyArray<ConductorRow> {
  const kept: ConductorRow[] = [];
  let previousWasDivider = false;
  for (const row of rows) {
    const divider = row.kind === "divider";
    if (!(divider && previousWasDivider)) kept.push(row);
    previousWasDivider = divider;
  }
  return kept.length === rows.length ? rows : kept;
}

/** What to write back after the conversation moved.
 *
 *  Derived from the live state and rows rather than accumulated beside them,
 *  so the record cannot disagree with what a reader is looking at. The row
 *  cap is a bound on the FILE, not on the panel: a conversation that has run
 *  for a week is still whole in memory, and what a restart brings back is its
 *  tail — which is the half a person scrolls to anyway.
 *
 *  THE ROWS GO THROUGH UNTOUCHED, attachments included, because an attachment
 *  carries no bytes to strip: it is a name, a size and the path kolu-server
 *  wrote the file to. A row restored from here is therefore the same value it
 *  was when it was minted — which is what makes "send again" on an hour-old
 *  message read the same file the first send did. The thumbnail is the only
 *  thing that does not survive, and it never left the browser that drew it. */
export function persistedFrom(
  state: ConductorState,
  rows: ReadonlyArray<ConductorRow>,
  /** The watch list as ENTRIES — the cell publishes membership as `work`
   *  (the refs, grouped) and nothing else about an entry, and what a restart
   *  needs is the facts beside each one (see the schema). Passed in rather
   *  than read off the state for exactly that reason: the state is what a
   *  browser is told, and this is what the next boot resumes from.
   *
   *  COPIED FIELD BY FIELD below, because the live entry carries two runtime
   *  fields the record must not learn (`kolu-conductor`'s `WatchEntry`: the
   *  last reading, and whether the next one baselines). A spread would write
   *  them to disk and a later boot would read back a reading of a world that
   *  has moved on. */
  watched: ReadonlyArray<PersistedConductor["watched"][number]>,
): PersistedConductor {
  return {
    sessionId: state.sessionId,
    cwd: state.cwd,
    model: state.model?.id ?? null,
    rows: rows.length > ROW_CAP ? rows.slice(rows.length - ROW_CAP) : rows,
    fleet: state.fleet,
    watched: watched.map((one) => ({
      ref: one.ref,
      name: one.name,
      agent: one.agent,
      told: one.told,
      joined: one.joined,
      spoken: one.spoken,
      ran: one.ran,
      since: one.since,
      root: one.root,
    })),
  };
}

/** Re-point every remembered attachment at the directory the bytes are in NOW.
 *
 *  An attachment's `path` is ABSOLUTE — the agent is handed it and the harness
 *  reads the file off it — so the one thing that can invalidate a whole
 *  transcript's worth of them is the directory moving underneath. It moves
 *  exactly once: kolu-server's 1.45.0 ladder rung renames the conversation's
 *  corner of the state root when the conversation itself is renamed, and a
 *  record carried across without this would draw chips for files at an address
 *  nothing writes to any more.
 *
 *  Pure, and a prefix swap rather than a re-join: a path that does NOT start
 *  at the old corner was not written by this server's attachment writer, and
 *  rebuilding it would be inventing a location for somebody else's file. */
export function repointConductorAttachments(
  record: PersistedConductor,
  from: string,
  to: string,
): PersistedConductor {
  return {
    ...record,
    rows: record.rows.map((row) =>
      row.kind === "user"
        ? {
            ...row,
            attachments: row.attachments.map((one) =>
              one.path.startsWith(from)
                ? { ...one, path: `${to}${one.path.slice(from.length)}` }
                : one,
            ),
          }
        : row,
    ),
  };
}

/** How many transcript rows the state file keeps.
 *
 *  Chosen for the file rather than for the screen: kolu-server's `config.json`
 *  holds the host map and the preferences beside this, and a conversation that
 *  has made two thousand tool calls would otherwise make every read of that
 *  file pay for scrollback nobody asked for. */
const ROW_CAP = 400;
