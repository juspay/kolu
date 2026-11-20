import {
  allowingOurs,
  type Background,
  type Leg,
  type ListedFacts,
  type Meta,
  mcpCallBy,
  type Reported,
  type Spawn,
  type TaskNotice,
} from "@kolu/acp/engine";

import { MODELS } from "./models.ts";

export const BYPASS_MODE = "bypassPermissions";

/**
 * How this agent spells the tools an MCP server contributes.
 *
 * `mcp__<server>__<tool>` is the Claude Code CLI's own naming. An agent that
 * names its MCP tools some other way matches nothing here and every request
 * goes to a person, which is the losing direction this can afford.
 */
export const spelling = (server: string) => `mcp__${server}__`;

/**
 * The option a permission request is answered with WITHOUT asking a person, or
 * `null` when it is a person's to answer.
 *
 * Everything else is a person's, and THAT direction is the load-bearing one.
 * The adapter maps plan mode's "Ready to code?" onto a permission request whose
 * first allow-flavoured option switches the session to `auto` — so a client
 * that answered every request with the first allow it found was silently saying
 * "yes, and stop asking me" on somebody's behalf, every time. The rule is
 * POSITIVE RECOGNITION: the tool is named, and the name is one of ours, or
 * nothing is bypassed.
 */
export const allowedWithoutAsking = allowingOurs(spelling);

export const toolNameIn = (meta: Meta): string | null =>
  stringIn(meta, "toolName");

const ASK_USER_QUESTION = "AskUserQuestion";

export const asksThroughForm = (toolName: string): boolean =>
  toolName === ASK_USER_QUESTION;

export const parentToolUseIn = (meta: Meta): string | null =>
  stringIn(meta, "parentToolUseId");

