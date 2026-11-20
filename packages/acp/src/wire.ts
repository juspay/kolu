import { Schema } from "effect";

/**
 * One option of a question the agent asked.
 *
 * `value` is what travels BACK — an enum's `const`, a permission option's id —
 * and `label` is what a person reads. They are usually the same string and are
 * two fields anyway, because the one case where they part company (a permission
 * option named "Yes, and use \"auto\" mode" whose id is `auto`) is the case this
 * whole member exists for.
 */
export const AskChoice = Schema.Struct({
  value: Schema.String,
  label: Schema.String,
  /** The option's own second line, when it has one. */
  hint: Schema.NullOr(Schema.String),
});
export type AskChoice = typeof AskChoice.Type;

/**
 * One field of the form the agent asked to be filled.
 *
 * `kind` is what a renderer switches on, and it is the whole of what this layer
 * knows about the JSON Schema it came from — the projection happens server-side
 * ({@link ./asks.ts}), so no browser ever reads a `oneOf`.
 */
export const AskField = Schema.Struct({
  /** The schema property this field answers. The answer travels back under it. */
  key: Schema.String,
  /** What to call it. `null` when the payload named nothing — a single question
   *  carries its text as the ask's own message, and a label invented from the
   *  field key would be `question_0`. */
  label: Schema.NullOr(Schema.String),
  hint: Schema.NullOr(Schema.String),
  kind: Schema.Literals([
    "choice",
    "choices",
    "text",
    "number",
    "integer",
    "boolean",
  ]),
  /** `choice` / `choices` only. */
  choices: Schema.Array(AskChoice),
  required: Schema.Boolean,
  /** The field this one is the free-text "other" for, by key, when the agent
   *  paired them — the CLI's per-question "Other" box. Drawn inside that
   *  field's block rather than as a field of its own. */
  attachedTo: Schema.NullOr(Schema.String),
});
export type AskField = typeof AskField.Type;

/**
 * A place an agent sent a person INSTEAD of asking them to fill something in.
 *
 * ACP's other elicitation mode: `mode: "url"` carries a URL and nothing to
 * type, and the agent completes it on its own — a device-code sign-in is told
 * when the person finished at the vendor's page (`elicitation/complete`), and a
 * server's OAuth is told the same way. So the panel's job is to SAY where to
 * go and to get out of the way, which is the whole of what this card is.
 *
 * `host` is here rather than computed where it is drawn, and for the reason
 * that makes it worth a field rather than a call to `new URL`: what the panel
 * is showing is WHICH MACHINE a person is about to hand credentials to, and
 * that question has to be answerable from the value the agent sent without a
 * browser's parser deciding whether it parses. A URL this end cannot parse is
 * carried through whole ({@link ./asks.ts}'s `hostOf`), so the line says where
 * it really goes instead of going blank about it.
 */
export const AskLink = Schema.Struct({
  url: Schema.String,
  host: Schema.String,
});
export type AskLink = typeof AskLink.Type;

/**
 * What was picked or typed for one field.
 *
 * Always TEXT, however the field is typed: a number field's answer is the
 * characters somebody entered, and turning those into a number belongs where
 * the schema that asked for one is understood ({@link ./asks.ts}'s
 * `contentOf`). One entry for a select or a box, several for a multi-select,
 * and a field left alone has no entry at all.
 */
export const AskAnswer = Schema.Struct({
  key: Schema.String,
  values: Schema.Array(Schema.String),
});
export type AskAnswer = typeof AskAnswer.Type;

/**
 * How a `boolean` field's answer is spelled.
 *
 * It used to be "a value neither owns", agreed by comment between the panel
 * that writes it and the chat package that reads it back — a spelling that
 * eventually stops agreeing, silently, since a changed word would simply stop
 * matching and every press would register as nothing. It is owned now: the
 * vocabulary the two ends share is this package's, both import the one value,
 * and the reader ({@link ./asks.ts}'s `valueOf`) lives beside it.
 */
export const YES_NO = { yes: "true", no: "false" } as const;

/** How a question stopped waiting.
 *
 *   - `answered` — a person filled it in and submitted.
 *   - `declined` — a person dismissed it. The agent is TOLD that, which is the
 *     point: a dismissal is a refusal to answer, never a fabricated answer.
 *   - `withdrawn` — the agent took the question back (the turn was cancelled,
 *     the session was replaced, the subprocess died). Nobody answered, and the
 *     row says so rather than sitting on screen waiting forever. */
