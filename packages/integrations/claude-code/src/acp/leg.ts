/**
 * What the Claude Code adapter MEANS by what it sends — kolu's first leg
 * (`@kolu/acp/engine`'s `Leg`).
 *
 * This is the part of the harness that would be wrong if somebody pointed kolu
 * at a different agent: a `_meta` extension one adapter writes, a tool-naming
 * convention one CLI uses, a message one wrapper forwards because we asked it
 * to. The protocol proper is read where it is spoken (`@kolu/acp`); the VALUES
 * that are only true of THIS agent are read here, which is what makes adding a
 * second agent a file rather than a search for the assumptions.
 *
 * Every bet is safe to lose in one direction only, and that is the direction it
 * loses in: an agent that says none of this matches nothing here, and what
 * happens then is that a person is asked. **Nothing is ever approved by failing
 * to recognise it.**
 *
 * Everything is a PURE function over a payload — `@kolu/acp`'s pattern, for the
 * reason that pattern exists: the rule that stops the conductor approving
 * its own permissions is a function with unit tests rather than a branch
 * reachable only by starting a subprocess and talking it into asking. Which
 * side of that package boundary a new reader belongs on is not which payload it
 * reads but WHO has to have sent it: `@kolu/acp` reads the protocol's own
 * shapes, true of any agent — which is why it is a package and this is not —
 * and this is the file that is wrong about a different one.
 *
 * What is NOT here, and cannot be: the things the harness assumes this adapter
 * DOES rather than says — that a `tool_call` is announced before the permission
 * request that references it, and that `session/list` answers by cwd prefix
 * rather than exactly. Those are shapes of the conversation rather than values
 * in a payload, and they are named where they are relied on. The MODEL PICKER's
 * MACHINERY is not here either, and that is a move rather than an omission:
 * every agent puts the model in ACP's own `configOptions`, so READING one is
 * the harness's. What is only true of this adapter — which entry, and the
 * aliases its picker offers for the ids its CLI reports — is {@link ./models.ts},
 * beside this file, and rides over on `Leg.models`.
 */

import {
  allowingOurs,
  type Background,
  type Leg,
  type Meta,
  mcpCallBy,
  type Reported,
  type Spawn,
  type TaskNotice,
} from "@kolu/acp/engine";

import { MODELS } from "./models.ts";

// ── which permissions are answered without asking ──────────────────────

/** The permission mode a session is asked for, in the adapter's own
 *  vocabulary: ACP leaves mode ids to the agent, and this is what the Claude
 *  Code adapter calls the one that stops it asking about tools it has been told
 *  are allowed. The pinned adapter omits this mode under root unless IS_SANDBOX
 *  is set. Selection is optional: a refusal is reported, then opening continues
 *  with {@link allowedWithoutAsking} as the existing permission backstop. */
export const BYPASS_MODE = "bypassPermissions";

/**
 * How this agent spells the tools an MCP server contributes.
 *
 * `mcp__<server>__<tool>` is the Claude Code CLI's own naming, and reading it
 * is a bet on that adapter exactly as {@link toolNameIn} is. An agent that
 * names its MCP tools some other way matches nothing here and every request
 * goes to a person, which is the losing direction this can afford.
 */
export const spelling = (server: string) => `mcp__${server}__`;

/**
 * The option a permission request is answered with WITHOUT asking a person, or
 * `null` when it is a person's to answer.
 *
 * Bypass mode is the design, so a call to one of the MCP servers WE handed this
 * session — kolu's own mediated face, plus whatever else this host's padi
 * handed over — is allowed immediately: those tools are already mediated and
 * already validated, and a click per write is not a permission model. The
 * adapter usually never asks about them at all, having been asked for
 * `bypassPermissions`; this is the path for a session whose bypass request was
 * refused.
 *
 * Everything else is a person's, and THAT direction is the load-bearing one.
 * The adapter maps plan mode's "Ready to code?" onto a permission request whose
 * first allow-flavoured option switches the session to `auto` — so a client
 * that answered every request with the first allow it found was silently saying
 * "yes, and stop asking me" on somebody's behalf, every time. The rule is
 * POSITIVE RECOGNITION: the tool is named, and the name is one of ours, or
 * nothing is bypassed. The rule itself is `allowingOurs`, shared between legs
 * so that the one rule this tree declares un-widenable cannot be widened in one
 * copy of it; what this file contributes is the {@link spelling}.
 */
