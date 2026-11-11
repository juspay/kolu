/**
 * READING THE PROTOCOL'S OWN PAYLOADS — the half of the wire that is ACP's
 * rather than one adapter's.
 *
 * Everything here is a pure function over something the SDK typed, which is
 * what keeps it out of {@link ./harness.ts}'s closure: those are rules worth
 * asserting over values, and a rule reachable only by starting a subprocess is
 * a rule nobody checks. What any of this means to ONE AGENT — its `_meta`, its
 * tool naming, which config option its picker is — is that agent's LEG
 * (`@kolu/acp/engine`) and is deliberately not here.
 */

import {
  type AuthMethodTerminal,
  type ContentBlock,
  type InitializeResponse,
  type McpServer,
  RequestError,
  type ToolCallContent,
  type ToolCallLocation,
} from "@agentclientprotocol/sdk";
import { relativeTo } from "@kolu/acp";
import type { OrchestratorAuthMethod } from "./rows.ts";

/**
 * HOW a verb failed — three ways, because a caller has TWO questions and two
 * values could only answer one of them.
 *
 *   - `refused` — THE AGENT SAID NO. It answered with a JSON-RPC error: a
 *     method it does not have, a session it does not know. Whatever was asked
 *     for did not happen (that is JSON-RPC's own bet about its own error
 *     responses), so asking again is honest — and the agent is demonstrably
 *     THERE, because it just spoke.
 *   - `unreachable` — NOTHING WAS ASKED OF ANYTHING: no process, a spawn that
 *     failed, no session open, a notification the pipe would not take.
 *   - `unanswered` — the request went out and NOTHING came back. Whether the
 *     agent acted on it cannot be known from this end, so the honest thing to
 *     do is SAY so and never quietly ask again.
 *
 * Splitting the first two rather than adding a second field is what keeps the
 * illegal combination unspellable: "the agent answered, and it is not there" is
 * not a value.
 */
export type Gone = "refused" | "unreachable" | "unanswered";

/**
 * Whether the agent ANSWERED the request this rejection came out of — with a
 * no, which is still an answer — or said nothing at all.
 *
 * The SDK gives exactly one shape to an error RESPONSE, its own
 * {@link RequestError}. Everything else it can reject with is silence: `close()`
 * rejects every pending request with the reason the connection died of. So the
 * whole of the reading is this `instanceof`, and the losing direction is the
 * safe one — an unrecognised rejection reads as `unanswered`, which offers a
 * person nothing rather than offering a retry that could duplicate a message
 * the agent already has.
 */
export const goneOf = (cause: unknown): Gone =>
  cause instanceof RequestError ? "refused" : "unanswered";

/** ACP's code for "authenticate first" — the protocol's own number, named once
 *  so the reader of a rejection sits beside the constant it reads. */
const AUTH_REQUIRED = -32000;

/**
 * ... AND WHETHER IT SAID NO FOR WANT OF A SIGNATURE.
 *
 * ACP spells "authenticate first" as an error RESPONSE to whatever was refused,
 * so an agent that needs a sign-in says so on `session/new`, on `session/load`
 * and on a turn alike. Read off the CODE and deliberately never guessed from
 * the message — "not signed in" is prose and an agent may write any sentence it
 * likes around it.
 */
export const authOf = (cause: unknown): boolean =>
  cause instanceof RequestError && cause.code === AUTH_REQUIRED;

/** WHAT ANYTHING THAT WENT WRONG SAID — an `Error`'s own sentence, and
 *  anything else as the string it prints as. Spelled ONCE, because every place
 *  in this package that reports a failure asks exactly this question and nine
 *  hand-written spellings of it were nine chances to answer it differently. */
export const messageOf = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

/**
 * ... AND WHAT IT SAID, in the agent's own sentence rather than the protocol's
 * code word.
 *
 * The SDK's own error wrapping turns a plain thrown `Error` into `-32603
 * "Internal error"` and puts the real sentence in `data.details` (or, when the
 * message parsed as JSON, makes `data` that object). So a model the account is
 * not entitled to reached a person as "Internal error". `.message` is the
 * code's NAME; the sentence is in `data`.
 */
export const saidOf = (cause: unknown): string => {
  if (
    cause instanceof RequestError &&
    typeof cause.data === "object" &&
    cause.data !== null
  ) {
    const data = cause.data as {
      readonly details?: unknown;
      readonly message?: unknown;
    };
    if (typeof data.details === "string" && data.details.trim() !== "") {
      return data.details;
    }
    if (typeof data.message === "string" && data.message.trim() !== "") {
      return data.message;
    }
  }
  return messageOf(cause);
};

/**
 * Whether a notification is about a conversation this harness is not in.
 *
 * A named session is about one conversation. It is from elsewhere when that
 * conversation is one we have LEFT, or when we are IN a conversation and this
 * is not it.
 *
 * A MISMATCH WHILE WE ARE IN NONE IS NOT ELSEWHERE on its own: a load's replay
 * arrives before this end has recorded which session it is in. Closed is what
 * names the session the frames must not be about. An unnamed notification is
 * not a mismatch either — absence is a shape we have not seen, and dropping one
 * would go quiet for the life of a conversation.
 */
