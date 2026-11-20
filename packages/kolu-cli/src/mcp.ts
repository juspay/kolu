import { writeSync } from "node:fs";
import { type KoluMcpConnection, serveKoluMcp } from "kolu-mcp";
import { serverVersion } from "kolu-server/src/hostname.ts";
import { Effect } from "effect";
import {
  connectKoluCliLocal,
  type KoluCliDialError,
  type KoluCliConnection,
} from "./connect.ts";
import type { Endpoint } from "./endpoint.ts";
import { CliExitCode, CliFailure } from "./exit.ts";
import { connectKoluCliViaHost } from "./hostConnect.ts";

const mcpFaceLine = (message: string): string => `kolu mcp: ${message}\n`;

const mcpFaceFailure = (message: string): CliFailure =>
  new CliFailure({
    reason: message,
    stderr: mcpFaceLine(message),
    code: CliExitCode.refused,
  });

export function probePadiAtStartup(
  dial: Effect.Effect<KoluCliConnection, KoluCliDialError>,
): Effect.Effect<void, CliFailure> {
  return Effect.flatMap(
    Effect.mapError(dial, (err) => mcpFaceFailure(err.message)),
    (conn) =>
      Effect.sync(() => {
        conn.dispose();
      }),
  );
}

export function midSessionDial(
  dial: Effect.Effect<KoluCliConnection, KoluCliDialError>,
): Effect.Effect<KoluMcpConnection, Error> {
  return Effect.catch(dial, (err) =>
    err._tag === "PadiContractSkew"
      ? Effect.sync((): never => exitAfterBestEffortStderr(err.message))
      : Effect.fail(
          new Error(
            `padi transport down: ${err.message} (retryable — kolu mcp queues nothing; retry once padi is reachable)`,
          ),
        ),
  );
}

function exitAfterBestEffortStderr(message: string): never {
  try {
    writeSync(process.stderr.fd, mcpFaceLine(message));
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "EPIPE" && code !== "EBADF" && code !== "EAGAIN") throw err;
  }
  process.exit(1);
}

export function runKoluMcp(opts: {
  readonly endpoint: Endpoint;
}): Effect.Effect<void, CliFailure> {
  const endpoint = opts.endpoint;
  const rawDial =
    endpoint.kind === "host"
      ? connectKoluCliViaHost(endpoint.ssh)
      : connectKoluCliLocal(endpoint);
  const dial = midSessionDial(rawDial);

  return Effect.gen(function* () {
    yield* probePadiAtStartup(rawDial);

    const { server } = yield* Effect.promise(() =>
      serveKoluMcp({
        connect: () => Effect.runPromise(dial),
        serverInfo: { name: "kolu-mcp", version: serverVersion },
      }),
    );

    yield* Effect.sync(() => {
      const inner = server.onclose;
      server.onclose = (): void => {
        inner?.();
        process.exit(0);
      };
    });
  });
}
