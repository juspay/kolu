/** The real ops: the index read — which bundle a host pulls, read off
 *  agent-distro's index over HTTPS (a 200 is the paths, a 404 says "not
 *  published", anything else is loud) — and the words a pull that did not land
 *  is reported in. */

import { pullClosure } from "@kolu/surface-remote";
import { describe, expect, it, vi } from "vitest";
import { readPublishedBundle, realDeliveryOps } from "./ops.ts";

vi.mock("@kolu/surface-remote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kolu/surface-remote")>()),
  pullClosure: vi.fn(),
}));

const INDEX = "https://raw.githubusercontent.com/juspay/agent-distro/ca-index";
const ENTRY = {
  rev: "cb44dd8115ea07c3b80b263f3992c49a587a4e5f",
  ca: "/nix/store/r6r8xkl3fvi5is4ckfbl6sl1wacz2rak-agent-distro-vanilla",
};

const answering = (status: number, text: string) =>
  vi.fn(async (_url: string) => ({ status, text }));

describe("readPublishedBundle", () => {
  it("a 200 is the entry, read from latest/<system>/<profile>.json", async () => {
    const fetchText = answering(200, JSON.stringify(ENTRY));
    await expect(
      readPublishedBundle(INDEX, "x86_64-linux", "vanilla", fetchText),
    ).resolves.toEqual(ENTRY);
    expect(fetchText).toHaveBeenCalledWith(
      `${INDEX}/latest/x86_64-linux/vanilla.json`,
    );
  });

  it("a 404 says upstream has not published it, naming the profile and system", async () => {
    const res = readPublishedBundle(
      INDEX,
      "armv7l-linux",
      "vanilla",
      answering(404, "404: Not Found"),
    );
    await expect(res).rejects.toThrow(
      "agent-distro has not published the vanilla agents for armv7l-linux yet",
    );
  });

  it("a malformed entry is loud, never a path guessed", async () => {
    await expect(
      readPublishedBundle(
        INDEX,
        "x86_64-linux",
        "vanilla",
        answering(200, JSON.stringify({ rev: ENTRY.rev })),
      ),
    ).rejects.toThrow(/is not \{ rev, ca \}/);
    await expect(
      readPublishedBundle(
        INDEX,
        "x86_64-linux",
        "vanilla",
        answering(200, "<html>"),
      ),
    ).rejects.toThrow(/is not \{ rev, ca \}/);
  });

  it("a request that never got an answer names the URL and the real cause, not a bare 'fetch failed'", async () => {
    const fetchText = vi.fn(async (_url: string) => {
      throw new TypeError("fetch failed", {
        cause: new Error("getaddrinfo ENOTFOUND raw.githubusercontent.com"),
      });
    });
    await expect(
      readPublishedBundle(INDEX, "x86_64-linux", "vanilla", fetchText),
    ).rejects.toThrow(
      `agent-distro's index at ${INDEX}/latest/x86_64-linux/vanilla.json could not be read: getaddrinfo ENOTFOUND raw.githubusercontent.com`,
    );
  });

  it("any other status is loud, with the status and the URL", async () => {
    await expect(
      readPublishedBundle(
        INDEX,
        "x86_64-linux",
        "vanilla",
        answering(503, "upstream down"),
      ),
    ).rejects.toThrow(
      `agent-distro's index answered HTTP 503 for ${INDEX}/latest/x86_64-linux/vanilla.json: upstream down`,
    );
  });
});

describe("realDeliveryOps.pull", () => {
  const ops = realDeliveryOps({
    index: INDEX,
    cache: "https://cache.example.org/oss",
    schedule: { periodSeconds: 21600, offsetSeconds: 7200 },
  });
  const pull = () =>
    ops.pull({
      ssh: "ci@box",
      label: "box",
      storePath: ENTRY.ca,
      profile: "vanilla",
      onProgress: () => {},
    });

  it("a copy the cache could not serve names the host, the path and the cache, in Nix's words", async () => {
    vi.mocked(pullClosure).mockResolvedValueOnce({
      ok: false,
      kind: "uncopied",
      reason: "unable to download 'https://cache.example.org/…'",
    });
    expect(await pull()).toEqual({
      ok: false,
      message: `box could not pull the vanilla agents (${ENTRY.ca}) from agent-distro's cache (https://cache.example.org/oss): unable to download 'https://cache.example.org/…'`,
    });
  });

  it("any other failure is the route's own words", async () => {
    vi.mocked(pullClosure).mockResolvedValueOnce({
      ok: false,
      kind: "failed",
      reason: "ci@box: could not establish the agent GC root: …",
      cause: "remote",
    });
    expect(await pull()).toEqual({
      ok: false,
      message: "ci@box: could not establish the agent GC root: …",
    });
  });

  it("roots under kolu's per-profile link in the login's home", async () => {
    vi.mocked(pullClosure).mockResolvedValueOnce({ ok: true });
    expect(await pull()).toEqual({ ok: true });
    expect(vi.mocked(pullClosure).mock.calls.at(-1)?.[0]).toMatchObject({
      host: "ci@box",
      cacheUrl: "https://cache.example.org/oss",
      storePath: ENTRY.ca,
      rootPath: ".local/state/kolu/agent-distro/gcroots/vanilla",
    });
  });
});
