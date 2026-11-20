import { createServer } from "node:net";
import type { ForwardMechanisms } from "./mechanism.ts";
import { openRelay } from "./relay.ts";
import { openSshForward, spawnSshChild } from "./sshForward.ts";

export function nativeMechanisms(): ForwardMechanisms {
  return {
    open({ target, report, lastLocalPort }) {
      return target.kind === "local"
        ? openRelay({
            port: target.port,
            report,
            listen: createServer,
            lastLocalPort,
            loopback: target.loopback,
          })
        : openSshForward({
            host: target.host,
            remotePort: target.port,
            report,
            spawnSsh: spawnSshChild,
            lastLocalPort,
            loopback: target.loopback,
          });
    },
  };
}