export const allowedWithoutAsking = allowingOurs(spelling);

// ── which tool a call is ───────────────────────────────────────────────

/**
 * The programmatic name of a tool, out of a `_meta` the Claude Code adapter
 * puts it in.
 *
 * Read out of an agent-specific `_meta` extension because the protocol proper
 * does not carry it where it is needed: a `session/request_permission`
 * describes the call it is about with a DISPLAY title, and "which tool is this"
 * is the question the answer turns on. Every `tool_call` the adapter emits
 * carries the name here, and the adapter emits one before it asks — so the pair
 * is enough.
 *
 * An agent that is not that adapter says nothing here, and nothing here guesses
 * on its behalf: an unknown tool is one a person is asked about.
 */
export const toolNameIn = (meta: Meta): string | null =>
  stringIn(meta, "toolName");

// ── which agent made a call ────────────────────────────────────────────

/**
 * The Agent call a tool call was made INSIDE — by the id of the `Agent`/`Task`
 * call that spawned the subagent — or `null` for a call the main agent made
 * itself.
 *
 * The second thing read out of that `_meta`, and it is there for the same
 * reason the first one is: the protocol proper carries no notion of WHO made a
 * call. Every `tool_call` arrives on one flat feed, so a subagent's `Bash` and
 * the main agent's `Bash` are the same frame with the same shape — and a
 * transcript drawing them in one column is saying something false about the
 * conversation, namely that one agent did all of it.
 *
 * The adapter knows better, and says so: it keeps a registry of the tasks it
 * has seen start, keyed by the subagent's own agent id, and stamps the spawning
 * call's id onto every frame that comes out of one — the streamed `tool_call`,
 * the `tool_call_update` that completes it, the permission request in between.
 *
 * A frame that says nothing here is the main agent's own, which is the losing
 * direction this can afford: an agent that is not that adapter has no subagents
 * as far as this transcript is concerned, and it looks exactly as it did before
 * anything was read.
 */
export const parentToolUseIn = (meta: Meta): string | null =>
  stringIn(meta, "parentToolUseId");

// ── which call STARTED an agent ────────────────────────────────────────

/**
 * What this frame says about an agent this call STARTED, or `null` for a frame
 * that says nothing about one — which is nearly all of them.
 *
 * The other side of {@link parentToolUseIn}, and the half that was missing: the
 * parent stamp says a call CAME OUT of a subagent, which is a thing nothing can
 * say until the subagent has made a call. A spawned agent that is still reading
 * its instructions has made none, so a reader with only that stamp has nothing
 * at all to draw for the agent it is waiting on — a pending row with an
 * ordinary title and no reason to think anybody was sent anywhere.
 *
 * TWO FIELDS, AND ONE OF THEM IS A GATE:
 *
 *   - **the spawn's own flag.** The adapter stamps `subagent: true` beside the
 *     tool name on every frame it builds for an `Agent`/`Task` call
 *     (`claudeCodeMetaFromToolUse`), and that frame is emitted when the tool
 *     use starts — so it arrives at the moment the agent is sent out rather
 *     than at the moment it reports back. The FLAG rather than the tool NAME,
 *     which the same corner also carries: the name is a word one CLI's tool
 *     table happens to use, and the adapter maps two of them onto this one
 *     boolean. Reading the boolean is reading the adapter's own answer instead
 *     of re-deriving it from a list that is somebody else's to extend.
 *   - **the call's own INPUT.** `subagent_type` is a field of the `Agent`
 *     tool's arguments (the SDK's `AgentInput`), so it rides the `rawInput` of
 *     the frame that announces the spawn — the first thing anybody hears about
 *     the agent. It is optional there: a spawn that named no kind has none.
 *
 * WHAT IS DELIBERATELY NOT READ, and this is the important half, because it is
 * the reading a future reader will find in the payload and re-add:
 * `toolResponse.subagentType`. The adapter's `tool_progress` forwarding really
 * does put an Agent call's kind there while the call runs, and reading it looks
 * like free redundancy. It is not free, because `_meta.claudeCode.toolResponse`
 * is not one thing: on the `tool_progress` path the adapter builds it, and on
 * the PostToolUse path it forwards **the tool's own response object, verbatim,
 * for any tool** (`onPostToolUseHook`, which spreads `toolResponse` straight
 * into the `_meta` of a `tool_call_update`). So that field is reachable by
 * anything a session can call — an MCP server kolu never handed this
 * conversation has only to answer with a `subagentType` in its structured
 * output to be drawn as an agent somebody spawned, with a live rail under it.
 * Gating it on the flag would not save it either: the beat frames carry no
 * flag, so a gate makes the read dead.
 *
 * And nothing is lost by dropping it. The kind rides the arguments of the
 * flagged frame that announces the spawn and of the flagged one that refines
 * it, and the transcript holds it sticky from there — so by the time any beat
 * could speak, the answer is already on the row. The only case a beat could
 * have answered alone is a spawn whose arguments never named a kind, and a task
 * with no `subagent_type` in its input has none to report in a beat either.
 *
 * NOTHING IS ACCUMULATED HERE. The input arrives incrementally — the adapter
 * emits the `tool_call` as the tool use starts and refines it with a
 * `tool_call_update` as the arguments finish parsing — and the flag, the kind
 * and the completion land on different frames. So a frame answers about the
 * frame: `{}` is an honest "a spawn, and nobody has said which kind", and an
 * absent `kind` reads as "unchanged" to the one thing that holds a row together
 * across frames, which is the rule every other field on a tool row already
 * follows.
 */
