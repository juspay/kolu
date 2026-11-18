/**
 * THE SHAPES OLAI'S WIRE SUPPLIED, copied verbatim with olai's encodings.
 *
 * The client's events carry these, and in olai they came from
 * `olai-plugin-chat/wire` (`wire/members.ts`, `wire/session.ts`, `json.ts`).
 * A client in kolu cannot import a product's wire, so for now the shapes live
 * here, byte for byte what olai declares, so that olai typechecks against the
 * client unchanged. They are a temporary second copy: the client moves to the
 * shared shapes in `@kolu/acp/wire`, and this file is deleted, before the
 * branch it is on merges.
 */

import { Schema } from "effect";

/** JSON values preserve their payload keys and have no undefined wire values. */
export const Json = Schema.Json;
export type Json = typeof Json.Type;

/**
 * A call that SENT AN AGENT OUT, and what is known about the agent.
 *
 * It exists so that a spawn is legible as a spawn from the instant it is
 * announced. The other half of the same feature — which `Agent` call a row was
 * made INSIDE ({@link ToolEntry.parent}) — cannot say anything until the
 * spawned agent has made a call, and a subagent that is still reading its
 * instructions has made none: for the whole of that stretch, which is the
 * stretch a person is watching, the panel had a pending row with an ordinary
 * title on it and no reason to think anybody had been sent anywhere.
 *
 * PRESENCE is the fact, and the field inside it is the detail. A spawn is known
 * to be one whether or not it named a kind of agent — so this is a STRUCT that
 * may be empty rather than a nullable string, and which of the two it is
 * decides how a caller can be wrong. A bare `spawned: string | null` puts "not
 * a spawn" and "a spawn nobody labelled" one falsy value apart, and the first
 * `if (entry.spawned)` anybody writes drops the second on the floor; an empty
 * struct is truthy, and the only way to ask about the kind is to ask about the
 * kind.
 */
export const Spawned = Schema.Struct({
  /** Which kind of agent, in the words whoever configured it used —
   *  `Explore`, `general-purpose`, a name out of somebody's own agent
   *  definitions.
   *
   *  ABSENT when nobody has said, which is an ordinary spawn rather than a
   *  broken one: naming a kind is optional in the tool that starts an agent.
   *  Absent rather than `null` so that "nobody said" is spelled the way
   *  "unchanged" is spelled everywhere else on a tool row — the fact arrives
   *  across several frames, and one word for a field that has nothing in it
   *  means the transcript's stickiness needs no second rule to hold this
   *  together.
   *
   *  The agent's own word, never mapped onto one of olai's. A name this end
   *  does not recognise is drawn as it came, for the reason the header draws an
   *  unrecognised model id raw: rounding somebody's agent to the nearest one
   *  this panel has heard of would be naming an agent nobody started. */
  kind: Schema.optionalKey(Schema.String),
  /** ... and WHAT IT WAS SENT TO DO — the short description the `Agent` call
   *  was made with, which is the only thing that tells one agent of a fan-out
   *  from another.
   *
   *  It is not the row's TITLE, and that is the whole reason it is a field. A
   *  tool row's title is the name the call was announced with and it is pinned
   *  at the first frame that carries one — for this adapter that is the tool's
   *  own name, so four agents dispatched in one message are four rows reading
   *  `Task`. Drawn under the call that sent them, that was survivable: a reader
   *  works downwards and finds out. Lifted onto a strip and put behind a door
   *  it is four identical buttons, which is the one thing the strip may not be.
   *
   *  ABSENT when nobody has said, like {@link Spawned.kind} and for its reason:
   *  the arguments arrive across frames, so "unchanged" is spelled by the field
   *  not being there. Every reader falls back to the row's own title, which is
   *  what a spawn nobody described has to be called. */
  said: Schema.optionalKey(Schema.String),
});
export type Spawned = typeof Spawned.Type;