export const AskOutcome = Schema.Struct({
  how: Schema.Literals(["answered", "declined", "withdrawn"]),
  answers: Schema.Array(AskAnswer),
});
export type AskOutcome = typeof AskOutcome.Type;

/**
 * HOW A TOOL CALL IS DOING. A row arrives `pending` and is refined by later
 * frames, so the status is the field a panel reads to know whether a card is
 * still breathing.
 */
export const ToolStatus = Schema.Literals([
  "pending",
  "in_progress",
  "completed",
  "failed",
]);
export type ToolStatus = typeof ToolStatus.Type;

/**
 * What became of a message's DELIVERY, when it did not simply go.
 *
 * Two values because there are exactly two things this end can honestly know.
 * `refused` — the agent said no, or a cancel beat the prompt onto the wire;
 * nothing took it, so *send again* sends it for the FIRST time. `unanswered` —
 * it went out and nothing came back; an agent that took it and then went
 * silent looks identical to one that never took it, so no retry is offered.
 */
export const Delivery = Schema.Literals(["refused", "unanswered"]);
export type Delivery = typeof Delivery.Type;

/** A PIECE of streaming prose appended to a row — never the text so far, so a
 *  turn that runs for a minute does not re-send its own paragraph per tick.
 *
 *  `of` is the row it belongs to, and `at` is authoritative: a piece that was
 *  delivered twice starts at an offset the row already covers, and truncating
 *  to `at` before appending makes the re-send a no-op instead of a stutter. */
export const Saying = Schema.Struct({
  of: Schema.String,
  at: Schema.Int,
  text: Schema.String,
});
export type Saying = typeof Saying.Type;

/** Something still out when the turn that started it has ended — a background
 *  task, or a subagent. Drawn on the strip above the scroll, because the row
 *  itself may be an hour of scrollback away. */
export const Watching = Schema.Struct({
  row: Schema.String,
  kind: Schema.Literals(["agent", "task"]),
  name: Schema.String,
  since: Schema.String,
});
export type Watching = typeof Watching.Type;

/** A background task the agent armed — a monitor, a `run_in_background` shell,
 *  an async subagent. It reports its launch and then LIVES, so its row stays
 *  live past the turn that made it and its death lands as a notice at the
 *  bottom of the transcript in the harness's own word. */
export const Armed = Schema.Struct({
  task: Schema.String,
  description: Schema.NullOr(Schema.String),
  /** The harness's own ending word — `completed`, `failed`, `killed`,
   *  `stopped`. A monitor you stopped did not fail. */
  ended: Schema.NullOr(Schema.String),
  report: Schema.NullOr(Schema.String),
});
export type Armed = typeof Armed.Type;

/** A subagent this call sent out: which kind, and what it was told to do. */
export const Spawned = Schema.Struct({
  kind: Schema.NullOr(Schema.String),
  said: Schema.NullOr(Schema.String),
});
export type Spawned = typeof Spawned.Type;

/** One step of the agent's execution plan. */
export const PlanStep = Schema.Struct({
  content: Schema.String,
  status: Schema.Literals(["pending", "in_progress", "completed"]),
  priority: Schema.NullOr(Schema.String),
});
export type PlanStep = typeof PlanStep.Type;

/** The agent asking a PERSON something — a permission request it was not
 *  allowed to answer for itself, an `AskUserQuestion` form, a URL to visit.
 *
 *  `outcome` is `null` while it waits. A question NEVER times out. */
export const Ask = Schema.Struct({
  fields: Schema.Array(AskField),
  link: Schema.NullOr(AskLink),
  outcome: Schema.NullOr(AskOutcome),
});
export type Ask = typeof Ask.Type;

/**
 * A file the agent rewrote, as the protocol reports it.
 *
 * STRUCTURED, and that is the whole point: ACP sends a tool call's diff as a
 * path and two texts, and the transcript used to flatten every content block a
 * call carried into one progress STRING — so what reached a browser about a
 * file being rewritten was the sentence `— /some/path`, and the change itself
 * was gone before the wire. A panel cannot draw what a wire has already turned
 * into prose, and re-parsing prose back into a diff is not a thing this
 * codebase will do.
 *
 * Two texts rather than a unified diff, because that is what the protocol
 * carries and because the LINE diff is a view-time computation: the client
 * derives it (the product's own diff view) the same way it
 * derives everything else it draws.
 *
 * `oldText` is `null` for a file that did not exist — the protocol's own way of
 * saying "this is new", and a distinction the panel draws rather than flattening
 * into an empty file.
 *
 * `path` is ROOT-RELATIVE when the file is under the served directory and
 * absolute otherwise, which is the spelling every `file:line` in kolu already
 * uses. The relativising happens where the payload is read ({@link ./diffs.ts}),
 * against the directory its caller knows the session was started in.
 */