export const spawnedIn = (meta: Meta, input: unknown): Spawn | null => {
  // THE FLAG IS THE ONLY THING THAT OPENS THIS DOOR. Everything below is read
  // off a frame the adapter itself said was an Agent call, and a frame that
  // does not say so is answered `null` however suggestively it is shaped.
  if (claudeIn(meta)?.subagent !== true) return null;
  // ... and then the kind, off the `Agent` tool's own arguments. `rawInput` is
  // the tool's payload rather than the adapter's word, which is exactly why it
  // may not be read on its own: `subagent_type` is a name ONE tool gives one of
  // its arguments, the tools on a session are not a closed set, and an MCP
  // server kolu never handed this conversation is free to take an argument by
  // that name. Requiring the flag costs nothing — the adapter builds both into
  // the same frames (`claudeCodeMetaFromToolUse` rides every announcement and
  // every refinement of an Agent call).
  const args = input as
    | { readonly subagent_type?: unknown; readonly description?: unknown }
    | null
    | undefined;
  const asked = args?.subagent_type;
  // ... and WHAT IT WAS SENT TO DO, out of the same arguments and through the
  // same gate. The `Agent` tool takes a short description beside the prompt,
  // and it is the only thing anywhere that tells one agent of a fan-out from
  // another: the call's TITLE is the tool's name, so four agents dispatched in
  // one message reach a reader as four rows reading `Task`.
  //
  // Read here rather than left to the row's title for the reason the title
  // cannot be moved: it is PINNED at the first frame that carries one,
  // deliberately, so that a call cannot rename itself twice while somebody is
  // reading it.
  const said = args?.description;
  return {
    ...(typeof asked === "string" && asked !== "" ? { kind: asked } : {}),
    ...(typeof said === "string" && said !== "" ? { said } : {}),
  };
};

// ── a task-notification is not a person speaking ───────────────────────

/**
 * WHAT SITS BETWEEN THE FIRST OPENING TAG AND THE LAST CLOSING ONE — a scan
 * rather than a regular expression, and the difference is a cost rather than a
 * meaning.
 *
 * It was `/<result>([\s\S]*)<\/result>/`. A greedy run followed by a literal is
 * the shape a backtracking engine walks quadratically: on a payload that OPENS
 * the tag many times and never closes it, the engine re-tries the tail from
 * every one of them. The text is an agent's own tool result — arbitrarily long,
 * and not ours — so the cost is somebody else's to hand us
 * (`js/polynomial-redos`).
 *
 * Two index scans answer the same question in one pass, and the LAST closing
 * tag is deliberate: a report may quote its own closing tag, and what the
 * harness wrapped is everything up to the outermost one.
 */
