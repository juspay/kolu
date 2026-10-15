/** The real ops: the index read — which package a host pulls, read off
 *  agent-distro's index over HTTPS (a 200 is the paths, a 404 says "not
 *  published", anything else is loud) — the words a pull that did not land is
 *  reported in, and how a profile built here is shipped to a host and the
 *  words a refusal is reported in. */

import { deliverClosure, pullClosure } from "@kolu/surface-remote";
import { describe, expect, it, vi } from "vitest";
import { readPublishedPackage, realDeliveryOps } from "./ops.ts";

vi.mock("@kolu/surface-remote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@kolu/surface-remote")>()),
  pullClosure: vi.fn(),
  deliverClosure: vi.fn(),
}));

const INDEX = "https://raw.githubusercontent.com/juspay/agent-distro/ca-index";
const ENTRY = {
  rev: "cb44dd8115ea07c3b80b263f3992c49a587a4e5f",
  ia: "/nix/store/1xxnk4wx89kk1cfyfnqgz8hg5msbz0gw-agent-distro",
  ca: "/nix/store/r6r8xkl3fvi5is4ckfbl6sl1wacz2rak-agent-distro",
};

const answering = (status: number, text: string) =>
  vi.fn(async (_url: string) => ({ status, text }));

describe("readPublishedPackage", () => {
  it("a 200 is the entry, read from latest/<system>/default.json through the framework reader", async () => {
    const fetchText = answering(200, JSON.stringify(ENTRY));
    await expect(
      readPublishedPackage(INDEX, "x86_64-linux", fetchText),
    ).resolves.toEqual(ENTRY);
    expect(fetchText).toHaveBeenCalledWith(
      `${INDEX}/latest/x86_64-linux/default.json`,
    );
  });

  it("a 404 says upstream has not published it, naming the system", async () => {
    const res = readPublishedPackage(
      INDEX,
      "armv7l-linux",
      answering(404, "404: Not Found"),
    );
    await expect(res).rejects.toThrow(
      "agent-distro has not published its agents for armv7l-linux yet",
    );
  });
  // The reader's own faults (no answer, another status, not an entry) are
  // `@kolu/surface-remote`'s `closureIndex.test.ts`.
});

const CACHE = "https://cache.example.org/oss";
const KEY = "oss:KEY=";
const ops = realDeliveryOps({
  flake: "github:juspay/agent-distro",
  index: INDEX,
  cache: { url: CACHE, publicKey: KEY },
  schedule: { periodSeconds: 21600, offsetSeconds: 7200 },
});

