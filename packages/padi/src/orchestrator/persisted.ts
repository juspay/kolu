/**
 * WHAT SURVIVES A padi RESTART about this host's orchestrator.
 *
 * padi drains on upgrade, so a restart is the NORMAL path rather than a crash
 * recovery: a person who was mid-conversation when a new kolu landed should
 * come back to the same conversation, not to an empty panel with a sentence
 * about why. That makes resume the default and this record the thing that
 * makes it possible.
 *
 * WHAT IS HERE, and why each of the four:
 *
 *  - `sessionId` — the agent's own id for the conversation, replayed with
 *    `session/load`. It means nothing to any other agent, so a stored id is
 *    only ever handed back to the agent that minted it.
 *  - `cwd` — the directory the session was opened in. It is what makes a stored
 *    session findable at all (Claude scopes its store by prefix), so a
 *    state-root whose `$HOME` moved must open a fresh session rather than ask
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
 *  - `fleet` — which terminals this conversation has touched. Membership only;
 *    every live fact about those terminals is read from the `terminals`
 *    collection, so a stale row cannot outlive the terminal it names.
 *
 * WHAT IS DELIBERATELY NOT HERE: the phase, the usage, the roster, the open
 * asks, the sign-in attempt. Every one of them is a fact about a subprocess
 * that no longer exists, and a restored one would be a lie with a timestamp on
 * it. They come back from the live agent or they do not come back.
 */

import {
  type OrchestratorRow,
  OrchestratorRowSchema,
  type OrchestratorState,
} from "@kolu/padi-client/surface";
import type { CellStore } from "@kolu/surface/server";
import { TerminalIdSchema } from "@kolu/terminal-vocab/schema";
import { Result, Schema } from "effect";

/** The record's SHAPE, as a schema rather than as an interface alone.
 *
 *  `confStore` hands back whatever is on disk under a cast — it decodes
 *  nothing — so without this the orchestrator would restore a hand-edited (or
 *  half-written) `orchestrator` key straight into a served cell and a replayed
 *  transcript, and the first thing to notice would be a row the panel cannot
 *  draw. Re-validated where it is READ ({@link readPersistedOrchestrator}),
 *  exactly as `getPersistedHosts` re-validates the server's `hosts` key: a
 *  parseable-but-invalid value is REFUSED loud, never normalized away and
 *  never collapsed to an empty conversation. */
export const PersistedOrchestratorSchema = Schema.Struct({
  sessionId: Schema.NullOr(Schema.String),
  cwd: Schema.String,
  model: Schema.NullOr(Schema.String),
  rows: Schema.Array(OrchestratorRowSchema),
  fleet: Schema.Array(TerminalIdSchema),
});

/** The record as a value. Derived from the schema rather than declared beside
 *  it, so the two cannot drift into disagreeing about what is on disk. */
export type PersistedOrchestrator = typeof PersistedOrchestratorSchema.Type;

/** An untouched state-root's record: no conversation, nothing to resume. */
export const EMPTY_PERSISTED_ORCHESTRATOR: PersistedOrchestrator = {
  sessionId: null,
  cwd: "",
  model: null,
  rows: [],
  fleet: [],
};

/** The re-validation, compiled once. `decodeUnknownResult` is a BRANCH rather
 *  than a throw, which is what lets the failure arm name the FILE — the one
 *  thing a person holding a corrupt state-root has to act on. */
const decodePersisted = Schema.decodeUnknownResult(PersistedOrchestratorSchema);

/** Read the remembered conversation out of padi's state-root, or CRASH naming
 *  the file.
 *
 *  There is no recovery arm on purpose. The two silent alternatives are both
 *  worse than a loud stop: dropping the offending rows would hand a person a
 *  transcript with holes in it and no way to know, and starting empty would
 *  throw away a conversation that is still on disk and still readable by hand.
 *  `conf` itself is fail-fast about an UNPARSEABLE file; this is the
 *  parseable-but-wrong case it cannot see. */
export function readPersistedOrchestrator(
  store: CellStore<PersistedOrchestrator>,
  path: string,
): PersistedOrchestrator {
  const result = decodePersisted(store.get());
  if (Result.isFailure(result)) {
    throw new Error(
      `the remembered orchestrator in ${path} does not match schema (${String(result.failure)}). Fix the \`orchestrator\` key to recover.`,
    );
  }
  return result.success;
}

/** What to write back after the conversation moved.
 *
 *  Derived from the live state and rows rather than accumulated beside them,
 *  so the record cannot disagree with what a reader is looking at. The row
 *  cap is a bound on the FILE, not on the panel: a conversation that has run
 *  for a week is still whole in memory, and what a restart brings back is its
 *  tail — which is the half a person scrolls to anyway. */
export function persistedFrom(
  state: OrchestratorState,
  rows: ReadonlyArray<OrchestratorRow>,
  cap = ROW_CAP,
): PersistedOrchestrator {
  return {
    sessionId: state.sessionId,
    cwd: state.cwd,
    model: state.model?.id ?? null,
    rows: rows.length > cap ? rows.slice(rows.length - cap) : rows,
    fleet: state.fleet,
  };
}

/** How many transcript rows a state-root keeps.
 *
 *  Chosen for the file rather than for the screen: padi's `config.json` holds
 *  the saved session beside this, and a conversation that has made two
 *  thousand tool calls would otherwise make every read of that file pay for
 *  scrollback nobody asked for. */
const ROW_CAP = 400;