export const FileDiff = Schema.Struct({
  path: Schema.String,
  oldText: Schema.NullOr(Schema.String),
  newText: Schema.String,
});
export type FileDiff = typeof FileDiff.Type;

/**
 * How full the conversation's context is: tokens in it, and how many fit.
 *
 * The protocol's own `usage_update`, projected to the two numbers a reader
 * acts on. It is the other half of the sentence the header's model is there
 * for — a turn's cost and character depend on which model it runs, and its
 * ROOM depends on this — and the question it answers is the one nothing on
 * screen used to: whether it is time to `/compact`.
 *
 * BOTH numbers travel, rather than the percentage they imply. A window is not
 * a constant — 200k and 1M are both ordinary, and a session moves between them
 * when the model does — so "80%" would be the one figure that reads the same
 * either way while meaning quite different amounts of work left. The reader
 * wants the denominator, and the wire is where it is known.
 *
 * `size` is the AGENT'S current best knowledge and is allowed to move under a
 * conversation. The Claude Code adapter seeds it from what it last learned for
 * the model and corrects it authoritatively when a turn ends, so the first turn
 * after a `/model` can report the previous model's window mid-stream and the
 * true one by the end. That is the agent revising a number it told us, not this
 * panel guessing, and it is drawn as it arrives for exactly that reason.
 *
 * `cost` is deliberately NOT here. The protocol carries it on the turn-final
 * frame and the header does not draw it: what a session has spent is a
 * different question from whether it is about to run out of room, asked at a
 * different moment, and a second number in that line buys nothing for the one
 * this exists to answer.
 */
export const Usage = Schema.Struct({
  /** Tokens currently in the context window. */
  used: Schema.Int,
  /** How many fit. Always positive — a report that said otherwise is dropped
   *  where the payload is read ({@link ./usage.ts}), because a denominator of
   *  zero is not a fact about a conversation. */
  size: Schema.Int,
});
export type Usage = typeof Usage.Type;

/**
 * The account fields an agent may state about the identity it is signed in as.
 *
 * All three are optional on the wire and `null` here: an adapter fills what its
 * own probe could read, and a missing organization is not a claim that there is
 * none. The panel draws the email when there is one and leaves the rest to the
 * line's `title`.
 */
export const AuthAccount = Schema.Struct({
  email: Schema.NullOr(Schema.String),
  organization: Schema.NullOr(Schema.String),
  /** The vendor's own plan string, not normalized — "max" from Claude,
   *  "plus" from Codex. */
  plan: Schema.NullOr(Schema.String),
});
export type AuthAccount = typeof AuthAccount.Type;

/**
 * WHO the agent process is signed in as, as the agent itself reports it.
 *
 * `_auth/status_update`'s payload, projected to the four facts a reader acts
 * on. The protocol's `vendor` corner is deliberately not here: it is
 * vendor-namespaced extras and nothing in this panel draws one.
 *
 * `label` is the agent's OWN ready-to-draw string ("Claude Max", "ChatGPT
 * Plus", "Anthropic API key") and it is the one field that is always present.
 * `detail` is its optional second line — a key source, a gateway host — and
 * the panel falls back to `account.email` where there is no detail.
 *
 * `kind` is `null` for a kind this build has no word for. That is the tolerant
 * direction: the protocol may grow a sixth kind, and a client that dropped the
 * whole payload would have shown "not reported" — which means something else
 * entirely — where the agent had said who it was. A KNOWN logged-out state is
 * `kind: "none"` with its label, and an agent that says nothing at all leaves
 * the whole value `null` (`ChatState.identity`).
 */
export const AuthStatus = Schema.Struct({
  kind: Schema.NullOr(
    Schema.Literals(["account", "api_key", "gateway", "external", "none"]),
  ),
  label: Schema.String,
  detail: Schema.NullOr(Schema.String),
  account: Schema.NullOr(AuthAccount),
});
export type AuthStatus = typeof AuthStatus.Type;

