/** A built profile's `share/agent-distro/profile.json` (upstream's
 *  `mkProfile`). */

import { describe, expect, it } from "vitest";
import { parseProfileFile, profileFile } from "./profileFile.ts";
import { builtProfileFiles, readFrom } from "./testing.ts";

/** A built profile's `profile.json`, as `mkProfile` writes it: sorted keys,
 *  with the fields a launch reads beside the name and description. */
const REAL = JSON.stringify({
  description: "Juspay skills + Kolu, via Juspay's LiteLLM gateway",
  env: { ANTHROPIC_BASE_URL: "https://example.invalid" },
  name: "juspay",
  reader: "/nix/store/r-agent-distro-runtime",
  settings: { claude: {} },
});

describe("parseProfileFile", () => {
  it("reads a built profile's name and description, leaving the launch's fields to upstream", () => {
    expect(parseProfileFile(REAL)).toEqual({
      name: "juspay",
      description: "Juspay skills + Kolu, via Juspay's LiteLLM gateway",
    });
  });

  it("reads what the test fixture writes, at the path it names", () => {
    const files = builtProfileFiles("/nix/store/p-ekala", {
      name: "ekala",
      description: "Ekala's skills",
    });
    expect(
      parseProfileFile(readFrom(files)(profileFile("/nix/store/p-ekala"))),
    ).toEqual({ name: "ekala", description: "Ekala's skills" });
  });

  it("throws on a missing field", () => {
    expect(() => parseProfileFile('{"name":"juspay"}')).toThrow();
    expect(() => parseProfileFile('{"description":"d"}')).toThrow();
  });

  it("throws on a field of the wrong type, or a name that is no selector", () => {
    expect(() =>
      parseProfileFile('{"name":"juspay","description":42}'),
    ).toThrow();
    expect(() => parseProfileFile('{"name":7,"description":"d"}')).toThrow();
    expect(() =>
      parseProfileFile('{"name":"a/b","description":"d"}'),
    ).toThrow();
    expect(() =>
      parseProfileFile('{"name":"a b","description":"d"}'),
    ).toThrow();
    expect(() => parseProfileFile('["juspay"]')).toThrow();
    expect(() => parseProfileFile("juspay")).toThrow();
  });

  it("sits under the built profile", () => {
    expect(profileFile("/nix/store/x")).toBe(
      "/nix/store/x/share/agent-distro/profile.json",
    );
  });
});