/**
 * A call that ARMED A BACKGROUND TASK, and what is known about the task.
 *
 * The other kind of call that outlives its own result. A `Monitor`, a
 * `Bash(run_in_background)`, an async `Agent`: the tool answers the moment the
 * task is running, and the task then lives on — past the frame, past the turn,
 * and (for a persistent monitor) for the whole of the conversation. What the
 * agent gets back is an acknowledgement; what a person needs is the task.
 *
 * It is on the wire because the WIRE says it: the pinned adapter stamps the
 * harness's own `task_started` onto the call it names, and the call stays
 * running until the harness reports a terminal state (`packages/plugins/claude/acp/patches/README.md`).
 * Nothing here is inferred from a tool's name or from an argument — a client
 * that guessed would be putting a live face on somebody's ordinary call.
 *
 * PRESENCE is the fact, like {@link Spawned}'s: a task that named no kind and
 * carried no description is still a task, so this is a struct with one required
 * field rather than a nullable string.
 */
export const Armed = Schema.Struct({
  /** The harness's own id for the task — the word every later frame about it
   *  arrives under, and the one thing that is always said. */
  task: Schema.String,
  /** The description it was armed WITH — "tick watch", "kolu fleet watch…" —
   *  which is the sentence a person recognises the task by, and which the
   *  call's own title (`Monitor`) is not. Absent for the same reason `kind`
   *  is. */
  description: Schema.optionalKey(Schema.String),
  /**
   * How it ENDED, in the harness's own word — and absent for the whole of the
   * time it is still running, which is what makes the presence of this field
   * the death itself.
   *
   * ACP has four statuses and the harness has more: `completed`, `failed`,
   * `killed` and `stopped` all reach the row's own `status` as one of two
   * words, and a monitor somebody STOPPED is not a monitor that failed. So the
   * word travels beside the status rather than being folded into it — the same
   * bargain {@link ChatServer}'s `said` strikes with an MCP server's status.
   */
  ended: Schema.optionalKey(Schema.String),
  /**
   * The agent's REPORT, once the outing has handed one back.
   *
   * A subagent's own prose never enters this conversation's column — the
   * ruling in `website/docs/chat.md`. The one place those words appear is the fold
   * of the call that armed the task. An async completion arrives as a
   * harness-injected user turn (`origin.kind: "task-notification"`) carrying
   * the whole report as XML; that turn is not a person speaking, and this
   * field is where the report is filed instead — on the task, next to how
   * it ended, which is the vocabulary the wire already uses
   * (`backgroundTask` on the pinned adapter).
   *
   * ABSENT until the agent has reported, like {@link Armed.ended}, and sticky
   * across frames for the same reason: a later status-only update must not
   * take the report back off the row.
   */
  report: Schema.optionalKey(Schema.String),
});
export type Armed = typeof Armed.Type;

/**
 * ONE WAY TO SIGN IN, as an agent advertised it at the handshake.
 *
 * WHAT THE PANEL IS TOLD is the half that decides what a button does, and the
 * other half — the command line a `terminal` method wants run — is deliberately
 * NOT here. A command and its arguments are what this machine spawns, and the
 * panel that would draw them is the browser ({@link ../../agent.ts} keeps them
 * where the spawn happens). What a person needs on screen is a name and a
 * sentence.
 *
 * `kind` is the whole of the difference a button has:
 *
 *   - `terminal` — THIS panel runs something and draws what it says. A
 *     subscription sign-in on the Claude Code adapter is one: the adapter hands
 *     over a command that prints a URL and waits for a code, and the panel owns
 *     the process, the output it streams and the line somebody types back.
 *   - `agent` — the AGENT runs it. Something happens at the other end of a URL
 *     and the agent says when it is done, so all this panel has is the page to
 *     send a person to and the wait.
 *   - `byHand` — NOBODY here runs it. The method is an interactive wizard that
 *     refuses a pipe, so what is drawn is the method's label and the command
 *     to type into a terminal on the server — the one case where the command
 *     line IS the content and therefore the one field below.
 */