/**
 * ONE WAY the agent offers to get signed in.
 *
 * The agent's own list from the handshake, projected to what a panel acts on.
 * `runs` is the half that decides what a press DOES, and it is the agent's
 * answer rather than ours: `client` — the adapter handed over a command line,
 * and the client spawns it and streams what it prints; `agent` — the agent
 * runs it, and the client's part is a page to visit; `hand` — the agent's way
 * in is a series of questions in a terminal, so nothing runs it here and the
 * panel shows the `command` a person types in a terminal on the server.
 *
 * `command` is that command line for a `hand` method and `null` for every
 * other — an absolute path, because the agent it names may be reachable only
 * through the product's own agent search path, and a bare name would not exist
 * in that person's shell either.
 *
 * Here rather than in a product's own schema because both of them draw this
 * list and the two products run the SAME adapters: an agent that names a
 * method a panel cannot run is a fact about the protocol's corner, not about
 * which product is looking at it.
 */
export const AuthMethod = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  runs: Schema.Literals(["client", "agent", "hand"]),
  command: Schema.NullOr(Schema.String),
});
export type AuthMethod = typeof AuthMethod.Type;

/**
 * WHICH SIGN-IN would fix a refusal — the two reasons a row carries beside the
 * sentence that refused it.
 *
 * `signed-out` is an agent with nobody signed in; `account` is the signature a
 * request reached that the agent does not accept (a limit, the wrong account,
 * a login gone stale). A row that says one of these can be *send again*-ed
 * after the sign-in it names; a row that says neither cannot.
 */
export const SignInReason = Schema.Literals(["signed-out", "account"]);
export type SignInReason = typeof SignInReason.Type;

/** A slash command the agent advertises. */
export const Command = Schema.Struct({
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
});
export type Command = typeof Command.Type;

/** One adapter-advertised session setting — the model, reasoning effort,
 *  permission mode, a boolean such as fast mode. The control uses the
 *  ADAPTER'S own name and values; neither product composes either. */
export const Setting = Schema.Struct({
  id: Schema.String,
  /**
   * WHICH CONTROL THIS ROW IS, decided by the client that read the adapter
   * and never re-derived by the panel.
   *
   * `"model"` — the agent's model picker, the row whose id its leg names as
   * the model config. It is BOTH the header's reading and a control, which is
   * the distinction this field exists to keep: a panel that recognised the
   * model row only by consuming it into the header drew every section except
   * the one a person opened the popover for. Drawn first, because choosing a
   * model is the thing people come here to do.
   *
   * `"boolean"` — an on/off setting (fast mode). It arrives with NO choices,
   * so a panel that only knows how to draw a list of them renders a heading
   * with nothing under it; a toggle on one line is the whole control.
   *
   * `"choice"` — everything else: reasoning effort, permission mode. A list
   * of the adapter's own values, one of them current.
   */
  kind: Schema.Literals(["model", "choice", "boolean"]),
  name: Schema.String,
  description: Schema.NullOr(Schema.String),
  /** The confirmed value. A refused change leaves this where it was. */
  value: Schema.NullOr(Schema.String),
  choices: Schema.Array(
    Schema.Struct({
      value: Schema.String,
      label: Schema.String,
      /** The context window, for a model row. `null` everywhere else. */
      hint: Schema.NullOr(Schema.String),
    }),
  ),
});
export type Setting = typeof Setting.Type;

/**
 * Where one MCP server in this conversation stands.
 *
 * Four standings and they are not interchangeable: `connected` is the AGENT'S
 * own word, `handed` is what the product gave over and the agent has not
 * spoken about, `unattached` quotes what the agent said instead, and `missing`
 * is a server the product could not hand over at all, because its own probe
 * said no. `said` is the agent's own sentence about the server wherever it
 * said one, and on `missing` the probe's, carried WHOLE; `null` when nobody
 * said anything. A server the agent names
 * that nobody handed adds NO row — a panel says "plus the agent's own" rather
 * than inventing one.
 *
 * `missing` is the arm only a product with OPTIONAL servers mints. kolu's
 * Conductor has none: its fleet MCP endpoint not answering refuses the whole
 * conversation (`ConductorUnavailable`), because a conductor that cannot reach
 * the fleet is a chat window, not a degraded conductor.
 *
 * `where` is where the server IS: the absolute file that was probed or would
 * be spawned, or the URL of one reached over http, and `null` for the one
 * failure that never reached a file. `at` is an app address a product's probe
 * named for what the server works on, drawn as a link; absent for a server
 * with nothing to look at.
 */
