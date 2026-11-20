import type { AgentPlugin } from "anyagent";
import type { Fetcher } from "kolu-transcript-core";
import { claudeCodePlugin } from "kolu-claude-code";
import { codexPlugin } from "kolu-codex";
import { grokPlugin } from "kolu-grok";
import { ompPlugin } from "kolu-omp";
import { opencodePlugin } from "kolu-opencode";
import { piPlugin } from "kolu-pi";
import { xynePlugin } from "kolu-xyne";
import type { AgentInfoOf, AgentKind } from "./vocab.ts";

export * from "./vocab.ts";

export const AGENT_PLUGINS: {
  [K in AgentKind]: AgentPlugin<unknown, AgentInfoOf<K>, Fetcher>;
} = {
  "claude-code": claudeCodePlugin,
  codex: codexPlugin,
  opencode: opencodePlugin,
  grok: grokPlugin,
  pi: piPlugin,
  omp: ompPlugin,
  xyne: xynePlugin,
};

/** Every agent-detection dir/db override env key, flattened from the plugins. */
export const AGENT_DIR_ENV_KEYS: readonly string[] = Object.values(
  AGENT_PLUGINS,
).flatMap((p) => p.envKeys);

/** The merged subsystem counters every plugin contributes to heap diagnostics. */
export function agentDiagnostics(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const plugin of Object.values(AGENT_PLUGINS)) {
    Object.assign(out, plugin.diagnostics?.() ?? {});
  }
  return out;
}
