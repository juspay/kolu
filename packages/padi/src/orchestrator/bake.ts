/**
 * THE TWO PATHS THE ORCHESTRATOR IS BAKED WITH, named once.
 *
 * Both are set by padi's own nix wrapper (`default.nix`), so a production padi
 * — local or provisioned onto a remote host through `padi-agent` — already has
 * them and reads them straight off its environment. Neither is a knob: the
 * values are store paths this kolu was built with, and an ambient override
 * would silently swap the binary the adapter's patches were proven against.
 *
 * They are named HERE, in a leaf of their own, because TWO packages need the
 * names and only one of them reads the values: padi reads them, and
 * kolu-server's padi binder FORWARDS them onto the padi it spawns — but only
 * on the from-source path, where there is no wrapper to have baked them (dev,
 * and the e2e harness pointing `KOLU_ACP_AGENT` at a fixture adapter). The
 * binder importing a list rather than spelling two strings is what keeps a
 * third path from being added in one place and forgotten in the other.
 */

/** The ACP adapter padi spawns — `@agentclientprotocol/claude-agent-acp`, with
 *  kolu's two patches applied. `@kolu/acp/engine` owns this name (`AGENT_ENV`);
 *  it is re-stated here only so the forwarding list is one import. */
export const ACP_AGENT_ENV = "KOLU_ACP_AGENT";

/** The `kolu` the orchestrator's session is handed as its one stdio MCP server
 *  — a wrapper that can run `kolu mcp` and nothing else it needs. It is a
 *  SECOND wrapper rather than the `kolu` a person runs, because that one bakes
 *  `KOLU_PADI_BIN` and reaching for it from padi's wrapper would close a nix
 *  cycle. */
export const KOLU_MCP_BIN_ENV = "KOLU_MCP_BIN";

/** Every orchestrator bake name, for the binder that forwards them onto a padi
 *  it spawns. */
export const ORCHESTRATOR_BAKE_ENVS = [
  ACP_AGENT_ENV,
  KOLU_MCP_BIN_ENV,
] as const;
