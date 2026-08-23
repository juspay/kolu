# @kolu/detect

**Is there a usable kolu on this host — and if not, why not?** An app that
wants to hand its coding agent kolu's terminals spawns `kolu mcp` as an MCP
server. The question it has to answer first is not "is `kolu` installed"; it is
"will the kolu that a spawn from *here* resolves to actually serve a live
workspace". Those come apart, and each way shipped as a real incident:

- **A path is not evidence.** A kolu terminal prepends its own bundled copy to
  `PATH`, and one of those was an older build reporting the same version string
  while missing most of the verbs ([#2146][2146]). The wrong build still spawns.
- **A handshake is not evidence either.** `kolu mcp` completes `initialize`,
  lists every tool and lists its resources with **no daemon behind it at all**
  ([#2148][2148]) — so only reading a cell the daemon owns separates a live
  workspace from a process that will fail every call it just advertised.
- **The PATH that matters is the spawner's.** A server started as a systemd
  user service does not inherit the PATH its user types at.

So `detect` resolves the executable, **starts it**, handshakes, and asks it to
read `surface://cells/identity` — padi's own identity, which a kolu that
reached no daemon cannot produce. The probe is never a client: it is killed
either way, and the caller spawns its own server at the **absolute path that
answered**.

It lives in its own **zero-dependency leaf package** (`node:child_process` and
nothing else) so an app on an otherwise-incompatible dependency tree can reach
it — the same shape as [`@kolu/shell-quote`](../shell-quote) and
[`@kolu/html-escape`](../html-escape).

## API

```ts
import { detect } from "@kolu/detect";

const found = await detect({
  path: process.env.PATH, // the LIVE PATH — what a spawn would resolve against
  socket: process.env.PADI_SOCKET, // optional: which padi to forward
});

if (found._tag === "reachable") {
  // Start YOUR MCP client against exactly this, not the bare word `kolu`.
  const { command, args, env } = found.server;
} else if (found._tag === "unreachable") {
  // A kolu is here and would not answer. `found.why` says which way:
  // couldNotStart · refused · closed · timedOut · failed
  report(found.command, found.why);
}
// `notOnPath` — nothing by that name. Whether that is worth reporting is
// yours to judge, so it carries no reason.
```

`probe(child, deadlineMs)` is the conversation half on its own, for a caller
that already owns a started `kolu mcp` process.

## It reports; it does not editorialize

Every "no" is a **value** naming which no it was, and nothing here logs,
throws, or words a sentence for a screen. That split is deliberate: whether a
missing kolu is worth telling a user about depends on facts kolu cannot see
(did anything declare that a workspace should be here?), and the sentence that
renders it belongs to whoever draws the screen. Kolu owns *which padi and
whether it answered*; the app owns *what to say about it*.

For the same reason nothing reads `process.env` on the caller's behalf — `path`
and `socket` are passed in, so a caller forwarding an inherited socket and one
naming a socket deliberately take the same path, and a test can drive either
without mutating the environment underneath itself.

[2146]: https://github.com/juspay/kolu/issues/2146
[2148]: https://github.com/juspay/kolu/issues/2148
