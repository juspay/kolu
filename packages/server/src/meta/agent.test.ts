import { describe, expect, it } from "vitest";
import { activeInvokedAgentBasename } from "./agent.ts";

describe("activeInvokedAgentBasename", () => {
  const codex = { raw: "codex", basename: "codex" };

  it("keeps wrapper-launched agents while a non-shell foreground is active", () => {
    expect(activeInvokedAgentBasename("node", codex)).toBe("codex");
  });

  it("drops stale command marks once the shell regains the foreground", () => {
    expect(activeInvokedAgentBasename("bash", codex)).toBeNull();
  });

  it("returns null when no agent command was invoked", () => {
    expect(activeInvokedAgentBasename("node", null)).toBeNull();
  });
});
