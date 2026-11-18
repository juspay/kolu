/**
 * The generic seam: what a session is handed, and what it is told about what it
 * was not.
 *
 * PURE of any appliance, which is the claim this file exists to hold as much as
 * any assertion in it. Its fixtures are servers called `alpha` and `beta`,
 * because nothing in `olai-plugin-chat` may know what an optional MCP server actually
 * IS — the probes arrive as a list ({@link ./probes.ts}) and this package's job
 * is to ask them all once, hand over what answered, and carry whole the
 * sentence about what did not.
 *
 * The rendering case came from `kolu.test.ts`, which asserted `mcpServersOf`
 * from a file that was otherwise entirely about detecting one appliance. The
 * probe moved to `olai-plugin-kolu`; the rendering belongs to whoever owns
 * `mcpServersOf`, which is this package.
 */

import { describe, expect, test } from "vitest";
import { Effect } from "effect";

import { mcpServersOf } from "./agent.ts";
import {
  handedIn,
  missingIn,
  type Probe,
  type Probed,
  probed,
  type StdioServer,
} from "./probes.ts";

const ALPHA: StdioServer = {
  name: "alpha",
  command: "/nix/store/x/bin/alpha",
  args: ["mcp"],
  env: { ALPHA_SOCKET: "/run/alpha.sock" },
};

const BETA: StdioServer = {
  name: "beta",
  command: "/nix/store/y/bin/beta",
  args: ["serve", "--stdio"],
  env: {},
};

/** A probe that answers what it is told to, after however long it is told to
 *  take — the delay is what the ordering and overlap cases turn on. */
const answering = (name: string, found: Probed, afterMs = 0): Probe => ({
  name,
  // AN EFFECT, like everything a plugin hands core — and the delay is Effect's
  // own. It was a `setTimeout` inside `Effect.promise`, which is a raw promise
  // and therefore UNINTERRUPTIBLE: the one helper that stages the overlap these
  // cases are about was staging it with the one shape the runtime cannot
  // cancel, under the fiber pool whose bounded concurrency is the subject.
  ask: Effect.delay(Effect.succeed(found), `${afterMs} millis`),
});

const run = <A>(effect: Effect.Effect<A>): Promise<A> =>
  Effect.runPromise(effect);

describe("asking what this host is running", () => {
  test("both halves come off ONE answer per probe", async () => {
    const found = await run(
      probed([
        answering("alpha", { server: ALPHA, missing: null }),
        answering("beta", {
          server: null,
          missing: {
            name: "beta",
            where: "/usr/bin/beta",
            why: "it would not answer",
          },
        }),
      ]),
    );

    // The invariant, said as an assertion: the servers to hand over and the
    // sentences to say are two READINGS of the same array, so a session cannot
    // be opened on one probing and reported on another.
    expect(handedIn(found)).toEqual([ALPHA]);
    expect(missingIn(found)).toEqual([
      { name: "beta", where: "/usr/bin/beta", why: "it would not answer" },
    ]);
  });

  test("each probe is asked exactly once", async () => {
    let asked = 0;
    const counting: Probe = {
      name: "alpha",
      ask: Effect.sync(() => {
        asked += 1;
        return { server: ALPHA, missing: null };
      }),
    };

    const found = await run(probed([counting]));
    // Read BOTH halves, which is what a session open does: a seam that probed
    // per question would spawn somebody's daemon twice per conversation.
    handedIn(found);
    missingIn(found);
    expect(asked).toBe(1);
  });

  test("the answers keep the order they were asked in, not the order they arrived", async () => {
    // The slow one is FIRST. An implementation that collected answers as they
    // landed would put `beta` at the head, and the roster a person reads would
    // reshuffle itself per conversation depending on which daemon woke first.
    const found = await run(
      probed([
        answering("alpha", { server: ALPHA, missing: null }, 30),
        answering("beta", { server: BETA, missing: null }),
      ]),
    );

    expect(handedIn(found).map((one) => one.name)).toEqual(["alpha", "beta"]);
  });

  test("they overlap, so the wall clock is the slowest probe and not the sum", async () => {
    // The hazard this bounds: a probe waits on a subprocess with a deadline in
    // seconds, and it runs on the session-open path, which already has a
    // documented `session === null` window. Serial probing multiplies that
    // window by however many plugins a build has.
    const started = Date.now();
    await run(
      probed([
        answering("alpha", { server: ALPHA, missing: null }, 60),
        answering("beta", { server: BETA, missing: null }, 60),
        answering("gamma", { server: null, missing: null }, 60),
      ]),
    );

    // Generous against a loaded CI box, and still far under the ~180ms three of
    // these cost one after another.
    expect(Date.now() - started).toBeLessThan(150);
  });

  test("a host running none of them is quiet, and is not a failure", async () => {
    const found = await run(
      probed([answering("alpha", { server: null, missing: null })]),
    );

    expect(handedIn(found)).toEqual([]);
    // Nothing went wrong: a machine that never had the tool is owed no
    // sentence, and a row saying otherwise would be a permanent complaint on
    // every machine that has never heard of it.
    expect(missingIn(found)).toEqual([]);
  });

  test("no probes at all is an empty answer and no work", async () => {
    expect(await run(probed([]))).toEqual([]);
  });
});

describe("what the session is handed", () => {
  const tools = {
    name: "olai",
    url: "http://127.0.0.1:7714/mcp",
    token: "secret",
  };

  const OLAI_ENTRY = {
    type: "http" as const,
    name: "olai",
    url: "http://127.0.0.1:7714/mcp",
    headers: [{ name: "Authorization", value: "Bearer secret" }],
  };

  test("a probed server rides beside olai's own, as stdio beside http", () => {
    expect(mcpServersOf(tools, [ALPHA])).toEqual([
      OLAI_ENTRY,
      {
        name: "alpha",
        command: "/nix/store/x/bin/alpha",
        args: ["mcp"],
        // The environment as ACP wants it: a list of pairs, not a record.
        env: [{ name: "ALPHA_SOCKET", value: "/run/alpha.sock" }],
      },
    ]);
  });

  test("two of them keep the order they were probed in, after olai's own", () => {
    expect(mcpServersOf(tools, [ALPHA, BETA]).map((one) => one.name)).toEqual([
      "olai",
      "alpha",
      "beta",
    ]);
  });

  test("nothing found leaves the list exactly as it was", () => {
    expect(mcpServersOf(tools, [])).toEqual([OLAI_ENTRY]);
  });
});