/**
 * What this frame says about an agent this call STARTED, or `null` for a frame
 * that says nothing about one.
 *
 * WHAT IS DELIBERATELY NOT READ, and this is the important half, because it is
 * the reading a future reader will find in the payload and re-add:
 * `toolResponse.subagentType`. `_meta.claudeCode.toolResponse` is not one
 * thing: on the `tool_progress` path the adapter builds it, and on the
 * PostToolUse path it forwards **the tool's own response object, verbatim, for
 * any tool** (`onPostToolUseHook`). So that field is reachable by anything a
 * session can call — an MCP server kolu never handed this conversation has only
 * to answer with a `subagentType` in its structured output to be drawn as an
 * agent somebody spawned.
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
  // that name.
  const args = input as
    | { readonly subagent_type?: unknown; readonly description?: unknown }
    | null
    | undefined;
  const asked = args?.subagent_type;
  const said = args?.description;
  return {
    ...(typeof asked === "string" && asked !== "" ? { kind: asked } : {}),
    ...(typeof said === "string" && said !== "" ? { said } : {}),
  };
};

const betweenIn = (text: string, open: string, close: string): string => {
  const from = text.indexOf(open);
  if (from === -1) return "";
  const to = text.lastIndexOf(close);
  return to < from + open.length ? "" : text.slice(from + open.length, to);
};

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

export const backgroundTaskIn = (meta: Meta): Background | null => {
  const said = claudeIn(meta)?.backgroundTask;
  if (typeof said !== "object" || said === null) return null;
  const task = said as { readonly [field: string]: unknown };
  const id = wordIn(task, "taskId");
  if (id === null) return null;
  const description = wordIn(task, "description");
  const ended = wordIn(task, "status");
  const report = wordIn(task, "report");
  return {
    task: id,
    ...(description === null ? {} : { description }),
    ...(ended === null ? {} : { ended }),
    ...(report === null ? {} : { report }),
  };
};

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

const claudeIn = (meta: Meta) => fieldIn(meta, "claudeCode");

const stringIn = (meta: Meta, field: string): string | null =>
  wordIn(claudeIn(meta), field);

const wordIn = (
  said: { readonly [field: string]: unknown } | undefined,
  field: string,
): string | null => {
  const value = said?.[field];
  return typeof value === "string" && value !== "" ? value : null;
};

export const listedIn = (meta: Meta): ListedFacts | null => {
  const said = claudeIn(meta);
  const supersededBy = wordIn(said, "supersededBy");
  const count = said?.["messageCount"];
  const messageCount =
    typeof count === "number" && Number.isInteger(count) && count >= 0
      ? count
      : null;
  return messageCount === null && supersededBy === null
    ? null
    : { messageCount, supersededBy };
};

export const OPEN_SESSION_META = {
  claudeCode: {
    emitRawSDKMessages: [{ type: "system", subtype: "init" }],
  },
};

export const SDK_MESSAGE = "_claude/sdkMessage";

export const liveModelIn = (params: unknown): string | null => {
  const model = initIn(params)?.model;
  return typeof model === "string" && model !== "" ? model : null;
};

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

const initIn = (
  params: unknown,
): { readonly [key: string]: unknown } | undefined => {
  const message = (params as { readonly message?: unknown } | null)?.message;
  if (typeof message !== "object" || message === null) return undefined;
  const shape = message as { readonly [key: string]: unknown };
  if (shape.type !== "system" || shape.subtype !== "init") return undefined;
  return shape;
};

export const provisionalTitleIn = (update: unknown): boolean => {
  const frame = record(update);
  if (frame?.sessionUpdate !== "tool_call") return false;
  const input = record(frame.rawInput);
  return input !== undefined && Object.keys(input).length === 0;
};

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

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

export const QUEUES_WHEN_BUSY = (initialized: unknown): boolean =>
  claudeIn(fieldIn(fieldIn(initialized, "agentCapabilities"), "_meta"))?.[
    "promptQueueing"
  ] === true;

export const STEER_METHOD = "_session/steering";

export const STEERING_ADVERTISED = (initialized: unknown): boolean =>
  (
    fieldIn(initialized, "_meta")?.["steering"] as
      | { readonly supported?: unknown }
      | undefined
  )?.supported === true;

export const STEER_WHEN_IDLE = {
  steering: { idleBehavior: "promptRequired" },
};

export const STEER_TIMEOUT = "30 seconds";

export const steerTaken = (answered: unknown): boolean =>
  (answered as { readonly outcome?: unknown } | null | undefined)?.outcome ===
  "injected";

/**
 * THE ERROR KINDS THAT ARE ABOUT THE ACCOUNT, as the pinned adapter forwards
 * them. A turn the Claude SDK classifies as failed carries a categorical
 * `error` on its assistant message, and adapter 0.81.2 rejects the prompt with
 * `data: { errorKind }` (its own words: "sparing them from pattern-matching
 * on text"). These are the kinds a different signature can change: the
 * account cannot sign in or is not allowed, has no billing or is on hold, or
 * has hit its usage limit — which the SDK reports as `rate_limit`, the same
 * kind as a passing rate limit. Signing in is offered beside it, not forced:
 * waiting is the other remedy, and the person reading the limit knows which.
 */
const ACCOUNT_ERROR_KINDS: ReadonlySet<string> = new Set([
  "authentication_failed",
  "oauth_org_not_allowed",
  "billing_error",
  "account_on_hold",
  "rate_limit",
]);

export const accountRefusalIn = (data: unknown): boolean => {
  if (typeof data !== "object" || data === null || !("errorKind" in data))
    return false;
  return (
    typeof data.errorKind === "string" &&
    ACCOUNT_ERROR_KINDS.has(data.errorKind)
  );
};

export const CLAUDE: Leg = {
  spelling,
  mcpCall: mcpCallBy(spelling),
  replyIn,
  accountRefusal: accountRefusalIn,
  toolNameIn,
  toolNameOf: () => null,
  asksThroughForm,
  allowedWithoutAsking,
  parentToolUse: parentToolUseIn,
  spawned: spawnedIn,
  backgroundTask: backgroundTaskIn,
  taskNotification: taskNotificationIn,
  prologueIn: () => null,
  bypassMode: BYPASS_MODE,
  bypassModeRequired: false,
  steering: {
    method: STEER_METHOD,
    meta: STEER_WHEN_IDLE,
    timeout: STEER_TIMEOUT,
    taken: steerTaken,
    advertised: STEERING_ADVERTISED,
  },
  queues: QUEUES_WHEN_BUSY,
  listedIn,
  terminalOutput: true,
  rawMessages: {
    openMeta: OPEN_SESSION_META,
    method: SDK_MESSAGE,
    modelIn: liveModelIn,
    serversIn: liveServersIn,
  },
  provisionalTitle: provisionalTitleIn,
  models: MODELS,
};
