/** The closure index, as a consumer reads it: the URL of an entry under a
 *  revision or `latest/`, and the read — a 200 is the entry, a 404 is "not
 *  published", anything else is loud and names the URL. */

import { describe, expect, it, vi } from "vitest";
import {
  ClosureIndexError,
  closureIndexUrl,
  readPublishedClosure,
} from "./closureIndex";

const INDEX = {
  rawBase: "https://raw.githubusercontent.com/juspay/agent-distro/ca-index",
};
const ENTRY = {
  rev: "cb44dd8115ea07c3b80b263f3992c49a587a4e5f",
  ia: "/nix/store/1xxnk4wx89kk1cfyfnqgz8hg5msbz0gw-agent-distro-vanilla",
  ca: "/nix/store/r6r8xkl3fvi5is4ckfbl6sl1wacz2rak-agent-distro-vanilla",
};

const answering = (status: number, text: string) =>
  vi.fn(async (_url: string) => ({ status, text }));
const read = (
  fetchText: Parameters<typeof readPublishedClosure>[0],
  key: Parameters<typeof readPublishedClosure>[2] = "latest",
  system = "x86_64-linux",
) => readPublishedClosure(fetchText, INDEX, key, system, "vanilla");

describe("closureIndexUrl", () => {
  it("names a revision's entry, or latest/'s", () => {
    expect(
      closureIndexUrl(INDEX, { rev: "c891495" }, "x86_64-linux", "padi"),
    ).toBe(`${INDEX.rawBase}/c891495/x86_64-linux/padi.json`);
    expect(closureIndexUrl(INDEX, "latest", "aarch64-darwin", "vanilla")).toBe(
      `${INDEX.rawBase}/latest/aarch64-darwin/vanilla.json`,
    );
  });

  it("strips every trailing slash of the base, however many", () => {
    expect(
      closureIndexUrl(
        { rawBase: `https://index.example.org/ca-index${"/".repeat(50_000)}` },
        "latest",
        "aarch64-darwin",
        "vanilla",
      ),
    ).toBe(
      "https://index.example.org/ca-index/latest/aarch64-darwin/vanilla.json",
    );
  });

  it("refuses a segment that could climb out of the index", () => {
    for (const [rev, system, attr] of [
      ["../x", "x86_64-linux", "padi"],
      ["c891495", ".hidden", "padi"],
      ["c891495", "x86_64-linux", "a/b"],
      ["", "x86_64-linux", "padi"],
    ] as const)
      expect(() => closureIndexUrl(INDEX, { rev }, system, attr)).toThrow(
        /cannot name an index path/,
      );
  });
});

describe("readPublishedClosure", () => {
  it("a 200 under latest/ is the entry, other fields ignored", async () => {
    const fetchText = answering(200, JSON.stringify({ ...ENTRY, extra: 1 }));
    await expect(read(fetchText)).resolves.toEqual({
      kind: "published",
      url: `${INDEX.rawBase}/latest/x86_64-linux/vanilla.json`,
      entry: ENTRY,
    });
  });

  it("a 200 under a revision is the entry when it names that revision", async () => {
    const fetchText = answering(200, JSON.stringify(ENTRY));
    const res = await read(fetchText, { rev: "cb44dd8" });
    expect(res.kind === "published" && res.entry).toEqual(ENTRY);
    expect(fetchText).toHaveBeenCalledWith(
      `${INDEX.rawBase}/cb44dd8/x86_64-linux/vanilla.json`,
    );
  });

  it("a revision's entry naming ANOTHER revision is a broken publisher, and loud", async () => {
    const res = read(answering(200, JSON.stringify(ENTRY)), { rev: "deadbee" });
    await expect(res).rejects.toThrow(/names revision cb44dd8.*, not deadbee/);
    await expect(res).rejects.toMatchObject({ kind: "malformed" });
  });

  it("a darwin entry carries no ca", async () => {
    const { ca: _, ...darwin } = ENTRY;
    const res = await read(
      answering(200, JSON.stringify(darwin)),
      "latest",
      "aarch64-darwin",
    );
    expect(res.kind === "published" && res.entry).toEqual(darwin);
  });

  it("a 404 is `not-published`, a fact rather than a fault", async () => {
    await expect(
      read(answering(404, "404: Not Found"), { rev: "c891495" }),
    ).resolves.toEqual({
      kind: "not-published",
      url: `${INDEX.rawBase}/c891495/x86_64-linux/vanilla.json`,
    });
  });

  it("a malformed entry is loud, never a path guessed", async () => {
    for (const body of [
      JSON.stringify({ rev: ENTRY.rev }),
      JSON.stringify({ ...ENTRY, ca: "/tmp/agents" }),
      JSON.stringify({ ...ENTRY, rev: "c891495" }),
      "<html>",
    ]) {
      const res = read(answering(200, body));
      await expect(res).rejects.toThrow(/is not \{ rev, ia, ca\? \}/);
      await expect(res).rejects.toBeInstanceOf(ClosureIndexError);
    }
  });

  it("a request that never got an answer names the URL and the real cause", async () => {
    const fetchText = vi.fn(async (_url: string) => {
      throw new TypeError("fetch failed", {
        cause: new Error("getaddrinfo ENOTFOUND raw.githubusercontent.com"),
      });
    });
    const res = read(fetchText);
    await expect(res).rejects.toThrow(
      `the closure index at ${INDEX.rawBase}/latest/x86_64-linux/vanilla.json could not be read: getaddrinfo ENOTFOUND raw.githubusercontent.com`,
    );
    await expect(res).rejects.toMatchObject({ kind: "unreadable" });
  });

  it("any other status is loud, with the status and the URL", async () => {
    const res = read(answering(503, "upstream down"));
    await expect(res).rejects.toThrow(
      `the closure index answered HTTP 503 for ${INDEX.rawBase}/latest/x86_64-linux/vanilla.json: upstream down`,
    );
    await expect(res).rejects.toMatchObject({ kind: "unreadable" });
  });
});
