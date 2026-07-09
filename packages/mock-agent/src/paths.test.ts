import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  claudeProjectsDir,
  claudeSessionsDir,
  codexDir,
  grokDir,
  opencodeDbPath,
} from "./paths.ts";

/** These must equal the `os.homedir()`-relative FALLBACKS the integrations use
 *  when no `KOLU_*_DIR` override is set — the whole point of the mock-agent is
 *  to write where a real agent (and the padi that senses it) reads by default.
 *  If an integration moves its default, this drifts and must be updated in
 *  lockstep; pinning the exact tails here makes that drift fail loudly. */
describe("default agent paths under a fixed HOME", () => {
  const HOME = "/home/tester";
  let prev: string | undefined;
  beforeEach(() => {
    prev = process.env.HOME;
    process.env.HOME = HOME;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.HOME;
    else process.env.HOME = prev;
  });

  it("claude sessions → ~/.claude/sessions", () => {
    expect(claudeSessionsDir()).toBe(`${HOME}/.claude/sessions`);
  });
  it("claude projects → ~/.claude/projects", () => {
    expect(claudeProjectsDir()).toBe(`${HOME}/.claude/projects`);
  });
  it("codex → ~/.codex", () => {
    expect(codexDir()).toBe(`${HOME}/.codex`);
  });
  it("opencode db → ~/.local/share/opencode/opencode.db", () => {
    expect(opencodeDbPath()).toBe(`${HOME}/.local/share/opencode/opencode.db`);
  });
  it("grok → ~/.grok", () => {
    expect(grokDir()).toBe(`${HOME}/.grok`);
  });
});
