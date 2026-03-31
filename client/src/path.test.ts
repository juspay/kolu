import { describe, it, expect } from "vitest";
import { shortenCwd, cwdBasename } from "./path";

describe("shortenCwd", () => {
  it("replaces /home/user with ~", () => {
    expect(shortenCwd("/home/alice/projects")).toBe("~/projects");
  });

  it("replaces /root with ~", () => {
    expect(shortenCwd("/root/projects")).toBe("~/projects");
  });

  it("replaces bare /home/user with ~", () => {
    expect(shortenCwd("/home/alice")).toBe("~");
  });

  it("replaces bare /root with ~", () => {
    expect(shortenCwd("/root")).toBe("~");
  });

  it("does not replace /home without user", () => {
    expect(shortenCwd("/home")).toBe("/home");
  });

  it("leaves non-home paths unchanged", () => {
    expect(shortenCwd("/var/log")).toBe("/var/log");
  });

  it("handles deeply nested paths", () => {
    expect(shortenCwd("/home/bob/a/b/c")).toBe("~/a/b/c");
  });
});

describe("cwdBasename", () => {
  it("returns last path segment", () => {
    expect(cwdBasename("/home/alice/projects")).toBe("projects");
  });

  it("returns ~ for bare home directory", () => {
    expect(cwdBasename("/home/alice")).toBe("~");
  });

  it("returns ~ for bare /root", () => {
    expect(cwdBasename("/root")).toBe("~");
  });

  it("returns last segment for non-home paths", () => {
    expect(cwdBasename("/var/log")).toBe("log");
  });

  it("returns last segment for deep home paths", () => {
    expect(cwdBasename("/home/bob/a/b/c")).toBe("c");
  });
});
