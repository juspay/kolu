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
  it("a 200 is the entry, read from latest/<system>/<profile>.json through the framework reader", async () => {
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
  // The reader's own faults (no answer, another status, not an entry) are
  // `@kolu/surface-remote`'s `closureIndex.test.ts`.
});

describe("realDeliveryOps.pull", () => {
  const CACHE = "https://cache.example.org/oss";
  const KEY = "oss:KEY=";
  const ops = realDeliveryOps({
    index: INDEX,
    cache: { url: CACHE, publicKey: KEY },
    schedule: { periodSeconds: 21600, offsetSeconds: 7200 },
  });
  const pull = (
    system = "x86_64-linux",
    ssh = "ci@box",
    nixVersion = "2.34.8",
  ) =>
    ops.pull({
      ssh,
      label: "box",
      hostNix: { system, nixVersion },
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

  it("a Linux host on Nix 2.35 pulls the signed bundle too, and a refusal names its Nix line as the reason", async () => {
    vi.mocked(pullClosure).mockResolvedValueOnce({ ok: true });
    expect(await pull("x86_64-linux", "ci@box", "2.35.2")).toEqual({
      ok: true,
      bundle: ENTRY.ia,
    });
    expect(pulled()).toMatchObject({ storePath: ENTRY.ia, signedBy: KEY });
    vi.mocked(pullClosure).mockResolvedValueOnce({
      ok: false,
      kind: "uncopied",
      reason: "lacks a signature by a trusted key",
    });
    const res = await pull("x86_64-linux", "ci@box", "2.35.2");
    expect(res.ok === false && res.message).toContain(
      "box is sent the signed agents — its Nix 2.35.2 cannot verify the content-addressed form the publisher writes",
    );
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
      message: `box could not pull the vanilla agents (${ENTRY.ia}) from agent-distro's cache (${CACHE}): ${refusal}. box is sent the signed agents — macOS kills a program whose code signature a content-addressed rewrite broke — and takes them only if its Nix trusts them: on box, add the login kolu connects as to \`nix.settings.trusted-users\`, or agent-distro's cache key (${KEY}) to \`nix.settings.trusted-public-keys\`.`,
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