export const Server = Schema.Struct({
  name: Schema.String,
  standing: Schema.Literals(["connected", "handed", "unattached", "missing"]),
  said: Schema.NullOr(Schema.String),
  where: Schema.NullOr(Schema.String),
  at: Schema.optionalKey(Schema.String),
});
export type Server = typeof Server.Type;

/** The page an agent sent a person to, and how far it got. */
export const SignInLink = Schema.Struct({
  url: Schema.String,
  /** Which machine it goes to — the client computes it where the payload is
   *  read, because the question a person is answering is "who am I about to
   *  hand this to" and a browser's URL parser is not the authority on a
   *  string the agent sent. */
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
 * A SIGN-IN THE CLIENT IS OFFERING OR RUNNING, as its `signIn` event says it.
 *
 * THREE ARMS, and each is a different thing a person can do something about:
 *
 *   - `choosing` — nothing is running and there is a method to pick: one
 *     button per {@link AuthMethod} the agent advertised. It is what `/login`
 *     asks for, and what the client falls into when an agent refuses something
 *     because nobody is signed in.
 *   - `terminal` — a method the CLIENT runs (`runs: "client"`). The row is the
 *     process: its output so far, verbatim and clickable, one input line that
 *     writes to its stdin, and a way out. Exit 0 is the end of it, and anything
 *     else leaves the output on screen AS the failure, because for a CLI
 *     sign-in the output is what a person needs to read.
 *   - `agent` — a method the AGENT runs. There is no process and no stdin:
 *     there is a page ({@link SignInLink}) while the agent waits on it, and
 *     then whatever the agent answers.
 *
 * `why` is the OTHER way an attempt ends — it could not be started, or the
 * agent refused it — and it is a sentence rather than a code because the two
 * arms would otherwise say it in two vocabularies. An arm with `why` set is
 * finished and failed; a `terminal` arm with `running: false` and a `code` is
 * finished and failed for the reason the output says.
 *
 * This is the client's EVENT. What a product DRAWS while it offers or runs one
 * is {@link SigningIn} beside it, and the two are not merged: one is what the
 * agent is doing, the other is what this panel is asking about.
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

/** A terminal the client created for the agent, as far as it has run: its
 *  output (capped, and `truncated` when it was), and how it ended. */
export const TerminalView = Schema.Struct({
  id: Schema.String,
  output: Schema.String,
  truncated: Schema.Boolean,
  exitCode: Schema.NullOr(Schema.Number),
  signal: Schema.NullOr(Schema.String),
  running: Schema.Boolean,
});
export type TerminalView = typeof TerminalView.Type;

/**
 * WHAT THE CONVERSATION IS DOING, in the one word a header chip paints.
 *
 * `asking` outranks `working`: a turn stopped on a form is blocked on a HUMAN,
 * and that is the state the badge counts. `starting` covers the whole of the
 * open — a subprocess, a handshake, and a replay — because the composer is not
 * locked during it and a person who typed needs to know where it went.
 */
export const Phase = Schema.Literals([
  "offline",
  "starting",
  "idle",
  "working",
  "asking",
]);
export type Phase = typeof Phase.Type;

/** The model the conversation is on, named the way the agent names it. A
 *  `window` of `null` is a refusal rather than a failure: the running model
 *  does not always state its context window, and naming one five times the
 *  real size in the line you would read to decide whether to compact is worse
 *  than naming nothing. */
export const Model = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  window: Schema.NullOr(Schema.Int),
});
export type Model = typeof Model.Type;

/** WHO PUT THE SIGN-IN ON SCREEN — the agent, in its own refusal, or a person
 *  who asked for it (a limit reached, the wrong account, a login that went
 *  stale). Two arms rather than an empty sentence for "nobody refused":
 *  which one it is decides whether the row can simply be closed again. */
export const SigningInCause = Schema.Union([
  Schema.Struct({
    kind: Schema.Literal("agent"),
    /** The agent's own refusal, in its own words. */
    why: Schema.String,
  }),
  Schema.Struct({
    kind: Schema.Literal("person"),
    /** What the conversation has to say about signing in here: where the
     *  signature is read from, or that the agent offered no way at all. */
    said: Schema.String,
  }),
]);
export type SigningInCause = typeof SigningInCause.Type;

