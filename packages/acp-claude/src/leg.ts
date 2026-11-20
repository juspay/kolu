import {
  allowingOurs,
  type Background,
  type Leg,
  type ListedFacts,
  type Meta,
  mcpCallBy,
  type Reported,
  type Spawn,
  type Steering,
  type TaskNotice,
} from "@kolu/acp/engine";

import { MODELS } from "./models.ts";

export const BYPASS_MODE = "bypassPermissions";

/**
 * How this agent spells the tools an MCP server contributes:
 * `mcp__<server>__<tool>` is the Claude Code CLI's own naming, and an agent
 * that names its MCP tools some other way matches nothing here.
 */
export const spelling = (server: string) => `mcp__${server}__`;

/**
 * The option a permission request is answered with WITHOUT asking a person, or
 * `null` when it is a person's to answer.
 *
 * The adapter maps plan mode's "Ready to code?" onto a permission request
 * whose first allow-flavoured option switches the session to `auto`, so the
 * first allow in a request's list is not a safe pick.
 */
export const allowedWithoutAsking = allowingOurs(spelling);

export const toolNameIn = (meta: Meta): string | null =>
  stringIn(meta, "toolName");

const ASK_USER_QUESTION = "AskUserQuestion";

export const asksThroughForm = (toolName: string): boolean =>
  toolName === ASK_USER_QUESTION;

export const parentToolUseIn = (meta: Meta): string | null =>
  stringIn(meta, "parentToolUseId");

type AgentToolInput = {
  readonly subagent_type?: unknown;
  readonly description?: unknown;
};

export const spawnedIn = (meta: Meta, input: unknown): Spawn | null => {
  if (claudeIn(meta)?.subagent !== true) return null;
  const args = input as AgentToolInput | null | undefined;
  const asked = args?.subagent_type;
  const said = args?.description;
  return {
    ...(typeof asked === "string" && asked !== "" ? { kind: asked } : {}),
    ...(typeof said === "string" && said !== "" ? { said } : {}),
  };
};

const betweenOutermost = (
  text: string,
  open: string,
  close: string,
): string => {
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
  const report = betweenOutermost(xml, "<result>", "</result>");
  return toolUseId === "" || task === ""
    ? { onto: null }
    : { onto: { toolUseId, task, report } };
};

type PatchedBackgroundTask = { readonly [field: string]: unknown };

export const backgroundTaskIn = (meta: Meta): Background | null => {
  const said = claudeIn(meta)?.backgroundTask;
  const stamped =
    typeof said === "object" && said !== null
      ? (said as PatchedBackgroundTask)
      : undefined;
  const id = wordIn(stamped, "taskId");
  if (id === null) return null;
  const description = wordIn(stamped, "description");
  const ended = wordIn(stamped, "status");
  const report = wordIn(stamped, "report");
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

/** The one word this CLI's `init` uses for a server it has. The SDK types
 *  `mcp_servers[].status` as a bare `string` (an open set: failures,
 *  `needs-auth`, words no version has emitted yet), so the match is positive
 *  and every other word reads as not attached. */
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

type ToolCallFrame = {
  readonly sessionUpdate?: unknown;
  readonly rawInput?: unknown;
};

export const announcedBeforeArgumentsIn = (update: unknown): boolean => {
  const frame = record(update) as ToolCallFrame | undefined;
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
    return refusalIn(text);
  }
};

export const QUEUES_WHEN_BUSY = (initialized: unknown): boolean =>
  claudeIn(fieldIn(fieldIn(initialized, "agentCapabilities"), "_meta"))?.[
    "promptQueueing"
  ] === true;

export const STEERING: Steering = {
  method: "_session/steering",
  meta: { steering: { idleBehavior: "promptRequired" } },
  timeout: "30 seconds",
  taken: (answered: unknown): boolean =>
    (answered as { readonly outcome?: unknown } | null | undefined)?.outcome ===
    "injected",
  advertised: (initialized: unknown): boolean =>
    (
      fieldIn(initialized, "_meta")?.["steering"] as
        | { readonly supported?: unknown }
        | undefined
    )?.supported === true,
};

/**
 * THE ERROR KINDS THAT ARE ABOUT THE ACCOUNT, as the pinned adapter forwards
 * them: adapter 0.81.2 rejects a failed prompt with `data: { errorKind }`, and
 * a usage limit arrives as `rate_limit` — the same kind as a passing one.
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
  steering: STEERING,
  queues: QUEUES_WHEN_BUSY,
  listedIn,
  terminalOutput: true,
  rawMessages: {
    openMeta: OPEN_SESSION_META,
    method: SDK_MESSAGE,
    modelIn: liveModelIn,
    serversIn: liveServersIn,
  },
  provisionalTitle: announcedBeforeArgumentsIn,
  models: MODELS,
};