export const fromElsewhere = (
  named: unknown,
  current: string | null,
  closed: ReadonlySet<string>,
): boolean =>
  typeof named === "string" &&
  (closed.has(named) || (current !== null && named !== current));

/**
 * What a content block says — and, when it is not prose, THAT IT WAS THERE.
 *
 * The panel draws text and nothing else, which was never a fair thing to do
 * SILENTLY: a block this returned `""` for was dropped by every caller, so an
 * agent that answered with a picture left a blank where its answer had been,
 * and a reader cannot tell that from an agent that said nothing.
 *
 * The `default` arm is not dead code: `ContentBlock` is somebody else's union
 * and it gains variants.
 */
export const textOf = (content: ContentBlock): string => {
  switch (content.type) {
    case "text":
      return content.text;
    case "image":
      return "[image]";
    case "audio":
      return "[audio]";
    case "resource_link":
      return `[resource: ${content.name}]`;
    case "resource":
      return `[resource: ${content.resource.uri}]`;
    default:
      return "[unsupported content]";
  }
};

/**
 * What a running call has to say for itself.
 *
 * Until this was read, an unfolded call showed its arguments and then nothing
 * at all until it completed — a long shell command indistinguishable from one
 * that had hung. REPLACES rather than appends, which is the protocol's own rule
 * for an update: a report carries the call's content as it stands now.
 */
export const progressOf = (
  content: ReadonlyArray<ToolCallContent> | null | undefined,
): string | undefined => {
  if (content == null || content.length === 0) return undefined;
  const said = content
    .map((block) => (block.type === "content" ? textOf(block.content) : ""))
    .filter((line) => line !== "");
  return said.length === 0 ? undefined : said.join("\n");
};

/** Where the call is working. `path:line` when the agent said which line, and
 *  the path alone when it did not — a `:0` invented for the second case would
 *  be a claim about a file nobody made. Root-relative by the same rule a diff's
 *  path is, because the two land on ONE row. */
export const locationsOf = (
  locations: ReadonlyArray<ToolCallLocation> | null | undefined,
  cwd: string,
): ReadonlyArray<string> | undefined => {
  if (locations == null || locations.length === 0) return undefined;
  return locations.map((at) => {
    const path = relativeTo(cwd, at.path);
    return typeof at.line === "number" ? `${path}:${at.line}` : path;
  });
};

/** A tool call's arguments and result, as one folded block. JSON rather than
 *  prose: it is detail somebody opens deliberately, and the shape is the
 *  agent's own. */
export const detailOf = (
  input: unknown,
  output: unknown,
): string | undefined => {
  const parts: Array<string> = [];
  if (input !== undefined && input !== null) {
    parts.push(JSON.stringify(input, null, 2));
  }
  if (output !== undefined && output !== null) {
    parts.push(JSON.stringify(output, null, 2));
  }
  return parts.length === 0 ? undefined : parts.join("\n\n");
};

/** Which elicitation a completion notification is about. Read defensively
 *  because a notification is not a request: an agent that sent a shape this end
 *  cannot use gets nothing done about it rather than an exception inside a
 *  callback. */
export const completionIdOf = (params: unknown): string | null => {
  if (typeof params !== "object" || params === null) return null;
  if (!("elicitationId" in params)) return null;
  const id = params.elicitationId;
  return typeof id === "string" && id !== "" ? id : null;
};

/** ACP's `_meta` corner a `terminal` auth method carries the command it wants
 *  run in — the pinned Claude Code adapter's own spelling, where the method's
 *  `args` are the ADAPTER's argv and this is the whole command line a client is
 *  meant to run instead of its own. */
const TERMINAL_AUTH = "terminal-auth";

