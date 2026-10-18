/**
 * `unixSocketConnector` against a REAL unix socket in a temp dir. No surface
 * server is stood up: the facts under test are the transport's — what absence
 * classifies as, and that the connection's `closed` is the socket's own close —
 * and a bare `net.createServer` produces all three honestly.
 *
 * Every wait here is a real event (`listening`, `close`, the connection's own
 * `closed` promise). A timer would make the suite's verdict depend on a guess.
 */
import { mkdtempSync, renameSync, rmSync } from "node:fs";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import { defineSurface } from "@kolu/surface/define";
import { Schema } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import {
  ConnectError,
  type ConnectContext,
  EndpointAbsentError,
} from "./session";
import { unixSocketConnector } from "./unixSocketConnector";

/** Any real surface will do — the suite never issues a call, it only needs a
 *  group the link can be built over. */
const probeSurface = defineSurface({
  cells: { ping: { schema: Schema.String, default: "" } },
});

/** The loop's context, reduced to what a dial reads. `connecting` is recorded so
 *  the success case can assert the connector announced the transport. */
function fakeCtx(): ConnectContext & { connectingCalls: number } {
  const ctx = {
    connectingCalls: 0,
    localProgress: () => {},
    remoteProgress: () => {},
    activity: () => {},
    provisioning: () => {},
    connecting: () => {
      ctx.connectingCalls += 1;
    },
    signal: new AbortController().signal,
    campaignEpoch: 0,
  };
  return ctx;
}

const dirs: string[] = [];
const servers: Server[] = [];

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "unix-connector-"));
  dirs.push(dir);
  return dir;
}

function connectorFor(socketPath: string) {
  return unixSocketConnector({
    socketPath: () => socketPath,
    group: probeSurface.group,
    client: (dispatch) => ({ dispatch }),
    describe: "probe daemon",
  });
}

afterEach(async () => {
  for (const server of servers.splice(0)) {
    if (server.listening) {
      server.close();
      await once(server, "close");
    }
  }
  for (const dir of dirs.splice(0))
    rmSync(dir, { recursive: true, force: true });
});

describe("unixSocketConnector", () => {
  it("throws EndpointAbsentError when no socket file exists (ENOENT)", async () => {
    const connect = connectorFor(join(tempDir(), "absent.sock"));
    const err = await connect(fakeCtx()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EndpointAbsentError);
    // The absence arm must still classify through every existing ConnectError path.
    expect(err).toBeInstanceOf(ConnectError);
    expect((err as ConnectError).failureCause).toBe("network");
    expect((err as Error).message).toContain("absent.sock");
  });

  it("throws EndpointAbsentError when the path exists but refuses (ECONNREFUSED)", async () => {
    const dir = tempDir();
    const socketPath = join(dir, "stale.sock");
    // A SOCKET file nobody is bound to — exactly the leftover a crashed daemon
    // leaves. A regular file is NOT that: on darwin, connecting to one is
    // ENOTSOCK, not ECONNREFUSED, so the fixture must be a real socket. Bind
    // one, move it out from under libuv's remembered name, then close the
    // listener — the file survives, listenerless, at `socketPath`.
    const bound = join(dir, "bound.sock");
    const server = createServer();
    servers.push(server);
    server.listen(bound);
    await once(server, "listening");
    renameSync(bound, socketPath);
    server.close();
    await once(server, "close");

    const err = await connectorFor(socketPath)(fakeCtx()).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(EndpointAbsentError);
    expect(err).toBeInstanceOf(ConnectError);
  });

  it("a live socket yields a Connection whose closed resolves endpoint-down, with an idempotent teardown", async () => {
    const socketPath = join(tempDir(), "live.sock");
    let accepted: Socket | undefined;
    const acceptedOnce = new Promise<Socket>((resolve) => {
      const server = createServer((sock) => {
        accepted = sock;
        resolve(sock);
      });
      servers.push(server);
      server.listen(socketPath);
    });
    await once(servers[0] as Server, "listening");

    const ctx = fakeCtx();
    const connection = await connectorFor(socketPath)(ctx);
    expect(ctx.connectingCalls).toBe(1);
    expect(connection.dispatch).toBeDefined();

    // The server hangs up: the endpoint went away, which is the ONE closed verdict
    // this transport can produce.
    (await acceptedOnce).destroy();
    expect(await connection.closed).toEqual({ kind: "endpoint-down" });

    // Teardown runs on overlapping paths (recheck, destroy); twice must be safe.
    connection.teardown();
    connection.teardown();
    expect(accepted?.destroyed).toBe(true);
  });
});
