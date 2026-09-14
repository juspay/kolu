/** The agent registry — node half.
 *
 *  `./vocab.ts` is the browser-safe vocabulary (kinds · schemas · CLI/resume,
 *  re-bound to the registry). This entry adds the pieces only a host runs: each
 *  agent's `AgentPlugin` (adapter + transcript fetcher + env keys), the keyed
 *  record padi folds, and the flattened env-key list `padiBinding` forwards
 *  server→padi. */

import type { AgentPlugin } from "anyagent";
import type { Fetcher } from "kolu-transcript-core";
import { claudeCodePlugin } from "kolu-claude-code";
import { codexPlugin } from "kolu-codex";
import { grokPlugin } from "kolu-grok";
import { opencodePlugin } from "kolu-opencode";
import { piPlugin } from "kolu-pi";
import type { AgentInfoOf, AgentKind } from "./vocab.ts";

export * from "./vocab.ts";

/** Every agent's plugin, keyed by kind. The KEYED record (not an array) keeps
 *  the kind↔Info correlation, so `AGENT_PLUGINS[kind]` is typed per kind. A new
 *  kind added to `AGENT_VOCABS` without a plugin row fails to compile. */
export const AGENT_PLUGINS: {
  [K in AgentKind]: AgentPlugin<unknown, AgentInfoOf<K>, Fetcher>;
} = {
  "claude-code": claudeCodePlugin,
  codex: codexPlugin,
  opencode: opencodePlugin,
  grok: grokPlugin,
  pi: piPlugin,
};

/** Every agent-detection dir/db override env key, flattened from the plugins.
 *  The server→padi hop forwards these so a built, forced-detached deployment
 *  still points detection at its fixtures (`padiBinding.ts`). */
export const AGENT_DIR_ENV_KEYS: readonly string[] = Object.values(
  AGENT_PLUGINS,
).flatMap((p) => p.envKeys);

/** The merged subsystem counters every plugin contributes to heap diagnostics.
 *  Folded here so the server logs per-agent diagnostics without depending on any
 *  agent package. */
export function agentDiagnostics(): Record<string, number> {
  const out: Record<string, number> = {};
  for (const plugin of Object.values(AGENT_PLUGINS)) {
    Object.assign(out, plugin.diagnostics?.() ?? {});
  }
  return out;
}
