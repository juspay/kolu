/**
 * Fixture for `lifetime.test.ts`: open one real ssh forward through the public
 * API, print the port it answers on, and then do nothing at all — so the test
 * can SIGKILL this process and watch what happens to the port.
 *
 * It must be a separate PROCESS, because the property under test is exactly
 * "what the kernel does to this forward when the process holding it dies", and
 * a process cannot observe its own SIGKILL.
 *
 * argv: <ssh host> <remote port>
 */

import { createForwardManager } from "./index.ts";

const [host, remotePort] = process.argv.slice(2);
if (host === undefined || remotePort === undefined) {
  throw new Error("usage: lifetime.fixture.ts <ssh host> <remote port>");
}

const forwards = createForwardManager({
  onLost: ({ forward, reason }) => {
    process.stdout.write(`LOST ${forward.key} ${reason}\n`);
  },
});

const forward = await forwards.create({
  kind: "remote",
  host,
  port: Number(remotePort),
});
process.stdout.write(`READY ${forward.localPort}\n`);

// Stay alive until killed. The forward is held by an ssh child of THIS process.
setInterval(() => {}, 1_000);
