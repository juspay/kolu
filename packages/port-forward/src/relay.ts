import { connect, type Server, type Socket } from "node:net";
import { messageOf } from "./diagnostic.ts";
import type { ForwardReport, OpenedForward } from "./mechanism.ts";
import { LOOPBACK_ADDRESS, type LoopbackFamily } from "./target.ts";
import { openPreferringPort, PortUnavailableError } from "./portChoice.ts";

function selfRelayError(targetPort: number): Error {
  return new Error(
    `port-forward: a relay for local port ${targetPort} cannot listen on that same number — it would relay into itself.`,
  );
}

export function openRelay(opts: {
  port: number;
  report: ForwardReport;
  listen: (onConnection: (socket: Socket) => void) => Server;
  lastLocalPort: number | undefined;
  loopback: LoopbackFamily;
}): Promise<OpenedForward> {
  const { port, lastLocalPort } = opts;
  if (lastLocalPort === port) throw selfRelayError(port);
  return lastLocalPort === undefined
    ? openRelayOn(opts, 0)
    : openPreferringPort({
        preferred: lastLocalPort,
        open: (localPort) => openRelayOn(opts, localPort),
      });
}

function openRelayOn(
  opts: {
    port: number;
    report: ForwardReport;
    listen: (onConnection: (socket: Socket) => void) => Server;
    loopback: LoopbackFamily;
  },
  localPort: number,
): Promise<OpenedForward> {
  const { port, report } = opts;
  const dial = LOOPBACK_ADDRESS[opts.loopback];
  const live = new Set<Socket>();

  const server = opts.listen((inbound) => {
    const outbound = connect({ host: dial, port });
    live.add(inbound);
    live.add(outbound);
    const drop = (): void => {
      live.delete(inbound);
      live.delete(outbound);
      inbound.destroy();
      outbound.destroy();
    };
    inbound.on("error", drop);
    outbound.on("error", drop);
    inbound.on("close", drop);
    outbound.on("close", drop);
    inbound.pipe(outbound);
    outbound.pipe(inbound);
  });

  let relayState:
    | { readonly kind: "up" }
    | { readonly kind: "closing"; readonly done: Promise<void> }
    | { readonly kind: "down" } = { kind: "up" };

  const teardown = (): Promise<void> => {
    if (relayState.kind === "down") return Promise.resolve();
    if (relayState.kind === "closing") return relayState.done;
    const attempt = new Promise<void>((done, fail) => {
      for (const socket of live) socket.destroy();
      live.clear();
      if (!server.listening) {
        relayState = { kind: "down" };
        done();
        return;
      }
      server.close((err) => {
        if (err !== undefined) fail(err);
        else {
          relayState = { kind: "down" };
          done();
        }
      });
    });
    if (relayState.kind === "up") {
      relayState = { kind: "closing", done: attempt };
    }
    attempt.catch(() => {
      if (relayState.kind === "closing" && relayState.done === attempt) {
        relayState = { kind: "up" };
      }
    });
    return attempt;
  };

  return new Promise((resolve, reject) => {
    const onListenError = (err: Error): void => {
      const code = (err as NodeJS.ErrnoException).code;
      reject(
        code === "EADDRINUSE" || code === "EACCES"
          ? new PortUnavailableError(localPort, err.message)
          : err,
      );
    };
    server.once("error", onListenError);
    server.listen({ host: "0.0.0.0", port: localPort }, () => {
      server.removeListener("error", onListenError);
      server.on("error", (err) => {
        if (relayState.kind !== "up") return;
        const reason = `the local relay listener failed: ${err.message}`;
        teardown().then(
          () => report.lost(reason),
          (closeError: unknown) =>
            report.fault(
              `${reason}, and closing it failed too: ${messageOf(closeError)}`,
            ),
        );
      });
      const address = server.address();
      if (address === null || typeof address === "string") {
        void teardown();
        reject(
          new Error(
            `port-forward: the relay listener has no TCP address (got ${JSON.stringify(address)}).`,
          ),
        );
        return;
      }
      if (address.port === port) {
        void teardown();
        reject(selfRelayError(port));
        return;
      }
      resolve({ localPort: address.port, close: teardown });
    });
  });
}