const betweenIn = (text: string, open: string, close: string): string => {
  const from = text.indexOf(open);
  if (from === -1) return "";
  const to = text.lastIndexOf(close);
  return to < from + open.length ? "" : text.slice(from + open.length, to);
};

/**
 * Whether this user-message text is a harness-injected task-notification, and
 * if so the spawning call it belongs to and the report it carries.
 *
 * TWO DOORS, and they are the adapter patch's two doors:
 *
 *   - **`origin.kind: "task-notification"`** — the discriminator the session
 *     JSONL already stamps. No ACP `user_message_chunk` carries it (the pin's
 *     `toAcpNotifications` stamps `messageId` / `parentToolUseId` and nothing
 *     else); a leftover chunk that has it was a fixture. A patched pin never
 *     forwards the chunk at all.
 *   - **the `<task-notification>` wrapper**, only when origin is **missing**,
 *     and only when the trimmed payload starts and ends with the tags — a
 *     replay of an older store, or a leftover the adapter forwarded without
 *     origin. Origin present and not a task-notification is a person speaking,
 *     even if they pasted the XML (the pin stamps every prompt
 *     `origin: { kind: "human" }`).
 *
 * A payload that is neither is `null`, which is a person speaking. A payload
 * that is one but names no spawning call or no task is still a notification
 * (`onto: null`): it must not become a user bubble, and it has no row to file
 * the report under.
 */
export const taskNotificationIn = (
  text: string,
  meta: Meta,
): TaskNotice | null => {
  const kind = wordIn(fieldIn(claudeIn(meta), "origin"), "kind");
  const xml = text.trim();
  const wrapped =
    xml.startsWith("<task-notification>") &&
    xml.endsWith("</task-notification>");
  if (kind !== "task-notification" && !(kind === null && wrapped)) return null;
  const toolUseId = (
    xml.match(/<tool-use-id>([^<]*)<\/tool-use-id>/u)?.[1] ?? ""
  ).trim();
  const task = (xml.match(/<task-id>([^<]*)<\/task-id>/u)?.[1] ?? "").trim();
  const report = betweenIn(xml, "<result>", "</result>");
  return toolUseId === "" || task === ""
    ? { onto: null }
    : { onto: { toolUseId, task, report } };
};

// ── which call ARMED A BACKGROUND TASK ─────────────────────────────────

/**
 * What this frame says about a background task this call armed, or `null` for a
 * frame that says nothing about one — which is nearly every frame.
 *
 * THE THIRD READING of that same `_meta` corner, and the one that is not in the
 * adapter as it ships: `_meta.claudeCode.backgroundTask` is written by the
 * patch kolu carries on its pin (`../../acp/patches/`). Without it the wire
 * says a `Monitor` COMPLETED at the instant it started — the acknowledgement
 * read as the result — so an armed watch and a finished one are the same row,
 * and the death that a person supervising off a monitor must not miss is on no
 * frame at all.
 *
 * ONE FIELD, READ WHOLE. Unlike {@link spawnedIn} there is no gate-plus-input
 * pair to assemble here, and that is the point of reading this corner rather
 * than the tool's own answer: `taskId` is a name the `Monitor` tool gives one
 * of ITS results and `backgroundTaskId` is what `Bash` gives one of its own, so
 * a reader that trusted either off a `rawOutput` would arm a live face on any
 * MCP server that answered with a field by that name. The adapter is the thing
 * that knows a task was registered, and this reads its answer.
 *
 * WHAT EACH FRAME SAYS is deliberately partial, and the union of them is never
 * assembled here: the arming frame names the task, its kind and the description
 * it was armed with; the settling frame names the task and how it ENDED. A
 * frame answers about itself, an absent field reads as "unchanged", and the
 * harness's transcript is what holds the row together — which is the rule every
 * other field on a tool row already follows.
 *
 * An agent that is not this adapter says nothing here and gets nothing: its
 * background work is drawn exactly as it was, as a call that completed at the
 * moment it started, which is the losing direction this bet is safe in.
 */