export const AuthMethod = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  /** The agent's own second line about the method, or `null` — drawn as the
   *  button's tooltip rather than under it, because the chooser is a list of
   *  things to press and not a page to read. */
  description: Schema.NullOr(Schema.String),
  kind: Schema.Literals(["terminal", "agent", "byHand"]),
  /** The command line to run in a terminal on the SERVER, for a `byHand`
   *  method and `null` for every other — an absolute path, because the agent
   *  this names may be reachable only through olai's own agent search path and
   *  a bare name would not exist in that person's shell either. */
  command: Schema.NullOr(Schema.String),
});
export type AuthMethod = typeof AuthMethod.Type;

/** The page an agent sent a person to, and how far it got. */
export const SignInLink = Schema.Struct({
  url: Schema.String,
  /** Which machine it goes to — {@link ../../agent.ts} computes it where the
   *  payload is read, because the question a person is answering is "who am I
   *  about to hand this to" and a browser's URL parser is not the authority on
   *  a string the agent sent. */
  host: Schema.String,
  /** The agent's own message, which for a device-code sign-in carries the code
   *  to type into the page. */
  message: Schema.String,
  /** The agent has said the elicitation is complete. The row stays until the
   *  sign-in itself answers, so what a person sees in between is "finished at
   *  the page, waiting for the agent" rather than the card silently vanishing. */
  done: Schema.Boolean,
});
export type SignInLink = typeof SignInLink.Type;

/**
 * A SIGN-IN THE PANEL IS OFFERING OR RUNNING.
 *
 * THREE ARMS, and each is a different thing a person can do something about:
 *
 *   - `choosing` — nothing is running and there is a method to pick. The panel
 *     shows one button per {@link AuthMethod} the agent advertised, and this arm
 *     is also what puts a sign-in on screen at all: it is what `/login` asks for,
 *     and what the panel falls into when an agent refuses something because
 *     nobody is signed in.
 *   - `terminal` — a method this PANEL runs ({@link AuthMethod}'s own note). The
 *     row is the process: its output so far, verbatim and clickable, one input
 *     line that writes to its stdin, and a way out. Exit 0 is the end of it —
 *     the row goes and the panel reopens the conversation — and anything else
 *     leaves the output on screen AS the failure, because for a CLI sign-in the
 *     output is what a person needs to read.
 *   - `agent` — a method the AGENT runs. There is no process and no stdin: there
 *     is a page ({@link SignInLink}) while the agent waits on it, and then
 *     whatever the agent answers.
 *
 * `why` is the OTHER way an attempt ends — it could not be started, or the agent
 * refused it — and it is a sentence rather than a code because the two arms
 * would otherwise say it in two vocabularies. An arm with `why` set is finished
 * and failed; a `terminal` arm with `running: false` and a `code` is finished
 * and failed for the reason the output says.
 */
export const SignIn = Schema.Union([
  Schema.Struct({ kind: Schema.Literal("choosing") }),
  Schema.Struct({
    kind: Schema.Literal("terminal"),
    /** Which method this is running — the id a button was pressed with. */
    method: Schema.String,
    /** ... and what to call it, out of the same advertisement. */
    label: Schema.String,
    /** Everything the process has said, stdout and stderr interleaved as they
     *  arrived, oldest first and capped at the tail. */
    output: Schema.String,
    running: Schema.Boolean,
    /** How it ended, once it has: the process's own exit code, or `null` when it
     *  was signalled. */
    code: Schema.NullOr(Schema.Int),
    why: Schema.NullOr(Schema.String),
  }),
  Schema.Struct({
    kind: Schema.Literal("agent"),
    method: Schema.String,
    label: Schema.String,
    link: Schema.NullOr(SignInLink),
    why: Schema.NullOr(Schema.String),
  }),
]);
export type SignIn = typeof SignIn.Type;

