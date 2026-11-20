import { PassThrough } from "node:stream";
import { STDIO_READINESS_KEY } from "@kolu/surface/links/readiness";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { KavalStdioFrontRefused, runStdioBridgeWith } from "./stdioBridge.ts";

function banners(stdout: PassThrough): Array<Record<string, unknown>> {
  const written = stdout.read();
  if (written === null) return [];
  return String(written)
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>)
    .map((frame) => frame[STDIO_READINESS_KEY] as Record<string, unknown>);
}

describe("runStdioBridge — converge, greet, relay", () => {
  it("greets `ready` BEFORE it engages the relay, and only after converging", async () => {
    const order: string[] = [];
    const stdout = new PassThrough();
    stdout.on("data", () => order.push("banner"));

    await runStdioBridgeWith(
      {},
      {
        converge: Effect.sync(() => {
          order.push("converge");
          return { verdict: "ready" as const };
        }),
        stdout,
        relay: async () => {
          order.push("relay");
        },
      },
    );

    expect(order).toEqual(["converge", "banner", "relay"]);
  });

  it("REFUSES on the wire and never relays — carrying the typed anomaly verbatim", async () => {
    const anomaly = {
      kind: "unconverged",
      cause: { kind: "unspeakable-protocol", pid: 25494 },
    };
    const stdout = new PassThrough();
    let relayed = false;

    const failure = await runStdioBridgeWith(
      {},
      {
        converge: Effect.succeed({
          verdict: "refused" as const,
          detail: "this host's kaval speaks a previous protocol epoch",
          anomaly,
        }),
        stdout,
        relay: async () => {
          relayed = true;
        },
      },
    ).catch((err: unknown) => err);

    expect(relayed).toBe(false);
    expect(failure).toBeInstanceOf(KavalStdioFrontRefused);

    const [banner] = banners(stdout);
    expect(banner).toMatchObject({
      v: 1,
      verdict: "refused",
      detail: "this host's kaval speaks a previous protocol epoch",
      anomaly,
    });
  });

  it("does not greet at all when the converge itself fails", async () => {
    const stdout = new PassThrough();
    const failure = await runStdioBridgeWith(
      {},
      {
        converge: Effect.fail(new Error("osfacts binary is not baked")),
        stdout,
        relay: async () => {},
      },
    ).catch((err: unknown) => err);

    expect((failure as Error).message).toMatch(/osfacts/);
    expect(banners(stdout)).toEqual([]);
  });
});
