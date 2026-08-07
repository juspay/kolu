/**
 * The `kaval --stdio` front's ORDER — converge, greet, relay (juspay/kolu#2101).
 *
 * The twin of `padi/src/daemonBoot/stdioBridge.test.ts`. The remote arm's whole
 * failure was an ordering one: it spliced first and asked questions never. So the
 * replacement order is pinned here directly, on the real composition
 * (`runStdioBridgeWith`) with the three things it is defined over injected — no
 * daemon forked, no test runner re-exec'd.
 *
 * What each case would look like if it silently regressed:
 *   - relay before the banner → the client attaches to bytes it has no proof about;
 *   - banner before converge  → a `ready` that certifies a daemon nobody checked;
 *   - relay after a refusal   → a fail-fast that does not actually stop.
 *
 * The converge STEP itself (probe → classify unspeakable → corroborate → take
 * over) is the framework's, and is pinned by the supervisor's own suites.
 */

import { PassThrough } from "node:stream";
import { STDIO_READINESS_KEY } from "@kolu/surface/links/readiness";
import { Effect } from "effect";
import { describe, expect, it } from "vitest";
import { KavalStdioFrontRefused, runStdioBridgeWith } from "./stdioBridge.ts";

/** Everything written to the fake stdout, as decoded banner bodies. */
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

    // The whole fix, as a sequence. Any permutation is a defect.
    expect(order).toEqual(["converge", "banner", "relay"]);
  });

  it("REFUSES on the wire and never relays — carrying the typed anomaly verbatim", async () => {
    // The previous-epoch case the incident produced: the front met a daemon it
    // could not decode and could not take over. It must say so in a form the ssh
    // client can decode, and it must NOT hand that daemon a client.
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
      // OPAQUE to the framework, intact for the app that decodes it.
      anomaly,
    });
  });

  it("does not greet at all when the converge itself fails", async () => {
    // A converge that THREW proved nothing, so there is nothing honest to say on
    // the wire. It must reach `bin.ts`'s error channel as itself rather than be
    // laundered into a banner — a caught error that collapses into a verdict is
    // exactly what this codebase forbids.
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