/** What running a `terminal` sign-in takes. */
export interface TerminalAuth {
  readonly command: string;
  readonly args: ReadonlyArray<string>;
  /** The method's own environment, over kolu's own. */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * ONE SIGN-IN METHOD, as this package reads it: the row the panel draws, and
 * what running it takes.
 *
 * The two halves live together because they are one advertisement and they go
 * to two different places — the method travels to the browser, and `run` is a
 * command line this process spawns and no browser has any business holding.
 */
export interface Offered {
  readonly method: OrchestratorAuthMethod;
  /** What running it takes, or `null` for a method the AGENT runs, which needs
   *  no command — only the wait. */
  readonly run: TerminalAuth | null;
}

/**
 * WHAT AN AGENT WILL SIGN SOMEBODY IN WITH, out of the handshake.
 *
 * Three kinds exist in the protocol and TWO are offered, which is a decision
 * rather than a filter that fell out:
 *
 *   - `terminal` — a command this process runs. The command line comes from the
 *     method's own `_meta` corner where the adapter wrote one, and otherwise
 *     from the protocol's own sentence about the field: those `args` are for
 *     the AGENT BINARY, which is the command kolu spawned.
 *   - `agent` — the agent runs it, and all this end does is wait and draw the
 *     page the agent sends.
 *   - `env_var` — NO. A method that wants an API key typed into a form is a
 *     credential box, which is a different feature with a different argument to
 *     make: where the key is kept, what happens to it, whether it is ever shown
 *     again. Offering the button without that argument would be offering
 *     something this panel cannot finish.
 *
 * A method whose name is empty is dropped too, because a button with no word on
 * it is one nobody can press on purpose.
 */
export const methodsIn = (
  response: InitializeResponse,
  command: string,
  baseArgs: ReadonlyArray<string>,
): ReadonlyArray<Offered> => {
  const offered: Array<Offered> = [];
  for (const method of response.authMethods ?? []) {
    if (method.name === "") continue;
    // WHICH KIND, read from the protocol's own discriminator. The pinned SDK's
    // union is two arms — a `terminal` method, and the plain `agent` one that
    // carries no `type` at all — so the field is reached through `in`, and
    // anything typed as something ELSE is refused rather than read as an agent
    // method. That arm is written today against `env_var`, which is a
    // credential box: where the key is kept, what happens to it and whether it
    // is ever shown again are a different feature's questions, and offering
    // the button without answering them would be offering something this panel
    // cannot finish. Written as "not terminal" rather than as that one name so
    // a THIRD kind lands the same way instead of being silently drawn as a
    // sign-in nobody can run.
    if ("type" in method && method.type !== "terminal") continue;
    const terminal = "type" in method ? method : null;
    const wire: OrchestratorAuthMethod = {
      id: method.id,
      name: method.name,
      description: method.description ?? null,
      runs: terminal === null ? "agent" : "client",
    };
    if (terminal === null) {
      offered.push({ method: wire, run: null });
      continue;
    }
    const written = terminalAuthIn(terminal);
    offered.push({
      method: wire,
      run: {
        command: written?.command ?? command,
        args: written?.args ?? [...baseArgs, ...(terminal.args ?? [])],
        env: written?.env ?? { ...terminal.env },
      },
    });
  }
  return offered;
};

/** The command line a `terminal` method asks for in its own `_meta`, or `null`
 *  when it wrote none — in which case the protocol's `args` are for the agent
 *  binary kolu already knows. */
export const terminalAuthIn = (
  method: AuthMethodTerminal,
): TerminalAuth | null => {
  const corner = method._meta?.[TERMINAL_AUTH];
  if (typeof corner !== "object" || corner === null) return null;
  if (
    !("command" in corner) ||
    typeof corner.command !== "string" ||
    corner.command === ""
  ) {
    return null;
  }
  const args =
    "args" in corner && Array.isArray(corner.args)
      ? corner.args.filter((one): one is string => typeof one === "string")
      : [];
  const env: Record<string, string> = { ...method.env };
  if (
    "env" in corner &&
    typeof corner.env === "object" &&
    corner.env !== null
  ) {
    for (const [name, value] of Object.entries(corner.env)) {
      if (typeof value === "string") env[name] = value;
    }
  }
  return { command: corner.command, args, env };
};

/** What a session is handed, as ACP's `mcpServers` — the one place the
 *  protocol's shape for an MCP server is spelled.
 *
 *  TWO arms, and the difference on the wire is one key. ACP's `McpServer` is a
 *  union discriminated by `type`, where the STDIO arm is the one WITHOUT the
 *  discriminant: `claude-agent-acp` 0.81.2 (the adapter `KOLU_ACP_AGENT` names)
 *  reads an entry with `type: "http"`/`"sse"` as a remote server, an entry with
 *  NO `type` key as a stdio server, and SILENTLY DROPS an entry carrying
 *  `type: "stdio"` (`dist/acp-agent.js:6536-6558` — measured, not inferred). So
 *  the http arm must emit `type` and the stdio arm must not emit it at all; a
 *  tidying pass that "completes" the union by adding `type: "stdio"` here would
 *  hand the orchestrator a session with no hands and no error.
 *
 *  The caller's own discriminant is `kind`, never `type`, precisely so the
 *  in-tree field and the wire field cannot be confused for each other. */
export const mcpServersOf = (
  servers: ReadonlyArray<
    | {
        readonly kind: "stdio";
        readonly name: string;
        readonly command: string;
        readonly args: ReadonlyArray<string>;
        readonly env: Readonly<Record<string, string>>;
      }
    | {
        readonly kind: "http";
        readonly name: string;
        readonly url: string;
        readonly headers: Readonly<Record<string, string>>;
      }
  >,
): ReadonlyArray<McpServer> =>
  servers.map((one) =>
    one.kind === "http"
      ? {
          type: "http" as const,
          name: one.name,
          url: one.url,
          headers: Object.entries(one.headers).map(([name, value]) => ({
            name,
            value,
          })),
        }
      : {
          name: one.name,
          command: one.command,
          args: [...one.args],
          env: Object.entries(one.env).map(([name, value]) => ({
            name,
            value,
          })),
        },
  );
