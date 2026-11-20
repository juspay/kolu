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
  loopback: "v4",
  host,
  port: Number(remotePort),
});
process.stdout.write(`READY ${forward.localPort}\n`);

setInterval(() => {}, 1_000);