export const backgroundTaskIn = (meta: Meta): Background | null => {
  const said = claudeIn(meta)?.backgroundTask;
  if (typeof said !== "object" || said === null) return null;
  const task = said as { readonly [field: string]: unknown };
  const id = wordIn(task, "taskId");
  // NO TASK ID, NO TASK. The id is the one field every frame about a task
  // carries, and a row that armed something nobody can name is not a fact worth
  // drawing a live face out of.
  if (id === null) return null;
  const description = wordIn(task, "description");
  // HOW IT ENDED, in the harness's own word — `completed`, `failed`, `killed`,
  // `stopped`. ACP folds the last three into one status, and a monitor somebody
  // STOPPED is not a monitor that failed, so the word travels beside the status
  // rather than being re-derived from it.
  const ended = wordIn(task, "status");
  // THE REPORT, the other half of a task-notification. The harness's summary is
  // `ended`'s sentence; this is the subagent's own prose, filed on the same
  // stamp rather than on a second `_meta` field the rest of this vocabulary
  // does not have.
  const report = wordIn(task, "report");
  return {
    task: id,
    ...(description === null ? {} : { description }),
    ...(ended === null ? {} : { ended }),
    ...(report === null ? {} : { report }),
  };
};

/*
 * What is deliberately NOT read off a background task, for the reason nothing
 * else here is read without a reader: **`taskType`**, the harness's own kind.
 * It is on the frame — the patch stamps what `task_started` said — and it says
 * `local_bash` for a `Monitor` and for a background shell alike, so it cannot
 * tell a person which kind of thing is out. What can is the DESCRIPTION, which
 * is what a person armed the task with. A field carried onto a row that nothing
 * draws is a field that is wrong the first time somebody draws it.
 */

/*
 * What is deliberately NOT read off a spawn, and why, because the next person
 * to open this file will find it in the payload and wonder:
 *
 *   - **`toolResponse.elapsedTimeSeconds`**, which the heartbeat carries. It is
 *     the agent's own clock and it is honest, but it only moves when a beat
 *     arrives — so a subagent that has actually WEDGED reports the age it had
 *     at its last beat, forever. A number that under-states how long something
 *     has been stuck is worse in exactly the direction a person consults it
 *     for, and the transcript already says the true thing (it is running, and
 *     here is every call it has made) without one.
 *   - **`toolResponse.subagentRetry`**, the SDK's rate-limit retry counters,
 *     forwarded so a client can say why a spawn looks stalled. Worth drawing
 *     one day; it is a shape nothing in this repo has ever seen arrive, and a
 *     row that renders a payload nobody has observed is a row that is wrong the
 *     first time it is right.
 *   - **the subagent's own PROSE while it runs**. The adapter strips a
 *     subagent's text and thinking blocks from the feed unless the client
 *     declares `subagent-transcript` in its `initialize` capabilities
 *     (`supportsSubagentTranscript`) — so kolu, which does not, cannot receive
 *     it and cannot have it leak into the main agent's voice either. Drawing a
 *     subagent's narration is a feature with a switch to throw, not a `_meta`
 *     to read, and it is not this one. The REPORT it hands back at the end
 *     rides {@link backgroundTaskIn}'s `report` — the task's own stamp — not a
 *     second field.
 */

/** One OBJECT-valued field of an object, or `undefined` for anything else — a
 *  missing field, a field of some other type, a value that is not an object at
 *  all.
 *
 *  The whole of the narrowing every reader in this file does, written once:
 *  everything read here is nested somewhere inside somebody else's payload, and
 *  each level of the nesting is a place a shape can change under us. `_meta`,
 *  `claudeCode` and a task-notification's `origin` are all the same step. */
const fieldIn = (
  value: unknown,
  field: string,
): { readonly [key: string]: unknown } | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const found = (value as { readonly [key: string]: unknown })[field];
  return typeof found === "object" && found !== null
    ? (found as { readonly [key: string]: unknown })
    : undefined;
};

/** The adapter's own corner of a `_meta`, or `undefined` when there is none —
 *  an absent `_meta`, an absent `claudeCode`, one that is not an object. Every
 *  reader here starts by asking for it, and it is {@link fieldIn} under the one
 *  name this file reads everything out of. */
