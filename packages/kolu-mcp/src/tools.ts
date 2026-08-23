/**
 * The kolu MCP face's bespoke TOOL TABLE — the worktree-capable create, the
 * named-key send, the tail-mode snapshot, the two composite wait done-signals,
 * and the standing-subscription open (resolves ignoreSelf) and drain.
 *
 * Its own leaf, NOT part of `serve.ts`, because this record is read by TWO
 * faces and only one of them is MCP's: `@kolu/surface-cli`'s projection takes
 * the same table verbatim (`surfaceCommands.verbs`) for the `kolu surface`
 * face. `serve.ts` transitively loads the MCP SDK server classes — fine for
 * `kolu mcp`'s own dynamic-import fence, wrong for a COMMAND TREE, which every
 * `kolu` invocation builds. The eight tool modules below import their plumbing
 * (`BespokeTool` · `ToolFailure` · `okImage` · `messageOf`) from
 * `@kolu/surface-mcp/tools` — the SDK-FREE shard — and this leaf is what makes
 * that shard's effect statable here: reading the table loads schemas, not a
 * server.
 *
 * The table is named HERE, once, so serve and the pins read one registry.
 */

import type { BespokeTool } from "@kolu/surface-mcp/tools";
import { createTool } from "./create.ts";
import { screenImageTool } from "./screenImage.ts";
import { screenTextTool } from "./screenText.ts";
import { sendInputTool } from "./sendInput.ts";
import { waitAgentStateTool, waitOutputSettledTool } from "./wait.ts";
import { watchNextTool } from "./watchNext.ts";
import { watchOpenTool } from "./watchOpen.ts";

export const KOLU_MCP_TOOLS: Record<string, BespokeTool> = {
  lifecycle_create: createTool,
  lifecycle_sendInput: sendInputTool,
  screen_text: screenTextTool,
  screen_image: screenImageTool,
  wait_outputSettled: waitOutputSettledTool,
  wait_agentState: waitAgentStateTool,
  watch_open: watchOpenTool,
  watch_next: watchNextTool,
};
