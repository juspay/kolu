/**
 * The `padi --stdio` front's ORDER — register the link's ssh-agent socket,
 * converge, greet, relay (juspay/kolu#2101, #2313).
 *
 * The remote arm's whole failure was an ordering one: it spliced first and asked
 * questions never. So the replacement order is pinned here directly, on the real
 * composition (`runPadiStdioBridgeWith`) with the steps it is defined over
 * injected — no daemon forked, no test runner re-exec'd.
 *
 * What each case would look like if it silently regressed:
 *   - relay before the banner → the client attaches to bytes it has no proof about;
 *   - banner before converge  → a `ready` that certifies a daemon nobody checked;
 *   - relay after a refusal   → a fail-fast that does not actually stop;
 *   - converge before the ssh-auth repoint → a daemon spawned by that converge can
 *     spawn a terminal that carries the PREVIOUS link's (dead) agent socket.
 *
 * The converge STEP itself (probe → classify unspeakable → corroborate → take
 * over) is the framework's, and is pinned by the supervisor's own suites plus
 * `dial.test.ts`'s real `padi --stdio` front, which now cannot pass unless the
 * front converges and greets for real.
 */

import {
  mkdtempSync,
  readdirSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { STDIO_READINESS_KEY } from "@kolu/surface/links/readiness";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PadiStdioFrontRefused,
  repointSshAuthSockLink,
  runPadiStdioBridgeWith,
} from "./stdioBridge.ts";

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

describe("runPadiStdioBridge — register the agent, converge, greet, relay", () => {
  it("registers this link's ssh-agent socket BEFORE it converges", async () => {
    const order: string[] = [];
    const stdout = new PassThrough();
    stdout.on("data", () => order.push("banner"));

    await runPadiStdioBridgeWith(
      {},
      {
        pointSshAuthSock: () => {
          order.push("ssh-auth");
        },
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
    expect(order).toEqual(["ssh-auth", "converge", "banner", "relay"]);
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

    const failure = await runPadiStdioBridgeWith(
      {},
      {
        pointSshAuthSock: () => {},
        converge: Effect.succeed({
          verdict: "refused" as const,
          detail: "this host's padi speaks a previous protocol epoch",
          anomaly,
        }),
        stdout,
        relay: async () => {
          relayed = true;
        },
      },
    ).catch((err: unknown) => err);

    expect(relayed).toBe(false);
    expect(failure).toBeInstanceOf(PadiStdioFrontRefused);

    const [banner] = banners(stdout);
    expect(banner).toMatchObject({
      v: 1,
      verdict: "refused",
      detail: "this host's padi speaks a previous protocol epoch",
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
    const failure = await runPadiStdioBridgeWith(
      {},
      {
        pointSshAuthSock: () => {},
        converge: Effect.fail(new Error("osfacts binary is not baked")),
        stdout,
        relay: async () => {},
      },
    ).catch((err: unknown) => err);

    expect((failure as Error).message).toMatch(/osfacts/);
    expect(banners(stdout)).toEqual([]);
  });
});

describe("repointSshAuthSockLink — the producer half of #2313", () => {
  let dir: string;
  let linkPath: string;
  let socket: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "padi-ssh-auth-"));
    linkPath = join(dir, "ssh-auth.sock");
    socket = join(dir, "agent.1000");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("points the link at the live socket the env names, leaving no temp behind", () => {
    writeFileSync(socket, "");
    repointSshAuthSockLink({ linkPath, env: { SSH_AUTH_SOCK: socket } });

    expect(readlinkSync(linkPath)).toBe(socket);
    // The atomically-renamed link is the ONLY new entry: no `.kolu-tmp` residue
    // for a concurrent spawn to trip over.
    expect(readdirSync(dir).sort()).toEqual(["agent.1000", "ssh-auth.sock"]);
  });

  it("repoints a link that already names a previous link's socket", () => {
    // The bug itself: the first ssh link's socket was frozen onto the link, and
    // sshd deleted that path when the session closed. A second link must win.
    const first = join(dir, "agent.999");
    writeFileSync(first, "");
    symlinkSync(first, linkPath);

    writeFileSync(socket, "");
    repointSshAuthSockLink({ linkPath, env: { SSH_AUTH_SOCK: socket } });

    expect(readlinkSync(linkPath)).toBe(socket);
  });

  it("leaves the link untouched when the env names no socket", () => {
    // Another concurrent link may own the link — and "no forwarded agent" is not
    // evidence that the previous one's socket is gone.
    const previous = join(dir, "agent.previous");
    writeFileSync(previous, "");
    symlinkSync(previous, linkPath);

    repointSshAuthSockLink({ linkPath, env: {} });
    repointSshAuthSockLink({ linkPath, env: { SSH_AUTH_SOCK: "" } });

    expect(readlinkSync(linkPath)).toBe(previous);
  });

  it("leaves the link untouched when the named target does not exist", () => {
    // A stale `SSH_AUTH_SOCK` (sshd removed the socket, or the env is a leftover)
    // must not replace a link another live session owns.
    const previous = join(dir, "agent.previous");
    writeFileSync(previous, "");
    symlinkSync(previous, linkPath);

    repointSshAuthSockLink({
      linkPath,
      env: { SSH_AUTH_SOCK: join(dir, "agent.gone") },
    });

    expect(readlinkSync(linkPath)).toBe(previous);
  });

  it("creates the runtime home on a host's first link", () => {
    // The bridge runs BEFORE the converge, so the daemon's runtime home may not
    // exist yet on a brand-new host. That must not cost the first link its agent.
    const nested = join(dir, "padi-digest", "ssh-auth.sock");
    writeFileSync(socket, "");

    repointSshAuthSockLink({
      linkPath: nested,
      env: { SSH_AUTH_SOCK: socket },
    });

    expect(readlinkSync(nested)).toBe(socket);
  });
});