const claudeIn = (meta: Meta) => fieldIn(meta, "claudeCode");

/** One field of that corner, when it is a non-empty string and `null` for
 *  everything else — a field of some other type, the empty string. The two
 *  fields read through it are independent of each other, and a frame carries
 *  either, both or neither: a subagent's terminal output arrives with a
 *  `claudeCode` holding only the parent, and a plan exit's with only the
 *  name. */
const stringIn = (meta: Meta, field: string): string | null =>
  wordIn(claudeIn(meta), field);

/** ... over any record, which is the half {@link backgroundTaskIn} needs: its
 *  fields are a level deeper than the corner above, and re-spelling the
 *  narrowing there made it the fourth copy of a rule this file already names. */
const wordIn = (
  said: { readonly [field: string]: unknown } | undefined,
  field: string,
): string | null => {
  const value = said?.[field];
  return typeof value === "string" && value !== "" ? value : null;
};

// ── which model a turn is running on ───────────────────────────────────

/** What OPENING a session asks the Claude Code adapter to forward, and why: the
 *  adapter handles a `/model` slash command inside the wrapped CLI, so it never
 *  sees a config change and its `configOptions` keep naming the model the
 *  session started on. The CLI's own `system`/`init` message carries the live
 *  one. An agent that is not that adapter ignores `_meta` and nothing changes —
 *  the config option is still read, and still enough.
 *
 *  Sent with `session/load` as well as `session/new`, and that is not
 *  belt-and-braces: the adapter reads this off the `_meta` of whichever call
 *  made the session, and a load makes one (`loadSession` hands its own `_meta`
 *  to `createSession`, defaulting the flag to false). Asked only at `new`, the
 *  running model would go unreported for the life of every RESTORED
 *  conversation — which is every conversation after a restart. */
export const OPEN_SESSION_META = {
  claudeCode: {
    emitRawSDKMessages: [{ type: "system", subtype: "init" }],
  },
};

/** The notification the Claude Code adapter forwards its wrapped CLI's own
 *  messages under, having been asked to by {@link OPEN_SESSION_META}. */
export const SDK_MESSAGE = "_claude/sdkMessage";

/**
 * The model a turn is actually running on, out of the CLI message the adapter
 * forwarded.
 *
 * TWO fields of one message kind are read, and this is one of them
 * ({@link liveServersIn} is the other). Everything else `init` carries — the
 * tool list, the permission mode, the slash commands, the CLI version — is
 * learned from the protocol proper or not at all, because a reader that
 * believed a wrapped CLI's private message about any of it would be reading
 * around the protocol it speaks.
 */
export const liveModelIn = (params: unknown): string | null => {
  const model = initIn(params)?.model;
  return typeof model === "string" && model !== "" ? model : null;
};

/**
 * ... and what the CLI says about its connection to each MCP server of this
 * conversation.
 *
 * THE SECOND FIELD READ HERE, and it needs its own paragraph because the rule
 * above says why there is not a third: everything the protocol carries is read
 * where the protocol is spoken, and this is the one thing on `init` the
 * protocol has no place for at all. ACP's `session/new` takes `mcpServers` and
 * answers with a session id — whether the agent reached any of them is never on
 * the wire — so kolu could report only the failures its own probe found BEFORE
 * handing anything over. This is the other half arriving, from the one agent
 * that volunteers it.
 *
 * The MODEL is why the subscription exists and the SERVERS ride it: the adapter
 * forwards `system`/`init` because {@link OPEN_SESSION_META} asked for that
 * message and no other, and it carries both. So this costs one more read of a
 * message already being read, on a channel already open, and an agent that
 * stops sending the field answers `null` — which leaves every row exactly where
 * the client put it.
 *
 * `mcp_servers` is `{ name, status }[]` on the SDK's own `SDKSystemMessage`,
 * where `status` is typed as a bare `string`: an OPEN SET, whose members today
 * are `connected`, `failed`, `needs-auth`, `pending` and `disabled`. WHICH OF
 * THEM MEANS YES is decided here and nowhere else ({@link CONNECTED}), because
 * it is a fact about this CLI in exactly the way `mcp__<server>__` is: read one
 * layer up, one adapter's vocabulary would be the leg-neutral roster's, and the
 * next agent to report per-server status would have to spell its own words this
 * one's way. The WORD ITSELF travels beside the verdict, so a person reads
 * `needs-auth` rather than a category this file would have to keep in step with
 * somebody else's releases.
 *
 * ENTRIES ARE DROPPED, NEVER REPAIRED. A row without a name is a row about
 * nothing, and a row without a status word is one with nothing to say — either
 * one coerced into a default would be this file inventing the fact it exists to
 * report. Dropped, they leave the roster row at `handed`, which is what it
 * already says.
 */