/**
 * THE SIGN-IN A PANEL DRAWS: why it is on screen, what is on offer, and the
 * attempt in flight.
 *
 * THREE SOURCES AND ONE ROW. The methods are the handshake's; the attempt is
 * the client's, which is the half holding a process and a question
 * ({@link SignIn}); the CAUSE is the conversation's own — a refusal it met, or
 * a person who pressed the button.
 *
 * One sign-in per agent: a second press on the same method ATTACHES to the
 * attempt already running rather than starting a second process.
 */
export const SigningIn = Schema.Struct({
  cause: SigningInCause,
  methods: Schema.Array(AuthMethod),
  attempt: Schema.NullOr(
    Schema.Struct({
      method: Schema.String,
      state: Schema.Literals(["running", "succeeded", "failed"]),
      /** The spawned command's output so far, capped — URLs in it are made
       *  clickable by the panel. */
      output: Schema.String,
      /** How a command this end ran exited, once it has: its own exit code,
       *  or `null` while it runs, when it was signalled, and for a method the
       *  agent runs. A panel that prints the failure says which code it was. */
      code: Schema.NullOr(Schema.Int),
      /** The page an agent-run method sent a person to, as the client said it:
       *  the place, which machine it is, the agent's own message (a device code
       *  rides in it), and whether the agent has said the page is done. */
      link: Schema.NullOr(SignInLink),
    }),
  ),
});
export type SigningIn = typeof SigningIn.Type;

/** Stable within a session, so a frame refines a row rather than duplicating
 *  it; `seq` is the conversation order the panel draws in; `since` is when the
 *  row was minted. */
export const rowHead = {
  id: Schema.String,
  seq: Schema.Int,
  since: Schema.String,
};

/** What a PERSON typed. Never markdown — it is quoted, not rendered. */
export const userRowFields = {
  ...rowHead,
  kind: Schema.Literal("user"),
  text: Schema.String,
  /** At the agent, next in line — this end sent a prompt while a turn of its
   *  own was still in flight. Absent once the agent takes it up; absent rather
   *  than `false`, because the writer only ever writes `true`. */
  queued: Schema.optionalKey(Schema.Literal(true)),
  delivery: Schema.optionalKey(Delivery),
};

/** The agent's prose, accumulated. Rendered as markdown. */
export const agentRowFields = {
  ...rowHead,
  kind: Schema.Literal("agent"),
  text: Schema.String,
  /** Absent rather than `false`: the writer only ever writes `true`, and a
   *  settled row carries no claim about a stream that has ended. */
  streaming: Schema.optionalKey(Schema.Literal(true)),
};

export const toolRowFields = {
  ...rowHead,
  kind: Schema.Literal("tool"),
  /** The agent's own title for the call. */
  text: Schema.String,
  status: ToolStatus,
  /** Folded JSON of the call's input and answer — the generic card's body. */
  detail: Schema.optionalKey(Schema.String),
  /** Live incremental content while the call runs. */
  progress: Schema.optionalKey(Schema.String),
  diffs: Schema.optionalKey(Schema.Array(FileDiff)),
  locations: Schema.optionalKey(Schema.Array(Schema.String)),
  armed: Schema.optionalKey(Armed),
  spawned: Schema.optionalKey(Spawned),
  /** The row of the subagent call this one was made INSIDE, by that row's own
   *  key — what makes a turn with several agents in it readable. */
  parent: Schema.optionalKey(Schema.String),
  /** Its turn ended and it never reported back. Background tasks are the one
   *  call kind exempt: they are SUPPOSED to outlive their turn. */
  stranded: Schema.optionalKey(Schema.Literal(true)),
  /** When the call started running, so a reader's clock and a reloaded tab's
   *  agree on "· 47s" rather than each starting its own stopwatch. */
  startedAt: Schema.optionalKey(Schema.String),
  /** A call that has been round MORE THAN ONCE, and when the current outing
   *  began — a subagent that reported is sent more work, and `since` is the
   *  row's BIRTH and must stay it, so a duration counted from it would say an
   *  agent resumed a minute ago has been out for three hours.
   *
   *  A STAMP, not a flag: absent is a call on its first outing, which is nearly
   *  all of them. */
  resumed: Schema.optionalKey(Schema.String),
};

export const askRowFields = {
  ...rowHead,
  kind: Schema.Literal("ask"),
  text: Schema.String,
  ask: Ask,
  parent: Schema.optionalKey(Schema.String),
};

export const noticeRowFields = {
  ...rowHead,
  kind: Schema.Literal("notice"),
  text: Schema.String,
};
