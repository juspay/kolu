/** A bundle's `share/agent-distro/profile.json` (upstream's `ProfileFile`). */

import { describe, expect, it } from "vitest";
import { parseProfileFile, profileFile } from "./profileFile.ts";

/** A real bundle's `profile.json` (vanilla, agent-distro d077d18). */
const REAL =
  '{"description":"Upstream harnesses with your own provider","name":"vanilla"}';

describe("parseProfileFile", () => {
  it("reads a real profile.json", () => {
    expect(parseProfileFile(REAL)).toEqual({
      name: "vanilla",
      description: "Upstream harnesses with your own provider",
    });
  });

  it("throws on a missing field", () => {
    expect(() => parseProfileFile('{"name":"vanilla"}')).toThrow();
    expect(() => parseProfileFile('{"description":"d"}')).toThrow();
  });

  it("throws on a field of the wrong type, or a name that is no selector", () => {
    expect(() =>
      parseProfileFile('{"name":"vanilla","description":42}'),
    ).toThrow();
    expect(() => parseProfileFile('{"name":7,"description":"d"}')).toThrow();
    expect(() =>
      parseProfileFile('{"name":"a/b","description":"d"}'),
    ).toThrow();
    expect(() => parseProfileFile('["vanilla"]')).toThrow();
    expect(() => parseProfileFile("vanilla")).toThrow();
  });

  it("throws on a field upstream does not write", () => {
    expect(() =>
      parseProfileFile('{"name":"vanilla","description":"d","tagline":"t"}'),
    ).toThrow(/tagline/);
  });

  it("sits under the bundle", () => {
    expect(profileFile("/nix/store/x")).toBe(
      "/nix/store/x/share/agent-distro/profile.json",
    );
  });
});
