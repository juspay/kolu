/**
 * The roster, over values.
 *
 * What a person is told this conversation can reach is a sentence worth
 * asserting without starting a subprocess — and the cases that matter most here
 * are ones a running agent will not produce on demand: an agent that names a
 * server olai never handed over, one that reports the very server this host's
 * probe already refused, a status word no released version has sent. Each is three
 * lines as a value and a fixture nobody would maintain as a scenario.
 *
 * The e2e suite drives the whole thing through a real panel
 * (`packages/plugins/chat/e2e/features/the_conversations_servers.feature`) and stays the
 * regression net for the wiring.
 */

import { describe, expect, test } from "vitest";

import type { McpServer } from "@agentclientprotocol/sdk";
import { movedBy, type NotHere, rosterOf } from "./servers.ts";

/** Olai's own tool server, as `mcpServersOf` renders it: the http route on this
 *  process's own listener, with the session's bearer token on a header. */
const OLAI: McpServer = {
  type: "http",
  name: "olai",
  url: "http://127.0.0.1:7714/mcp",
  headers: [{ name: "Authorization", value: "Bearer secret" }],
};

/** ... and an OPTIONAL one this host turned out to be running: somebody else's
 *  program, spawned by absolute path — the file that answered the probe.
 *
 *  Called `alpha`, and the anonymity is the claim: nothing in this package may
 *  know what an optional server is, so a fixture naming a real one would be
 *  this file asserting something about an appliance rather than about a
 *  roster. */
const ALPHA: McpServer = {
  name: "alpha",
  command: "/nix/store/abc/bin/alpha",
  args: ["mcp"],
  env: [{ name: "ALPHA_SOCKET", value: "/run/user/1000/alpha/alpha.sock" }],
};

/** What a probe hands over about a server this host could not give the session
 *  — the shape is this module's and the SENTENCE is the probe's, verbatim. */
const ABSENT: NotHere = {
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
    // The whole layering, in one assertion. Olai knows what it put on the wire
    // and cannot know what the session did with it, so nothing here is
    // `connected` — only an agent's own word moves a row that far, and a tick
    // drawn on olai's say-so would be the panel making the claim the model made
    // wrongly.
    expect(
      rosterOf([OLAI, ALPHA], []).every(
        (server) => server.standing === "handed",
      ),
    ).toBe(true);
  });

  test("where a server IS follows its transport", () => {
    // A URL for the route on this process's own listener, an absolute file for
    // somebody else's program. Both come off the entry the session was given,
    // so the panel cannot name a path the session was not opened with.
    const [olai, alpha] = rosterOf([OLAI, ALPHA], []);
    expect(olai?.where).toBe("http://127.0.0.1:7714/mcp");
    expect(alpha?.where).toBe("/nix/store/abc/bin/alpha");
  });

  test("an entry of a shape this does not know says where it is, or nothing", () => {
    // ACP has four MCP transports and olai hands over two. A third arriving one
    // day should draw a name with no path rather than a guess — and never a
    // path off some other server's row.
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
      // The probe answers its own verdict; WHICH STANDING that is, is minted
      // here — the one module where all four are named and explained.
      {
        name: "alpha",
        where: ABSENT.where,
        standing: "missing",
        said: ABSENT.why,
      },
    ]);
  });

  test("a host with nothing to miss reports nothing missing", () => {
    // Nothing failed on a machine that is not running the tool, and a probe
    // answers with nothing missing for it. A roster row saying so would be a
    // permanent complaint on every machine that has never heard of it.
    expect(rosterOf([OLAI], [])).toHaveLength(1);
  });

  test("a session handed nothing has an empty roster rather than an invented one", () => {
    expect(rosterOf([], [])).toEqual([]);
  });
});

describe("the roster as the agent's own report leaves it", () => {
  const handed = rosterOf([OLAI, ALPHA], []);

  test("the agent's own verdict is what puts a tick on a row", () => {
    // WHICH WORD meant yes was the leg's to decide (`olai-plugin-claude`'s `leg.test.ts`),
    // because it is true of one agent. What is asserted here is the half that
    // is true of every agent: a verdict of yes becomes `connected`, and nothing
    // else does.
    expect(
      movedBy(handed, [
        { name: "olai", attached: true, said: "connected" },
        { name: "alpha", attached: true, said: "connected" },
      ]),
    ).toEqual([
      // ... and the agent's own word rides the row it moved, whole: `said` is
      // the agent's sentence wherever it said one (`@kolu/acp/wire`'s
      // `Server`), and a tick with `null` beside it would be a row saying
      // nobody had spoken about a server the agent had just spoken about.
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
    // POSITIVE RECOGNITION: `needs-auth` and `pending` are not failures in the
    // sense `failed` is, and none of the three is a connection. A reader can
    // act on the difference between them — sign the server in, wait, go and
    // look — which is why the word is carried rather than categorised.
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
    // The status set is the CLI's and grows without asking anybody here, so the
    // leg answers `attached: false` for a word it does not know — and the WORD
    // still travels, because "it did not work" is the log line this whole
    // feature exists to stop putting on screen.
    const moved = movedBy(handed, [
      { name: "olai", attached: false, said: "reticulating" },
    ]);
    expect(moved?.[0]).toMatchObject({
      standing: "unattached",
      said: "reticulating",
    });
  });

  test("a row the agent did not name keeps the standing it had", () => {
    // An agent naming some of its servers has said nothing about the others.
    // Read as a downgrade, a row would flicker on every message that happened
    // to be shorter than the last.
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
    // The layer's boundary. The agent's own servers are configured where olai
    // cannot see, are named at most once a turn by an agent free to reconnect
    // one in between, and are not named at all on the other leg — so a row for
    // one could never be kept honest. The panel says "plus the agent's own".
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
    // This host's `alpha` would not answer olai's probe, so the session was
    // never given one. An agent reporting an `alpha` is reporting ITS OWN — one
    // out of somebody's `~/.claude.json` — and letting that turn the row into a
    // tick would erase the one failure `mcp-fail-visible` exists to show.
    const withAbsent = rosterOf([OLAI], [ABSENT]);
    expect(
      movedBy(withAbsent, [
        { name: "alpha", attached: true, said: "connected" },
      ]),
    ).toBeNull();
  });

  test("a report that moves nothing is not news", () => {
    // Asked on every message the agent forwards, and the Claude adapter
    // forwards one per TURN. A conversation whose servers are all fine would
    // otherwise republish an identical roster to every open tab forever.
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
    // The other side of it: a `needs-auth` that becomes `connected` between two
    // turns is news, and a roster that only ever moved once would leave the
    // reason up over a server that is now fine.
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
    // What a panel between two conversations holds. A forwarded message still
    // in flight from the finished session names rows that belong to a
    // conversation nobody is in.
    expect(
      movedBy([], [{ name: "olai", attached: true, said: "connected" }]),
    ).toBeNull();
  });
});
