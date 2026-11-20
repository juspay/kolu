import { describe, expect, test } from "vitest";

import type { McpServer } from "@agentclientprotocol/sdk";
import { type MissingServer, movedBy, rosterOf } from "./servers.ts";

const OLAI: McpServer = {
  type: "http",
  name: "olai",
  url: "http://127.0.0.1:7714/mcp",
  headers: [{ name: "Authorization", value: "Bearer secret" }],
};

const ALPHA: McpServer = {
  name: "alpha",
  command: "/nix/store/abc/bin/alpha",
  args: ["mcp"],
  env: [{ name: "ALPHA_SOCKET", value: "/run/user/1000/alpha/alpha.sock" }],
};

const ABSENT: MissingServer = {
  name: "alpha",
  where: "/usr/bin/alpha",
  why: "it refused to read the daemon's identity: no daemon is behind it",
};

describe("the roster as olai composed it", () => {
  test("every server handed over is on it, in the order it was handed", () => {
    expect(rosterOf([OLAI, ALPHA], [])).toEqual([
      { name: "olai", where: OLAI.url, standing: "handed", said: null },
      { name: "alpha", where: ALPHA.command, standing: "handed", said: null },
    ]);
  });

  test("a handed server whose plugin named a page carries it, and keeps it as the agent reports", () => {
    const roster = rosterOf(
      [OLAI, ALPHA],
      [ABSENT],
      new Map([
        ["alpha", "/alpha"],
        ["absent-elsewhere", "/x"],
      ]),
    );
    expect(roster.map((server) => server.at)).toEqual([
      undefined,
      "/alpha",
      undefined,
    ]);
    const moved = movedBy(roster, [
      { name: "alpha", attached: true, said: "" },
    ] as never);
    expect(moved?.[1]).toEqual({
      name: "alpha",
      where: ALPHA.command,
      standing: "connected",
      said: "",
      at: "/alpha",
    });
  });

  test("handing a server over is not the same as the agent having it", () => {
    expect(
      rosterOf([OLAI, ALPHA], []).every(
        (server) => server.standing === "handed",
      ),
    ).toBe(true);
  });

  test("where a server IS follows its transport", () => {
    const [olai, alpha] = rosterOf([OLAI, ALPHA], []);
    expect(olai?.where).toBe("http://127.0.0.1:7714/mcp");
    expect(alpha?.where).toBe("/nix/store/abc/bin/alpha");
  });

  test("an entry of a shape this does not know says where it is, or nothing", () => {
    const acp = {
      type: "acp",
      name: "somewhere",
      serverId: "s1",
    } as unknown as McpServer;
    expect(rosterOf([acp], [])).toEqual([
      { name: "somewhere", where: null, standing: "handed", said: null },
    ]);
  });

  test("the one it did not get is on the roster too, last, with its sentence", () => {
    expect(rosterOf([OLAI], [ABSENT])).toEqual([
      { name: "olai", where: OLAI.url, standing: "handed", said: null },
      {
        name: "alpha",
        where: ABSENT.where,
        standing: "missing",
        said: ABSENT.why,
      },
    ]);
  });

  test("a host with nothing to miss reports nothing missing", () => {
    expect(rosterOf([OLAI], [])).toHaveLength(1);
  });

  test("a session handed nothing has an empty roster rather than an invented one", () => {
    expect(rosterOf([], [])).toEqual([]);
  });
});

describe("the roster as the agent's own report leaves it", () => {
  const handed = rosterOf([OLAI, ALPHA], []);

  test("the agent's own verdict is what puts a tick on a row", () => {
    expect(
      movedBy(handed, [
        { name: "olai", attached: true, said: "connected" },
        { name: "alpha", attached: true, said: "connected" },
      ]),
    ).toEqual([
      {
        name: "olai",
        where: OLAI.url,
        standing: "connected",
        said: "connected",
      },
      {
        name: "alpha",
        where: ALPHA.command,
        standing: "connected",
        said: "connected",
      },
    ]);
  });

  test("every other word is a row the agent did not attach, in the agent's words", () => {
    expect(
      movedBy(handed, [
        { name: "olai", attached: false, said: "needs-auth" },
        { name: "alpha", attached: false, said: "failed" },
      ]),
    ).toEqual([
      {
        name: "olai",
        where: OLAI.url,
        standing: "unattached",
        said: "needs-auth",
      },
      {
        name: "alpha",
        where: ALPHA.command,
        standing: "unattached",
        said: "failed",
      },
    ]);
  });

  test("a word this end has never seen still reaches a person", () => {
    const moved = movedBy(handed, [
      { name: "olai", attached: false, said: "reticulating" },
    ]);
    expect(moved?.[0]).toMatchObject({
      standing: "unattached",
      said: "reticulating",
    });
  });

  test("a row the agent did not name keeps the standing it had", () => {
    const first = movedBy(handed, [
      { name: "olai", attached: true, said: "connected" },
      { name: "alpha", attached: true, said: "connected" },
    ]);
    expect(
      movedBy(first ?? [], [
        { name: "olai", attached: true, said: "connected" },
      ]),
    ).toBeNull();
  });

  test("a server olai never handed over adds no row", () => {
    expect(
      movedBy(handed, [
        { name: "olai", attached: true, said: "connected" },
        { name: "deepwiki", attached: true, said: "connected" },
      ]),
    ).toEqual([
      {
        name: "olai",
        where: OLAI.url,
        standing: "connected",
        said: "connected",
      },
      { name: "alpha", where: ALPHA.command, standing: "handed", said: null },
    ]);
  });

  test("a probe's own finding is never overwritten by the agent", () => {
    const withAbsent = rosterOf([OLAI], [ABSENT]);
    expect(
      movedBy(withAbsent, [
        { name: "alpha", attached: true, said: "connected" },
      ]),
    ).toBeNull();
  });

  test("a report that moves nothing is not news", () => {
    expect(movedBy(handed, [])).toBeNull();
    const connected = movedBy(handed, [
      { name: "olai", attached: true, said: "connected" },
    ]);
    expect(connected).not.toBeNull();
    expect(
      movedBy(connected ?? [], [
        { name: "olai", attached: true, said: "connected" },
      ]),
    ).toBeNull();
  });

  test("a row that changes its mind moves again", () => {
    const stuck = movedBy(handed, [
      { name: "alpha", attached: false, said: "needs-auth" },
    ]);
    const fixed = movedBy(stuck ?? [], [
      { name: "alpha", attached: true, said: "connected" },
    ]);
    expect(fixed?.[1]).toEqual({
      name: "alpha",
      where: ALPHA.command,
      standing: "connected",
      said: "connected",
    });
  });

  test("an empty roster has nothing to be moved", () => {
    expect(
      movedBy([], [{ name: "olai", attached: true, said: "connected" }]),
    ).toBeNull();
  });
});
