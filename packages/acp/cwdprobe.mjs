import { connect } from "node:net";
import { Readable, Writable } from "node:stream";
import {
  ClientSideConnection,
  ndJsonStream,
  PROTOCOL_VERSION,
} from "@zed-industries/agent-client-protocol";
const sock = process.argv[2];
const s = await new Promise((res, rej) => {
  const c = connect(sock)
    .once("connect", () => res(c))
    .once("error", rej);
});
const conn = new ClientSideConnection(
  () => ({
    sessionUpdate: async () => {},
    requestPermission: async () => {
      throw new Error("nope");
    },
  }),
  ndJsonStream(Writable.toWeb(s), Readable.toWeb(s)),
);
await conn.initialize({ protocolVersion: PROTOCOL_VERSION });
try {
  const sess = await conn.newSession({ cwd: process.cwd(), mcpServers: [] });
  console.log("OK session", sess.sessionId, "from cwd", process.cwd());
} catch (e) {
  console.log(
    "REFUSED from cwd",
    process.cwd(),
    ":",
    JSON.stringify(e?.data ?? String(e)),
  );
}
process.exit(0);
