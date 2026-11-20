/**
 * THE CONDUCTOR'S MEMORY, as the fleet face reaches it — the `memory`
 * resource it reads and the `memory_propose` tool it asks with.
 *
 * kolu-server owns the memory (it is stored with the rest of kolu's state,
 * and only the human changes what is remembered), so this is a PORT, as the
 * works are: the face reads and asks through it and holds no copy.
 */

import { type BespokeTool, ToolFailure } from "@kolu/surface-mcp/tools";
import { Effect, Schema } from "effect";

/** WHAT THE CONDUCTOR REMEMBERS, written for the model: every approved
 *  entry, the titles of its proposals still waiting on the human, and how
 *  much room is used of how much. */
export const FleetMemorySchema = Schema.Struct({
  entries: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      title: Schema.String,
      about: Schema.NullOr(Schema.String),
      body: Schema.String,
    }),
  ),
  waiting: Schema.Array(
    Schema.Struct({ id: Schema.String, title: Schema.String }),
  ),
  room: Schema.Struct({ used: Schema.Int, of: Schema.Int }),
});
export type FleetMemoryView = typeof FleetMemorySchema.Type;

export const EMPTY_FLEET_MEMORY: FleetMemoryView = {
  entries: [],
  waiting: [],
  room: { used: 0, of: 0 },
};

/** What a proposal asks the memory to do. */
export type FleetMemoryChange =
  | {
      readonly kind: "add";
      readonly title: string;
      readonly about: string | null;
      readonly body: string;
    }
  | {
      readonly kind: "replace";
      readonly entry: string;
      readonly title: string;
      readonly about: string | null;
      readonly body: string;
    }
  | { readonly kind: "forget"; readonly entry: string };

/** What proposing answered: the proposal, waiting on the human, or the
 *  sentence saying why kolu refused it. */
export type FleetMemoryProposed =
  | { readonly kind: "waiting"; readonly proposal: string }
  | { readonly kind: "refused"; readonly why: string };

export interface FleetMemory {
  /** The memory as the `memory` resource serves it. */
  view(): FleetMemoryView;
  /** THE MEMORY MOVED — the resource re-reads on this. */
  subscribe(cb: () => void): () => void;
  /** Record a proposal for the human to decide, answering at once. */
  propose(change: FleetMemoryChange, why: string | null): FleetMemoryProposed;
}

const MemoryProposeArgsSchema = Schema.Struct({
  kind: Schema.Literals(["add", "replace", "forget"]).annotate({
    description:
      "`add` a new memory; `replace` the memory `entry` names with new words; `forget` the memory `entry` names.",
  }),
  entry: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "The id of the memory to replace or forget, as the `memory` resource lists it (`m3`). Not for `add`.",
    }),
  ),
  title: Schema.optionalKey(
    Schema.String.annotate({
      description: "One line, at most 80 characters. For `add` and `replace`.",
    }),
  ),
  about: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "What it is about, if it is about one thing: a repository, a host. At most 80 characters.",
    }),
  ),
  body: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "The memory itself, in Markdown with no heading lines, at most 1,200 characters. For `add` and `replace`.",
    }),
  ),
  why: Schema.optionalKey(
    Schema.String.annotate({
      description:
        "Why it is worth keeping, in a few words the human reads beside it: where they said so, or the file it came from. At most 200 characters.",
    }),
  ),
});
type MemoryProposeArgs = typeof MemoryProposeArgsSchema.Type;

const misuse = (why: string): ToolFailure =>
  new ToolFailure(why, { kind: "memory-propose-misused" });

const changeOf = (args: MemoryProposeArgs): FleetMemoryChange => {
  const about = args.about ?? null;
  switch (args.kind) {
    case "add":
      if (args.entry !== undefined)
        throw misuse("`add` makes a new memory: leave `entry` out.");
      if (args.title === undefined || args.body === undefined)
        throw misuse("`add` needs a `title` and a `body`.");
      return { kind: "add", title: args.title, about, body: args.body };
    case "replace":
      if (
        args.entry === undefined ||
        args.title === undefined ||
        args.body === undefined
      )
        throw misuse(
          "`replace` needs the `entry` it replaces, a `title` and a `body`.",
        );
      return {
        kind: "replace",
        entry: args.entry,
        title: args.title,
        about,
        body: args.body,
      };
    case "forget":
      if (args.entry === undefined)
        throw misuse("`forget` needs the `entry` it forgets.");
      return { kind: "forget", entry: args.entry };
  }
};

/** `memory_propose` — the Conductor's one way to change what it remembers. */
export function memoryProposeTool(memory: FleetMemory): BespokeTool {
  return {
    input: MemoryProposeArgsSchema,
    mutates: true,
    title: "Propose a change to what you remember",
    description:
      "Propose a change to what you remember across sessions: `add` a memory, `replace` one, or `forget` one (by the id the `memory` resource lists). NOTHING IS REMEMBERED UNTIL THE HUMAN APPROVES IT. This call answers at once with the proposal's id; the human remembers it, edits it or declines it later, in kolu. Do not ask them about it in your reply and do not wait for it: kolu shows them the proposal. Keep a memory to something true beyond one piece of work — a rule they gave you, a preference, where something lives. Not for what the `works` resource holds: a work's state, questions and timeline are kolu's record already. A refused proposal says why (declined before, already remembered, already waiting, memory full, too many waiting): do not propose it again.",
    handler: (args, _bundle, _signal) =>
      Effect.try({
        try: () => changeOf(args as MemoryProposeArgs),
        catch: (err: unknown) => err as ToolFailure,
      }).pipe(
        Effect.flatMap((change) => {
          const answered = memory.propose(
            change,
            (args as MemoryProposeArgs).why ?? null,
          );
          return answered.kind === "waiting"
            ? Effect.succeed({
                proposal: answered.proposal,
                waiting:
                  "for the human: nothing is remembered until they approve it",
              })
            : Effect.fail(
                new ToolFailure(`refused: ${answered.why}`, {
                  kind: "memory-proposal-refused",
                }),
              );
        }),
      ),
  };
}