describe("realDeliveryOps.pull", () => {
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
      onProgress: () => {},
    });
  const pulled = () => vi.mocked(pullClosure).mock.calls.at(-1)?.[0];

  it("a Linux host pulls the content-addressed package, trusting no key, rooted under kolu's package link", async () => {
    vi.mocked(pullClosure).mockResolvedValueOnce({ ok: true });
    expect(await pull()).toEqual({ ok: true, bundle: ENTRY.ca });
    expect(pulled()).toMatchObject({
      host: "ci@box",
      cacheUrl: CACHE,
      storePath: ENTRY.ca,
      rootPath: ".local/state/kolu/agent-distro/gcroots/package",
    });
    expect(pulled()).not.toHaveProperty("signedBy");
  });

  it("a Mac pulls the signed input-addressed package — a rewritten Mach-O will not run — naming the cache's key", async () => {
    vi.mocked(pullClosure).mockResolvedValueOnce({ ok: true });
    expect(await pull("aarch64-darwin")).toEqual({
      ok: true,
      bundle: ENTRY.ia,
    });
    expect(pulled()).toMatchObject({ storePath: ENTRY.ia, signedBy: KEY });
  });

  it("a Linux host on Nix 2.35 pulls the signed package too, and a refusal names its Nix line as the reason", async () => {
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
      message: `box could not pull the agents (${ENTRY.ca}) from agent-distro's cache (${CACHE}): unable to download 'https://cache.example.org/…'`,
    });
  });

  it("a Mac that would not take the signed package is told the one-line fix — for the login, or for this machine's user", async () => {
    const refusal =
      "cannot add path because it lacks a signature by a trusted key";
    vi.mocked(pullClosure).mockResolvedValue({
      ok: false,
      kind: "uncopied",
      reason: refusal,
    });
    expect(await pull("aarch64-darwin", "ci@mac")).toEqual({
      ok: false,
      message: `box could not pull the agents (${ENTRY.ia}) from agent-distro's cache (${CACHE}): ${refusal}. box is sent the signed agents — macOS kills a program whose code signature a content-addressed rewrite broke — and takes them only if its Nix trusts them: on box, add the login kolu connects as to \`nix.settings.trusted-users\`, or agent-distro's cache key (${KEY}) to \`nix.settings.trusted-public-keys\`.`,
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

describe("realDeliveryOps.ship", () => {
  const BUILT = "/nix/store/p0p0p0p0p0p0p0p0p0p0p0p0p0p0p0p0-agent-profile";
  const ship = (
    system = "x86_64-linux",
    ssh = "ci@box",
    reference = "github:juspay/skills",
  ) =>
    ops.ship({
      ssh,
      label: "box",
      hostNix: { system, nixVersion: "2.34.8" },
      reference,
      path: BUILT,
      onProgress: () => {},
    });
  const delivered = () => vi.mocked(deliverClosure).mock.calls.at(-1)?.[0];

  it("ships the built path, never through the index, rooted per reference — and answers the path the host has", async () => {
    vi.mocked(deliverClosure).mockResolvedValueOnce({
      ok: true,
      outPath: "/nix/store/ca-on-box",
    });
    expect(await ship()).toEqual({ ok: true, path: "/nix/store/ca-on-box" });
    const args = delivered();
    expect(args).toMatchObject({
      host: "ci@box",
      outPath: BUILT,
      published: null,
    });
    expect(args?.rootPath).toMatch(
      /^\.local\/state\/kolu\/agent-distro\/gcroots\/profile-[0-9a-f]{16}$/,
    );
    expect(await args?.system()).toBe("x86_64-linux");
    // The same reference keeps its root; another gets its own.
    vi.mocked(deliverClosure).mockResolvedValueOnce({
      ok: true,
      outPath: BUILT,
    });
    await ship();
    const again = delivered()?.rootPath;
    expect(again).toBe(args?.rootPath);
    vi.mocked(deliverClosure).mockResolvedValueOnce({
      ok: true,
      outPath: BUILT,
    });
    await ship("x86_64-linux", "ci@box", "/home/me/profile");
    expect(delivered()?.rootPath).not.toBe(args?.rootPath);
  });

  it("a Linux host that would not take it is the route's words, naming the host and the path", async () => {
    vi.mocked(deliverClosure).mockResolvedValueOnce({
      ok: false,
      kind: "not-delivered",
      reason: "nix copy exit 1",
    });
    expect(await ship()).toEqual({
      ok: false,
      message: `box could not take ${BUILT}: nix copy exit 1`,
    });
  });

  it("a Mac that would not take it is told its Nix must trust the login", async () => {
    vi.mocked(deliverClosure).mockResolvedValueOnce({
      ok: false,
      kind: "not-delivered",
      reason: "lacks a signature by a trusted key",
    });
    expect(await ship("aarch64-darwin", "ci@mac")).toEqual({
      ok: false,
      message: `box could not take ${BUILT}: lacks a signature by a trusted key. box takes a profile built here only when its Nix trusts the login kolu connects as: on box, add it to \`nix.settings.trusted-users\`.`,
    });
  });

  it("a failed route is its own words, even to a Mac", async () => {
    vi.mocked(deliverClosure).mockResolvedValueOnce({
      ok: false,
      kind: "failed",
      reason: "ssh dropped",
      cause: "network",
    });
    expect(await ship("aarch64-darwin", "ci@mac")).toEqual({
      ok: false,
      message: `box could not take ${BUILT}: ssh dropped`,
    });
  });
});