export const liveServersIn = (
  params: unknown,
): ReadonlyArray<Reported> | null => {
  const servers = initIn(params)?.mcp_servers;
  if (!Array.isArray(servers)) return null;
  return servers.flatMap((entry): ReadonlyArray<Reported> => {
    const shape = entry as {
      readonly name?: unknown;
      readonly status?: unknown;
    } | null;
    const name = shape?.name;
    const said = shape?.status;
    return typeof name === "string" &&
      name !== "" &&
      typeof said === "string" &&
      said !== ""
      ? [{ name, attached: said === CONNECTED, said }]
      : [];
  });
};

/** The one word this CLI's `init` uses for a server it has. Matched POSITIVELY
 *  and never widened: every other word it could send — a failure, a
 *  `needs-auth`, one no version has emitted yet — is read as "not attached",
 *  which is the direction this bet is safe to lose in. A tick over tools that
 *  are not there is the direction it may not. */
const CONNECTED = "connected";

/** The CLI's own `system`/`init` out of a forwarded message, or `undefined` for
 *  any other message — the adapter forwards what it was asked for and nothing
 *  says a future version will not be asked for more. Both readers above start
 *  by asking for it, so the shape test is written once: two copies of "is this
 *  the init message" is one place for a subtype to be checked and another for
 *  it to be forgotten. */
const initIn = (
  params: unknown,
): { readonly [key: string]: unknown } | undefined => {
  const message = (params as { readonly message?: unknown } | null)?.message;
  if (typeof message !== "object" || message === null) return undefined;
  const shape = message as { readonly [key: string]: unknown };
  if (shape.type !== "system" || shape.subtype !== "init") return undefined;
  return shape;
};

// ── the first title a call carries is not its name ─────────────────────

/**
 * Whether a frame's title is the adapter's PLACEHOLDER rather than the call's
 * name — true for the announcement it writes before the model's arguments have
 * parsed, false for everything after it.
 *
 * THE SHAPE: the adapter announces a tool call on the SDK's
 * `content_block_start` (`acp-agent.js`), when all it has is that a tool use
 * has begun, so the frame carries `rawInput: {}` — an input object with nothing
 * in it, which is a different claim from an absent one — and a title derived
 * from no arguments, which for the shell tool is the bare word "Terminal"
 * (`tools.js`).
 *
 * BOTH FIELDS, not either: the frame kind alone would call an UPDATE carrying
 * no arguments provisional, and the empty object alone would be read off frames
 * that are not announcements. A call whose arguments really are empty is
 * announced and refined with the same title, so nothing moves.
 */
export const provisionalTitleIn = (update: unknown): boolean => {
  const frame = record(update);
  if (frame?.sessionUpdate !== "tool_call") return false;
  const input = record(frame.rawInput);
  return input !== undefined && Object.keys(input).length === 0;
};

/** An object that is not an array, or `undefined` — the narrowing the two
 *  readers below do before they index anything. */
const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * The branded refusal a `@kolu/surface-mcp` tool answers with, decoded out of
 * the TEXT it arrived as.
 *
 * Here rather than imported because of what the import would cost: this package
 * is an ACP integration and takes `@kolu/acp/engine` and nothing else, and the
 * brand is one line of wire format rather than a behaviour. It is read here at
 * all because the Claude SDK drops `structuredContent` — only MCP text blocks
 * survive into `rawOutput` — so a refusal from kolu's own MCP face reaches this
 * leg as prose or not at all, and a kind and a reason a person can act on are
 * exactly what a refusal is for.
 *
 * An unbranded, truncated or foreign message is `undefined`: a tool that said
 * something else said something else.
 */