/**
 * How an MCP server STANDS on this conversation — four answers, and which one
 * is true is decided by who said so.
 *
 *   - `connected` — the AGENT reports it attached. The only arm resting on the
 *     agent's own word, and the only one that may be read as "these tools are
 *     actually reachable from the conversation".
 *   - `handed` — olai gave it to the session and nothing has said what became
 *     of it. The ordinary state on an agent that reports nothing per server
 *     (ACP's `session/new` answers with a session id and says no more), and
 *     the state every conversation is in until its agent has spoken.
 *   - `unattached` — olai handed it over and the agent says it did NOT attach.
 *     Its `why` is the agent's own word for it.
 *   - `missing` — olai could not hand it over at all, because its own probe
 *     said no. `why` is that probe's sentence, carried WHOLE — the whole of
 *     `mcp-fail-visible` (`../../plugins/chat/src/probes.ts` asks; the plugin whose
 *     tool it is writes the words).
 *
 * POSITIVE RECOGNITION, which is the rule the legs already read permissions by
 * (`@kolu/acp`'s `./engine` door, where the `Leg` shape lives): `connected` is claimed only where an agent
 * said that word, and every other word it could send falls to `unattached`.
 * A tick on this panel is one somebody asserted, never one inferred from
 * silence — the losing direction being an agent whose servers are all fine
 * drawn as merely handed, which is what every conversation looked like before
 * this member existed.
 *
 * A UNION AND NOT A LABEL BESIDE A NULLABLE REASON, which is the shape this
 * shipped in for a day and is the one thing about it worth a paragraph. `why`
 * is grounded by the standing and by nothing else — the two arms that mean
 * "this conversation does not have it" carry one and the two that do not,
 * cannot. Written flat, each field reads honestly alone and the lie lives in
 * the pair: `{ standing: "missing", why: null }` is constructible and renders
 * as a failure with no reason, which is precisely the log line
 * `mcp-fail-visible` exists to stop putting on screen — and the panel promptly
 * grew a `why !== null` filter, deriving the standing back out of the field
 * that depends on it. Discriminated, both are type errors. {@link whyNot} is
 * the one read that turns it back into a sentence.
 */
export const ServerStanding = Schema.Union([
  /** The agent itself reports it attached. */
  Schema.Struct({ kind: Schema.Literal("connected") }),
  /** Olai gave it to the session and nothing has said what became of it. */
  Schema.Struct({ kind: Schema.Literal("handed") }),
  /** Olai handed it over and the agent says it did NOT attach. */
  Schema.Struct({
    kind: Schema.Literal("unattached"),
    /** The agent's own word for it. */
    why: Schema.String,
  }),
  /** Olai could not hand it over at all, because its own probe said no. */
  Schema.Struct({
    kind: Schema.Literal("missing"),
    /** The probe's or the server's own sentence. */
    why: Schema.String,
  }),
]);
export type ServerStanding = typeof ServerStanding.Type;

/**
 * An MCP server this conversation has, and how it stands.
 *
 * `mcp-roster-visible` on the wire, and `mcp-fail-visible`'s `MissingServer`
 * with the healthy majority of its own subject put back in. #140 published the
 * FAILURES and deliberately nothing else, on the argument that a working
 * conversation is owed no sentence. The incident that filed THIS one is the
 * other half of that argument arriving: somebody asked an agent which MCP
 * servers it had, and it answered wrong — opencode listed olai and deepwiki,
 * omitted kolu, and then called `kolu_lifecycle_create` perfectly. "Which
 * servers does this conversation have?" is a question people actually ask, and
 * a panel that answers it only when something is broken leaves the MODEL to
 * answer it the rest of the time, out of a context that never contained the
 * answer.
 *
 * ONE MEMBER FOR ALL FOUR STANDINGS rather than a healthy list beside the
 * broken one. A roster split in two is two lists to read in the right order to
 * learn one thing, and the split would fall exactly where the interesting
 * question is: whether the server named on the healthy list is the one the
 * agent could not reach.
 *
 * The standing's `why` is the SERVER'S OWN SENTENCE wherever there is one — a
 * JSON-RPC error message, an exec failure's reason, the agent's own status word
 * — with the probe's framing around it and nothing invented. That is the
 * field's whole value: "it did not attach" names the symptom every failure
 * shares and is the one thing that never helped anybody, and the ways of
 * failing a probe want different things done about them. Which is why no
 * general package composes this sentence: the words are the plugin's whose
 * tool would not answer (`../../plugin-kolu/src/probe.ts` is the one that
 * exists), and chat and this wire carry them through untouched.
 *
 * `where` is where the server IS: the absolute file that was probed or would
 * be spawned, or the URL of one reached over http. It is here because the
 * incident #140 comes from was a question about WHICH binary: a `kolu` on PATH
 * is not necessarily the host's kolu, a padi-spawned terminal prepends its own
 * bundled copy, and one of those was an older build that spawned perfectly and
 * knew nothing (juspay/kolu#2146). A reason without the path leaves the reader
 * where the incident started.
 *
 * `null` is the one failure that never reached a file, and it is the reason
 * that field is nullable at all: an environment that names a padi with no
 * `kolu` on PATH to reach it (`../../plugin-kolu/src/probe.ts`). #140 shipped `where`
 * required on the argument that a server olai can find is one it found on PATH
 * — true of every reason that comes back from a spawn, and not of the one that
 * never got to spawn anything. The absence IS the finding there, so it is spelt
 * as one rather than as a sentinel path that is not a path.
 *
 * A server that is simply NOT INSTALLED is on no arm of this. Nothing failed on
 * a host that is not running kolu, and a roster row reporting an absence as a
 * fault is a row a reader learns to ignore — which is the same mistake as
 * saying nothing, arrived at from the other side.
 */
