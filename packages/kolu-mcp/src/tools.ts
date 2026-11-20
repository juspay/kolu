import type { BespokeTool } from "@kolu/surface-mcp/tools";
import { createTool } from "./create.ts";
import { agentSayTool } from "./say.ts";
import { screenImageTool } from "./screenImage.ts";
import { screenTextTool } from "./screenText.ts";
import { sendInputTool } from "./sendInput.ts";
import { waitAgentStateTool, waitOutputSettledTool } from "./wait.ts";
import { watchNextTool } from "./watchNext.ts";
import { watchOpenTool } from "./watchOpen.ts";

export const KOLU_MCP_TOOLS: Record<string, BespokeTool> = {
  lifecycle_create: createTool,
  lifecycle_sendInput: sendInputTool,
  agent_say: agentSayTool,
  screen_text: screenTextTool,
  screen_image: screenImageTool,
  wait_outputSettled: waitOutputSettledTool,
  wait_agentState: waitAgentStateTool,
  watch_open: watchOpenTool,
  watch_next: watchNextTool,
};
