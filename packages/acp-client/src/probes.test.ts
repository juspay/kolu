import { describe, expect, test } from "vitest";
import { Effect } from "effect";

import { mcpServersOf } from "./agent.ts";
import {
  handedIn,
  missingIn,
  type Probe,
  type Probed,
  probed,
  type ProbedServer,
} from "./probes.ts";

const ALPHA: ProbedServer = {
  name: "alpha",
  command: "/nix/store/x/bin/alpha",
  args: ["mcp"],
  env: { ALPHA_SOCKET: "/run/alpha.sock" },
};

const BETA: ProbedServer = {
  name: "beta",
  command: "/nix/store/y/bin/beta",
  args: ["serve", "--stdio"],
  env: {},
};

const answering = (name: string, found: Probed, afterMs = 0): Probe => ({
  name,
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
    handedIn(found);
    missingIn(found);
    expect(asked).toBe(1);
  });

  test("the answers keep the order they were asked in, not the order they arrived", async () => {
    const found = await run(
      probed([
        answering("alpha", { server: ALPHA, missing: null }, 30),
        answering("beta", { server: BETA, missing: null }),
      ]),
    );

    expect(handedIn(found).map((one) => one.name)).toEqual(["alpha", "beta"]);
  });

  test("they overlap, so the wall clock is the slowest probe and not the sum", async () => {
    const started = Date.now();
    await run(
      probed([
        answering("alpha", { server: ALPHA, missing: null }, 60),
        answering("beta", { server: BETA, missing: null }, 60),
        answering("gamma", { server: null, missing: null }, 60),
      ]),
    );

    expect(Date.now() - started).toBeLessThan(150);
  });

  test("a host running none of them is quiet, and is not a failure", async () => {
    const found = await run(
      probed([answering("alpha", { server: null, missing: null })]),
    );

    expect(handedIn(found)).toEqual([]);
    expect(missingIn(found)).toEqual([]);
  });

  test("no probes at all is an empty answer and no work", async () => {
    expect(await run(probed([]))).toEqual([]);
  });
});

describe("what the session is handed", () => {
  const tools = [
    {
      kind: "http" as const,
      name: "olai",
      url: "http://127.0.0.1:7714/mcp",
      headers: { Authorization: "Bearer secret" },
    },
  ];

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