const refusalIn = (
  text: string,
): { kind: string; reason: string } | undefined => {
  const refusal =
    /^surface-mcp: `[^`]+` was refused \((usage|not-found|validation|busy)\): ([\s\S]+)$/.exec(
      text,
    );
  return refusal
    ? { kind: refusal[1] ?? "", reason: refusal[2] ?? "" }
    : undefined;
};

/**
 * The structured reply an MCP call answered with, out of what this adapter
 * forwards as `rawOutput`.
 *
 * The SDK emits `tool_result.content` as either a string or content blocks, and
 * the pinned adapter forwards that value unchanged — so the JSON a tool put in
 * its first text block is the reply, and anything that is not an object once
 * parsed is not one.
 */
export const replyIn = (
  rawOutput: unknown,
): Record<string, unknown> | undefined => {
  const text =
    typeof rawOutput === "string"
      ? rawOutput
      : Array.isArray(rawOutput)
        ? rawOutput.find((block) => record(block)?.type === "text")?.text
        : undefined;
  if (typeof text !== "string") return undefined;
  try {
    return record(JSON.parse(text));
  } catch {
    // Claude forwards only MCP text blocks, dropping `structuredContent`. The
    // owned MCP server's branded refusal still carries its kind and reason.
    return refusalIn(text);
  }
};

// ── the leg ────────────────────────────────────────────────────────────

/**
 * Everything above, as the one shape `@kolu/acp-harness` talks to.
 *
 * A VALUE assembled at the bottom rather than a class or a namespace, because
 * every member is already a pure function or a constant and this is the list of
 * them: a reader comparing two agents reads two of these side by side and sees
 * exactly where they differ.
 *
 * `toolNameOf` takes the call id and ignores it. That is not an accident of the
 * interface: the adapter says the name in its own `_meta`, and reading the id
 * as well would be a second answer to a question that already has one — and the
 * ONE that could be wrong, since a Claude call id is an opaque `toolu_…`.
 */
export const CLAUDE: Leg = {
  spelling,
  mcpCall: mcpCallBy(spelling),
  replyIn,
  toolNameIn,
  // Nothing: a Claude call id is an opaque `toolu_…` and says nothing about the
  // tool. Reading it would answer for a call nothing has named, which is the
  // one direction this file may not fail in.
  toolNameOf: () => null,
  allowedWithoutAsking,
  parentToolUse: parentToolUseIn,
  spawned: spawnedIn,
  backgroundTask: backgroundTaskIn,
  taskNotification: taskNotificationIn,
  // No doubling on this wire: the adapter's `session/new` answers with a
  // session id and `configOptions` and never announces a chunk in advance.
  prologueIn: () => null,
  bypassMode: BYPASS_MODE,
  // ... and a refusal of it is NOT fatal. The pinned adapter omits this mode
  // under root unless IS_SANDBOX is set, and a host that cannot have it is a
  // host whose conductor still works: the refusal is reported, the adapter's
  // own default mode stands, and `allowedWithoutAsking` is the backstop that
  // was always underneath it.
  bypassModeRequired: false,
  // The three questions this panel never asks. They are on `Leg` because
  // `@kolu/acp` is a SHARED vocabulary — olai's own panel steers, promises a
  // queue and draws the session list — and the honest nothing is what a leg
  // owes a question its harness never puts: any answer here would be a 0.81.2
  // `_meta` spelling re-verified at every adapter bump for no reader at all.
  steering: null,
  queues: () => false,
  listedIn: () => null,
  rawMessages: {
    openMeta: OPEN_SESSION_META,
    method: SDK_MESSAGE,
    modelIn: liveModelIn,
    serversIn: liveServersIn,
  },
  // ... and the title the announcement carries is not the call's name yet
  // ({@link provisionalTitleIn}).
  provisionalTitle: provisionalTitleIn,
  // The alias tiers and the picker id, which are this adapter's two bets about
  // models ({@link ./models.ts}).
  models: MODELS,
};