export const ChatServer = Schema.Struct({
  /** What it is called — the same name the session was given it under, which
   *  is the name the agent's own tools carry. */
  name: Schema.String,
  /** Where it is: the executable that was probed or would be spawned,
   *  absolute, or the URL of one reached over http — and `null` when the
   *  failure was that there was nothing to probe. */
  where: Schema.NullOr(Schema.String),
  /** How it stands, and — on the two arms that have one — why not. See
   *  {@link ServerStanding}. */
  standing: ServerStanding,
  /** Where in this app a person can see what the server works on — an app
   *  address its plugin named on the probe (`Probed.at`), drawn as a link on
   *  the chip. Absent for a server with nothing to look at; chat never learns
   *  what the address shows. */
  at: Schema.optionalKey(Schema.String),
});
export type ChatServer = typeof ChatServer.Type;

/**
 * Whether two standings say the same thing.
 *
 * DERIVED from the schema, exactly as `@olai/format`'s `sameGit` and
 * `samePending` are, and for their reason: written out by hand it would be a
 * field comparison beside the declaration of those same fields, and a field
 * added to an arm would simply not be compared. What that costs here is a frame
 * that is NEVER SENT — `olai-plugin-chat`'s roster asks this to decide whether an
 * agent's report moved anything, so an equality that missed a field would leave
 * the panel drawing the standing before last, silently, because a roster
 * written and not published looks exactly like a roster nothing changed.
 */
export const sameStanding: (a: ServerStanding, b: ServerStanding) => boolean =
  Schema.toEquivalence(ServerStanding);

const SettingInfo = {
  id: Schema.String,
  name: Schema.String,
  description: Schema.String,
};
export const SessionSetting = Schema.Union([
  Schema.Struct({
    ...SettingInfo,
    type: Schema.Literal("select"),
    currentValue: Schema.String,
    options: Schema.Array(
      Schema.Struct({
        value: Schema.String,
        name: Schema.String,
        description: Schema.String,
      }),
    ),
  }),
  Schema.Struct({
    ...SettingInfo,
    type: Schema.Literal("boolean"),
    currentValue: Schema.Boolean,
  }),
]);
export type SessionSetting = typeof SessionSetting.Type;
export const PlanStep = Schema.Struct({
  content: Schema.String,
  priority: Schema.Literals(["high", "medium", "low"]),
  status: Schema.Literals(["pending", "in_progress", "completed"]),
});
export type PlanStep = typeof PlanStep.Type;
export const TerminalView = Schema.Struct({
  id: Schema.String,
  output: Schema.String,
  truncated: Schema.Boolean,
  exitCode: Schema.NullOr(Schema.Number),
  signal: Schema.NullOr(Schema.String),
  running: Schema.Boolean,
});
export type TerminalView = typeof TerminalView.Type;
