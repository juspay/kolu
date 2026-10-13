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
  ia: "/nix/store/1xxnk4wx89kk1cfyfnqgz8hg5msbz0gw-agent-distro-vanilla",
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
    ).rejects.toThrow(/is not \{ rev, ia, ca \}/);
    await expect(
      readPublishedBundle(
        INDEX,
        "x86_64-linux",
        "vanilla",
        answering(200, "<html>"),
      ),
    ).rejects.toThrow(/is not \{ rev, ia, ca \}/);
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
  const CACHE = "https://cache.example.org/oss";
  const KEY = "oss:KEY=";
  const ops = realDeliveryOps({
    index: INDEX,
    cache: { url: CACHE, publicKey: KEY },
    schedule: { periodSeconds: 21600, offsetSeconds: 7200 },
  });
  const pull = (system = "x86_64-linux", ssh = "ci@box") =>
    ops.pull({
      ssh,
      label: "box",
      system,
      published: ENTRY,
      profile: "vanilla",
      onProgress: () => {},
    });
  const pulled = () => vi.mocked(pullClosure).mock.calls.at(-1)?.[0];

  it("a Linux host pulls the content-addressed bundle, trusting no key, rooted under kolu's per-profile link", async () => {
    vi.mocked(pullClosure).mockResolvedValueOnce({ ok: true });
    expect(await pull()).toEqual({ ok: true, bundle: ENTRY.ca });
    expect(pulled()).toMatchObject({
      host: "ci@box",
      cacheUrl: CACHE,
      storePath: ENTRY.ca,
      rootPath: ".local/state/kolu/agent-distro/gcroots/vanilla",
    });
    expect(pulled()).not.toHaveProperty("signedBy");
  });

  it("a Mac pulls the signed input-addressed bundle — a rewritten Mach-O will not run — naming the cache's key", async () => {
    vi.mocked(pullClosure).mockResolvedValueOnce({ ok: true });
    expect(await pull("aarch64-darwin")).toEqual({
      ok: true,
      bundle: ENTRY.ia,
    });
    expect(pulled()).toMatchObject({ storePath: ENTRY.ia, signedBy: KEY });
  });

  it("a copy the cache could not serve names the host, the path and the cache, in Nix's words", async () => {
    vi.mocked(pullClosure).mockResolvedValueOnce({
      ok: false,
      kind: "uncopied",
      reason: "unable to download 'https://cache.example.org/…'",
    });
    expect(await pull()).toEqual({
      ok: false,
      message: `box could not pull the vanilla agents (${ENTRY.ca}) from agent-distro's cache (${CACHE}): unable to download 'https://cache.example.org/…'`,
    });
  });

  it("a Mac that would not take the signed bundle is told the one-line fix — for the login, or for this machine's user", async () => {
    const refusal =
      "cannot add path because it lacks a signature by a trusted key";
    vi.mocked(pullClosure).mockResolvedValue({
      ok: false,
      kind: "uncopied",
      reason: refusal,
    });
    expect(await pull("aarch64-darwin", "ci@mac")).toEqual({
      ok: false,
      message: `box could not pull the vanilla agents (${ENTRY.ia}) from agent-distro's cache (${CACHE}): ${refusal}. A Mac takes the signed agents only if its Nix trusts them: on box, add the login kolu connects as to \`nix.settings.trusted-users\`, or agent-distro's cache key (${KEY}) to \`nix.settings.trusted-public-keys\`.`,
    });
    const local = await pull("aarch64-darwin", "localhost");
    expect(local.ok === false && local.message).toContain(
      "add the user kolu runs as",
    );
    vi.mocked(pullClosure).mockReset();
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
});
