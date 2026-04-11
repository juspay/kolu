/**
 * Agent CLI command detection and normalization.
 *
 * When the user runs a known agent binary in any kolu terminal
 * (`claude`, `aider`, `opencode`, etc.), kolu's preexec hook emits
 * the raw command line as an `OSC 633 ; E ; <cmd>` mark on the PTY
 * output stream. `parseAgentCommand` takes that raw string and
 * returns a normalized canonical form, or `null` if the command
 * is not a known agent invocation.
 *
 * Normalization rules:
 * - First token (basename-stripped) must be in `KNOWN_AGENTS`.
 * - Prompt/message flags (`-p`, `--prompt`, `-m`, `--message`) are
 *   stripped together with their values so ephemeral prompt text
 *   never lands in the persisted MRU (leak prevention).
 * - Trailing positional arguments (after the last flag) are stripped
 *   so `aider src/foo.ts` collapses to `aider`.
 * - All other flags are preserved verbatim in their original order.
 *
 * Tokenization delegates to `string-argv`, a small focused library
 * for splitting shell-like strings into argv. We don't try to evaluate
 * the command — we only need to decide which tokens to strip — so the
 * tokenizer's exact handling of edge cases (command substitution,
 * process substitution, glob) doesn't matter: unknown constructs fall
 * through as opaque positionals and get dropped in the same step that
 * drops real positionals.
 */

import { parseArgsStringToArgv } from "string-argv";

/** Agent CLI basenames kolu recognizes out of the box.
 *  Adding a new agent is a one-line change — no adapter, no registry. */
const KNOWN_AGENTS: ReadonlySet<string> = new Set([
  "claude",
  "opencode",
  "aider",
  "codex",
  "goose",
  "gemini",
  "cursor-agent",
]);

/** Flags whose value is an ephemeral prompt/message and must be stripped. */
const PROMPT_FLAGS: ReadonlySet<string> = new Set([
  "-p",
  "--prompt",
  "-m",
  "--message",
]);

/** Basename of a path-like token (strips directory prefix). */
function basename(s: string): string {
  const slash = s.lastIndexOf("/");
  return slash === -1 ? s : s.slice(slash + 1);
}

/**
 * Parse a raw command line. Returns the normalized agent invocation
 * string (e.g. `"claude --model sonnet"`) if the first token resolves
 * to a known agent binary, or `null` otherwise.
 */
export function parseAgentCommand(raw: string): string | null {
  const tokens = parseArgsStringToArgv(raw.trim());
  if (tokens.length === 0) return null;

  const agent = basename(tokens[0]!);
  if (!KNOWN_AGENTS.has(agent)) return null;

  // Collect stable flags + drop prompt flags with their values.
  // A stable flag is any `-x` or `--xxx` that is not in PROMPT_FLAGS.
  // Anything else (trailing positional args) is dropped.
  const kept: string[] = [agent];
  const args = tokens.slice(1);
  for (let i = 0; i < args.length; i++) {
    const t = args[i]!;
    if (t === "--") break; // stop at explicit end-of-flags
    if (!t.startsWith("-")) continue; // drop positional
    if (PROMPT_FLAGS.has(t)) {
      // Skip the flag and its value (if present and not another flag)
      if (i + 1 < args.length && !args[i + 1]!.startsWith("-")) i++;
      continue;
    }
    // Stable flag — keep verbatim
    kept.push(t);
    // If the next token is a non-flag value (e.g. `--model sonnet`),
    // attach it to the flag as-is.
    if (i + 1 < args.length && !args[i + 1]!.startsWith("-")) {
      kept.push(args[++i]!);
    }
  }
  return kept.join(" ");
}
