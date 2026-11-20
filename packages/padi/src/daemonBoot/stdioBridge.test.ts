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

    expect(order).toEqual(["ssh-auth", "converge", "banner", "relay"]);
  });

  it("REFUSES on the wire and never relays — carrying the typed anomaly verbatim", async () => {
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
      anomaly,
    });
  });

  it("does not greet at all when the converge itself fails", async () => {
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
    expect(readdirSync(dir).sort()).toEqual(["agent.1000", "ssh-auth.sock"]);
  });

  it("repoints a link that already names a previous link's socket", () => {
    const first = join(dir, "agent.999");
    writeFileSync(first, "");
    symlinkSync(first, linkPath);

    writeFileSync(socket, "");
    repointSshAuthSockLink({ linkPath, env: { SSH_AUTH_SOCK: socket } });

    expect(readlinkSync(linkPath)).toBe(socket);
  });

  it("leaves the link untouched when the env names no socket", () => {
    const previous = join(dir, "agent.previous");
    writeFileSync(previous, "");
    symlinkSync(previous, linkPath);

    repointSshAuthSockLink({ linkPath, env: {} });
    repointSshAuthSockLink({ linkPath, env: { SSH_AUTH_SOCK: "" } });

    expect(readlinkSync(linkPath)).toBe(previous);
  });

  it("leaves the link untouched when the named target does not exist", () => {
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
    const nested = join(dir, "padi-digest", "ssh-auth.sock");
    writeFileSync(socket, "");

    repointSshAuthSockLink({
      linkPath: nested,
      env: { SSH_AUTH_SOCK: socket },
    });

    expect(readlinkSync(nested)).toBe(socket);
  });
});
